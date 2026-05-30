# Performance page → real load via k6 integration

Date: 2026-05-30
Status: Approved (design)

## Goal

The Performance page currently simulates load with synthetic curves
(`TYPE_META.baseLat`/`capacity` + `vusAt()` over 56 buckets). Make it real: the
chart and SLO scoring reflect actual HTTP behavior from real concurrent requests
against the selected target. We do this by delegating the load engine to **k6**
(Grafana, industry standard) rather than rolling our own JS-side worker pool.

## Why k6, not a JS engine

- k6 handles concurrency, stage ramping, percentile metrics, and timing
  correctly. A JS-in-webview engine cannot match this on accuracy under load.
- The Rust backend already has `commands::process::run_command` (async tokio
  subprocess with streamed stdout/stderr + tree-kill). The k6 hookup reuses it.
- User must install k6 (`winget install k6.k6` or `choco install k6`). Missing
  k6 → show install hint, do **not** fall back to a JS engine (avoids two
  divergent result sources).

## Architecture

1. **PerfTest.jsx** (frontend) — replaces synthetic `run()`:
   a. Build the request to test from `REQUEST_DETAILS[target]` + the flat option.
      No env/vars in Phase 1 (absolute-URL imports work directly; `{{vars}}`
      requests don't bind yet — note in the UI).
   b. Generate a k6 script string via `k6gen.buildScript(req, stages, conn)`.
   c. Call new bridge `api.writeTempText(content) → path` (Rust command).
   d. `api.runCommand("k6", ["run", "--quiet", "--no-summary", "--out", "json=-", path])`.
   e. Listen `command-output` events, buffer chunks into lines, parse each line
      via `k6parse.feed(state, line)`. State accumulates: per-bin avg latency
      (binned by k6 sample `time` aligned to run start), per-bin RPS, overall
      latency list (for p80/p90/p95/p99), HTTP status counts, errors.
   f. On each tick (~250 ms), `setLive({ m, latSeries, rpsSeries, dist, broke,
      slo })` in the same shape the current chart consumes — no chart changes.
   g. On `run_command` completion: compute SLO `rows`, push a `runs[]` history
      entry exactly like today, persist in localStorage.
   h. Stop button → `api.stopCommand(<pid>)` (existing). Component unmount →
      same stop, so leaving the route never orphans k6.

2. **`src/qa/k6gen.js`** (new) — pure helper:
   - `buildScript({ method, url, headers, body }, stages, conn)`:
     emits ES module k6 script: `import http from 'k6/http';`,
     `export const options = { stages: [{duration:'8s', target: 10}, ...] }`,
     and `export default function() { http.<method>(url, body, params); }`.
     JSON body → string + `Content-Type: application/json` header.
     `conn.timeout` → `params.timeout: '30s'`.
   - Pure, no side effects. Unit-tested.

3. **`src/qa/k6parse.js`** (new) — pure helper:
   - `feed(state, line, runStartMs, dtMs)`: parses one ndjson line; if it's a
     `Point` for `http_req_duration`, pushes the value, attributes a bin index,
     bumps the request counter for that bin. Tracks status tag for 2xx/4xx/5xx.
   - `snapshot(state, slo)`: returns `{ m, latSeries, rpsSeries, dist, broke }`
     shaped exactly like the current `live` state.
   - Pure, unit-tested with synthetic ndjson fixtures.

4. **`src-tauri/src/commands/fsops.rs`** — add `write_temp_text(content: String)`:
   - Creates a unique file under `std::env::temp_dir()` (e.g. `qa-k6-<rand>.js`).
   - Writes content, returns the path string.
   - Registered in `lib.rs` invoke handler.

5. **JS bridge** (`src/api/index.js`):
   - `writeTempText: (content) => invoke('write_temp_text', { content })`.

## Stream-vs-file decision

We assume `k6 run --out json=-` streams ndjson to stdout (`-` = stdout). We'll
probe this with the user's installed k6. If it doesn't work, fallback: have k6
write `json=<tempfile>` and poll-read the file every 250 ms via existing
`read_file_content`.

## Safety defaults (per earlier choice)

Lower `TYPE_META.*.stages.t` peaks: Performance 5, Load 15, Stress 40 (from
120/200/500). No hard cap — users can crank up the stage editor for their own
infrastructure. Add a small UI hint near the stages editor: "公開 API 請保持
低 VUs".

## Out of scope

- env/vars binding (Phase 2).
- Multi-request scenarios.
- Bundling k6 — user installs it.
- Tail/file-poll fallback unless `--out json=-` proves unavailable.

## Verification

- Unit tests: `k6gen.buildScript` (GET / POST with JSON body / headers / stages)
  and `k6parse.feed`+`snapshot` (binning + percentiles on a fixed fixture).
- Manual: after rebuild, pick "Random cat fact", press Start, confirm the chart
  fills from real samples and the runs-history row records real metrics.
