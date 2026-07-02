# Getting Started

A 15-minute path from clone to your first security scan. For the full feature
list see the [README](../README.md); for deeper dives see the
[docs index](#where-to-next).

## Prerequisites

- **Node.js 20+** (CI runs on 22) and **npm**
- **Rust toolchain** — only needed for the desktop app (`tauri:dev`/`tauri:build`)
  and the headless CLI; not for the browser dev server
- **k6** is fetched automatically by the setup scripts (see README "k6 Binary")

## 1. Install

```bash
npm install
```

Optional: copy the env template if you need to override defaults (the app runs
fine without it):

```bash
cp .env.example .env
```

## 2. Run it

**Fastest look (browser, no Rust):**

```bash
npm run dev          # http://localhost:3000
```

The browser mode uses deterministic fallbacks for anything that needs the native
backend — good for UI iteration, not for real request execution.

**Full desktop app (real request execution, k6, keychain):**

```bash
npm run tauri:dev
```

## 3. Send your first request

1. Open **API Client** from the nav rail.
2. Pick or add an **environment** (a base URL + variables) in **Settings**.
3. Enter a method + URL, **Send**, and inspect the response, headers, and timing.

## 4. Import a demo collection

The repo ships two ready-to-run Postman collections in [`demo/`](../demo):

- `public-apis.postman_collection.json`
- `rest-countries.postman_collection.json`

Use the sidebar **Import** button → pick a file. The requests appear as a
collection you can run individually or via the **Runner**. QA Touchstone also
imports OpenAPI/Swagger JSON.

## 5. Run your first security scan

This is the core feature. Full walkthrough:
[security-workflow.md](security-workflow.md). The short version:

1. Open **Security**.
2. Define at least two **identities** — e.g. `anon` (no auth) and one
   authenticated identity.
3. Add an **endpoint** (a saved request), ideally a privileged one.
4. Mark the per-cell **expectation**: which identity should be `allow` vs `deny`.
5. **Run full security suite**.
6. **Triage** the findings, then **pin a baseline** so future runs show only
   what changed.

## 6. Wire it into CI (optional)

Build the headless runner and gate a pipeline on new high/critical findings:

```bash
cargo build --manifest-path src-tauri/Cargo.toml -p qa-touchstone-ci --release
./src-tauri/target/release/qa-touchstone-ci --version
```

See the README "Headless CI Runner" section for the `qa.json` schema, the
`setup-ci` GitHub Action, and a full workflow example.

## Everyday commands

```bash
npm test           # vitest suite
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # eslint
npm run format     # prettier --write
npm run build      # frontend build
npm run tauri:build# desktop installer
```

## Where to next

- [Capability matrix](capability-matrix.md) — what runs on desktop vs the CLI
- [Security workflow](security-workflow.md) — the full RBAC/BOLA/rate-limit journey
- [Design system](design-system.md) — theming, tokens, and UI primitives
- [AI-era API testing assessment](ai-era-api-testing-assessment.md) — the product thesis
- [Architecture diagram](architecture.svg)
