# Rate-limit / Abuse Testing — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Phase 3 — rate-limit / abuse testing inside the Security page. Builds on the RBAC matrix (phase 0), response oracles (phase 1), and BOLA/IDOR (phase 2).

## Motivation

Missing or weak rate limiting enables credential stuffing, OTP/password-reset brute force, scraping, and cost/DoS abuse. None of the existing tools cover it: the RBAC matrix and BOLA send one request per cell, and the Performance page is a **simulated** load test (its own footer: "Load figures are from a simulated run") aimed at latency/SLO, not security — it never sends real traffic and cannot observe throttling.

This phase fires a **real, bounded burst** at an endpoint and reports whether throttling actually engages. The security insight: **the absence of a throttling signal is the finding** — if N requests complete with no `429` and no rate-limit headers, the endpoint is abusable, and that matters most on sensitive endpoints (login, OTP, password reset, writes).

## Decisions (locked during brainstorming)

1. **Burst shape = bounded burst (N requests + concurrency).** Configurable N and concurrency, hard-capped, stop-able. Simpler and safer than sustained-rate or escalating-ramp (both roadmap if ever needed).
2. **Throttle signal = HTTP 429 OR any rate-limit header** (`Retry-After`, `RateLimit-Limit/Remaining/Reset`, `X-RateLimit-Limit/Remaining/Reset`). Presence of a `RateLimit-*` header means a limiter exists (control present) even if not tripped.
3. **Verdict:** throttled → `pass`; burst completes with no signal → `vuln` (abuse risk); all requests errored → `inconclusive`.
4. **Severity = per-test sensitivity flag.** `vuln` on a `sensitive` endpoint → `high`; on a `normal` endpoint → `low`. (No-throttle on a public GET ≠ on login.)
5. **Guardrails = caps + confirm-before-run.** Hard caps `MAX_N=200`, `MAX_CONCURRENCY=10`, defaults N=30 / concurrency=5; a confirm dialog before firing ("send N real requests to {target} as {identity}?"); Stop aborts.
6. **Placement = a third mode in the Security page** (Matrix | Object-access | Rate limit), sharing identities; engine in a new pure `src/qa/ratelimit.js`; UI in `src/qa/RateLimitPanel.jsx`. Findings reuse the phase-1 `Finding` shape (`oracle:'rate-limit'`).

## Architecture

```
src/qa/ratelimit.js   (NEW, pure, unit-tested)
   ├─ THROTTLE_HEADERS (lowercased set)
   ├─ MAX_N = 200, MAX_CONCURRENCY = 10
   ├─ detectThrottleSignal(responses) -> { throttled, saw429, headerHit }
   ├─ classifyRateLimit(signal, completedCount) -> 'pass' | 'vuln' | 'inconclusive'
   ├─ rateLimitSeverity(sensitivity, verdict) -> severity | null
   ├─ runBurst(test, runner, opts) -> { responses, stats }   # concurrency pool, injected runner
   └─ summarizeRateLimit(results) -> { total, pass, vuln, inconclusive }

src/qa/RateLimitPanel.jsx  (NEW — UI; rendered by Security.jsx when mode === 'ratelimit')
   ├─ shared identities, shared EndpointPicker
   ├─ per-test config: identity, N, concurrency, sensitivity
   ├─ confirm-before-run modal + progress bar + Stop
   ├─ stats card + verdict + finding
   └─ findings reuse the phase-1 findings list/CSS

src/qa/Security.jsx  (MODIFIED — extend the mode toggle to 3 modes; render RateLimitPanel)
src/qa/authz.js      (MODIFIED — persist a `rateLimit` blob in the security config)
```

Reuses: `qaRunSavedRequest` (returns status + headers; no `mutate` needed), `EndpointPicker`/`MethodBadge`/`Icon`, the `Finding` shape, the findings panel/severity CSS. RBAC, BOLA, and the response oracles are untouched.

## Components

### 1. Throttle detection — `detectThrottleSignal(responses)`

`responses` is the burst result array, each `{ status, headers, timeMs, error }` (`headers` is a plain object keyed by header name). Returns:
```js
{ throttled: boolean, saw429: boolean, headerHit: boolean }
```
- `saw429` = any response with `status === 429`.
- `headerHit` = any response whose headers (compared **case-insensitively**) include a key in `THROTTLE_HEADERS`.
- `throttled` = `saw429 || headerHit`.

`THROTTLE_HEADERS` (lowercased): `retry-after`, `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`.

### 2. Verdict — `classifyRateLimit(signal, completedCount)`

`completedCount` = number of burst responses that returned a real HTTP status (i.e. `status` is a number; transport/`net` errors don't count). This is distinct from `stats.sent` (all responses collected, errors included).

- `signal.throttled` → `pass` (a limiter is present).
- `completedCount > 0 && !signal.throttled` → `vuln` (requests completed with no throttling — abuse risk).
- `completedCount === 0` → `inconclusive` (everything errored; nothing observed).

### 3. Severity — `rateLimitSeverity(sensitivity, verdict)`

- `verdict === 'vuln'`: `sensitivity === 'sensitive'` → `high`, else → `low`.
- `pass` / `inconclusive` → `null` (no finding).

### 4. Burst executor — `runBurst(test, runner, opts)`

`test = { reqId, n, concurrency, ... }`. `runner(test, index) => Promise<response>` is injected (the page builds + executes via `qaRunSavedRequest`). `opts = { signal, onProgress }`.

- Clamp `n = min(max(1, test.n), MAX_N)`, `c = min(max(1, test.concurrency), MAX_CONCURRENCY)`.
- A **worker pool**: spawn `min(c, n)` workers; each pulls the next index until `n` are launched, awaiting `runner` per request. Per request, record `{ status, headers, timeMs, error }`; a thrown runner → `{ status:null, headers:{}, timeMs:0, error }` (counted, never aborts the burst).
- After each completion call `opts.onProgress(done, n)`. Check `opts.signal.aborted` before launching each new request (in-flight requests finish; no new ones start).
- Returns `{ responses, stats }` where `stats = { sent, ok2xx, c429, c4xx, c5xx, net, throttled, headerHit, avgMs, maxMs }` (`sent` = responses collected; `net` = errored/no-status).

### 5. UI — `RateLimitPanel.jsx` + Security 3-way mode toggle

- `Security.jsx`'s existing `mode` toggle gains a third segment: **Rate limit**. Identities/env/vars/cookies/sslVerify shared as today.
- **Per test:** `EndpointPicker` to add an endpoint; an **identity** dropdown (shared identities + anon — rate limits are per-token/IP); **N** (number, default 30, clamped ≤200), **concurrency** (default 5, clamped ≤10), and a **sensitivity** toggle (`sensitive`/`normal`).
- **Run:** opens a **confirm modal** — "Send {n} real requests to {METHOD path} as {identity}?" — Confirm fires `runBurst`; a progress bar tracks `done/n`. **Stop** aborts.
- **Results per test:** a stats card (sent · 2xx · 429 · throttle-headers-seen · 4xx/5xx/net · avg/max ms), the verdict chip (`pass`/`vuln`/`inconclusive`), and the finding (when severity ≠ null). Findings render in the shared findings list (`oracle:'rate-limit'`).
- **Runner (page-side):** `runner(test, index) => qaRunSavedRequest({ id: test.reqId }, { env, vars, cookies, sslVerify, authOverride: identity.auth, oauthToken: identity._oauthToken })` — identity resolved from `test.identityId`.

### 6. Finding shape (reused)

```js
{ oracle: 'rate-limit', severity, title: 'No rate limiting observed',
  path: `${method} ${path}`, evidence: `${sent} requests, no 429/rate-limit headers`, source: 'rule' }
```

## Data flow

```
RateLimitPanel.run() ─ confirm ─▶ runBurst(test, runner, {signal, onProgress})
                                     │  worker pool, ≤concurrency in flight, N total
                                     ▼
                                  { responses, stats }
                                     │  detectThrottleSignal(responses)
                                     │  classifyRateLimit(signal, sent) ─▶ verdict
                                     │  rateLimitSeverity(sensitivity, verdict) ─▶ Finding?
                                     ▼
                                  stats card / verdict chip / findings list
```

## Error handling

- Per-request try/catch inside the pool: a network/transport error is recorded as a `net` result and never aborts the burst.
- All requests errored (`sent === 0` completed-with-status, or every result has `error`) → `inconclusive`, with the error surfaced in the stats card.
- Caps (`MAX_N`, `MAX_CONCURRENCY`) clamp inputs in BOTH the UI and `runBurst` (defense in depth).
- Stop sets the abort signal; the pool stops launching new requests and resolves once in-flight ones settle.
- The confirm modal prevents accidental firing; closing it cancels with no requests sent.

## Testing

- **`src/__tests__/ratelimit.test.js`** (pure): `detectThrottleSignal` (429 present, header present case-insensitively, neither); `classifyRateLimit` (throttled→pass, completed-no-signal→vuln, zero-completed→inconclusive); `rateLimitSeverity` (sensitive vuln→high, normal vuln→low, pass→null); `runBurst` (collects N via injected runner, respects max-in-flight concurrency, honors abort signal mid-burst, records a thrown runner as a net error without aborting, `onProgress` streams).
- **`src/__tests__/ratelimit-panel.test.jsx`**: on the canned path (executor returns a fixed 200 with no rate-limit headers), configure a test, click Run, confirm the modal, and assert a `vuln` verdict + a `rate-limit` finding appear; a separate render with an injected/canned 429 (or a `Retry-After` header) yields `pass`; Run does nothing until the confirm modal is accepted.
- **`src/__tests__/authz.test.js`**: `rateLimit` blob round-trips.
- **`src/__tests__/security-page.test.jsx`**: the third mode toggle renders `RateLimitPanel`.

## Out of scope (this phase)

- Sustained-rate and escalating-ramp burst shapes (roadmap).
- Auto-detecting endpoint sensitivity (user marks it; method/path heuristics are roadmap).
- Distributed / multi-IP source simulation.
- Any change to RBAC, BOLA, oracle engines, or the Performance page.

## Roadmap after this

- **Phase 4 — depth:** BFLA ergonomics (auto-flag mutating/admin endpoints); id auto-discovery via seed requests + cross-tenant `tenantId` presets (BOLA roadmap); persisted/pinned baselines + retain `op.responses[].schema` in `import-parser.js` for OpenAPI-fed schema conformance (oracle roadmap); CI export of all findings (JUnit/SARIF). Optionally sustained-rate / ramp burst modes if the bounded burst proves insufficient.
