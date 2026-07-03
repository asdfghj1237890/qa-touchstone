// uitests/specs/smoke.spec.mjs
// Browser-mode parity of e2e/specs/smoke.e2e.mjs: import → send → security
// suite → export. Export is asserted via Playwright's download event — the
// blob <a download> path is exactly the path that exists in browser mode
// (src/qa/download.ts fallback), making this the browser-layer analogue of
// the packaged-app 0.21.1 export gate.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const demoCollection = readFileSync(
  join(here, '..', '..', 'demo', 'rest-countries.postman_collection.json'),
  'utf8'
);
const COLLECTION_NAME = 'OpenNet REST Countries — QA Touchstone Collection';

test('smoke: import → send → suite → export lands as a download', async ({ page }) => {
  const blocked = await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);

  // ── import the demo collection through the UI ──
  await page.getByTestId('nav-api').click();
  await page.getByTestId('import-open').click();
  // React controlled textarea: fill() dispatches proper input events.
  await page.getByTestId('import-text').fill(demoCollection);
  await expect(page.locator('.qa-import-preview')).toBeVisible();
  await page.getByTestId('import-submit').click();
  await expect(page.locator('.qa-col-name', { hasText: COLLECTION_NAME })).toBeVisible();

  // ── send a request from the imported collection (fixture-backed, HARD assert) ──
  await page
    .locator('button.qa-req', { hasText: 'Search name: japan' })
    .click();
  await page.getByTestId('send-request').click();
  // Unlike the packaged-app e2e (tolerant, real network), the fixture makes
  // the outcome deterministic: expect a 200 in the response bar.
  await expect(page.locator('.qa-resp-bar')).toContainText('200', { timeout: 20_000 });

  // ── run the security suite to completion ──
  await page.getByTestId('nav-security').click();
  await page.getByTestId('suite-run').click();
  // Suite complete signal: export menu unlocks (same signal as e2e smoke).
  await expect(page.getByTestId('report-export')).toBeVisible({ timeout: 120_000 });

  // ── export the JSON report; assert the download really happens ──
  await page.getByTestId('report-export').click();
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByTestId('report-export-json').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^qa-security-.*\.json$/);
  const reportPath = await download.path();
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const key of ['meta', 'engines', 'summary', 'findings']) {
    expect(report).toHaveProperty(key);
  }

  // ── determinism + health gates ──
  expect(blocked, `unmocked hosts requested:\n${blocked.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
