// src/__tests__/windowed-list.test.js
import { describe, it, expect } from 'vitest';
import { computeWindow } from '../qa/useWindowedList';

describe('computeWindow', () => {
  it('returns an empty window for no items or zero row height', () => {
    expect(computeWindow(0, 40, 400, 0)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
    expect(computeWindow(100, 0, 400, 0)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
  });

  it('renders a viewport-sized slice plus overscan at the top', () => {
    // 1000 rows × 40px, 400px viewport, scrollTop 0, overscan 4.
    const w = computeWindow(1000, 40, 400, 0, 4);
    expect(w.start).toBe(0);
    // ceil(400/40)=10 visible + 4*2 overscan = 18 (clamped to top)
    expect(w.end).toBe(14); // 0 + (10 + 4) since top overscan is clamped at 0
    expect(w.topPad).toBe(0);
    expect(w.bottomPad).toBe((1000 - w.end) * 40);
  });

  it('windows around the scroll position in the middle of a long list', () => {
    const w = computeWindow(1000, 40, 400, 4000, 4); // scrolled to row 100
    expect(w.start).toBe(96); // floor(4000/40)=100, minus 4 overscan
    expect(w.end).toBe(114); // 96 + 10 visible + 8 overscan
    expect(w.topPad).toBe(96 * 40);
    expect(w.bottomPad).toBe((1000 - 114) * 40);
  });

  it('clamps the end to the total and zeroes the bottom pad at the list end', () => {
    const w = computeWindow(20, 40, 400, 10000, 4); // scrolled past the end
    expect(w.end).toBe(20);
    expect(w.bottomPad).toBe(0);
    expect(w.start).toBeLessThanOrEqual(20);
  });

  it('the rendered slice always covers the viewport (no holes)', () => {
    const rowH = 30, viewport = 300, total = 500;
    for (const scrollTop of [0, 150, 900, 4500, 14000]) {
      const w = computeWindow(total, rowH, viewport, scrollTop, 2);
      const firstVisible = Math.floor(scrollTop / rowH);
      const lastVisible = Math.min(total - 1, Math.floor((scrollTop + viewport) / rowH));
      expect(w.start).toBeLessThanOrEqual(firstVisible);
      expect(w.end).toBeGreaterThanOrEqual(Math.min(total, lastVisible + 1));
    }
  });
});
