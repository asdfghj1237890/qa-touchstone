# Capability Matrix — Desktop vs Headless CLI

QA Touchstone ships as **two surfaces over one shared engine core**:

- **Desktop** — the Tauri app (`src/qa/**` UI + `src-tauri/src/**` backend).
- **Headless CLI** — `qa-touchstone-ci` (`src-tauri/cli/**`), no Tauri, no OS
  keychain, built for CI runners.

The Rust core (`src-tauri/core/src/**`) is the source of truth for the analysis
logic. The CLI calls it directly. The desktop is migrating to call it over Tauri
IPC as well: the **RBAC matrix** engine already runs via the core on desktop
(`run_security_matrix` → `core::security::runner::run_matrix`), with the
TypeScript engine (`src/qa/*.ts`) kept as the **browser/dev fallback**; the other
desktop engines still run as TypeScript pending later slices. TS↔Rust behaviour
parity is enforced by the golden fixtures in `src-tauri/core/tests/fixtures`
(regenerated and diff-gated in CI — see
[`scripts/gen-fixtures.mjs`](../scripts/gen-fixtures.mjs) and `.github/workflows/ci.yml`).

> **Why this file exists:** the two surfaces evolve on separate cadences, so a
> feature can land on one before the other. This table is the single source of
> truth for "what runs where". Update it in the same PR that changes either
> surface.

## Security engines

Five of the six engines run on **both** surfaces. **Conformance is desktop-only**
today — it exists as TypeScript (`schemaConformance.ts`) with no Rust port, so
the CLI's `scan` does not run it (the Rust `EngineId` enum is
`Matrix, Bola, Bfla, RateLimit, Oracle, Fuzz` — see
[`core/src/security/finding.rs`](../src-tauri/core/src/security/finding.rs)).

Fuzz and BFLA *are* on both surfaces: earlier docs called conformance/fuzz/BFLA
"engine shipped, UI integration pending"; for fuzz and BFLA that's now done (wired
into the desktop suite at [`Security.tsx`](../src/qa/Security.tsx) and into `scan`
at [`cli/src/scan.rs`](../src-tauri/cli/src/scan.rs)), while conformance still awaits
a Rust port to reach the CLI.

| Engine (OWASP)             | Desktop UI | CLI `scan` | Engine module (TS / Rust)                        |
| -------------------------- | :--------: | :--------: | ------------------------------------------------ |
| RBAC matrix (API1/API5)    |     ✅     |     ✅     | `authz.ts` / `core/src/security/authz.rs`        |
| BOLA / IDOR (API1)         |     ✅     |     ✅     | `bola.ts` / `core/src/security/bola.rs`          |
| Rate-limit / abuse (API4)  |     ✅     |     ✅     | `ratelimit.ts` / `core/src/security/ratelimit.rs`|
| BFLA (API5)                |     ✅     |     ✅     | `bfla.ts` / `core/src/security/bfla.rs`          |
| Fuzzing (5xx/leak/reflect) |     ✅     |     ✅     | `fuzz.ts` / `core/src/security/fuzz.rs`          |
| Schema conformance         |     ✅     |   ❌ (TS-only) | `schemaConformance.ts` / _(no Rust port yet)_ |

Response **oracles** (sensitive-data exposure, schema drift) run as a cross-cutting
layer on both surfaces (`oracles.ts` / `core/src/security/oracles.rs`,
`EngineId::Oracle`).

Reports/gating available on both surfaces: JSON, HTML, JUnit XML, SARIF; baseline
diff (new/carried/resolved) and gate on new high/critical.

> **Known drift:** porting conformance to `core/src/security/` would close the
> last engine gap between the two surfaces. Until then, a CI `scan` will not flag
> schema-conformance issues that the desktop app would.

## Feature areas

| Area                              | Desktop | CLI | Notes                                                                    |
| --------------------------------- | :-----: | :-: | ------------------------------------------------------------------------ |
| REST/GraphQL request client       |   ✅    | ◑  | CLI sends one request (`send`) / collections (`run`); no GraphQL explorer |
| Collection runner (live)          |   ✅    | ✅  | CLI `run` with JUnit output                                              |
| Postman/OpenAPI import            |   ✅    | ✅  | CLI `import` → `qa.json` scaffold                                        |
| Security suite                    |   ✅    | ✅  | see table above; CLI `scan`                                              |
| Findings lifecycle + baseline     |   ✅    | ✅  | CLI: `--baseline` / `--update-baseline`                                  |
| Report export (JSON/HTML/JUnit/SARIF) | ✅  | ✅  | CLI flags `--out/--html/--junit/--sarif`                                 |
| k6 performance testing            |   ✅    | ◑  | CLI `perf` needs k6 on the runner (not bundled); desktop bundles k6      |
| Realtime (WebSocket / SSE)        |   ✅    | ❌  | UI-only                                                                  |
| Monitors (scheduled)              |   ✅    | ❌  | background scheduler is desktop-only                                     |
| AI test-gen / review / triage     |   ✅    | ❌  | desktop-only; CLI is deterministic by design                             |
| API docs / codegen                |   ✅    | ❌  | UI-only                                                                  |
| BOLA config suggestion            |   ✅    | ✅  | CLI `bola-suggest`                                                       |
| OS-keychain secret storage        |   ✅    | ❌  | CLI reads secrets from env (`{ "env": "API_TOKEN" }`)                    |
| Stable exit codes (0–4)           |   —     | ✅  | CI contract; see README "Headless CI Runner"                             |

Legend: ✅ full · ◑ partial/subset · ❌ not present · — n/a

## CLI command → capability

| Command        | Needs network | Needs k6 | Output                                         |
| -------------- | :-----------: | :------: | ---------------------------------------------- |
| `ping`         |      Yes      |    No    | Human status line                              |
| `import`       |      No       |    No    | `qa.json` scaffold                             |
| `send`         |      Yes      |    No    | JSON result                                    |
| `run`          |      Yes      |    No    | JSON + optional JUnit XML                      |
| `perf`         |      Yes      |   Yes    | JSON + optional k6 summary export              |
| `scan`         |      Yes      |    No    | JSON, HTML, JUnit XML, SARIF, baseline updates |
| `bola-suggest` |      No       |    No    | Human or JSON candidate list                   |
