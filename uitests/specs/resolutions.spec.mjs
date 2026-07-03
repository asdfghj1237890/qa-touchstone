// uitests/specs/resolutions.spec.mjs
// Resolution compatibility matrix: layout health assertions + screenshots
// saved as human-review artifacts (NOT compared). Viewports approximate the
// desktop window content area; 900x600 is the app's tauri.conf.json minimum.
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockNet } from '../helpers/mockNet.mjs';
import { gotoApp } from '../helpers/session.mjs';
import {
  assertNoHorizontalOverflow,
  assertNavUsable,
  assertContentWidth,
} from '../helpers/layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(here, '..', 'artifacts');

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 900, height: 600 }, // tauri minWidth × minHeight
];

// Pages worth a layout pass (key, identifying wait selector).
const PAGES = [
  ['home', '.qa-home'],
  ['api', '.qa-urlbar'],
  ['security', '.qa-sec-tabs'],
  ['perf', '.pf'],
  ['settings', '.qa-settings'],
];

test('layout stays healthy across the resolution matrix', async ({ page, browserName }) => {
  mkdirSync(artifactsDir, { recursive: true });
  await installMockNet(page);
  await gotoApp(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const [key, waitSel] of PAGES) {
      const label = `${browserName} ${viewport.width}x${viewport.height} ${key}`;
      await page.getByTestId(`nav-${key}`).click();
      if (waitSel) await page.locator(waitSel).first().waitFor();

      await assertNoHorizontalOverflow(page, label);
      await assertNavUsable(page, viewport, label);
      await assertContentWidth(page, label);

      await page.screenshot({
        path: join(artifactsDir, `${browserName}-${viewport.width}x${viewport.height}-${key}.png`),
      });
    }
  }
});
