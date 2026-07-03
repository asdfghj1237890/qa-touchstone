// uitests/specs/findings.spec.mjs
// Findings lifecycle UI: suppress / severity-override / note. In browser
// mode no engine produces a findings union, and FindingsPanel.buildRows()
// only renders union rows or baseline-'resolved' rows — so a BASELINE
// snapshot is seeded via localStorage before boot (lastRun: null), which
// yields two operable "resolved" rows. This spec tests the lifecycle UI,
// not the engines (owned by unit/Rust tests). Row titles for
// snapshot-reconstructed rows are their locationLabel (snapshots store no
// title), hence the SEED_LOCATION_* assertions.
import { test, expect } from '@playwright/test';
import { installMockNet } from '../helpers/mockNet.mjs';
import {
  collectPageErrors,
  gotoApp,
  seedFindings,
  SEED_LOCATION_1,
  SEED_LOCATION_2,
} from '../helpers/session.mjs';

test('suppress, override severity, and annotate a seeded finding', async ({ page }) => {
  await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await seedFindings(page); // BEFORE gotoApp: addInitScript plants localStorage pre-boot
  await gotoApp(page);

  await page.getByTestId('nav-security').click();
  await page.getByTestId('sec-mode-findings').click();

  // Both seeded rows render (as presence 'resolved', reconstructed from the
  // baseline snapshot).
  const row1 = page.locator('.qa-find-row', { hasText: SEED_LOCATION_1 });
  await expect(row1).toBeVisible();
  await expect(page.locator('.qa-find-row', { hasText: SEED_LOCATION_2 })).toBeVisible();

  // "Show suppressed" must be checked BEFORE suppressing row1: the visible-
  // rows filter (FindingsPanel.tsx) hides suppressed rows unless this is on,
  // and it does not special-case the currently-open detail row — suppressing
  // row1 first would remove row1 (and its open .qa-find-detail) from the DOM
  // mid-interaction.
  await page.getByLabel('Show suppressed').check();

  // Expand detail; suppress with a reason. Class-based asserts (not i18n
  // strings) so the spec is robust to copy tweaks.
  await row1.click();
  const detail = page.locator('.qa-find-detail');
  await expect(detail).toBeVisible();
  await detail.getByRole('checkbox').first().check(); // suppress toggle (first control in detail)
  await expect(row1.locator('.qa-find-suppressed')).toBeVisible(); // row badge appears
  await detail.locator('input.qa-inp').first().fill('known test artifact'); // suppress reason (renders once suppressed)

  // Severity override control: high → low. Two <select>s live in the detail
  // row (status, then severity override, in DOM order) — target by
  // aria-label rather than a bare `select` locator, which would be ambiguous
  // (strict-mode violation) across both.
  //
  // NOT asserted here: the row's severity cell reflecting the override via
  // `.qa-find-orig`. For 'resolved' (snapshot-reconstructed) rows,
  // FindingsPanel.buildRows() (src/qa/FindingsPanel.tsx:90-106) sets both
  // `severity` and `effectiveSeverity` verbatim from the baseline snapshot
  // item (`bi.effectiveSeverity`) and never calls the `effectiveSeverity()`
  // helper (src/qa/findings.ts:118) the way the live-union branch does
  // (line 83) — so a severityOverride in the lifecycle record has no visual
  // effect on this row type. That's a real product gap (out of scope here:
  // the only src/ change this spec is allowed is the sec-mode-* testids),
  // flagged separately rather than asserted against.
  await detail.getByLabel('Severity override').selectOption('low');
  await expect(detail.getByLabel('Severity override')).toHaveValue('low');

  // Owner + note controls accept input (aria-labels from i18n en dict).
  await detail.getByLabel('Owner').fill('qa-team');
  await detail.getByLabel('Note').fill('tracked in QA-123');

  // Reload: lifecycle state (suppressed/severity/owner/note) persists via
  // localStorage (same context) — but "Show suppressed" is local component
  // state (useState, not persisted), so it resets to unchecked and must be
  // re-enabled or row1 stays hidden by the visible-rows filter.
  await page.reload();
  await page.locator('.qa-app').waitFor();
  await page.getByTestId('nav-security').click();
  await page.getByTestId('sec-mode-findings').click();
  await page.getByLabel('Show suppressed').check();
  const row1Again = page.locator('.qa-find-row', { hasText: SEED_LOCATION_1 });
  await expect(row1Again.locator('.qa-find-suppressed')).toBeVisible();

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
