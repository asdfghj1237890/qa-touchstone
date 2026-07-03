// uitests/specs/settings.spec.mjs
// Settings controls that must work identically in both engines:
// AI privacy mode 3-state switch, and the zh-TW ↔ en-US language switch
// (asserted via the settings nav label, which is translated live).
import { test, expect } from '@playwright/test';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

test('privacy mode switches and language round-trips', async ({ page }) => {
  await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);

  await page.getByTestId('nav-settings').click();

  // ── privacy mode: locked-to-local state in this harness ──
  // Modes are 'full' | 'redacted' | 'local' (src/qa/aiPrivacy.ts); buttons
  // carry data-testid="privacy-mode-<m>" and data-active. They live under
  // the settings page's own "AI Privacy" tab (SettingsPage.tsx defaults to
  // the 'appearance' tab), so switch tabs first.
  //
  // This harness runs the production web bundle with no Tauri backend and
  // no VITE_QA_ALLOW_EXTERNAL_AI flag, so App.tsx's boot-time
  // loadAiPolicy() (src/qa/aiPolicy.ts) always resolves to AI_POLICY_DENY
  // (externalAllowed:false, forcedMode:'local', locked:true) — the
  // intentional CI-safe default. PrivacySettings.resolvePolicy() (in
  // SettingsPage.tsx) then renders ONLY the 'local' mode button and
  // disables it (`visibleModes = policy.locked ? ['local'] : MODES`), with
  // a lock banner naming the source. There is no free 3-state switch to
  // exercise here — the meaningful assertion is that the control correctly
  // reflects and enforces this locked state rather than silently allowing
  // a mode change or hiding the lock reason. Note data-active tracks the
  // STORED user preference (cfg.mode, still 'redacted' by default) not the
  // enforced mode, so it stays '0' here — the enforced mode is proven
  // instead via the mode-description paragraph, which is keyed off
  // policy.effectiveMode ('local').
  await page.getByRole('button', { name: 'AI Privacy' }).click();
  const local = page.getByTestId('privacy-mode-local');
  await local.scrollIntoViewIfNeeded();
  await expect(local).toHaveAttribute('data-active', '0');
  await expect(local).toBeDisabled();
  await expect(page.getByTestId('privacy-mode-redacted')).toHaveCount(0);
  await expect(page.getByTestId('privacy-mode-full')).toHaveCount(0);
  await expect(
    page.getByText('External AI disabled by CI / organization policy.')
  ).toBeVisible();
  await expect(
    page.getByText(
      'Only a self-managed (loopback/private/attested) endpoint is allowed. Cloud providers are blocked.'
    )
  ).toBeVisible();

  // ── language: en-US → zh-TW → en-US via the language dropdown ──
  // LOCALES (src/qa/i18nOptions.ts) are {value,label} pairs; the trigger
  // is a <button className="qa-dd-btn"> showing the current LABEL, and the
  // open menu is <div className="qa-dd-menu" role="listbox"> containing
  // <button role="option">. The explicit role="option" (components.tsx)
  // wins over the native <button> tag in the accessibility tree, so menu
  // items must be queried with getByRole('option', ...), not 'button'.
  // The dropdown lives on the "Appearance" tab (the default one), so
  // switch back to it first.
  await page.getByRole('button', { name: 'Appearance' }).click();
  const lang = page.locator('.qa-dd--lang');
  await lang.scrollIntoViewIfNeeded();
  await lang.locator('.qa-dd-btn').click();
  await lang.getByRole('option', { name: '繁體中文' }).click();
  // Live translation: the settings nav aria-label flips to Chinese.
  await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-label', '設定');

  await lang.locator('.qa-dd-btn').click();
  await lang.getByRole('option', { name: 'English (US)' }).click();
  await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-label', 'Settings');

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
