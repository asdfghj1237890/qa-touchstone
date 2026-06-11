# QA Touchstone

[![CI](https://github.com/asdfghj1237890/qa-touchstone/actions/workflows/ci.yml/badge.svg)](https://github.com/asdfghj1237890/qa-touchstone/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](#license)
[![Desktop: Tauri 2](https://img.shields.io/badge/desktop-Tauri%202-24C8DB.svg)](#architecture)
[![Frontend: React 19](https://img.shields.io/badge/frontend-React%2019-61DAFB.svg)](#architecture)
[![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)](#architecture)
[![Build: Vite](https://img.shields.io/badge/build-Vite-646CFF.svg)](#development)
[![Tests: Vitest](https://img.shields.io/badge/tests-Vitest-6E9F18.svg)](#development)
[![Performance: k6](https://img.shields.io/badge/performance-k6-7D64FF.svg)](#k6-binary)
[![Data: local-first](https://img.shields.io/badge/data-local--first-2E7D32.svg)](#local-data-and-secrets)

[繁體中文](README.zh-TW.md)

QA Touchstone is a local-first desktop tool for **API security testing in CI**:
run an identity × endpoint RBAC matrix, BOLA/IDOR object-authorization tests,
and rate-limit abuse checks against your real API, manage findings across runs
with baseline diffs, and export **SARIF / JUnit / HTML / JSON** artifacts your
pipeline can gate on. Around that core it ships the full supporting workbench —
a Postman-compatible API client (REST and GraphQL), live collection execution,
background monitors, k6 performance testing, AI-assisted test generation and
triage, and exportable API documentation — in one Tauri app.

## Screenshots

**A local-first, Postman-compatible desktop workspace for API QA** — API client,
collection runner, security matrix, monitors, performance testing, and exportable
docs in one app.

![QA Touchstone](docs/screenshots/01-home.png)

| Security matrix (RBAC) | AI test generation | API client |
| --- | --- | --- |
| ![Security matrix](docs/screenshots/02-security-matrix.png) | ![AI test generation](docs/screenshots/03-test-generation.png) | ![API client](docs/screenshots/04-api-client.png) |
| **Generated API docs** | **Performance / load testing** | **Realtime (WebSocket / SSE)** |
| ![Generated API docs](docs/screenshots/05-api-docs.png) | ![Performance testing](docs/screenshots/06-performance.png) | ![Realtime testing](docs/screenshots/07-realtime.png) |

<sub>Regenerate with `node scripts/capture-screenshots.mjs` while the dev server is running (drives your system Chrome over the DevTools Protocol; set `LOCALE=zh-TW` for a Chinese UI).</sub>

## Current Scope

The current public-facing scope is API testing only:

- Generic API environments for local, staging, production, and custom targets
- Local request execution through the Tauri desktop backend
- Browser/dev fallback paths for deterministic tests and quick UI iteration
- Runtime data and credentials stored on the local machine
- No company-specific services, internal links, or obsolete non-API workflow docs

## Capabilities

- **API client**: build HTTP and GraphQL requests (with a schema explorer),
  switch environments, inspect responses, view call history, and export
  responses and history as HTML, JSON, or CSV reports.
- **Import/export**: import Postman v2.1 collections and OpenAPI/Swagger JSON;
  export collections back to Postman JSON.
- **Authentication**: No Auth, Bearer Token, OAuth 2.0 (authorization-code,
  client-credentials, and password grants), API Key, Basic Auth, and AWS SigV4.
- **Variables and cookies**: resolve global, collection, environment, and local
  variables plus dynamic values ({{$timestamp}}, {{$guid}}, {{$randomInt}});
  replay matching cookies through the local cookie jar.
- **Collection Runner**: run selected requests, iterate over CSV/JSON data, and
  score assertions on live responses.
- **Security testing**: run an identity × endpoint RBAC matrix — the same saved
  requests sent under multiple identities — with per-cell allow/deny expectations,
  a configurable deny-status set, and response oracles that flag sensitive-data
  exposure and schema drift. The matrix oracle is body-aware: a 200 that denies
  in-band (`{"error":"Access denied"}`) is classified as denied, not a false vuln.
  Object-level authorization (BOLA/IDOR) testing swaps
  object ids across identities with auto-detected id locations, reusable
  cross-tenant presets, and a negative control that suppresses false positives
  (id echoes only count at identity-like keys, and the control is scored by an
  independent structural oracle). Rate-limit / abuse testing fires bounded
  request bursts behind a confirm gate and grades protection none / weak /
  strong by how many requests slip through before the first 429.
  A single **Run full security suite** executes all three engines as one recorded
  run — rate-limit last, so its bursts don't skew the matrix and BOLA results.
  Three further engines — JSON-Schema/OpenAPI **conformance** validation, input
  **fuzzing** (5xx, stack-trace-leak, and reflected-payload detection), and an
  auto-derived **BFLA** (OWASP API5) scan — ship as pure, fully unit-tested
  modules with SARIF rule metadata already in the report layer; UI integration
  is the next step.
- **AI security triage**: condense a whole scan (matrix + object-authz + rate-limit)
  into a short, prioritized, categorized shortlist — what to look at first, what
  looks like a real issue, and what's likely a false positive — advisory only,
  never altering the underlying findings.
- **Findings lifecycle**: suppress false positives, override severity, and assign
  owner/status/note, then diff each run against a pinned baseline — new/carried/resolved
  badges plus a new-high/critical counter.
- **Security reports / CI artifacts**: export a completed suite run as a JSON
  artifact, an HTML executive report, JUnit XML (CI test checks), or SARIF
  (GitHub code scanning) — gated on new high/critical findings, with three
  redaction levels for artifacts that leave the machine: `strict` omits evidence
  entirely, `redacted` keeps a short masked value, and `evidence` attaches a
  structure-preserving, **mask-by-default** request/response summary that locates
  each finding while guaranteeing tokens, cookies, and PII never leak (every leaf
  is type-tokenized except the finding itself). The evidence summary is generated
  on demand and only persisted into a run on explicit opt-in. SARIF output is
  code-scanning-ready: rules carry names, descriptions, `helpUri`, CWE/OWASP
  tags, and a GitHub `security-severity` score, and each result carries a
  `physicalLocation`.
- **Monitors**: run live checks manually or let enabled monitors execute on
  their configured cadence while the app is running.
- **Performance testing**: generate and run k6 performance, load, and stress
  tests with live metrics, SLO scoring, history, and exportable reports.
- **AI assistance**: generate classified test cases from BDD, OpenAPI, PRD, or
  PDF-like text; review individual API responses against existing assertions; and
  scan a response on demand for sensitive-data exposure (PII, secrets, internal
  or debug fields).
- **Configurable AI provider**: every AI feature (test generation, response
  review, sensitive-data scan, and security triage) runs on a provider you
  choose — OpenAI, or a custom / self-managed (enterprise on-prem)
  OpenAI-compatible endpoint — with credentials kept on the local machine.
  AI features are optional: without a configured provider, test generation
  falls back to a built-in heuristic engine and the rest of the app works
  fully. (A keyless built-in Claude provider exists but only functions when
  the UI runs inside a claude.ai Artifacts sandbox — it is **not available in
  the desktop builds**; the Settings page shows its live availability.)
- **AI privacy mode**: all AI calls pass through one egress chokepoint that is
  redacted-by-default. Three modes — `full context`, `redacted` (default), and
  `local only` — control what leaves the machine. `redacted` masks URLs (host
  stripped), bodies (structure-preserving — values become type tokens, keys
  kept), headers, and identifiers (email, tokens, UUID, IP, Luhn-valid cards,
  SSN) locally before sending, and reduces OpenAPI specs to path shape (no real
  host, no example values). `local only` blocks cloud providers and allows only
  a self-managed endpoint (loopback / private / explicitly attested). A preview
  shows the exact prompt before it is sent, and a CI / org lockdown (env
  `QA_ALLOW_EXTERNAL_AI`) can force external AI off.
- **Docs and codegen**: generate API docs, standalone HTML exports, and request
  code snippets (cURL, Python, JavaScript, HTTPie).
- **Realtime testing**: test WebSocket and Server-Sent Events streams.
- **Bilingual, themeable UI**: complete English and Traditional Chinese (繁體中文)
  interface, switchable in Settings, with a themeable dark UI (multiple accent
  palettes and density options).

## Architecture

```mermaid
flowchart LR
  User["QA engineer"] --> Shell["Tauri desktop shell"]
  Shell --> UI["React + Vite UI"]

  UI --> Client["API Client (REST / GraphQL)"]
  UI --> Runner["Collection Runner"]
  UI --> Security["Security suite (RBAC / BOLA / rate-limit)"]
  UI --> Monitors["Background Monitors"]
  UI --> Perf["Performance Page"]
  UI --> AI["Test Gen + AI Review"]
  UI --> Realtime["Realtime (WS / SSE)"]
  UI --> Docs["Docs / Codegen / Reports"]

  Client --> Executor["Shared Request Executor"]
  Runner --> Executor
  Monitors --> Executor
  Security --> Executor

  Security --> Findings["Findings lifecycle + baseline diff (RunRecord)"]
  Findings --> Evidence["Redacted evidence artifact (mask-by-default)"]
  Findings --> Reports["Security reports: JSON / HTML / JUnit / SARIF"]
  Evidence --> Reports

  Executor --> Vars["Variables + Environments"]
  Executor --> Cookies["Local Cookie Jar"]
  Executor --> Rust["Rust Tauri Commands"]
  Rust --> APIs["Target APIs"]
  Rust --> Keychain["OS keychain (AWS secret keys)"]

  Perf --> K6["Bundled k6"]
  K6 --> APIs
  Realtime --> APIs

  AI --> AIGate["AI privacy chokepoint (qaAiSend): redact + preview + egress policy"]
  Security --> AIGate
  AIGate --> LLM["Built-in / OpenAI / self-managed LLM"]
  AIGate --> AIPolicy["Egress policy (Rust get_ai_policy / lockdown)"]
  Findings --> Storage["Storage layer (versioned, disk-mirrored)"]
  Storage --> Disk["Rust app-data files (user_data.json, config.json)"]
  UI --> Storage
```

- **Frontend**: React 19 + Vite, **100% TypeScript** (strict). Workspace,
  request/send, and monitor state live in typed React context providers
  (`src/qa/state/`); shared domain types in `src/qa/types.ts`.
- **Desktop shell**: Tauri 2
- **Backend commands**: Rust — request execution (reqwest + manual redirect
  following, AWS SigV4, and an SSRF guard that blocks signed requests to
  cloud-metadata addresses), the k6 process runner, temp-file helpers, local
  config/data persistence, OS-keychain secret storage (`keyring`), and a
  text-file save command fed by the native save dialog. The renderer's command
  surface is intentionally minimal (no shell, no arbitrary network access), and
  disabling TLS verification requires an explicit renderer confirmation and is
  audit-logged.
- **Storage**: a single versioned layer (`src/qa/storage.ts`) with on-read
  migrations mirrors critical workspace data to disk via the Rust backend; the
  cookie jar enforces the full Public Suffix List (`src/qa/psl.ts`).
- **Performance engine**: k6, materialized into `src-tauri/resources/`
- **Tests + checks**: Vitest + Testing Library and Rust unit tests, gated in CI
  alongside `tsc --noEmit`, ESLint, `npm audit`, and `cargo audit`, with
  workflow actions pinned to commit SHAs.

## Project Status

Actively maintained. The frontend is fully strict TypeScript; every push runs
ESLint, `tsc --noEmit`, the Vitest suite, `npm audit`, and Rust unit tests, and
the release pipeline refuses to build installers unless those pass. See
[CHANGELOG.md](CHANGELOG.md) for the per-release history (recent work:
OS-keychain credential storage, hardened RBAC/BOLA/rate-limit oracles, three
new security engines — conformance, fuzzing, BFLA — richer SARIF, and the
React 19 upgrade).

## Requirements

- Node.js 20 or newer (CI runs on 22)
- npm
- Rust toolchain for Tauri commands and desktop builds
- k6 is handled by the setup scripts described below

## Development

<details open>
<summary>Common commands</summary>

Install dependencies:

```bash
npm install
```

Run the frontend dev server:

```bash
npm run dev
```

Run the Tauri desktop app in development mode:

```bash
npm run tauri:dev
```

Run tests:

```bash
npm test
```

Type-check, lint, and format:

```bash
npm run typecheck
npm run lint
npm run format
```

Build the frontend:

```bash
npm run build
```

Build the desktop app:

```bash
npm run tauri:build
```

</details>

## k6 Binary

<details>
<summary>k6 setup and release verification</summary>

The Performance page runs real load tests through k6. The binary is not
committed because it is large and platform-specific.

The setup script materializes it at `src-tauri/resources/`:

- **Dev**: `npm run setup:k6` is a no-op if k6 already exists, otherwise it
  copies `k6` from PATH or downloads the pinned release.
- **Release**: `npm run setup:k6:release` downloads the OS/arch-correct official
  artifact, verifies SHA256 checksums stored in `scripts/setup-k6.mjs`, and
  confirms `k6 version` before bundling.

Manual commands:

```bash
npm run setup:k6
npm run setup:k6:release
```

When bumping `K6_VERSION=<x.y.z>`, add that release's checksums to the
`CHECKSUMS` table in `scripts/setup-k6.mjs`; release builds fail closed if the
checksum is missing or mismatched.

</details>

## Local Data And Secrets

<details>
<summary>Stored files and secret handling</summary>

Runtime configuration is stored locally. Common generated files include:

- `config.json` for application settings
- `postman_collections_cache.json` for cached collection metadata
- `user_data.json` — disk mirror of critical workspace data (security findings
  lifecycle, baselines, perf history, monitors). The app reads/writes these via
  a single versioned storage layer (`src/qa/storage.ts`) that survives a cleared
  webview cache, migrates older data shapes on read, and surfaces write failures
  instead of swallowing them. Secrets (LLM API keys) are deliberately excluded
  from the mirror.

Manual AWS secret access keys are not stored in `config.json`: they live in the
OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret
Service), keyed by credential-profile id. A legacy inline secret is still
honored on read so older configs keep working.

LLM settings are stored in browser localStorage. AI privacy mode is
redacted-by-default: prompts are masked locally and shown in a preview before
being sent to the chosen provider; `local only` mode restricts AI to a
self-managed endpoint, and a CI / org lockdown (`QA_ALLOW_EXTERNAL_AI`) can
disable external AI entirely. Do not commit credentials, generated cache files,
local tokens, or machine-specific paths.

Security run records persist only a compact, redacted snapshot — request/response
bodies are never stored. The richer redacted evidence artifact is held in memory
for the current session and only written into a saved run (or pinned baseline)
when you explicitly opt in.

</details>

## Packaging Notes

<details>
<summary>macOS, Windows, and Gatekeeper notes</summary>

macOS builds produce a `.dmg` under
`src-tauri/target/release/bundle/dmg/`. Windows builds produce both an NSIS
installer (`-x64-setup.exe`) and a no-install portable ZIP (`-x64-portable.zip`)
that holds the executable next to its bundled `resources/k6.exe`. Run
`npm run package:portable` to assemble that portable ZIP locally into `dist/`
(same steps as the release workflow). The macOS k6
binary is bundled into the app at
`Contents/Resources/resources/k6`, so Performance testing works without a
system k6 install.

The current macOS build is not signed or notarized with an Apple Developer ID.
On first launch, Gatekeeper may block it. Bypass it once by right-clicking the
app and choosing **Open**, or by clearing quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/QA Touchstone.app"
```

For wider distribution, sign and notarize the build.

</details>

## Credits

- **Performance testing** is powered by [Grafana k6](https://k6.io)
  ([`grafana/k6`](https://github.com/grafana/k6)), licensed under
  [AGPL-3.0](https://github.com/grafana/k6/blob/master/LICENSE.md). The official
  k6 binary is downloaded, SHA256-verified, and bundled under the app's
  `resources/` directory (see [k6 Binary](#k6-binary) and
  [Packaging Notes](#packaging-notes)). It runs as a separate executable invoked
  by the app — it is not linked into QA Touchstone. Thanks to the Grafana Labs
  team and the k6 contributors.
- Built with [Tauri](https://tauri.app) and [React](https://react.dev).

Trademarks and project names belong to their respective owners.

## License

ISC
