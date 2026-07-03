// uitests/specs/request-builder.spec.mjs
// Edit method + URL in the request bar, send against a fixture host,
// assert the response panel renders the deterministic result.
import { test, expect } from '@playwright/test';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

test('edit method+URL and send: response panel shows fixture 200', async ({ page }) => {
  const blocked = await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);

  await page.getByTestId('nav-api').click();

  // Method: open the method menu, pick POST (menu buttons carry the verb).
  await page.locator('.qa-method-btn').click();
  await page.locator('.qa-method-menu button', { hasText: 'POST' }).click();
  await expect(page.locator('.qa-method-btn')).toContainText('POST');

  // URL: absolute URL to the mock host (bypasses env baseUrl concatenation).
  const url = page.locator('.qa-urlinput input');
  await url.fill('https://mock.local/api/ping');

  await page.getByTestId('send-request').click();
  // STATUS ASSERT: StatusPill (src/qa/components.tsx) renders a bare,
  // class-less <span>"{code} {statusText}"</span> as the first child of
  // .qa-resp-stats — its siblings (elapsed-time, size) all carry the
  // .qa-resp-stat class. Scoping to "the .qa-resp-stats child that is NOT
  // .qa-resp-stat" isolates the status text from the timing stat, so a
  // "200 ms" elapsed reading can never satisfy this assertion.
  await expect(page.locator('.qa-resp-stats > span:not(.qa-resp-stat)')).toHaveText(/\b200\b/, {
    timeout: 20_000,
  });
  // Body assert: the fixture payload is rendered in the response panel.
  await expect(page.locator('.qa-app')).toContainText('mock.local');

  expect(blocked, `unmocked hosts requested:\n${blocked.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
