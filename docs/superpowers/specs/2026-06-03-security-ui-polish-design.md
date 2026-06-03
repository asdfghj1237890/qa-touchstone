# Security Page UI Polish — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope:** Polish the Security page UI that accreted across phases 0–4a (RBAC matrix + Object-access/BOLA + Rate-limit modes + findings). Fix rough edges and apply a light visual lift. Keep the existing visual language — no theme redesign, no engine/behavior changes beyond the one noted toggle de-noise.

## Motivation

The Security area was built feature-first across four phases; the rapid builds left visible rough edges, confirmed on the live dev server (port 3000):

- **Broken active-tab color** — `.qa-seg--on` used a non-existent `--surface` token with a `#fff` fallback, so on the dark theme the selected mode tab rendered white background under near-white `--text` (white-on-white, unreadable). This is the user-reported "選擇顏色不太對".
- **Double header** — in BOLA / rate-limit modes the page still shows the matrix's `安全矩陣 / 執行 RBAC 矩陣…` header *and* the panel's own header, stacked.
- **Mode toggle wraps** — `RBAC 矩陣 / 物件越權 (BOLA) / 速率限制` wrap awkwardly in the cramped segmented control.
- **Per-row "標高權" noise** — the privileged toggle's off-state shows on every endpoint row, including non-privileged GETs.
- **Matrix grid overflow** — identity columns overflow with a scrollbar; the endpoint column scrolls away.
- **Clipped BOLA dropdown** — the "加入要測的 endpoint…" select clips its placeholder.

## Decisions (locked during brainstorming)

1. **Scope = Security page only.** Not a whole-app pass.
2. **Depth = fix rough edges + light lift.** Keep the visual language; no theme/typography redesign.
3. **Active tab color = accent-soft tint (option C).** `background: var(--accent-soft)`, `color: var(--accent)`, `border-color: var(--accent-line)` — on-brand, clearly "selected", and visually distinct from the solid-accent run button (which is an *action*, not a *state*). Chosen over solid-accent fill (A, competes with the run button) and neutral raised tile (B, too quiet). Verified live via injected styles.
4. **Theme tokens only.** Replace the broken `--surface`/`--surface-2` references with real tokens (`--bg-1/2/3`, `--accent*`, `--text*`, `--border*`).
5. **Priv toggle de-noise = hover-reveal off-state.** The colored privileged badge stays always-visible when privileged; the "標高權 / mark priv" off-state affordance only appears on row hover. (The one small behavior change.)

## Architecture / scope of change

~90% `src/qa/qa.css`; one small structural move in `src/qa/Security.jsx`. No changes to `authz.js`, `bola.js`, `ratelimit.js`, `oracles.js`, or any engine logic. `BolaPanel.jsx` / `RateLimitPanel.jsx` keep their own headers (they become the single header for their mode).

```
src/qa/Security.jsx  — move the matrix header (title + subtitle + 全部執行 button)
                       INTO the matrix branch; the page level keeps only the tab bar row.
src/qa/qa.css        — tab bar restyle (incl. the C active color, the actual bug fix),
                       priv toggle hover-reveal, grid sticky-first-column + contained
                       scroll, BOLA dropdown min-width, spacing/density, chip consistency.
```

## Components / changes

### 1. One header per mode (fixes the double header)

`Security.jsx` currently renders `.qa-sec-head` with `[title+subtitle][mode toggle][run-all (matrix only)]` ABOVE the mode branch, while `BolaPanel`/`RateLimitPanel` render their own `.qa-sec-head`. Restructure:

- Page level renders only the **tab bar** row (the three mode buttons).
- The matrix's title + subtitle + `全部執行`/`停止` button move **into the matrix branch** (the `<>…</>`), so the matrix has its own single header — symmetric with the BOLA/rate-limit panels, which keep theirs.
- Result: exactly one header per mode, below the tab bar. No duplication. The run-all button stays matrix-only (it's already gated on `mode === 'matrix'`).

### 2. Tab bar restyle (fixes wrapping + the active-color bug)

- `.qa-sec-modetoggle`: its own row; `background: var(--bg-1)`, `border: 1px solid var(--border)`, `border-radius`, small padding; `display: inline-flex`.
- `.qa-seg`: `white-space: nowrap`, adequate padding, `color: var(--text-dim)`, transparent border, pointer.
- `.qa-seg--on` (the fix): `background: var(--accent-soft)`, `color: var(--accent)`, `border-color: var(--accent-line)`. **Remove the `var(--surface, #fff)` / `var(--surface-2, …)` references entirely** — those tokens don't exist in the theme.

### 3. Privileged toggle de-noise (hover-reveal)

- `.qa-sec-priv--on` (privileged): unchanged — always visible, colored (`#ea580c` orange tint).
- `.qa-sec-priv--off` ("mark priv"): `opacity: 0` by default; `.qa-sec-grid tr:hover .qa-sec-priv--off { opacity: .55 }` (and `:focus-visible` for keyboard) so it reveals on row hover. Keeps the affordance discoverable without cluttering every non-privileged row. No JS change — purely CSS on the existing element.

### 4. Matrix grid overflow

- `.qa-sec-gridwrap`: contained horizontal scroll (already scrolls; refine with a subtle scrollbar).
- `.qa-sec-rowhead` / the endpoint header column (`th.qa-sec-corner` + `th.qa-sec-rowhead`): `position: sticky; left: 0; z-index` + a solid background so the endpoint column stays put while identity columns scroll.
- Identity column cells: a sensible `min-width` so they don't crush.

### 5. Misc polish

- BOLA add-test `<select>` (and the rate-limit add-test select): `min-width` so the placeholder isn't clipped.
- Spacing/density: align the header, summary chips, and toolbar gaps; consistent `gap`/padding on `.qa-sec-summary`, `.qa-sec-toolbar`.
- Chip consistency: ensure `.qa-sec-chip`, `.qa-rl-verdict`, `.qa-bola-cell` verdicts, and `.qa-sec-findchip`/severity chips share radius/size/weight conventions (small alignment only).

## Error handling / risk

Pure presentational + a localized JSX move. Risk is limited to (a) breaking an existing `security-page.test.jsx` selector and (b) the sticky-column z-index/overlap. Mitigation: all existing selectors (`.qa-bola`, `.qa-rl`, `.qa-sec-priv--on`, `td.qa-sec-cell[data-expect]`, verdict classes, `/Run all/i`, `/Object access/i`, `/Rate limit/i`) are preserved; the matrix run-all button keeps its text and stays in matrix mode.

## Testing

- **`src/__tests__/security-page.test.jsx`** must stay green unchanged (it asserts mode switching, the privileged badge `.qa-sec-priv--on`, the deny-count, findings, drawer). Add one assertion: after switching to BOLA mode, there is exactly **one** `.qa-sec-head` rendered (no double header) — e.g. `document.querySelectorAll('.qa-sec-head').length === 1` in bola mode.
- Manual/visual verification on the live dev server: screenshots of all three modes (matrix, BOLA, rate-limit) showing the corrected active tab (accent-soft), single header, hover-reveal priv toggle, and the sticky endpoint column — captured as before/after proof.
- `npm run build` clean; full `npx vitest run` green.

## Out of scope

- Whole-app UI pass (other 8 routes).
- Theme/typography/color-system redesign.
- Any engine or behavior change beyond the priv-toggle hover-reveal.
- New features.
