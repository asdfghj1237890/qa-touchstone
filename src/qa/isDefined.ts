// ── QA Touchstone — shared array-compaction type guard ──────────────────────
// The one idiom for dropping null/undefined holes from an array: pass this to
// `.filter(isDefined)` instead of `.filter(Boolean) as T[]` casts or ad-hoc
// inline `(x): x is T => x != null` guards. Deliberately nullish-only: falsy
// values like '' / 0 / false pass through.
export function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}
