# Changelog

All notable changes to QA Touchstone are documented here. Versions follow
[SemVer](https://semver.org); 0.x releases may contain breaking changes.

## [Unreleased]

### Changed
- **React 18 → 19** (`react` / `react-dom` 19.2, `@vitejs/plugin-react` 5.2).

## [0.22.4] — 2026-06-29

### Fixed
- Performance run history **Clear** now respects row selection: with rows
  checked it removes only the selected runs (matching Export); with nothing
  selected it still clears the entire history (`src/qa/PerfTest.tsx`).

## [0.22.1] — 2026-06-28

### Fixed
- Code generation now emits valid snippets for Unicode Basic auth credentials,
  JSON booleans/nulls in Python, malformed JSON request bodies, HTTPie form
  payloads, and non-object JSON bodies.
- Disk mirroring now uses the live monitors storage key and removes perf run
  history from the mirrored snapshot when history is cleared.
- API key auth names are substituted consistently in the frontend, CLI, and
  Rust security runners, including redirect-sensitive stripping for resolved
  header names.

## [0.22.0] — 2026-06-11

### Security
- **AWS secret keys move to the OS keychain.** Manual AWS secret access keys are
  no longer stored in plaintext in `config.json` — they live in the OS keychain
  (Windows Credential Manager / macOS Keychain / Linux Secret Service) keyed by
  credential-profile id (`src-tauri/src/secrets.rs` + `commands/secrets.rs`,
  `keyring` crate). A legacy inline secret is still honored on read for a smooth
  migration; resolution prefers the keychain.
- **Disabling TLS verification now requires explicit confirmation.** A
  `ssl_verify=false` without the renderer's `sslVerifyConfirmed` flag is rejected
  by the backend, so an implicit/injected disable can no longer silently strip
  certificate verification.
- **SSRF guard for cloud metadata endpoints.** An AWS-signed request to a
  link-local metadata address (`169.254.169.254`, ECS `169.254.170.2`, IPv6
  `fd00:ec2::*`, GCP `metadata.google.internal`, Alibaba) is now blocked — it
  would otherwise sign the user's/instance's credentials into a request that
  hands back instance-role credentials. Unsigned localhost/private testing is
  unaffected.
- **RBAC soft-deny detection.** The matrix oracle is body-aware: a 200 that
  denies in-band (`{"error":"Access denied"}`, `{"status":"forbidden"}`) is
  classified as `denied`, removing false `vuln`s on deny-cells and false `pass`es
  on allow-cells (`src/qa/authz.ts`).
- **BOLA false-positive hardening.** Object-id echo only counts at an
  identity-like key (a stray `1` as `page`/`total` no longer matches), and the
  negative control uses an independent structural oracle instead of re-using the
  attack content match — breaking the prior circular self-validation
  (`src/qa/bola.ts`).
- **Rate-limit strength, not just presence.** Bursts are graded none / weak /
  strong by how many requests slipped through before the first 429; a single
  late 429 is reported as weak protection instead of a clean pass
  (`src/qa/ratelimit.ts`).

### Added
- **Three new security engines** (pure, fully unit-tested): JSON-Schema/OpenAPI
  **conformance** validation (`schemaConformance.ts`), input **fuzzing** with
  5xx / stack-trace-leak / reflected-payload detection (`fuzz.ts`), and an
  auto-derived **BFLA** (OWASP-API5) scan (`bfla.ts`).
- **Richer SARIF.** Rules now carry name, descriptions, `helpUri`, default level,
  CWE/OWASP tags, and a GitHub `security-severity` score; results carry
  `ruleIndex` and a `physicalLocation` (`src/qa/securityReport.ts`).
- **Versioned storage with migrations** (`src/qa/storage.ts`) so an older
  `user_data.json` shape is upgraded on read instead of silently misread.
- **List virtualization primitive** (`useWindowedList.ts`) plus a render cap on
  the findings table so very large scans don't thrash the DOM.
- **Home empty state** for Recent requests — a guiding CTA instead of a blank
  panel.
- An ISC **LICENSE** file (the repo claimed ISC without the license text).

### Fixed
- **Findings fingerprint survives rule renames** via a canonical-id alias
  registry, and a separate detail hash now surfaces evidence drift on a carried
  finding without destabilizing the baseline diff (`src/qa/findings.ts`).

### Tests / CI
- New IPC-contract tests for the keychain commands and an export-routing
  regression guard for `download.ts` (the v0.21.1 broken-exports class of bug).
- CI Linux Rust job installs `libdbus-1-dev` + `pkg-config` for the keyring
  Secret Service backend.
- Regenerated README screenshots (now "QA Touchstone", current version) and
  removed stray Electron-era build residue from the working tree.

## [0.21.1] — 2026-06-11

### Fixed
- **Exports now work in the packaged desktop app.** Every export (perf reports,
  security JSON/HTML/JUnit/SARIF, API docs, Postman collections, response /
  history) used a blob `<a download>`, which the Tauri WebView silently
  ignores — clicking a report did nothing. All exports now route through one
  Tauri-aware helper (`src/qa/download.ts`): a native save dialog plus a
  backend `save_text_file` command in Tauri, with the blob fallback kept for
  browser/dev. Added `dialog:allow-save` capability.
- **Perf "p50" chart end-spike** removed: the time series binned by request
  *completion* time and averaged, so slow requests draining after the nominal
  end clamped into the last bucket and spiked it. Now bins by request *start*
  time and plots the per-bin median (matching the chart's "p50" label).
- **k6 no longer flashes a console window** on Windows: the k6 subprocess (and
  the taskkill on stop) spawn with `CREATE_NO_WINDOW`; piped output is
  unaffected.
- **Desktop hides the built-in Claude provider** when `window.claude` is absent
  (it only works inside a claude.ai Artifacts sandbox); the provider labels no
  longer claim "no key" where it can't run.
- Perf run-history export dropdown was clipped by the container's
  `overflow: hidden`; the menu now overflows correctly.
- Home header and nav rail showed a stale hardcoded version; the displayed
  version is now injected from `package.json` at build time.

### Changed
- Larger, more legible UI font sizes across the app; bigger perf stat-card
  labels; perf run-history rows aligned into tabular columns.

### Performance
- First paint no longer waits on an `initApi` IPC round-trip that cached
  process env nothing read (dead code removed).

## [0.21.0] — 2026-06-10

### Security
- **Full Public Suffix List** for the cookie jar: the hand-rolled ~300-entry
  suffix set is replaced by the complete publicsuffix.org list (9,919 rules +
  283 wildcards + 8 exceptions, bundled in `src/qa/psl.data.ts`, refresh via
  `node scripts/update-psl.mjs`) with a spec-faithful matcher (longest-match,
  wildcard, and `!`-exception rules) in `src/qa/psl.ts`. Domain-attribute
  supercookie attempts (`Domain=co.uk`, `Domain=s3.amazonaws.com`, unknown
  TLDs, …) are now rejected exactly the way browsers do.

### TypeScript
- The entire frontend is now strict TypeScript: all pure-logic modules
  (29 files, shared domain types in `src/qa/types.ts`), every UI component
  (29 .jsx → .tsx), the Tauri bridge (`src/api/index.ts`), and the app entry
  (`App.tsx` / `index.tsx`). `tsc --noEmit` is a CI gate; `t()` i18n keys are
  a compile-checked union with IDE autocomplete.
- AppShell decomposed into typed providers (`src/qa/state/`): Workspace /
  Request / Monitors contexts + an event-driven ToastHost. `App.tsx` holds
  4 useState (was 23); RequestBuilder takes 1 prop (was 17).

### Security
- Removed the entire legacy Electron-era hardware command surface that was
  still exposed to the webview for no reason: serial-port I/O + XMODEM file
  transfer, LAN/SSH device scanning, firmware flash-path management,
  certificate-folder scanning, hex-file lookup, and the temp-dir file readers
  (`read_directory` / `read_file_content`). Five Rust modules and ~10 commands
  deleted, along with the `serialport`, `base64`, `wait-timeout`, `if-addrs`,
  and `dns-lookup` crates.
- Removed the hidden, unused `settings` window and its capability grants;
  capabilities now cover the `main` window only and no longer include
  `core:webview:allow-create-webview-window`.
- Disabling TLS verification (`ssl_verify=false`) is now audit-logged
  (target host only — no URLs/query strings) on every request.
- `npm audit` is clean: 0 vulnerabilities (was 3 critical / 9 high / 4
  moderate, mostly via vite/vitest — fixed by upgrading within semver).

### Reliability
- New unified storage layer (`src/qa/storage.js`): critical workspace data
  (findings lifecycle, baselines, perf history, monitors, AI privacy config)
  is mirrored to `user_data.json` on disk via the Tauri backend and restored
  automatically if the webview's localStorage is cleared. Write failures
  (e.g. quota) now show a toast + console error instead of being silently
  swallowed. Secrets (LLM API keys) are excluded from the disk mirror.
- Top-level React ErrorBoundary: an uncaught render error now shows a
  readable bilingual error screen with a Reload button instead of a white
  screen.
- Missing i18n keys log a one-time dev-mode warning instead of failing
  silently.

### CI / quality
- New `ci.yml` workflow: every push/PR runs ESLint, the full Vitest suite,
  Rust unit tests, and `npm audit`. The release workflow now refuses to build
  installers unless frontend + Rust tests pass.
- ESLint 9 (flat config) + Prettier introduced; all error-level violations
  fixed (dead imports/variables/functions removed across ~16 files).
- Removed unused heavyweight dependencies: `@mui/material`,
  `@mui/icons-material`, `@mui/x-data-grid`, `@mui/x-tree-view`,
  `@emotion/react`, `@emotion/styled`, `react-router-dom`, `dompurify`.

### Accessibility
- Dropdowns are now keyboard-operable (Arrow keys/Home/End/Escape) with
  proper `listbox`/`option` ARIA roles and `aria-expanded` state.
- Global `:focus-visible` outline; `--text-faint` contrast raised from
  3.5:1 to 4.9:1 (WCAG AA).

### Docs
- README repositioned around the security-testing core (RBAC matrix, BOLA,
  rate-limit, SARIF/JUnit CI artifacts).
- Corrected the AI provider claim: the keyless built-in Claude provider only
  works inside a claude.ai Artifacts sandbox and is **not available in
  desktop builds**; desktop AI features require configuring OpenAI or an
  OpenAI-compatible endpoint (test generation falls back to the heuristic
  engine without one).
- Deleted the stale 846-line `.cursorrules` (still described the
  Electron-era v0.10.9 app).
- Added this changelog.

## [0.20.2] — 2026-06-04
- fix: harden file and AI egress boundaries.

## [0.20.1] — 2026-06-04
- refactor(ai-privacy): break aiPrivacy/llm import cycles.

## [0.20.0] — 2026-06-04
- **AI Privacy Mode**: single redacted-by-default egress chokepoint
  (`qaAiSend`) for every AI feature — three modes (`full` / `redacted` /
  `local only`), structure-preserving body masking, secret/PII key masking,
  URL/OpenAPI host stripping, prompt preview + approval before send,
  backend-resolved egress policy (`get_ai_policy`) and
  `QA_ALLOW_EXTERNAL_AI` org lockdown.

## [0.19.0] — 2026-06-04
- **Redacted evidence artifact**: opt-in, mask-by-default request/response
  summaries attached to security findings; expandable evidence in HTML
  reports; export/persist integration coverage.

## [0.18.0] — 2026-06-04
- Baseline public release of the API-QA workspace: Postman-compatible
  client (REST/GraphQL), collection runner with live execution, security
  suite (RBAC matrix / BOLA / rate-limit) with findings lifecycle +
  baseline diff + SARIF/JUnit/HTML/JSON reports, background monitors, k6
  performance testing, AI test generation/review/triage, realtime
  (WS/SSE), docs/codegen, bilingual UI.
