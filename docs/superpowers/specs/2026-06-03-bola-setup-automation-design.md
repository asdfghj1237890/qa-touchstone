# BOLA Setup Automation — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Reduce the manual setup the BOLA engine requires — auto-detect the object-id location, surface candidate id values, reusable cross-tenant presets, and a negative control that suppresses false positives. Sibling spec: `2026-06-03-batch-ai-triage-design.md` (independent feature, separate plan). Builds on the shipped BOLA engine ([bola.js](../../../src/qa/bola.js) / [BolaPanel.jsx](../../../src/qa/BolaPanel.jsx)).

## Motivation

The BOLA engine works, but the human still hand-fills every test: pick the `idLocation` (path index / query key / body path) and type each identity's owned id into `idValues`. That is the friction wall between "engine exists" and "engine gets used." This phase automates the setup and adds a false-positive guard.

## Decisions (locked during brainstorming)

1. **Id sourcing = static parse + presets (v1).** Detect the id location and pull literal id values straight from the saved request's path/query/body; the user assigns them to identities, aided by reusable cross-tenant presets. **No active probing** in v1 — the app's history doesn't store response bodies ([App.jsx:258](../../../src/App.jsx) keeps only `{method, path, status, time, at}`), so reading each identity's owned id from a live response is a phase-2 feature.
2. **Suggest-and-confirm, not auto-apply.** Detection pre-fills the id location + candidate values as an *editable suggestion with a confidence hint*; the user confirms. BOLA with a wrong id location fails **silently** (`applyIdLocation` sets `_idApplied=false`, attacker reads their own object → false negative), so a visible suggestion is the guardrail.
3. **Negative control gates verdicts.** For each test, fire the attacker against a synthetic id that shouldn't exist. If the endpoint returns 2xx-and-matches for the *fake* id too, it isn't object-scoped → demote that test's `vuln`/`unconfirmed` cells to `inconclusive` with a reason. This is deterministic mechanical evidence, not AI judgment, so gating (vs annotating) is safe.
4. **Additive.** The existing manual flow stays fully usable; every automation is an optional affordance on top.
5. **Logic/UI split.** New pure module `src/qa/bolaSetup.js` (detection/extraction/presets); negative control lives in the engine `bola.js` (it gates verdicts); `BolaPanel.jsx` wires the affordances.

## Architecture

```
src/qa/bolaSetup.js   (NEW, pure, unit-tested)
   ├─ detectIdLocation(req) -> [{ idLocation, value, confidence, why }]   # ranked candidates
   ├─ extractIdCandidates(req) -> [{ value, where }]                      # literal ids in the request
   ├─ applyPreset(test, preset) -> test'                                  # merge idValues, never mutates
   └─ syntheticIdFor(idLocation, sampleValue) -> string                   # shape-matched fake id

src/qa/bola.js   (MODIFIED — negative control in the engine)
   ├─ runBola(state, runner, opts)   # opts.negativeControl: per-test synthetic probe + verdict demotion
   ├─ negativeControl(controlCell) -> bool   # 2xx + content match => endpoint not object-scoped
   └─ (demoted cells: verdict 'inconclusive', severity null, finding null, controlFailed:true, reason)

src/qa/BolaPanel.jsx  (MODIFIED — detection suggestion on add, candidate fills, preset row, control toggle + banner)
src/qa/authz.js       (MODIFIED — persist bola.presets in the security config blob)
src/qa/i18n.jsx       (MODIFIED — security.bola.setup.* keys in en-US + zh-TW)
```

Reuses: `buildReq`, `walkJson` (from `oracles.js`), `applyIdLocation` / `matchesOwner` / `classifyBola` (from `bola.js`), `MUTATING_METHODS`, the existing `saveMatrixConfig`/`loadMatrixConfig`, the `qa-bola-warn` style.

## Components

### 1. `detectIdLocation(req)` — ranked candidates

Heuristics over `buildReq(reqId)`. Returns candidates sorted by confidence:

- **Path:** segments that look like ids — numeric (`/orders/123`), UUID, or 24-hex (Mongo ObjectId). A segment immediately after a *plural collection noun* (`/orders/{x}`, `/users/{x}`) scores highest. Yields `{kind:'path', index}` + the literal value.
- **Query:** keys matching `/(^|_)(id|.*Id|uuid|tenant|account|org)$/i` → `{kind:'query', key}` + value.
- **Body:** JSON leaves whose key matches the same id-ish pattern (via `walkJson`) → `{kind:'body', path}` + value.
- **Confidence** from signal strength: UUID/24-hex in a path slot after a plural noun = high; bare `?id=` = medium; a numeric field on a denylist (`count`, `page`, `limit`, `size`, `offset`, `total`) is excluded.

Pure, deterministic, no network.

### 2. `extractIdCandidates(req)` — literal values

Returns the concrete id values literally present in the request (path segment values, query values, id-ish body leaves) with a `where` label, so the panel can offer them as one-click fills.

### 3. Cross-tenant presets

A reusable identity→id map stored in the security config alongside `bola` (via existing `saveMatrixConfig`/`loadMatrixConfig`):

```js
bola.presets = [
  { id, name: "prod tenants", values: { [identityId]: "ownedId", … } }
]
```

`applyPreset(test, preset)` returns a **new** test with `idValues` merged from the preset (never mutates input). Keyed by identity id, so one tenant map applies across every test — set tenant ids once, reuse across 20 endpoints. This is the main payoff.

### 4. Negative control (engine, `bola.js`)

- `runBola` gains `opts.negativeControl` (default on, surfaced via a panel toggle). For each test, after the reference pass, it fires **one** synthetic-id probe: an arbitrary owner identity requesting `syntheticIdFor(test.idLocation, sampleValue)`.
- `syntheticIdFor` returns a shape-matched fake — a random-looking UUID for a UUID-shaped id, an absurd large integer for a numeric id — so the request stays well-formed but cannot reference a real object.
- `negativeControl(controlCell)`: if the synthetic request returns **2xx and content-matches** (reusing `matchesOwner`-style logic), the endpoint isn't object-scoped → `controlPassed = false`.
- When `controlPassed === false`, every attack cell in that test is demoted: `verdict:'inconclusive'`, `severity:null`, `finding:null`, plus `controlFailed:true` and a `reason` string. **Raw `status`/`response` are preserved** — the drawer still shows everything.
- `summarizeBola` and the findings list reflect the demotion with no separate code path. Honors `signal`; one extra request per test.

### 5. `BolaPanel.jsx` wiring (additive)

- **On add-test:** call `detectIdLocation(buildReq(r.reqId))`. Above a confidence threshold, pre-fill `idLocation` and show a dismissible suggestion: *"Detected id in path segment 1 (numeric, after /orders) — confidence high. [Use] [Edit]"*. Below threshold, keep today's default with a subtle "Detect" link.
- **Per id-value input:** offer `extractIdCandidates` values as one-click fills.
- **Preset row** per test: "Apply preset ▾" dropdown + "Save as preset" (writes `bola.presets`).
- **Negative-control toggle** in the panel header (default on), wired into `runBola` opts; per-test ⚠ banner renders when `controlFailed` (reuses `qa-bola-warn`).
- New `security.bola.setup.*` i18n keys in **both** locales.

## Data Flow

1. User adds an endpoint → `detectIdLocation` runs → suggestion shown (or default).
2. User confirms/edits the id location; fills id values (manual, candidate one-click, or apply preset).
3. User runs BOLA with negative control on → engine does reference pass + synthetic probe + attacker×owner pass.
4. Per test: if the synthetic probe shows the endpoint isn't object-scoped, that test's vuln/unconfirmed cells are demoted to inconclusive with a banner; otherwise verdicts stand as today.

## Error Handling & Edge Cases

- **Detection finds nothing** → no suggestion; default id location; manual flow unchanged.
- **Suggestion wrong** → user edits before running (the whole point of suggest-and-confirm).
- **`syntheticIdFor` can't infer shape** → fall back to a fixed unlikely UUID; still a valid control.
- **Synthetic probe errors / non-2xx non-deny** → treat control as *passed* (don't demote on an inconclusive control; never invent a gate).
- **Preset references a removed identity** → that key is ignored on apply (no crash).
- **Body id path parent missing** → `applyIdLocation` already no-ops (`_idApplied=false`); detection won't suggest a body path whose parent is absent.

## Testing

Vitest, per-module style:

- **`bolaSetup.js` (pure):** `detectIdLocation` ranks path-uuid-after-plural over a bare numeric body field; detects `?userId=`; denylist excludes `count`/`page`/`limit`; `extractIdCandidates` pulls literals with `where`; `applyPreset` merges without mutating the input; `syntheticIdFor` shape-matches numeric vs UUID.
- **`bola.js` engine:** negative-control probe fires once per test; a 2xx-matching synthetic response demotes all attack cells to `inconclusive` + `controlFailed`; a denied synthetic (403/404) leaves verdicts untouched; an errored/inconclusive control does **not** demote; `signal` abort still respected; raw response preserved on demoted cells.
- **Panel:** adding a test shows the detection suggestion; applying a preset fills all identities; control toggle off skips the probe.

## Out of scope (flagged follow-ups)

- **Active probe** — run a "list/seed" request as each identity and read the owned id from the live response to auto-fill `idValues` (the ambitious version of id-value sourcing; needs stored/streamed responses + response-shape id guessing).
- Auto-detecting which identity owns which extracted id.
- Persisting detection results or exporting setup to CI.
