# BOLA / IDOR Object-Authorization Testing — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Phase 2 — object-level authorization (BOLA/IDOR) testing inside the Security page. Builds on the shipped RBAC matrix (phase 0) and response oracles (phase 1).

## Motivation

The RBAC matrix tests **function-level** access (`endpoint × identity → allow/deny`). It runs each request unmodified, so it cannot catch **object-level** holes: a user legitimately allowed to call `GET /orders/{id}` may still be able to read *another* user's order by swapping the id. That is BOLA / IDOR — the most common and damaging API authz flaw, and the headline item from the original request ("換 userId/orderId/tenantId 測越權").

This phase adds object-level testing: authenticate as an **attacker** identity but inject a **victim/owner** identity's object id, and confirm — by content, not just status — whether the attacker actually read (or wrote) someone else's object.

## Decisions (locked during brainstorming)

1. **Object-id model = mark location + per-identity owned id.** The user marks where the id lives (path segment / query key / body JSON path) and gives each identity the id of an object *it* owns. Deterministic, reuses existing identities, no auto-discovery (that's roadmap).
2. **Verdict basis = status + content confirmation.** A 2xx is only a *confirmed* BOLA if the attacker's response actually contains the owner's object (matched against the owner's own reference response). 2xx without a match is "accessible-unconfirmed" (lower severity).
3. **Placement = a mode inside the Security page**, sharing the matrix identities; engine in a new pure `src/qa/bola.js`; UI in a new `src/qa/BolaPanel.jsx` so `Security.jsx` doesn't bloat.
4. **Findings reuse phase-1 `Finding`** (`oracle: 'object-authz'`), flowing into the same aggregated panel / severity summary.
5. **Severity:** confirmed read (GET/HEAD) → `high`; confirmed on a mutating method (POST/PUT/PATCH/DELETE) → `critical`; accessible-unconfirmed → `medium`.

## Architecture

```
src/qa/bola.js   (NEW, pure, unit-tested)
   ├─ applyIdLocation(req, idLocation, value) -> req'      # mutate path seg / query / body field
   ├─ matchesOwner(attackResp, ownerRef, ownerIdValue) -> bool   # content confirmation
   ├─ classifyBola(method, status, matched, denySet) -> verdict  # pass|vuln|unconfirmed|inconclusive
   ├─ bolaSeverity(method, verdict) -> severity|null
   ├─ runBola(state, runner, opts) -> results             # reference pass + attack pass, streams onCell
   └─ summarizeBola(results) -> { total, vuln, unconfirmed, pass, inconclusive }

src/qa/BolaPanel.jsx  (NEW — UI; rendered by Security.jsx when mode === 'bola')
   ├─ shared identities (from Security.jsx), shared EndpointPicker
   ├─ id-location editor (kind + locator, live path preview)
   ├─ per-identity id-value inputs
   ├─ attacker × owner result grid (+ reference row) per test
   └─ cell drawer: mutated request, response, finding, match evidence

src/qa/Security.jsx  (MODIFIED — add a Matrix | Object access mode toggle; pass identities/env to BolaPanel)
src/qa/authz.js      (MODIFIED — persist a `bola` blob in the security config)
```

Reuses: `walkJson` (from `oracles.js`), the `Finding` shape, `buildReq`, `executeRequest`, `EndpointPicker`, `DEFAULT_DENY_SET`. The RBAC engine (`runMatrix`) is untouched.

## Components

### 1. `idLocation` and `applyIdLocation(req, idLocation, value)`

```js
idLocation =
  | { kind: 'path',  index }        // index into the URL's non-empty path segments
  | { kind: 'query', key }          // a query param key in req.params
  | { kind: 'body',  path }         // dot/bracket JSON path into the parsed body
```

`applyIdLocation` returns a **copy** of the built request with that location overwritten by `value`:
- `path`: split `req.url` on `/`, replace the Nth non-empty segment, rejoin (query string preserved).
- `query`: set/replace the `key` entry in `req.params` (turn it `on`).
- `body`: parse `req.body` JSON, set the value at `path` (create intermediates only if they exist; if the body isn't JSON or the path is absent, leave unchanged and flag — see error handling), re-stringify.

Pure; never mutates its input.

### 2. Content confirmation — `matchesOwner(attackResp, ownerRef, ownerIdValue)`

Returns true when the attacker's response actually reflects the owner's object:
- **(a) id echo:** the `ownerIdValue` (stringified) appears as a leaf value in the attacker's response body, OR
- **(b) leaf overlap:** Jaccard similarity of scalar leaf *values* (via `walkJson`) between `attackResp.body` and `ownerRef.body` ≥ `0.6`.

Non-JSON bodies: fall back to substring check of `ownerIdValue` in the raw body string for (a); skip (b). The `0.6` threshold is a named constant `MATCH_THRESHOLD`.

### 3. Verdict — `classifyBola(method, status, matched, denySet)`

| status | matched | verdict |
|---|---|---|
| in `denySet` (e.g. 401/403/404) | — | `pass` |
| 2xx | true | `vuln` (confirmed) |
| 2xx | false | `unconfirmed` (accessible, content unconfirmed) |
| anything else / null | — | `inconclusive` |

### 4. Severity — `bolaSeverity(method, verdict)`

- `vuln` + mutating method (`POST/PUT/PATCH/DELETE`) → `critical`
- `vuln` + safe method (`GET/HEAD`) → `high`
- `unconfirmed` → `medium`
- `pass` / `inconclusive` → `null` (no finding)

### 5. Run model — `runBola(state, runner, opts)`

`state = { identities, tests, denySet }`, where each `test = { id, reqId, method, path, idLocation, idValues: { [identityId]: value } }`. `runner(test, identity, idValue) => Promise<response>` is injected (the page supplies one that builds the request, applies the id-location, applies the identity's auth, and executes). `opts = { signal, onCell }`.

For each `test`:
1. **Reference pass** — for each identity I that has an `idValue`, run `runner(test, I, idValues[I])` (I accessing its *own* id) → `reference[I]`. Streams as a reference cell.
2. **Attack pass** — for each ordered pair (attacker A, owner O), A≠O, both with id values: run `runner(test, A, idValues[O])`. Compute `matched = matchesOwner(resp, reference[O], idValues[O])` (only if `reference[O]` is a 2xx; otherwise `matched=false`), `verdict = classifyBola(test.method, status, matched, denySet)`, attach a `Finding` when severity ≠ null. Stream via `onCell(testId, attackerId, ownerId, cell)`.

Identities without an id value for a test are skipped (not errors). Honors `signal.aborted`.

Result shape:
```js
results[testId] = {
  reference: { [identityId]: cell },
  attacks:   { [attackerId]: { [ownerId]: cell } },
}
// cell = { phase:'ref'|'attack', status, matched?, verdict, severity?, finding?, request, response, error }
```

### 6. UI — `BolaPanel.jsx` + Security mode toggle

- `Security.jsx` gets a header toggle: **Matrix | Object access (BOLA)**. Identities + env/vars/cookies/sslVerify are lifted/shared so both modes use the same identity list.
- **Config:** add a test via `EndpointPicker`; for each test, an id-location editor (pick `kind`, then segment index / query key / body path) with a **live preview** of the resolved location on the request's path/body; per-identity id-value text inputs.
- **Results:** per test, an attacker (rows) × owner (cols) grid of verdict cells, plus a reference row showing each identity's own-access result. Cell click → drawer with the **mutated request** (method, resolved path/body, attacker identity), the response body, the finding, and the match evidence (which rule fired: id-echo vs overlap).
- Findings surface in the same aggregated findings panel + severity summary introduced in phase 1 (shared component/logic where practical).

The page-supplied runner (lives in `BolaPanel.jsx`, not the pure engine):
```
runner(test, identity, idValue):
  req = buildReq(test.reqId)
  req = applyIdLocation(req, test.idLocation, idValue)
  req.auth = identity.auth
  return executeRequest(req, env, varMap, { cookies, sslVerify, oauthToken: identity._oauthToken })
```

### 7. Persistence

BOLA config (`tests` with their `idLocation`/`idValues`) is stored in the existing security config object under a new `bola` key, via `saveMatrixConfig`/`loadMatrixConfig` (identities remain single-source, never duplicated). Object id values are not secrets, so persisting them is fine; transient `_`-prefixed identity fields stay dropped as today. Results are transient.

## Data flow

```
BolaPanel.run() ─▶ runBola(state, runner, {onCell})
                     │  reference pass: each identity hits its OWN id  ─▶ reference[I]
                     │  attack pass: attacker A injects owner O's id
                     │     matchesOwner(resp, reference[O], idValues[O])
                     │     classifyBola(method, status, matched) ─▶ verdict
                     │     bolaSeverity(method, verdict) ─▶ Finding?
                     ▼
                  results[testId].attacks[A][O]  ─▶ grid cell / drawer / findings panel / summary
```

## Error handling

- Missing `idValue` for an identity on a test → that identity is skipped for that test (reference + as attacker/owner), no error.
- `applyIdLocation` on a non-JSON body or absent body path → returns the request unchanged and the cell records a `note` ("id-location not applied"); the run continues.
- `reference[O]` not 2xx (owner couldn't read its own object — bad id or broken endpoint) → attacks against O are still run but `matched` is forced false (can't confirm without a reference), so the worst they reach is `unconfirmed`; the reference cell shows the failure so the user fixes the id.
- Runner throw → cell `inconclusive` with `error` (mirrors `runMatrix`).
- Engine never throws out of a run; `walkJson` depth guard (phase 1) protects the overlap computation.

## Testing

- **`src/__tests__/bola.test.js`** (pure): `applyIdLocation` for all three kinds (incl. query-string preservation on path swaps, body-path absent → unchanged); `matchesOwner` (id-echo true, overlap ≥/< threshold, non-JSON substring fallback); `classifyBola` (deny→pass, 2xx+match→vuln, 2xx+nomatch→unconfirmed, 500→inconclusive); `bolaSeverity` (GET→high, DELETE→critical, unconfirmed→medium, pass→null); `runBola` (reference+attack streaming via injected runner, skip-on-missing-id, abort signal, owner-reference-not-2xx caps at unconfirmed).
- **`src/__tests__/bola-panel.test.jsx`**: on the canned path, configure a test with a path id-location + two identities' id values, run, and assert the attacker×owner grid renders a confirmed-vuln cell and a finding (canned response echoes the injected id).

## Out of scope (this phase)

- Auto-discovery of ids via seed/list requests (roadmap phase 4).
- Cross-tenant `tenantId` presets / multi-id-per-request mutation (roadmap).
- Rate-limit/abuse testing (roadmap phase 3).
- Any change to `runMatrix` / the RBAC engine.

## Roadmap after this

- **Phase 3 — rate limit / abuse:** burst runner (N rapid requests; detect 429/Retry-After or its absence). Reuses findings.
- **Phase 4 — depth:** id auto-discovery via seed requests; cross-tenant presets; BFLA ergonomics (auto-flag mutating/admin endpoints); persisted/pinned baselines + OpenAPI schema retention (from phase-1 roadmap); CI export of findings.
