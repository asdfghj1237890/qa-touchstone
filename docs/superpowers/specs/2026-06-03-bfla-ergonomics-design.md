# BFLA Ergonomics — Auto-flag Privileged Endpoints — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Phase 4a — auto-classify privileged (admin / mutating) endpoints in the RBAC matrix and use that to set smarter default expectations for BFLA testing. Enhances the matrix engine; adds no new finding type.

## Motivation

BFLA (Broken Function-Level Authorization) — a low-privilege role calling a high-privilege endpoint — is already *caught* by the matrix verdict (an expectation of `deny` that returns 2xx → `vuln`). The gap is **setup ergonomics**: the tester must manually know which endpoints are privileged and set every non-admin identity's expectation to `deny` on them. Today the only smart default is per-identity (anon → deny, else allow), so an admin-only `DELETE /admin/users/{id}` defaults a normal `user` identity to `allow` — exactly the cell that should default to `deny`.

This phase auto-classifies privileged endpoints (mutating method or admin-ish path), surfaces them in the grid, and — via a per-identity privileged flag — makes privileged endpoints default *non-privileged* identities to `deny`, so the BFLA-relevant cells are pre-set correctly when the matrix is built.

## Decisions (locked during brainstorming)

1. **Classification = method + path heuristics.** Privileged if the method is mutating (`POST/PUT/PATCH/DELETE`) OR the path contains an admin-ish token. Each flag carries reasons (`write`, `admin-path`).
2. **Flag drives smarter defaults (not just a badge).** A per-identity `privileged` flag is added; a privileged endpoint defaults *non-privileged* identities to `deny`.
3. **Per-endpoint manual override.** Heuristics misfire, so each endpoint can be manually toggled privileged on/off; the override wins over the heuristic and persists.
4. **Lives in the matrix engine (`authz.js`)**, not a new module — it's an enhancement to `defaultExpectation`/`withDefaults`. No new finding type.
5. **Preserve existing cells.** `withDefaults` keeps any already-set expectation; smarter defaults apply only to newly added (endpoint, identity) cells / fresh matrices. Existing persisted matrices are never silently rewritten.

## Architecture

```
src/qa/authz.js   (MODIFIED — matrix engine)
   ├─ MUTATING_METHODS, ADMIN_PATH_TOKENS               # constants
   ├─ classifyEndpoint(method, path) -> { privileged, reasons }   # pure heuristic
   ├─ endpointPrivileged(ep) -> { privileged, reasons, source }   # override > heuristic
   ├─ defaultExpectation(identity, endpoint?) -> 'allow'|'deny'    # endpoint-aware (2nd arg optional)
   ├─ withDefaults(state)                               # passes ep to defaultExpectation
   └─ saveMatrixConfig                                  # persist identity.privileged

src/qa/Security.jsx   (MODIFIED — UI)
   ├─ endpoint row: privileged badge (reason tooltip) + override toggle
   ├─ toolbar: count of privileged endpoints
   └─ IdentityEditor: "privileged / admin" checkbox

src/qa/AuthEditor.jsx is NOT touched; the privileged checkbox lives in IdentityEditor (Security.jsx).
```

Identities/endpoints stay the same shape plus one optional field each. `runMatrix`, oracles, BOLA, and rate-limit are untouched.

## Components

### 1. `classifyEndpoint(method, path)`

```js
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
export const ADMIN_PATH_TOKENS = ['admin', 'internal', 'manage', 'management', 'root', 'sudo', 'privileged', 'superuser'];

classifyEndpoint(method, path) -> { privileged: boolean, reasons: string[] }
```
- `reasons` includes `'write'` if `method.toUpperCase()` ∈ `MUTATING_METHODS`.
- `reasons` includes `'admin-path'` if any **discrete token** of the path (split on `/ . _ - ? = &`, lowercased) is in `ADMIN_PATH_TOKENS` — so `admin` matches `/admin/x` and `v1.admin` but `badminton` does not.
- `privileged = reasons.length > 0`. Pure; tolerant of null/empty method/path.

### 2. `endpointPrivileged(ep)`

```js
endpointPrivileged(ep) -> { privileged, reasons, source }
```
- If `typeof ep.privileged === 'boolean'` → `{ privileged: ep.privileged, reasons: ['manual'], source: 'manual' }`.
- Else → `{ ...classifyEndpoint(ep.method, ep.path), source: 'auto' }`.

The manual override is the only thing persisted on the endpoint (`ep.privileged`); the heuristic is recomputed at render/default time.

### 3. `defaultExpectation(identity, endpoint)` (endpoint-aware)

```js
defaultExpectation(identity, endpoint) -> 'allow' | 'deny'
```
- anon (`identity.auth.type === 'none'`) → `deny`. (unchanged)
- privileged endpoint (`endpointPrivileged(endpoint).privileged`) AND identity not privileged (`!identity.privileged`) → `deny`.
- otherwise → `allow`.

`endpoint` is **optional**: called with one arg it behaves exactly as today (anon→deny, else allow), so existing call sites and tests are unaffected.

The four quadrants on a privileged endpoint: anon→deny, normal user→deny, admin (privileged identity)→allow; on a non-privileged endpoint: anon→deny, everyone else→allow.

### 4. `withDefaults(state)`

Unchanged except the per-cell default now passes the endpoint:
```js
row[id.id] = prev[id.id] ?? defaultExpectation(id, ep);
```
The `prev[id.id] ??` preserves any existing/persisted expectation; smarter defaults fill only missing cells.

### 5. Persistence

`saveMatrixConfig` extends the cleaned identity to `{ id, name, auth, privileged }` (drops only `_`-prefixed transient fields, as today). Endpoints already persist their full object, so `ep.privileged` rides along. `privileged` is a plain boolean — no secret.

### 6. UI

- **Endpoint row (`Security.jsx`):** when `endpointPrivileged(ep).privileged`, render a small badge next to the method/path showing the reason(s) (`write` / `admin-path` / `manual`) with a tooltip explaining why. A small toggle button on the row flips the override: clicking sets `ep.privileged = !effective` (an explicit boolean). (Resetting to pure-auto is out of scope — remove and re-add the endpoint.)
- **Toolbar:** a count, e.g. "N privileged", of endpoints whose effective privileged is true.
- **IdentityEditor (`Security.jsx`):** a "privileged / admin" checkbox bound to `identity.privileged`, with a one-line hint that privileged identities default to `allow` on privileged endpoints.

Changing an identity's `privileged`, or an endpoint's override, recomputes defaults for any *missing* cells via the existing `withDefaults` memo — already-set cells are preserved (see decision 5). Newly added endpoints/identities pick up the smarter defaults immediately.

## Data flow

```
endpoint added / loaded ─▶ endpointPrivileged(ep) ─▶ badge + toggle (UI)
identity.privileged ┐
endpoint privileged ┴▶ defaultExpectation(identity, ep) ─▶ withDefaults fills MISSING cells ─▶ grid expectation
                                                              (existing cells preserved)
```

## Error handling

- `classifyEndpoint` tolerates null/undefined/empty method or path (no match, not privileged) — never throws.
- `endpointPrivileged` falls back to the heuristic whenever `ep.privileged` is not a boolean (undefined/null/legacy endpoints).
- `defaultExpectation` with no `endpoint` arg = legacy behavior, so nothing breaks for existing callers.
- Legacy persisted matrices (no `privileged` fields) load fine: identities default `privileged` falsy, endpoints fall back to heuristic, existing expectation cells are preserved.

## Testing

- **`src/__tests__/authz.test.js`:**
  - `classifyEndpoint`: `write` (POST/PUT/PATCH/DELETE), `admin-path` (`/admin/x`, `v1.internal`), both, neither (`GET /orders`), token-boundary (`/badminton` not flagged), null/empty inputs.
  - `endpointPrivileged`: manual override `true`/`false` wins; `undefined` → heuristic; `source` correct.
  - `defaultExpectation(identity, endpoint)`: anon→deny regardless; non-privileged identity + privileged endpoint→deny; privileged identity + privileged endpoint→allow; non-privileged identity + non-privileged endpoint→allow; one-arg call = legacy behavior.
  - `withDefaults`: privileged endpoint defaults a normal identity to `deny` for a NEW cell, but preserves an existing override.
  - persistence: `identity.privileged` and `endpoint.privileged` round-trip; absent → undefined.
- **`src/__tests__/security-page.test.jsx`:** an admin/mutating endpoint shows the privileged badge; on a freshly built matrix a non-privileged named identity's cell on that endpoint defaults to `deny`; toggling the row override off flips its newly-defaulted cells back to `allow` (for missing cells); the identity privileged checkbox is present in the editor.

## Out of scope (this phase)

- Resetting an overridden endpoint back to pure-auto (remove + re-add instead).
- Configurable/editable `ADMIN_PATH_TOKENS` (built-in list; extension is roadmap).
- Retroactively re-defaulting already-set cells in existing matrices.
- Any change to oracles / BOLA / rate-limit / `runMatrix`.

## Roadmap after this

- BOLA id auto-discovery via seed requests + cross-tenant `tenantId` presets.
- Persisted/pinned schema baselines + `op.responses[].schema` retention in `import-parser.js` for OpenAPI-fed schema conformance.
- CI export of all findings (JUnit / SARIF) — makes the whole suite gate-able in CI.
- Optional sustained-rate / ramp burst modes for rate-limit.
