# QA Touchstone

[繁體中文](README.zh-TW.md)

QA Touchstone is a local-first desktop workspace for API QA. It combines a
Postman-compatible API client, live collection execution, monitors, k6
performance testing, AI-assisted test generation, AI response review, and
exportable API documentation in one Tauri app.

## Current Scope

The current public-facing scope is API testing only:

- Generic API environments for local, staging, production, and custom targets
- Local request execution through the Tauri desktop backend
- Browser/dev fallback paths for deterministic tests and quick UI iteration
- Runtime data and credentials stored on the local machine
- No company-specific services, internal links, or obsolete non-API workflow docs

## What Changed In This Refactor

- Repositioned the product around API QA workflows instead of the earlier broad
  desktop utility scope.
- Removed obsolete non-API workflow descriptions from the public README and docs.
- Kept the useful API testing surface: import, send, run, monitor, review,
  document, export, and performance-test requests.
- Promoted live execution paths: Runner and Monitors now evaluate assertions
  against real responses instead of demo-only data.
- Consolidated LLM usage through shared settings for Test Gen and response
  review.

## Capabilities

- **API client**: build HTTP requests, switch environments, inspect responses,
  view history, and export response reports.
- **Import/export**: import Postman v2.1 collections and OpenAPI/Swagger JSON;
  export collections back to Postman JSON.
- **Authentication**: No Auth, Bearer Token, OAuth 2.0, API Key, Basic Auth,
  and AWS SigV4.
- **Variables and cookies**: resolve global, collection, environment, and local
  variables; replay matching cookies through the local cookie jar.
- **Collection Runner**: run selected requests, iterate over CSV/JSON data, and
  score assertions on live responses.
- **Monitors**: create monitor cards and trigger live "Run now" collection
  checks. Background cadence scheduling is still follow-up work.
- **Performance testing**: generate and run k6 performance, load, and stress
  tests with live metrics, SLO scoring, history, and exportable reports.
- **AI assistance**: generate classified test cases from BDD, OpenAPI, PRD, or
  PDF-like text; review individual API responses against existing assertions.
- **Docs and codegen**: generate API docs, standalone HTML exports, and request
  code snippets.
- **Realtime testing**: test WebSocket and Server-Sent Events streams.

## Architecture

- **Frontend**: React 18 + Vite
- **Desktop shell**: Tauri 2
- **Backend commands**: Rust, including request execution, process helpers, and
  local file operations
- **Performance engine**: k6, materialized into `src-tauri/resources/`
- **Tests**: Vitest + Testing Library for the frontend and Rust unit tests for
  Tauri helpers

## Requirements

- Node.js 18 or newer
- npm
- Rust toolchain for Tauri commands and desktop builds
- k6 is handled by the setup scripts described below

## Development

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

Build the frontend:

```bash
npm run build
```

Build the desktop app:

```bash
npm run tauri:build
```

## k6 Binary

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

## Local Data And Secrets

Runtime configuration is stored locally. Common generated files include:

- `config.json` for application settings
- `postman_collections_cache.json` for cached collection metadata
- `api_credential_configs.json` for reusable API credential profile metadata

LLM settings are stored in browser localStorage and sent directly to the chosen
provider. Do not commit credentials, generated cache files, local tokens, or
machine-specific paths.

## Packaging Notes

macOS builds produce a `.dmg` under
`src-tauri/target/release/bundle/dmg/`. Windows builds produce an NSIS
installer. The macOS k6 binary is bundled into the app at
`Contents/Resources/resources/k6`, so Performance testing works without a
system k6 install.

The current macOS build is not signed or notarized with an Apple Developer ID.
On first launch, Gatekeeper may block it. Bypass it once by right-clicking the
app and choosing **Open**, or by clearing quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/QA Touchstone.app"
```

For wider distribution, sign and notarize the build.

## License

ISC
