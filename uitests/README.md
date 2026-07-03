# Cross-engine UI tests (engine-proxy layer)

Playwright drives the **production vite bundle** (`vite preview`) in the two
engine families the desktop app actually ships on:

| Project    | Engine           | Proxies                     |
| ---------- | ---------------- | --------------------------- |
| `webkit`   | bundled WebKit   | macOS WKWebView             |
| `chromium` | bundled Chromium | Windows WebView2 (Chromium) |

## What this layer proves / does NOT prove

**Proves:** UI flows, layout across the supported window-size envelope, and
engine-family compatibility (WebKit vs Chromium behavior differences) — on
one machine, offline, in minutes. The app's browser-fallback layer is real
shipped code (`hasTauri()` false → fetch executor, TS security engine, blob
downloads), so these flows exercise production logic.

**Does NOT prove:** the packaged app. Tauri IPC, native dialogs, the Rust
core engine, and disk writes are covered by `e2e/` (tauri-driver; Linux CI,
Windows manual) and unit/Rust tests. A green run here is necessary, not
sufficient, for a release.

## Run

```sh
cd uitests
npm ci --ignore-scripts
npx playwright install webkit chromium   # one-time browser download
npm test                                 # both engines
npm run test:webkit                      # single engine
npm run test:headed                      # watch it run
npm run report                           # open last HTML report
```

Or from the repo root: `npm run test:gui`.

## Determinism

All external network is mocked (`helpers/mockNet.mjs`, default-deny: unknown
hosts abort and fail the test). Tests run with `locale: 'en-US'`. Findings
lifecycle specs seed `localStorage` snapshots instead of running engines.
The production preview build fires the app's GitHub update check on boot;
`mockNet` answers it with a deterministic 404 (the check fails closed). In
this no-backend environment the AI policy also fail-closes
(`AI_POLICY_DENY` → privacy mode locked to `local`); `settings.spec.mjs`
asserts that locked behavior rather than the free 3-state switch, which is
unreachable here by design (see the comments in that spec).

## Resolution matrix

`specs/resolutions.spec.mjs` checks layout health (no horizontal overflow,
nav usable, content width) at 1920×1080 / 1366×768 / 1280×720 / 900×600
(the `tauri.conf.json` minimum) and saves screenshots to `artifacts/`
(gitignored, for human review — no pixel comparison).

## Known maintenance points

- The nav-rail count (10) and the page/selector table are asserted in
  `specs/navigation.spec.mjs` and partially duplicated in
  `specs/resolutions.spec.mjs` — adding an app tab means updating both
  (a shared `NAV_KEYS` constant extraction is a welcome follow-up).
- Specs share a common prologue (`installMockNet` + `collectPageErrors` +
  `gotoApp`) and trailing gates; promoting these to a Playwright
  `test.extend` fixture is a deliberate deferral — the fixture's shape
  (what it must expose: the `blocked` list, `pageErrors`, seed hooks) is
  best designed against all call sites at once, after the suite stops
  growing.
- `specs/findings.spec.mjs` seeds a baseline snapshot to render rows;
  see the WHY comment in `helpers/session.mjs` before changing the seed.
