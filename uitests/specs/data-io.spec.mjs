// uitests/specs/data-io.spec.mjs
// Workspace data out: export a collection as Postman JSON from the sidebar
// menu; the blob download is intercepted and its content validated.
// (Import direction is covered by smoke.spec's collection import.)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

test('sidebar collection export produces a valid Postman JSON download', async ({ page }) => {
  await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);

  await page.getByTestId('nav-api').click();
  // Open the export menu (icon button next to Import) and export the first
  // collection (the auto-loaded demo workspace collection).
  await page.locator('.qa-side-exportwrap > button').click();
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.locator('.qa-export-menu button').first().click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  // Postman v2 collection shape (buildPostmanCollection, src/qa/ExportData.tsx).
  expect(exported).toHaveProperty('info');
  expect(exported.info).toHaveProperty('schema');
  expect(exported.info.schema).toContain('schema.getpostman.com');
  expect(Array.isArray(exported.item)).toBe(true);
  expect(exported.item.length).toBeGreaterThan(0);

  // Provenance: the exported blob is the collection the menu showed (guards
  // against a future menu-index bug exporting the wrong item).
  const firstColName = (await page.locator('.qa-col-name').first().textContent()).trim();
  expect(exported.info.name).toBe(firstColName);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
