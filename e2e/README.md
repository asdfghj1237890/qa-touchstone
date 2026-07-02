# Desktop E2E smoke harness

One WebDriver-driven smoke path through the **packaged** Tauri app:

> launch → import `demo/rest-countries.postman_collection.json` via the UI →
> send a request → run the security suite → **export a JSON report and assert
> the file actually lands on disk**.

That last assertion is the point: in v0.21.1 every export silently failed in
the packaged app (the Tauri WebView ignores blob `<a download>`). Unit tests
mock the bridge, so only a real-app test can guard the full
dialog → `save_text_file` → disk chain.

## ⚠️ Verification model — read this first

**This suite cannot run without a built release binary, a WebDriver bridge,
and a display server.** In practice that means:

- **CI (`e2e-smoke` job in `.github/workflows/ci.yml`) is the reference
  environment** — Linux, xvfb, webkit2gtk-driver. Changes to the harness are
  only truly verified by a CI run.
- Locally you can verify statics only (config parses, lint, the seam's unit
  test in `src/__tests__/e2eSaveSeam.test.js`) — or do a full local run per
  below.

## How it works

- [`tauri-driver`](https://crates.io/crates/tauri-driver) launches the release
  binary and proxies WebDriver to the platform's native driver
  (WebKitWebDriver on Linux, msedgedriver on Windows; **macOS unsupported**).
- WebdriverIO (mocha, `specs/smoke.e2e.mjs`) drives the UI via `data-testid`
  hooks.
- The native save dialog cannot be WebDriver-driven, so the spec sets
  `window.__QA_E2E_SAVE_DIR__` (an inert seam in `src/api/index.ts`); the
  dialog is skipped but the real Rust disk write still runs and is asserted
  via Node `fs` polling.
- send/scan hit the demo collection's real public APIs and are asserted
  **tolerantly** (flow completes; HTTP outcome not asserted). The only hard
  network-free assertion is the export.
- On Linux the app runs with `XDG_*` pointed at a temp dir — no touching real
  user data.

## Local run — Linux

```sh
sudo apt-get install -y webkit2gtk-driver xvfb   # plus the usual Tauri deps
cargo install tauri-driver --locked
npm ci --ignore-scripts                          # repo root
npx tauri build --no-bundle                      # repo root; skips k6 pre-script
cd e2e && npm ci --ignore-scripts
xvfb-run --auto-servernum npm test               # headless; omit xvfb-run on a desktop
```

## Local run — Windows

> **Caveat:** Windows has no XDG override — the app under test uses your real
> `%APPDATA%\com.qatouchstone.desktop`. Back it up first (and
> `%LOCALAPPDATA%\com.qatouchstone.desktop` if present); the run may add a
> demo collection and a security-run snapshot to your workspace.

1. `npm ci --ignore-scripts && node scripts/setup-k6.mjs --release && npx tauri build --no-bundle`
   (repo root — Windows needs k6 materialized first: `tauri.windows.conf.json`
   declares `resources/k6.exe` and tauri-build validates it at compile time
   even with `--no-bundle`; Linux declares no bundle resources)
2. `cargo install tauri-driver --locked`
3. Download the **msedgedriver matching your WebView2 version**
   (version: `(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv`,
   driver: `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`)
4. `cd e2e; npm ci --ignore-scripts`
5. `$env:E2E_NATIVE_DRIVER = 'C:\path\to\msedgedriver.exe'; npm test`

A green Windows run does **not** prove the Linux CI job (different WebView +
renderer) — it validates the platform-independent 80%: selectors, timing, the
seam, fs polling.

## Troubleshooting

- Blank window / renderer crash under xvfb: `WEBKIT_DISABLE_COMPOSITING_MODE=1`
  and `WEBKIT_DISABLE_DMABUF_RENDERER=1` (CI sets both).
- "app binary not found": build it first — `npx tauri build --no-bundle` from
  the repo root (the preflight in `wdio.conf.mjs` checks this before starting).
- `resource path 'resources\k6.exe' doesn't exist` (Windows build): run
  `node scripts/setup-k6.mjs --release` first — see the Windows steps above.
- `tauri-driver` not found: `cargo install tauri-driver --locked` and ensure
  `~/.cargo/bin` is on PATH.
- Failure screenshots land in `e2e/logs/` (uploaded as a CI artifact).

## Deliberately out of scope

Local stub server (send/scan offline determinism), driving the endpoint picker
so engines truly run, macOS, more export formats, visual regression, gating
`release.yml` on E2E. See
`docs/superpowers/specs/2026-07-02-desktop-e2e-smoke-design.md` (untracked
planning artifact) for the full design rationale.
