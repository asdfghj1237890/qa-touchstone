# Changelog

All notable changes to QA Touchstone are documented here. Versions follow
[SemVer](https://semver.org); 0.x releases may contain breaking changes.

## [Unreleased]

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
