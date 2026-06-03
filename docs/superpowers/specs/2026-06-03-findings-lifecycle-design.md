# Findings Lifecycle — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation plan
**Scope (this spec):** Turn one-shot security findings into managed findings. Add per-finding state (false-positive suppression, severity override, owner/status/note), a pinned-baseline + last-run comparison with new/carried/resolved diffing, and a "new high/critical" counter — all cross-engine (matrix + BOLA + rate-limit), in the GUI. CI gating is explicitly **out of scope** and deferred to a sibling spec; this design only ensures the counter it would consume is computed and exportable later.

## Motivation

Today the Security page **finds** but does not **manage**. Matrix oracles ([oracles.js](../../../src/qa/oracles.js)), BOLA ([BolaPanel.jsx](../../../src/qa/BolaPanel.jsx)), and rate-limit ([RateLimitPanel.jsx](../../../src/qa/RateLimitPanel.jsx)) each emit `Finding[]`, a page-level `triageUnion` aggregates them ([Security.jsx:158](../../../src/qa/Security.jsx)), and the AI triage layer ([triage.js](../../../src/qa/triage.js)) offers an advisory pass. But:

- Every run starts from zero. There is **no stable identity** for a finding, so a known false positive reappears every run with no memory.
- There is no way to **suppress**, **re-severity**, **assign**, or **annotate** a finding.
- There is no **run-over-run comparison**, so you cannot tell a *new* leak from one you already triaged.
- "Fail CI only on new high/critical" — the eventual goal — is impossible without all of the above.

This spec adds the lifecycle layer the scanning engines have been missing.

## Decisions (locked during brainstorming)

1. **GUI lifecycle now; CI gating deferred.** Build suppression / override / owner-status-note / compare-with-previous-run in the app. The "fail CI on new high/critical findings" ask becomes a later, separate spec — but this design computes the *new high/critical count* it will consume, so the future CI export is a thin add-on, not a redesign.
2. **Pinned baseline + last run.** The user pins one run as a known-good **baseline**; diffs are computed current-vs-baseline. The immediately-previous run (**last run**) is also retained for "what changed since last time." No deep run history (YAGNI against this decision).
3. **Separate suppress flag + status.** Per-finding state is an **independent `suppressed` boolean** (with free-text `suppressReason`) **plus** a `status` enum, **plus** free-text `owner` and `note`, **plus** an optional `severityOverride`. Suppression is its own visibility/gate axis, orthogonal to triage status.
4. **Status is `open | acknowledged` only; presence is derived.** There is **no manual `fixed`** state (it would let a user mark a still-present finding fixed and lie). Whether a finding is `new | carried | resolved` is computed from the baseline diff; a `resolved` fingerprint that reappears auto-reopens. `status` captures human triage intent (open vs acknowledged); presence captures reality.
5. **Fingerprint excludes title and evidence.** A finding's stable identity is `engine | ruleId | location | normalizePath(path)`. Human `title` is display-only (engine wording can change across versions and would silently orphan annotations). `evidence` is volatile (redacted values change) and may carry sensitive data — excluded.
6. **Stable `ruleId` threaded at emission.** Each engine tags its findings with a stable machine code (`title` stays for display). Oracle rules already carry `id`s; schema/BOLA/rate-limit get explicit codes. The fingerprint keys on `ruleId`, never `title`.
7. **Lifecycle keyed by fingerprint, not by run.** So suppression/ownership survive across runs automatically. Records are sparse (only touched findings). Versioned storage envelope; on fpVersion bump, old records are **quarantined as "legacy annotations"** (shown separately, never silently dropped) — no risky auto-migration.
8. **Snapshots store identities, not findings.** Compact `{fp, effectiveSeverity, engine, ruleId, locationLabel, count}` per fingerprint, plus run metadata. **No evidence, bodies, headers, cookies, or tokens** are ever persisted.
9. **Effective severity drives everything.** `effectiveSeverity = severityOverride ?? severity`. Badge color, sort order, diff, and the new-high/critical counter all use it. Original severity is kept for display only.
10. **New UI home: a Findings tab.** A 4th mode beside Matrix / BOLA / Rate-limit, consuming the cross-engine union + lifecycle + diff. Existing panels stay scan-focused. Pure-logic + panel split mirrors `triage.js`/`TriagePanel.jsx`.
11. **Lifecycle store is sensitive local data.** `note`/`suppressReason` may contain secrets. The store is treated like the OAuth tokens already stripped before persistence ([authz.js:161](../../../src/qa/authz.js)): excluded from any future export-by-default.

## Architecture

```
matrix / bola / ratelimit ── findings (now carry stable ruleId) ──► triageUnion (cross-engine, page level)
                                                                         │
                                                  ┌──────────────────────┼───────────────────────┐
                                                  ▼                      ▼                        ▼
                                       fingerprint(f)           lifecycle store            run snapshots
                                    (engine|ruleId|loc|path)   qa_security_lifecycle      qa_security_snapshots
                                          │                    {fpVersion, records[fp]}    {fpVersion, baseline, lastRun}
                                          └──────────────► diffRuns(current, baseline) ──► new | carried | resolved
                                                                         │
                                                            gateCount(effective sev, suppressed)
                                                                         ▼
                                                              FindingsPanel (4th tab)

src/qa/findings.js        (NEW, pure, unit-tested)
   ├─ FP_VERSION
   ├─ ruleIdOf(finding) / fingerprint(finding) -> { fp, fpMaterial }
   ├─ effectiveSeverity(finding, record) -> severity
   ├─ loadLifecycle()/saveLifecycle()   — versioned envelope, corrupt-tolerant, migrate-or-quarantine
   ├─ loadSnapshots()/saveSnapshots(), pinBaseline(current), recordRun(current)
   ├─ snapshotOf(union, lifecycle) -> { runId, createdAt, scopeHash, items[] }
   ├─ diffRuns(currentItems, baselineItems) -> Map<fp, 'new'|'carried'|'resolved'>
   └─ gateCount(currentItems, lifecycle) -> number   // new + effective≥high + not suppressed

src/qa/FindingsPanel.jsx  (NEW)   — header strip, filters, table, per-row controls, legacy banner
```

### Finding shape (after this spec)

```jsonc
{ "engine": "matrix", "ruleId": "jwt", "severity": "high", "title": "JWT in response",
  "path": "data.token", "evidence": "eyJ…<redacted>…0",
  "ref": { "reqId": "...", "idId": "admin" } }      // ruleId is new; everything else unchanged
```

`ruleId` per engine:
- **matrix sensitive-data** → the rule's existing `id` (`jwt`, `aws-key`, `private-key`, `secret-name`, `email`, `card`, `internal`, `leaky-header`).
- **matrix schema** → `schema:undeclared` | `schema:type-mismatch` | `schema:missing`.
- **BOLA** → `object-authz`. **rate-limit** → its oracle id.

### `location(f)` (the per-engine identity component)

| engine     | location |
|------------|----------|
| matrix     | `${ref.method ?? ''} ${endpointPath} @${ref.idId}` |
| bola       | `bola:${ref.testId}:${ref.attackerId}->${ref.ownerId}` |
| ratelimit  | `rl:${ref.testId}` |

`fingerprint` = short non-crypto hash (e.g. FNV-1a → hex; repo is dependency-light) of
`engine | ruleId | location(f) | normalizePath(f.path)`. The pre-hash string is the **fpMaterial**, stored beside the hash for audit/migration. `FP_VERSION` starts at `1`.

### Storage

**`qa_security_lifecycle`** (sensitive; sparse; versioned):
```jsonc
{ "fpVersion": 1, "records": {
  "<fp>": {
    "fpMaterial": "matrix|jwt|GET /me @admin|data.token",
    "suppressed": false, "suppressReason": "",
    "status": "open",                 // open | acknowledged
    "owner": "", "note": "",
    "severityOverride": null,         // null | info|low|medium|high|critical
    "createdAt": "<ISO>", "updatedAt": "<ISO>", "lastSeenAt": "<ISO>", "seenCount": 0
  }
}}
```

**`qa_security_snapshots`** (identities only; no finding bodies):
```jsonc
{ "fpVersion": 1,
  "baseline": { "runId": "...", "createdAt": "<ISO>", "scopeHash": "...",
                "items": [ { "fp": "...", "effectiveSeverity": "high", "engine": "matrix",
                             "ruleId": "jwt", "locationLabel": "GET /me · admin", "count": 1 } ] },
  "lastRun":  { /* same shape */ } }
```
`baseline`/`lastRun` are `null` until set. `count` = concrete occurrences collapsed into one fp by `normalizePath`.

## Behavior & semantics

### Effective severity
`effectiveSeverity(finding, record) = record?.severityOverride ?? finding.severity`. Used for badge, sort, diff item severity, and the gate count. Display shows `orig → override` when they differ.

### Diff (`diffRuns(current, baseline)`)
- `new` — fp in current, absent from baseline.
- `carried` — fp in both.
- `resolved` — fp in baseline, absent from current (rendered from baseline `locationLabel`, muted).
- No baseline pinned → every current finding is `new`; UI states "no baseline — pin one to track deltas" (counter is honest, not silently zero).
- Auto-reopen — a `resolved` fp reappearing in a later run is simply `new`/`carried` again. No sticky `fixed`.

### New high/critical counter (`gateCount`)
`count of findings where presence == 'new' AND effectiveSeverity ∈ {high, critical} AND not suppressed`.
- Override that lowers below `high` → excluded. Override that raises to `high` → included.
- Suppressed → excluded (reason shown, so the exclusion is auditable).
- This integer is the seed the deferred CI gate will export and threshold on.

### Scope awareness
`scopeHash` = hash of the run's endpoints/identities/tests config. When `current.scopeHash !== baseline.scopeHash`, the diff still renders but is badged "baseline scope differs," so a changed test surface is not misread as fixes/regressions.

### Write timing (critical)
- Snapshots are written **only after a completed full cross-engine scan** — never from streaming `onCell` ([Security.jsx:203](../../../src/qa/Security.jsx)) or partial child-panel `onFindings` effects, never on abort. This avoids partial lists overwriting `lastRun`.
- `lastRun` updates on each completed scan; `baseline` only when the user clicks **Pin current as baseline**.
- `lifecycle` writes are per-edit (debounced), independent of scans, and a load failure (corrupt JSON) degrades to an empty store — it must **never** break scanning.

### Versioning / migration
On load, if stored `fpVersion < FP_VERSION`, records are moved to a `legacy` bucket and surfaced as a dismissible "legacy annotations" banner with a review affordance. No silent loss, no auto-remap guesswork.

## UI — Findings tab (`FindingsPanel.jsx`)

A 4th segment beside Matrix / BOLA / Rate-limit. Inputs: the page-level `triageUnion`, lifecycle store, snapshots.

- **Header strip:** "N findings · X new high/critical" counter; **Pin current as baseline** button; baseline meta ("baseline: same scope, 2 runs ago" or "no baseline"); scope-mismatch badge when applicable; filter chips (severity, engine, status, presence, suppressed on/off).
- **Table** — one row per fingerprint (same-fp occurrences grouped with `count`): presence badge · effective severity (with `orig→override`) · engine · ruleId/title · location · owner · status. Default sort: effective severity desc, `new` first.
- **Row expand / drawer:** suppress toggle + reason; status (open/acknowledged); owner; note; severity-override dropdown. Edits persist immediately to `qa_security_lifecycle` (debounced), mirroring config autosave ([Security.jsx:120](../../../src/qa/Security.jsx)).
- **Resolved rows:** reconstructed from the baseline snapshot's `locationLabel`, shown muted (live finding is gone).
- **Legacy-annotations banner:** dismissible, links to the quarantined set.
- **i18n:** all strings via `useI18n`, keys added to en-US + zh-TW (repo convention).

## Module layout & test plan

**New files**
- `src/qa/findings.js` — pure logic (see Architecture). No React, no DOM.
- `src/qa/FindingsPanel.jsx` — presentation + controls.
- `src/__tests__/findings.test.js`.

**Touch points (display unchanged)**
- `oracles.js`, `BolaPanel.jsx`, `RateLimitPanel.jsx` — add `ruleId` to emitted findings.
- `Security.jsx` — add `findings` mode/tab; write snapshot on completed full scan; wire union + lifecycle + diff into `FindingsPanel`.
- i18n catalogs — new keys.

**`findings.test.js` must cover**
- Fingerprint **stability** (same finding across runs → same fp; title change → same fp; evidence change → same fp) and **non-collision** (different ruleId / location / path → different fp).
- `effectiveSeverity` override precedence.
- `diffRuns` — new / carried / resolved, and auto-reopen of a reappearing resolved fp.
- `gateCount` — override raises/lowers across the high threshold; suppressed excluded; only `new` counted; no-baseline path.
- Storage — corrupt-JSON tolerance (→ empty store, no throw); fpVersion bump → quarantine, no silent loss.
- `snapshotOf` — `count` aggregation of normalize-collapsed occurrences; no evidence/body fields present in the snapshot.

## Build order (test-first)

1. **`findings.js` + tests** — fingerprint, effective severity, diff, gate count, storage load/save/migrate. Pure, no UI.
2. **`ruleId` threading + read-only Findings table** — engines tag `ruleId`; table renders union with presence badges (requires snapshot read). No editing yet.
3. **Per-finding annotations** — suppress/status/owner/note/override persisted to `qa_security_lifecycle`; filters.
4. **Baseline + snapshot lifecycle** — pin-baseline, completed-scan snapshot write timing, legacy quarantine banner, scope-mismatch UX, gate counter in header.

## Out of scope (this spec)

- CI integration / headless runner / exit-code gating (sibling spec; this spec only computes the counter it will consume).
- Deep run history beyond baseline + last run.
- Cross-device sync of lifecycle data.
- Orphaned-record cleanup UI (records simply persist; a TTL/cleanup affordance is a later option).
- Export of findings/lifecycle to disk (and its sensitive-data handling).
