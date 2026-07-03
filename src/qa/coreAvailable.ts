/**
 * True when running inside the Tauri shell, where the Rust core is reachable over
 * IPC (desktop). In the browser/dev build both globals are absent → false → the
 * caller uses the TS fallback engine. Mirrors the detection in App.tsx.
 */
export function isCoreAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__);
}
