# Security Response Oracles — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Phase 1 only — sensitive-data exposure + schema/contract conformance, attached to the Security matrix.

## Motivation

The Security matrix today does RBAC well: `endpoint × identity → run → classify HTTP status → verdict (pass/fail/vuln)`. That covers function-level authorization (BFLA is structurally the matrix with a low-priv identity column + a `deny` expectation).

It does **not** look *inside* responses. The AI-era API risks that bite hardest are object-level and response-content risks:

- **BOLA / IDOR** — swap `userId`/`orderId`/`tenantId` to test cross-object access.
- **Sensitive data exposure** — does the response leak token / email / internal fields?
- **Schema / contract conformance** — does the response match its expected shape?
- **Rate limit / abuse**.
- **BFLA** — low-priv role hitting high-priv endpoints (mostly already covered).

These collapse into one architectural idea: every executed request flows through a set of **oracles**. This spec builds the first, highest-leverage slice — the two *response* oracles — because the matrix **already captures every response body per cell**, so they need zero new execution and immediately enrich what exists. They also establish the **findings model** that every later phase reuses.

## Decisions (locked during brainstorming)

1. **Phase 1 = response oracles first** (sensitive-data + schema). BOLA / rate-limit / BFLA-ergonomics are roadmap.
2. **Sensitive-data detection = rules-first + optional LLM.** Deterministic regex / key-name rules are the spine (repeatable, offline, no API key); an opt-in LLM pass catches what rules miss.
3. **Schema source = inferred baseline + drift (default, zero-config)**, with optional OpenAPI/JSON-Schema attach taking precedence when present.
4. **Finding model = independent findings layer**, orthogonal to the allow/deny verdict. A cell can be authz-`pass` and still carry a `high` data-leak finding.
5. **Surfacing scope = matrix only** — cell drawer findings + an aggregated findings panel in the Security page. (API-client scanning is roadmap.)
6. **Architecture = Approach A** — a pure `oracles.js` module auto-run in `Security.jsx`, mirroring the existing `authz.js` (pure engine) / `Security.jsx` (UI) split. Authz path is untouched.
7. **Baselines = transient (intra-run)** for phase 1. Persisted / pinned baselines are roadmap.

## Architecture

```
src/qa/oracles.js   (NEW, pure, unit-tested like authz.js)
   ├─ scanSensitive(response, config) -> Finding[]      # rules, runs on ALL responses
   ├─ inferContract(body) -> Contract                   # field-path -> {type, required, enum?}
   ├─ checkSchema(body, contract) -> Finding[]          # drift; runs on 2xx only
   ├─ runOracles(cell, ctx) -> Finding[]                # orchestrates the above for one cell
   ├─ scanSensitiveLLM(response) -> Promise<Finding[]>  # OPTIONAL, qaCallLLM, source:'llm'
   ├─ summarizeFindings(results) -> {bySeverity, byOracle, total}
   └─ DEFAULT_ORACLE_CONFIG, SEVERITY_ORDER, redact()

src/qa/Security.jsx  (MODIFIED — UI wiring only)
   ├─ baselinesRef: { [reqId]: Contract }   # seeded by first 2xx per endpoint in a run
   ├─ onCell -> runOracles(...) -> cell.findings
   ├─ cell badge + drawer Findings section + "Scan with AI" button
   └─ aggregated findings panel + findings-by-severity summary chips
```

`authz.js` / `runMatrix` are **not** modified. Oracles consume the `cell.response` the matrix already produces.

## Components

### 1. Finding shape

```js
{
  oracle:   'sensitive-data' | 'schema',
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical',
  title,                 // human label, i18n key driven
  path,                  // JSON pointer-ish path or header name, e.g. "user.email" / "header:Server"
  evidence,              // ALWAYS masked/truncated — never the full secret
  source:   'rule' | 'llm',
}
```

`SEVERITY_ORDER = ['info','low','medium','high','critical']` drives sorting and the cell's "worst-severity" badge color.

### 2. Sensitive-data oracle — `scanSensitive(response, config)`

Deep-walks the JSON body and iterates response headers. Each rule is `{ id, label, severity, scope: 'value'|'key'|'both', test }`. Matches on value-regex AND key-name where applicable.

Rule groups (severities are defaults; user-adjustable):

| Group | Examples | Default severity |
|---|---|---|
| Secrets | JWT (`eyJ…`), bearer, AWS access key (`AKIA[0-9A-Z]{16}`), `-----BEGIN … PRIVATE KEY-----`, any value under key `password\|secret\|token\|apikey\|client_secret` | high / critical (private key, password value → critical) |
| PII | email, phone, credit-card (Luhn-validated to cut false positives), national-id-like | medium / high |
| Internal/debug | key names `stacktrace\|exception\|sql\|internal*\|debug`; headers `Server`, `X-Powered-By`; stack-trace error envelopes | medium |

- Runs on **every** response regardless of status (a 403/500 body can leak a stack trace).
- `redact(value)` masks evidence: keep a short prefix/suffix, replace the middle (e.g. `eyJ…<redacted>…9c`), and cap length.
- Each rule emits at most a bounded number of findings per response to avoid floods (e.g. dedupe by `(ruleId, path)`).

### 3. Schema oracle — `inferContract` + `checkSchema`

- `inferContract(body)`: walks the object, producing `path → { type, required:true, enum? }`. Arrays inspected by element shape; `enum` only inferred for small primitive sets. Shallow record of presence/type — not a full JSON-Schema.
- `checkSchema(body, contract)`:
  - **Undeclared field** (in body, not in contract) → `low`. **Cross-bump to `high`** if the path also matches a sensitive rule (overexposure).
  - **Missing field** (in contract, absent in body) → `medium`.
  - **Type mismatch** → `medium`.
- Baseline priority: **attached OpenAPI/JSON-Schema for the endpoint (if present) > first 2xx response per endpoint in the current run.**
- Runs on **2xx responses only** (error envelopes differ in shape and would create noise).

### 4. Baseline store (Security.jsx)

`baselinesRef = useRef({})`, keyed by `reqId`. During a run, the first 2xx response per endpoint seeds `baselinesRef.current[reqId] = inferContract(body)`; later 2xx responses for that endpoint are checked against it. Reset at the start of each full run. **Transient** — not persisted in phase 1.

### 5. Optional LLM pass — `scanSensitiveLLM(response)`

On-demand only. A "Scan with AI" button in the cell drawer (and/or findings panel) calls `qaCallLLM` with the (masked-where-possible) response, asking for sensitive/PII/internal exposure the rules missed. Results are merged as findings with `source:'llm'`. Requires LLM config; never runs automatically; never blocks the matrix run. If LLM is unconfigured the button is disabled with a hint.

### 6. UI wiring (Security.jsx — matrix only)

- **onCell** (`src/qa/Security.jsx`): after a cell completes, compute `cell.findings = runOracles(cell, { baseline: baselinesRef.current[reqId], config })` and store it on the cell.
- **Cell**: existing `verdict` chip **plus** a findings badge — count + dot colored by worst severity. Absent when no findings.
- **Drawer**: a new **Findings** section listing each finding (`severity · oracle · path · masked evidence`), sorted by severity desc, plus the "Scan with AI" button.
- **Aggregated findings panel**: a collapsible panel in the Security page that flattens every cell's findings with `(endpoint, identity)` context and groups by severity / oracle / endpoint.
- **Summary**: a findings-by-severity breakdown rendered next to — and visually distinct from — the existing pass/fail/vuln chips (the layer is orthogonal, not part of the authz tally).

### 7. Config & i18n

- `DEFAULT_ORACLE_CONFIG`: per-oracle on/off + per-group severity overrides + `llmEnabled`. Persisted by extending `saveMatrixConfig` / `loadMatrixConfig` (new `oracleConfig` key; backward-compatible default when absent).
- New i18n keys under `security.findings.*`, `security.severity.*`, `security.oracle.*`, added to all locales including zh-TW (the project ships full zh-TW).

## Data flow

```
runMatrix (unchanged) ──onCell──▶ Security.onCell
                                     │  seed/lookup baseline (2xx)
                                     ▼
                                  runOracles(cell, ctx)
                                     │  scanSensitive (all)  +  checkSchema (2xx)
                                     ▼
                                  cell.findings  ──▶ cell badge / drawer / panel / summary
                                                  (optional) "Scan with AI" ─▶ scanSensitiveLLM ─▶ merge
```

## Error handling

- Non-JSON / unparseable bodies: sensitive-data falls back to scanning the raw string; schema oracle is skipped (no contract inferable). No throw.
- Oracle exceptions are caught per cell so one bad response never aborts the run; a failed oracle yields zero findings (not a crashed run).
- LLM failures surface inline on the button (like the existing AI-review flow), never block.
- Evidence is masked at the point of capture so secrets are never stored unredacted on the cell.

## Testing

- **`src/__tests__/oracles.test.js`** (new, pure): each rule group (positive + negative incl. Luhn false-positive guard), `inferContract`, `checkSchema` drift cases (undeclared / missing / type-mismatch), the sensitive×schema cross-bump, `redact()` masking, `summarizeFindings`.
- **Extend `src/__tests__/security-page.test.jsx`**: on the canned path, a cell with a known leaky/drifting response shows the findings badge, the drawer lists the finding, and the summary reflects it. The LLM button is gated on config.

## Roadmap (NOT built in this spec — listed so the model holds together)

- **Phase 2 — BOLA / IDOR**: request mutation (substitute a victim identity's object-id while authed as attacker) + cross-identity attack engine. Reuses the findings model.
- **Phase 3 — Rate limit / abuse**: a burst runner (N rapid requests; detect 429/Retry-After, or flag its *absence*). Reuses findings.
- **Phase 4 — depth**: BFLA ergonomics (auto-flag mutating/admin endpoints); retain `op.responses[...].schema` in `import-parser.js` so OpenAPI feeds the schema oracle; persisted / pinned baselines; **differential exposure** (compare what different identities see for the same endpoint — a free, strong signal from this design); API-client response-panel scanning; CI export of findings (JUnit/SARIF).

## Out of scope (phase 1)

- Any change to `authz.js` / `runMatrix`.
- Request mutation, burst execution.
- Persisted/cross-run baselines, OpenAPI schema retention.
- Scanning outside the Security matrix (API client, Runner, Monitors).
