# Design System

QA Touchstone has no third-party UI framework. The visual layer is a single
stylesheet of CSS custom properties (`src/qa/qa.css`) driven by a small theme
engine (`src/qa/theme.ts`), rendered by a handful of hand-built primitives
(`src/qa/components.tsx`). This doc is the reference the code doesn't spell out
on its own.

## Decision: dark-only, token-driven, dependency-free

**Dark-only.** There is intentionally no light theme. This is a developer tool
used in long focused sessions next to a terminal and an IDE; a light mode would
double the CSS surface for a mode this audience rarely wants. If a light theme
is ever added it should be a fourth "direction" (see below), not a fork of the
stylesheet.

**Token-driven.** Every color, radius, spacing, and font is a CSS variable set
on the app root. `theme.ts` swaps variable *values* at runtime; components only
ever reference variables, never literals. This is why theme/accent/density
switch instantly with no re-render.

**Dependency-free.** The MUI/emotion stack was removed in v0.21.0. Primitives
are plain React + CSS. Keep it that way unless a primitive is genuinely too
complex to own (none is today).

## Tokens

Defined as fallbacks in `qa.css` (`:root`) and authoritatively by `theme.ts`.

| Group      | Variables                                                      |
| ---------- | ------------------------------------------------------------- |
| Surfaces   | `--bg`, `--bg-1`, `--bg-2`, `--bg-3`                          |
| Borders    | `--border`, `--border-2`                                     |
| Text       | `--text`, `--text-dim`, `--text-faint`                       |
| Accent     | `--accent`, `--accent-soft`, `--accent-line`, `--accent-contrast` |
| Radius     | `--radius`, `--radius-lg`                                    |
| Spacing    | `--gap`, `--pad`, `--row`, `--ctrl` (control height)         |
| Type       | `--fs` (base size), `--font-ui`, `--font-mono`               |

Contrast note: `--text-faint` was raised to a 4.9:1 ratio for WCAG AA (v0.21.0).
Keep new low-emphasis text at `--text-dim`/`--text-faint`, not ad-hoc greys.

## Themes ("directions")

Three cohesive dark palettes in `theme.ts` (`DIRECTIONS`). Each sets its own
surfaces, text, accent-contrast, and radius:

| Direction  | Feel                              | Default accent | UI font |
| ---------- | --------------------------------- | -------------- | ------- |
| `graphite` | Cool slate · electric blue · IDE  | `#4d9fff`      | sans    |
| `phosphor` | Near-black · phosphor green · TTY | `#46d27a`      | mono    |
| `indigo`   | Deep indigo · violet · modern     | `#9182ff`      | sans    |

**Accents** (`ACCENTS`), independent of direction: `blue #4d9fff`,
`green #46d27a`, `violet #9182ff`, `amber #f0a35e`, `cyan #3ed0d0`.

**Density** (`DENSITY`): `compact` and `comfortable` — remap
`--row/--gap/--pad/--fs/--ctrl`.

**Fonts** (`FONTS`): `sans` = IBM Plex Sans, `mono` = Google Sans Code.

### Semantic colors (computed, not tokens)

Two helpers in `theme.ts` return `oklch()` colors so they stay perceptually even
across directions:

- `methodColor(method)` — HTTP method hue (kept constant across directions for
  muscle memory; hue from `window.QA.METHOD_META`).
- `statusColor(code)` — 5xx red / 4xx amber / 3xx blue / 2xx green / other grey.

Use these for method badges and status text instead of hardcoding.

## Primitives (`components.tsx`)

Public exports — reuse these before writing new markup:

| Component     | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `Icon`        | Inline SVG icon set (name-keyed)                           |
| `PulseLogo`   | Animated app mark                                          |
| `MethodBadge` | HTTP method chip (colored via `methodColor`)               |
| `StatusPill`  | Response status chip (colored via `statusColor`)           |
| `Spinner`     | Inline busy indicator                                      |
| `MiniCheck`   | Compact checkbox                                           |
| `Dropdown`    | Keyboard-accessible select (`listbox`/`option` ARIA, arrow/Home/End/Esc) |
| `FieldRow`    | Labeled form row                                           |
| `SecretInput` | Masked credential input                                    |

Helpers: `highlightJson` (JSON syntax highlighting for report/response HTML),
`fmtBytesShared` (byte formatting).

## Accessibility baseline

- Global `:focus-visible` outline; don't remove it on custom controls.
- `Dropdown` is fully keyboard-operable with correct ARIA — model new
  interactive controls on it, not on bare `<div onClick>`.
- New text colors must clear WCAG AA against their surface.

## When adding UI

1. Reach for an existing primitive; extend it before forking.
2. Reference tokens (`var(--…)`), never color/spacing literals.
3. Put page-specific rules in the matching `qa.css` section (the file is
   organized by feature area — Nav rail, Response panel, Security, etc.).
4. If you introduce a new token, add it to all three directions in `theme.ts`
   and the `:root` fallback, and document it in the table above.
