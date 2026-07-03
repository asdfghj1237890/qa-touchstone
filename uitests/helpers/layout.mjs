/* global document -- page.evaluate callbacks run inside the browser page, not Node */
// uitests/helpers/layout.mjs
// Deterministic layout health checks — no pixel comparisons.
import { expect } from '@playwright/test';

/** The page must not scroll horizontally (1px tolerance for rounding). */
export async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, `${label}: horizontal overflow of ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Every nav-rail button must sit fully inside the viewport and be clickable. */
export async function assertNavUsable(page, viewport, label) {
  const buttons = page.locator('.qa-rail-btn');
  const count = await buttons.count();
  expect(count, `${label}: nav rail rendered`).toBe(10);
  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box, `${label}: nav button ${i} has a box`).not.toBeNull();
    expect(box.x, `${label}: nav button ${i} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${label}: nav button ${i} top edge`).toBeGreaterThanOrEqual(0);
    expect(
      box.x + box.width,
      `${label}: nav button ${i} right edge`
    ).toBeLessThanOrEqual(viewport.width + 1);
    expect(
      box.y + box.height,
      `${label}: nav button ${i} bottom edge`
    ).toBeLessThanOrEqual(viewport.height + 1);
  }
}

/** Main content area must keep a workable width. */
export async function assertContentWidth(page, label) {
  const width = await page.evaluate(() => {
    const el = document.querySelector('.qa-app');
    return el ? el.clientWidth : 0;
  });
  expect(width, `${label}: app shell width`).toBeGreaterThan(300);
}
