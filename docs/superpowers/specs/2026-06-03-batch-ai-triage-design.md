# Batch AI Triage — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** A cross-engine AI layer that condenses a whole Security-page batch (matrix + BOLA + rate-limit findings) into a short, prioritized, categorized triage — advisory only. Sibling spec: `2026-06-03-bola-setup-automation-design.md` (independent feature, separate plan).

## Motivation

AI in the app today is **single-point**: `ResponsePanel`'s "AI review" of one response body, and the Security drawer's "Scan with AI" (`scanSensitiveLLM`, [oracles.js:209](../../../src/qa/oracles.js)) on one cell. The matrix run loop that streams cells lives in [App.jsx](../../../src/App.jsx)/`Security.jsx`. Nothing looks across a whole run.

After a batch, the oracles + BOLA + rate-limit engines can emit dozens of findings spread over three panels. The valuable move is to condense:

> "Of these 87 results, the 4 worth looking at are these; 1 looks like 越權/BOLA, 2 like schema drift, 1 is probably a false positive."

This spec adds that condensing layer.

## Decisions (locked during brainstorming)

1. **Input = findings only.** Triage re-ranks/clusters/labels the structured findings the engines already produced (incl. flagging likely false positives). It does **not** re-scan raw response bodies — that keeps it one cheap LLM call and avoids making the AI a load-bearing part of the security verdict. (Catching what the oracles missed is a later, more expensive option.)
2. **Scope = all three engines.** Matrix + BOLA + rate-limit, unified into one triage pass. Requires lifting BOLA/rate-limit findings to the Security page (see Aggregation).
3. **Advisory only — never mutates.** Triage output lives in its own transient state. It never reorders, hides, or re-severities the real findings; those render exactly as today. A "likely false positive" is a label on the triage card, nothing more. The AI cannot silently bury a real vuln.
4. **Aggregation = callback-up.** Each engine emits a normalized findings list to `SecurityPage` via a new `onFindings(engine, findings)` prop. Panels keep their internal results state for rendering; no globals, no rewrite of working panels.
5. **Transient, on-demand.** Triage is produced by a "Triage with AI" button and held in transient state (mirrors how `results` already work — not persisted). Re-runnable.
6. **Capped with no silent truncation.** Over the cap (default 150 findings), sort by severity, take the top N, and surface a visible "triaged N of M — K dropped" note.

## Architecture

```
matrix run ─┐
bola run   ─┼─► onFindings(engine, normalized[])  ─►  SecurityPage holds { matrix, bola, ratelimit }
ratelimit ─┘                                                     │
                                              "Triage with AI" ──┤
                                                                 ▼
                            normalize+cap ─► qaCallLLM (1 call) ─► parse/validate ─► TriagePanel (advisory card)

src/qa/triage.js   (NEW, pure, unit-tested)
   ├─ normalizeFindings(engine, findings, refOf) -> normalized[]   # tag engine + back-ref
   ├─ buildTriageInput(union, cap) -> { input[], dropped }         # cap by severity, report drops
   ├─ buildTriagePrompt(input) -> string                           # sibling of scanSensitiveLLM's prompt
   ├─ parseTriage(raw, input) -> { headline, items[] }             # defensive parse + back-ref validation
   └─ runTriage(union, callLLM=qaCallLLM, opts) -> triage          # orchestration; callLLM injectable

src/qa/TriagePanel.jsx  (NEW — collapsible "AI Triage" card above the mode tabs in Security.jsx)
src/qa/Security.jsx     (MODIFIED — hold { matrix, bola, ratelimit } findings; render TriagePanel)
src/qa/BolaPanel.jsx        (MODIFIED — add onFindings prop, emit on results change)
src/qa/RateLimitPanel.jsx   (MODIFIED — add onFindings prop, emit on results change)
src/qa/i18n.jsx         (MODIFIED — security.triage.* keys in en-US + zh-TW)
```

Reuses: `qaCallLLM` ([llm.js](../../../src/qa/llm.js)), the `aiReady` precondition pattern from [Security.jsx](../../../src/qa/Security.jsx), the `{oracle, severity, title, path, evidence}` finding shape, `SEVERITY_ORDER`. The engines (`runMatrix`, `runBola`, rate-limit) are untouched.

## Components

### 1. Normalized finding

One flat shape across engines, carrying a back-reference so a triage item can navigate to its source:

```js
{
  engine,                                  // 'matrix' | 'bola' | 'ratelimit'
  severity, oracle, title, path, evidence, // from the existing finding
  ref:                                     // back-reference into that engine's results
       /* matrix    */ { reqId, idId }
     | /* bola      */ { testId, attackerId, ownerId }
     | /* ratelimit */ { testId }
}
```

No secrets cross the boundary — `evidence` is already a short redacted string and `path` is a JSON path. `normalizeFindings(engine, findings, refOf)` tags each finding; `refOf(finding)` is supplied by the caller that knows the coordinates.

### 2. Aggregation (callback-up)

- `SecurityPage` already owns matrix findings (`allFindings`). It gains state `engineFindings = { matrix, bola, ratelimit }` and a memo `triageUnion = [...matrix, ...bola, ...ratelimit]`.
- `BolaPanel` / `RateLimitPanel` each get one new prop `onFindings`. A `useEffect` on their results emits the normalized list upward (engine + per-cell ref). They otherwise render exactly as today.
- Matrix findings are normalized inline in `SecurityPage` (ref = `{reqId, idId}`).

### 3. The LLM call (`triage.js`)

**Input** — compact, indexed JSON (the index lets the model reference findings without re-quoting them, curbing hallucination):

```js
[{ i:0, engine:"bola", severity:"critical", oracle:"object-authz",
   title:"Cross-object access confirmed", path:"GET /orders/{id}", evidence:"as alice → bob's id" }, …]
```

**Prompt** — *"You are triaging security findings from an automated API scan. Group related findings, surface the few that truly need a human, and flag likely false positives. Return ONLY JSON matching {schema}. Reference findings by their `i` index — never invent findings."*

**Output** (validated; see Error Handling for defensive parsing):

```js
{
  headline: "4 of 23 findings need a look",
  items: [{
    title,
    category,            // guided enum: object-authz | schema-drift | sensitive-exposure |
                         //              rate-limit | auth-matrix | false-positive | other
    priority,            // p1 | p2 | p3
    rationale,           // one line: why this matters / why it's likely FP
    findingIndexes: [0,5,…],  // back-refs into the input array
    likelyFalsePositive: bool
  }]
}
```

`runTriage(union, callLLM, opts)` = `buildTriageInput` → `buildTriagePrompt` → `callLLM` → `parseTriage`. `callLLM` defaults to `qaCallLLM` and is injected in tests (same pattern as `scanSensitiveLLM`).

### 4. UI surface (`TriagePanel.jsx`)

A collapsible **"AI Triage" card above the matrix/BOLA/rate-limit tab bar** — it owns the whole batch, so it doesn't belong inside a per-engine tab. The tabs are unchanged.

- **Header:** "Triage with AI" button, disabled with a hint when no LLM is configured (reuse `aiReady`) or the union is empty. A "triaged N of M" line when capped.
- **Body:** the `headline`, then one row per item — `priority` chip, `category` tag, `title`, one-line `rationale`, a "likely false positive" badge when set, and a linked-findings count.
- **Expand:** each item expands inline to list its linked normalized findings (`severity · engine · path · evidence` — data already carried). A **"Go to {engine}"** button switches `mode` to that tab.

## Data Flow

1. User runs one or more engines; each emits normalized findings up to `SecurityPage`.
2. User clicks "Triage with AI" → `runTriage(triageUnion)`.
3. `buildTriageInput` caps + indexes; `buildTriagePrompt` wraps; `qaCallLLM` returns text.
4. `parseTriage` extracts JSON, validates items, resolves `findingIndexes` back to normalized findings (and their refs), drops anything invalid.
5. `TriagePanel` renders the advisory card. Real findings lists are untouched.

## Error Handling & Guardrails (security-tool invariants)

- **Never mutates real findings.** Triage state is separate; `allFindings` length/order/severity are invariant across a triage run. (Asserted in tests.)
- **No invented findings.** Every `findingIndexes` entry must resolve to a real input finding. Unresolved indexes are dropped; an item left with zero valid refs is dropped entirely.
- **Label, not verdict.** `likelyFalsePositive` styles the triage card only; the underlying finding keeps its oracle severity everywhere else.
- **No silent truncation.** Over cap → top-N by severity + visible "K dropped" note (also `log`-able).
- **Defensive parse.** `parseTriage` extracts the first balanced JSON object, tolerates fenced ```json blocks, coerces a missing/invalid `category` to `other`, an invalid `priority` to `p3`, a non-boolean `likelyFalsePositive` to `false`; total parse failure → empty triage + surfaced error.
- **LLM unreachable / errors** → the card shows the error (reusing the `scanWithAI` error pattern); every findings list keeps working untouched.

## Testing

Vitest, per-module style under `src/__tests__`:

- **`triage.js` (pure):**
  - `normalizeFindings` tags `engine` + `ref` correctly for each engine.
  - `buildTriageInput` caps at N, keeps highest-severity, reports `dropped` count.
  - `parseTriage` handles clean JSON, junk, fenced JSON, missing fields; **drops invalid `findingIndexes`; drops zero-ref items**; coerces bad enums.
  - `runTriage` with an injected `callLLM` is deterministic.
- **`TriagePanel`:** renders items from a stubbed triage; "Go to {engine}" switches mode; button disabled when `aiReady` is false / union empty.
- **Invariant:** triaging does not change `allFindings` length, order, or severity.

## Out of scope (flagged follow-ups)

- Auto-opening the destination engine's cell drawer from a triage item (needs cross-panel drawer coupling; inline expansion covers the evidence for v1).
- Triaging raw response bodies to catch oracle misses (the "findings + bodies" option).
- Persisting triage output / CI export of the triage summary.
