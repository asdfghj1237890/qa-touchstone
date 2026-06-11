// ── QA Touchstone — lightweight list virtualization (no dependency) ──────────
// A windowing primitive for long, flat lists (request/perf history, large result
// sets) so the DOM only holds the rows near the viewport instead of all N. The
// math (computeWindow) is pure and unit-tested; useWindowedList wires it to a
// scroll container with memoized derivations.
import React from 'react';

export interface WindowSpec {
  /** first row index to render (inclusive) */
  start: number;
  /** one-past-the-last row index to render (exclusive) */
  end: number;
  /** spacer height above the rendered slice (px) */
  topPad: number;
  /** spacer height below the rendered slice (px) */
  bottomPad: number;
}

// Given the list size and the current scroll geometry, return the slice of rows
// to render plus the top/bottom spacer heights that keep the scrollbar honest.
export function computeWindow(
  total: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = 4,
): WindowSpec {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleRows = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight));
  const start = Math.min(Math.max(0, firstVisible - overscan), total);
  const end = Math.max(start, Math.min(total, firstVisible + visibleRows + overscan));
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (total - end) * rowHeight),
  };
}

export interface UseWindowedListResult {
  window: WindowSpec;
  scrollProps: { ref: React.RefObject<HTMLDivElement | null>; onScroll: (e: React.UIEvent<HTMLDivElement>) => void };
  scrollTop: number;
  viewport: number;
}

// React wrapper: tracks scrollTop + measured viewport height and memoizes the
// window so a parent re-render does not recompute unless the geometry changed.
export function useWindowedList(
  total: number,
  rowHeight: number,
  opts: { overscan?: number; viewportHeight?: number } = {},
): UseWindowedListResult {
  const overscan = opts.overscan ?? 4;
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewport, setViewport] = React.useState(opts.viewportHeight ?? 480);

  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (el && el.clientHeight) setViewport(el.clientHeight);
  }, []);

  const window = React.useMemo(
    () => computeWindow(total, rowHeight, viewport, scrollTop, overscan),
    [total, rowHeight, viewport, scrollTop, overscan],
  );

  return { window, scrollProps: { ref, onScroll }, scrollTop, viewport };
}
