// uitests/specs/data-io.spec.mjs
// Workspace data out: export a collection as Postman JSON from the sidebar
// menu; the blob download is intercepted and its content validated.
// (Import direction is covered by smoke.spec's collection import.)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { installMockNet } from '../helpers/mockNet.mjs';
import { collectPageErrors, gotoApp } from '../helpers/session.mjs';

test('PDF import extracts text through the bundled PDF.js worker', async ({ page }) => {
  const blocked = await installMockNet(page);
  const pageErrors = collectPageErrors(page);
  await gotoApp(page);
  await page.getByTestId('nav-testgen').click();

  const text = 'PDF import smoke test';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const workerResponse = page.waitForResponse((response) =>
    /\/assets\/pdf\.worker\.min-[^/]+\.mjs$/.test(response.url())
  );
  await page.locator('.tg input[type="file"]').setInputFiles({
    name: 'pdf-import-smoke.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf),
  });
  expect((await workerResponse).ok()).toBe(true);
  await expect(page.locator('.tg textarea')).toHaveValue(text);
  expect(blocked, `unmocked hosts requested:\n${blocked.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('sidebar collection export produces a valid Postman JSON download', async ({ page }) => {
  const blocked = await installMockNet(page);
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

  expect(blocked, `unmocked hosts requested:\n${blocked.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
