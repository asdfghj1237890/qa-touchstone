// uitests/specs/navigation.spec.mjs
// Click every nav-rail entry; assert the page renders its identifying
// element (where one exists), the nav marks itself active, and no uncaught
// page errors occur. Console errors are NOT asserted — browser mode
// legitimately warns where Tauri APIs are absent.
import { test, expect } from '@playwright/test';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

// key → identifying selector.
const PAGES = [
  ['home', '.qa-home'],
  ['testgen', '.tg'],
  ['api', '.qa-urlbar'],
  ['realtime', '.qa-realtime'],
  ['runner', '.rn'],
  ['security', '.qa-sec-tabs'],
  ['monitors', '.qa-monitors'],
  ['docs', '.qa-docs'],
  ['perf', '.pf'],
  ['settings', '.qa-settings'],
];

test('every nav tab renders without page errors', async ({ page }) => {
  await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);

  for (const [key, rootSel] of PAGES) {
    const nav = page.getByTestId(`nav-${key}`);
    await nav.click();
    await expect(nav).toHaveAttribute('data-active', '1');
    if (rootSel) {
      await expect(page.locator(rootSel).first()).toBeVisible();
    }
  }
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
