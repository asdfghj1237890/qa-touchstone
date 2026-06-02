# Authz / Security Test Matrix — Design

- **Date:** 2026-06-02
- **Status:** Approved design, ready for implementation plan
- **Scope:** First of two features. The **CI export** feature is explicitly out of
  scope here and will get its own spec in a later round. This spec only forward-shapes
  the result data so a later CI export can serialize it.

## 1. Overview

QA Companion is a Tauri desktop API client. Its **Test Gen** page already classifies
generated cases into `happy / negative / edge` and emits a single "unauthenticated →
401" case, but there is no systematic authorization testing.

This feature adds a new **Security** page that runs a **role-based access-control
(RBAC) matrix**: a 2-D grid of **identities × endpoints**, where each cell carries an
**expected outcome** (`allow` / `deny` / `skip`). The page sends each endpoint's saved
request once per identity — swapping in that identity's auth — classifies the real HTTP
response as allowed/denied, compares it against the expectation, and renders a pass/fail
grid. The dangerous case — *expected deny but actually allowed* — is flagged as a
**vulnerability**.

### Goals

- Define a reusable set of identities (each = a name + an auth config).
- Pick endpoints from the app's existing collections.
- Per-cell expectations with smart defaults and column/row bulk-fill.
- Execute the matrix for real (reusing the existing executor bridge) and show a
  pass/fail/vuln grid with drill-down into each request/response.
- Full i18n (zh-TW + en-US) and unit tests, consistent with the rest of the app.

### Non-goals (this spec)

- No OWASP API Top 10 probing (BOLA tampering, SSRF, injection, security headers,
  sensitive-data-exposure scans). Pure RBAC only.
- No CI export (JUnit / SARIF / GitHub Actions). Separate later spec.
- No new identity-provider integration beyond the auth types the app already supports.

## 2. Chosen approach

**Approach A — standalone Security module + thin authz engine.** Rejected
alternatives: folding into the Runner (B — tangles a 2-D grid + per-identity auth
override onto a sequential, list-oriented runner; hard to test) and generate-only into
Test Gen (C — user requires execute + grid).

New code:

| File | Responsibility |
|------|----------------|
| `src/qa/authz.js` | Pure logic, no React. Build cell list, classify a response, compute verdict, smart defaults, bulk-fill, run the matrix via an injected runner fn. Unit-tested. |
| `src/qa/Security.jsx` | The page: identity manager, endpoint picker, grid, run controls, cell-detail drawer. |

Reused / touched:

- `buildReq(reqId)` (`src/qa/buildReq.js`) — endpoint → full request shape.
- `executeRequest(req, env, varMap, opts)` (`src/qa/executor.js`) — send (Tauri →
  browser fetch → canned).
- The env/vars/cookie/sslVerify plumbing already used by `qaRunSavedRequest`
  (`src/qa/sendRequest.js`). The matrix runner follows the same resolution path,
  overriding only `req.auth`.
- **`AuthEditor`** is currently an unexported internal component of
  `src/qa/RequestBuilder.jsx`. Extract it (with its `OAuth2Editor` helper) into a shared
  module — `src/qa/AuthEditor.jsx` — and have RequestBuilder import it. This is a
  targeted refactor in service of the feature, not unrelated cleanup.
- `App.jsx` (register `security` route + render `<SecurityPage/>`), `Sidebar.jsx` (nav
  rail item with a shield icon), `i18n.jsx` (strings), `qa.css` (grid styles).

## 3. Data model

```js
Identity    = { id, name, auth }            // auth: the existing { type, bearer, apiKey, basic, oauth2, aws } shape.
                                            // Built-in seed identity "anon" with auth.type === 'none' (not deletable).
EndpointRef = { reqId, method, path }       // chosen from window.QA.COLLECTIONS via buildReq metadata.
Expectation = 'allow' | 'deny' | 'skip'
denySet     = number[]                      // statuses that count as "denied". Default [401, 403]. User-editable.

CellResult  = {
  status,            // HTTP status or null on transport error
  outcome,           // 'allowed' | 'denied' | 'other'
  verdict,           // 'pass' | 'fail' | 'vuln' | 'inconclusive' | null(not-run)
  timeMs,
  request,           // the resolved request shape that was sent (auth redacted in storage)
  response,          // { status, statusText, time, size, body, headers }
  error,             // string|null
}

MatrixState = {
  identities: Identity[],
  endpoints:  EndpointRef[],
  expect:     { [reqId]: { [identityId]: Expectation } },
  denySet:    number[],
  results:    { [reqId]: { [identityId]: CellResult } },   // transient run output
}
```

Persisted to `localStorage` under `SECURITY_STORAGE_KEY` (mirrors the Monitors
`MONITOR_STORAGE_KEY` pattern). **Persist config only** — `identities` (with secrets),
`endpoints`, `expect`, `denySet`. `results` are transient and not persisted (avoids
storing live response bodies / secrets at rest beyond what the user already accepts for
auth config).

## 4. Classification engine (`authz.js`, unit-tested)

**Outcome** from the real response:

- `2xx` (200–299) → `allowed`
- `status ∈ denySet` (default 401, 403) → `denied`
- anything else (3xx, 400, 404, 5xx, transport error) → `other`

**Verdict** = expectation vs outcome:

| Expected | Outcome `allowed` | Outcome `denied` | Outcome `other` |
|----------|-------------------|------------------|-----------------|
| `allow`  | **pass**          | **fail** (over-restrictive / broken) | **inconclusive** |
| `deny`   | **vuln** (access-control hole — critical) | **pass** | **inconclusive** |
| `skip`   | not run           | not run          | not run          |

`vuln` is the headline finding and is styled distinctly (critical red + icon).
`inconclusive` (yellow) means the response was neither a clean allow nor a clean deny —
the user should inspect it (e.g. a 404 used to hide a resource, or a 5xx).

**Smart defaults** when an endpoint or identity is added: identity `anon`
(`auth.type === 'none'`) defaults every cell to `deny`; every other identity defaults to
`allow`. Users override per cell.

**Bulk-fill:** `setColumn(identityId, expectation)` and `setRow(reqId, expectation)`.

`authz.js` exposes pure functions plus `runMatrix(state, runner, { signal, onCell })`
where `runner(endpoint, identity) → Promise<response>` is injected so tests can stub it.

## 5. Execution flow

For each cell whose expectation ≠ `skip`, sequentially (abortable):

1. `req = buildReq(endpoint.reqId)`
2. `req.auth = identity.auth` (override; identity `anon` → `{ type: 'none' }`)
3. Resolve vars/cookies the same way `qaRunSavedRequest` does (current `env`, `vars`,
   `cookies`, `sslVerify`, oauth token if the identity uses oauth2), then
   `executeRequest(req, env, varMap, opts)`.
4. Classify → `CellResult`; stream back via `onCell` so the grid fills progressively.

Sequential execution keeps it simple and avoids hammering the target; a "Run all / Run
row / Run cell" set of controls plus a stop button. Outside Tauri (dev/test) the
executor falls back to canned responses, so tests stay deterministic.

## 6. UI

New `security` route; nav-rail item with a shield icon, placed after `runner`.

- **Identity manager** (left/top): list of identities; add/edit/remove; each edit opens
  the shared `AuthEditor`. `anon` is seeded and non-deletable.
- **Endpoint picker:** add rows by selecting saved requests from `window.QA.COLLECTIONS`
  (folder-grouped picker, like the sidebar tree).
- **Grid:** rows = endpoints (`MethodBadge` + path), columns = identities (header shows
  name + auth type). Clicking a column or row header opens a quick allow/deny/skip
  bulk-set. Each cell: before a run, the expectation badge; after, the actual status +
  pass/fail/vuln/inconclusive coloring.
- **Cell drawer:** click a populated cell → drawer with the resolved request and full
  response (reuse `ResponsePanel`-style rendering).
- **Summary chips** (top): total / pass / fail / **vulnerabilities** / inconclusive.

## 7. i18n & testing

- All user-facing strings added to `src/qa/i18n.jsx` for both `zh-TW` and `en-US`
  (the app has full coverage; the new page must match).
- **Unit tests** (`src/__tests__/authz.test.js`): outcome classification incl. denySet
  edge cases, the full verdict table (esp. `deny + allowed → vuln`), smart defaults,
  bulk-fill, and `runMatrix` with a stubbed runner (skip handling, abort, progressive
  `onCell`).
- **Component smoke test** for `Security.jsx` on the canned path: seed identities +
  endpoints, run, assert the grid renders verdicts.

## 8. Risks / notes

- **AuthEditor extraction** must not regress RequestBuilder — covered by existing
  RequestBuilder behavior; verify the API client auth tab still works after the move.
- **Secrets at rest:** identity auth (tokens) persist to localStorage, same trust model
  the app already uses for request auth/variables. `results` are not persisted.
- **OAuth2 identities:** acquiring a token may require the same token-exchange flow the
  request builder uses; v1 can require the user to fetch the token in the identity
  editor before running (no silent background refresh).

## 9. Forward hook for CI export (next spec)

`MatrixState.results` + `CellResult` are intentionally serializable (no React/DOM
references, redacted requests) so the later CI-export feature can emit JUnit/SARIF/etc.
directly from a completed matrix run without reshaping.
