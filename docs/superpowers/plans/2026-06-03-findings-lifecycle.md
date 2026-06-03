# Findings Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one-shot security findings into managed findings — per-finding suppression / severity override / owner-status-note, plus a pinned-baseline vs current diff (new/carried/resolved) and a "new high/critical" counter — cross-engine, in the GUI.

**Architecture:** A new pure module `src/qa/findings.js` owns finding identity (a `fingerprint` over `engine|ruleId|location|normalizePath(path)`, excluding title/evidence), effective-severity, run-diff, gate counting, and versioned localStorage persistence (lifecycle records + run snapshots). Engines gain a stable `ruleId` at emission. A new `src/qa/FindingsPanel.jsx` (4th tab in `Security.jsx`) renders the cross-engine union with diff badges and per-finding controls. Mirrors the existing `oracles.js`/`triage.js` pure-logic + panel split.

**Tech Stack:** React 18 (no router; `window.QA` globals), Vitest + jsdom, `@testing-library/react`, localStorage persistence, in-repo `useI18n` dictionary (en-US + zh-TW).

**Spec:** `docs/superpowers/specs/2026-06-03-findings-lifecycle-design.md`

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/qa/findings.js` (NEW) | Pure logic: fingerprint, effective severity, snapshot building, diff, gate count, versioned lifecycle + snapshot storage. No React/DOM. |
| `src/__tests__/findings.test.js` (NEW) | Unit tests for everything in `findings.js`. |
| `src/qa/oracles.js` (MODIFY) | Add stable `ruleId` to emitted sensitive/schema/LLM findings. |
| `src/qa/Security.jsx` (MODIFY) | Carry `ruleId`+location fields into the matrix union; add the Findings tab; record a run snapshot on completed full scan; wire union/lifecycle/snapshots into `FindingsPanel`. |
| `src/qa/BolaPanel.jsx`, `src/qa/RateLimitPanel.jsx` (MODIFY) | Carry `ruleId` into the upward findings union. |
| `src/qa/FindingsPanel.jsx` (NEW) | Cross-engine table, diff badges, header counter + pin-baseline, per-row controls, legacy banner. |
| `src/__tests__/findings-panel.test.jsx` (NEW) | Component tests for the panel. |
| `src/qa/i18n.jsx` (MODIFY) | `findings.*` keys (en-US + zh-TW). |

**Conventions to follow:** every pure module starts with `import './setup.js';` (see `oracles.js:4`). Tests import from `vitest`. localStorage load paths must tolerate corrupt JSON and return a safe default (see `loadMatrixConfig`, `authz.js:149`). Locale-independent strings only inside `findings.js` (snapshots must be stable across language switches).

---

## Phase 1 — Pure core (`findings.js`)

### Task 1: Fingerprint (identity, ruleId, location, hash)

**Files:**
- Create: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/findings.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FP_VERSION, ruleIdOf, locationOf, locationLabel, fnv1a, fingerprint,
} from '../qa/findings.js';

const matrixF = (over = {}) => ({
  engine: 'matrix', ruleId: 'jwt', severity: 'high', title: 'JWT in response',
  path: 'data.token', evidence: 'eyJ…', method: 'GET', endpoint: '/me',
  identityLabel: 'admin', ref: { reqId: 'r1', idId: 'admin' }, ...over,
});

describe('FP_VERSION', () => {
  it('is a positive integer', () => { expect(FP_VERSION).toBeGreaterThanOrEqual(1); });
});

describe('ruleIdOf', () => {
  it('prefers explicit ruleId', () => { expect(ruleIdOf({ ruleId: 'jwt', oracle: 'sensitive-data' })).toBe('jwt'); });
  it('falls back to oracle (BOLA/rate-limit have stable oracle ids)', () => {
    expect(ruleIdOf({ oracle: 'object-authz' })).toBe('object-authz');
    expect(ruleIdOf({ oracle: 'rate-limit' })).toBe('rate-limit');
  });
  it('defaults to "unknown" when neither present', () => { expect(ruleIdOf({})).toBe('unknown'); });
});

describe('locationOf', () => {
  it('matrix uses method + endpoint + identity id', () => {
    expect(locationOf(matrixF())).toBe('GET /me @admin');
  });
  it('bola uses test + attacker -> owner', () => {
    expect(locationOf({ engine: 'bola', ref: { testId: 't1', attackerId: 'a', ownerId: 'o' } }))
      .toBe('bola:t1:a->o');
  });
  it('ratelimit uses test id', () => {
    expect(locationOf({ engine: 'ratelimit', ref: { testId: 't9' } })).toBe('rl:t9');
  });
});

describe('fingerprint', () => {
  it('is stable when only title or evidence changes', () => {
    const a = fingerprint(matrixF());
    const b = fingerprint(matrixF({ title: 'Different wording', evidence: 'zzz' }));
    expect(b.fp).toBe(a.fp);
  });
  it('changes when ruleId, location, or normalized path changes', () => {
    const base = fingerprint(matrixF()).fp;
    expect(fingerprint(matrixF({ ruleId: 'email' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ endpoint: '/other' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ path: 'data.secret' })).fp).not.toBe(base);
  });
  it('treats array indices as equal (normalizePath collapses [n])', () => {
    expect(fingerprint(matrixF({ path: 'items[0].token' })).fp)
      .toBe(fingerprint(matrixF({ path: 'items[3].token' })).fp);
  });
  it('exposes the canonical fpMaterial beside the hash', () => {
    expect(fingerprint(matrixF()).fpMaterial).toBe('matrix|jwt|GET /me @admin|data.token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js`
Expected: FAIL — "Failed to resolve import '../qa/findings.js'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/findings.js
// ── QA Companion — findings lifecycle (pure logic, no React) ───────────────
// Stable identity, effective severity, run diff, gate counting, and versioned
// localStorage persistence for findings management. UI lives in FindingsPanel.
import './setup.js';
import { SEVERITY_ORDER, normalizePath } from './oracles.js';

export const FP_VERSION = 1;
export const LIFECYCLE_KEY = 'qa_security_lifecycle';
export const SNAPSHOTS_KEY = 'qa_security_snapshots';
export const STATUSES = ['open', 'acknowledged'];

// Stable machine code. Matrix findings carry an explicit ruleId (oracle alone
// is too coarse: 7 sensitive rules share oracle 'sensitive-data'). BOLA and
// rate-limit findings already have a stable, specific `oracle`, so reuse it.
export function ruleIdOf(f) { return (f && (f.ruleId || f.oracle)) || 'unknown'; }

// Per-engine identity component (locale-independent — feeds the fingerprint).
export function locationOf(f) {
  const r = (f && f.ref) || {};
  if (f && f.engine === 'bola') return `bola:${r.testId}:${r.attackerId}->${r.ownerId}`;
  if (f && f.engine === 'ratelimit') return `rl:${r.testId}`;
  return `${(f && f.method) || ''} ${(f && f.endpoint) || ''} @${r.idId || ''}`.trim();
}

// Human, locale-independent label for display + snapshots (survives the finding
// disappearing, so resolved rows are still explainable).
export function locationLabel(f) {
  const r = (f && f.ref) || {};
  if (f && f.engine === 'bola') return `BOLA ${r.testId} (${r.attackerId}→${r.ownerId})`;
  if (f && f.engine === 'ratelimit') return `Rate-limit ${r.testId}`;
  const id = (f && f.identityLabel) ? ` · ${f.identityLabel}` : '';
  return `${(f && f.method) || ''} ${(f && f.endpoint) || ''}${id}`.trim();
}

// FNV-1a 32-bit → 8-hex. Deterministic, dependency-free; non-crypto identity only.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// Stable identity. Excludes title (engine wording drifts) and evidence (volatile,
// may carry secrets). fpMaterial is kept beside the hash for audit/migration.
export function fingerprint(f) {
  const material = [f && f.engine, ruleIdOf(f), locationOf(f), normalizePath((f && f.path) || '')].join('|');
  return { fp: fnv1a(material), fpMaterial: material };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js`
Expected: PASS (all Task 1 specs green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): stable fingerprint over engine|ruleId|location|path"
```

---

### Task 2: Effective severity

**Files:**
- Modify: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test** (append to the test file)

```js
import { effectiveSeverity } from '../qa/findings.js';

describe('effectiveSeverity', () => {
  it('returns the finding severity when no override', () => {
    expect(effectiveSeverity({ severity: 'medium' }, undefined)).toBe('medium');
    expect(effectiveSeverity({ severity: 'medium' }, { severityOverride: null })).toBe('medium');
  });
  it('applies a valid override', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'low' })).toBe('low');
  });
  it('ignores an invalid override value', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'bogus' })).toBe('high');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js -t effectiveSeverity`
Expected: FAIL — "effectiveSeverity is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `findings.js`)

```js
// Override wins only if it's a recognized severity; otherwise the original.
export function effectiveSeverity(finding, record) {
  const ov = record && record.severityOverride;
  return (ov && SEVERITY_ORDER.includes(ov)) ? ov : (finding && finding.severity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js -t effectiveSeverity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): effective severity (override wins when valid)"
```

---

### Task 3: Snapshot building (`snapshotOf`, `scopeHashOf`)

**Files:**
- Modify: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { snapshotOf, scopeHashOf } from '../qa/findings.js';

const lc = (records = {}) => ({ fpVersion: FP_VERSION, records });

describe('snapshotOf', () => {
  it('keys items by fingerprint and counts collapsed occurrences', () => {
    const union = [matrixF({ path: 'items[0].token' }), matrixF({ path: 'items[1].token' })];
    const snap = snapshotOf(union, lc(), { runId: 'run1', createdAt: 'T', scopeHash: 'sh' });
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].count).toBe(2);
    expect(snap.runId).toBe('run1');
    expect(snap.scopeHash).toBe('sh');
  });
  it('records effective severity using lifecycle overrides', () => {
    const fp = fingerprint(matrixF()).fp;
    const snap = snapshotOf([matrixF()], lc({ [fp]: { severityOverride: 'low' } }), {});
    expect(snap.items[0].effectiveSeverity).toBe('low');
  });
  it('never stores evidence, body, or title in snapshot items', () => {
    const snap = snapshotOf([matrixF()], lc(), {});
    const item = snap.items[0];
    expect(item).not.toHaveProperty('evidence');
    expect(item).not.toHaveProperty('title');
    expect(Object.keys(item).sort()).toEqual(
      ['count', 'effectiveSeverity', 'engine', 'fp', 'locationLabel', 'path', 'ruleId'].sort());
  });
});

describe('scopeHashOf', () => {
  it('is stable for the same descriptor and changes when it changes', () => {
    const a = scopeHashOf({ endpoints: ['r1', 'r2'], identities: ['admin'] });
    const b = scopeHashOf({ endpoints: ['r1', 'r2'], identities: ['admin'] });
    const c = scopeHashOf({ endpoints: ['r1'], identities: ['admin'] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js -t snapshotOf`
Expected: FAIL — "snapshotOf is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `findings.js`)

```js
// Aggregate a finding union into compact snapshot items (identities, NOT
// findings). `path` is the normalized JSON field path (a key name, never a
// value) — safe to store and useful for explaining resolved rows. `meta`
// carries { runId, createdAt, scopeHash }.
export function snapshotOf(union, lifecycle, meta = {}) {
  const records = (lifecycle && lifecycle.records) || {};
  const byFp = new Map();
  for (const f of (union || [])) {
    const { fp } = fingerprint(f);
    const existing = byFp.get(fp);
    if (existing) { existing.count += 1; continue; }
    byFp.set(fp, {
      fp,
      effectiveSeverity: effectiveSeverity(f, records[fp]),
      engine: f.engine,
      ruleId: ruleIdOf(f),
      path: normalizePath((f && f.path) || ''),
      locationLabel: locationLabel(f),
      count: 1,
    });
  }
  return {
    runId: meta.runId || '', createdAt: meta.createdAt || '', scopeHash: meta.scopeHash || '',
    items: [...byFp.values()],
  };
}

// Stable hash of the scanned surface (NOT the findings), so a diff across a
// changed test surface can be flagged instead of misread as fixes/regressions.
export function scopeHashOf(descriptor) { return fnv1a(JSON.stringify(descriptor || {})); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js -t "snapshotOf|scopeHashOf"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): snapshotOf (identity-only items + count) and scopeHashOf"
```

---

### Task 4: Diff (`diffRuns`)

**Files:**
- Modify: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { diffRuns } from '../qa/findings.js';

const item = (fp, sev = 'high') => ({ fp, effectiveSeverity: sev });

describe('diffRuns', () => {
  it('labels new / carried / resolved', () => {
    const cur = [item('a'), item('b')];
    const base = [item('b'), item('c')];
    const d = diffRuns(cur, base);
    expect(d.get('a')).toBe('new');
    expect(d.get('b')).toBe('carried');
    expect(d.get('c')).toBe('resolved');
  });
  it('treats everything as new when there is no baseline', () => {
    const d = diffRuns([item('a'), item('b')], []);
    expect(d.get('a')).toBe('new');
    expect(d.get('b')).toBe('new');
  });
  it('auto-reopens: a fp present in current is never stuck "resolved"', () => {
    // Even if this fp was resolved against some older baseline, diffing the
    // CURRENT run against a baseline that lacks it yields "new" (live again).
    const d = diffRuns([item('x')], [item('y')]);
    expect(d.get('x')).toBe('new');      // x is live -> new, never stuck resolved
    expect(d.get('y')).toBe('resolved'); // y absent from current
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js -t diffRuns`
Expected: FAIL — "diffRuns is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `findings.js`)

```js
// Presence map fp -> 'new' | 'carried' | 'resolved', comparing current items
// against a baseline's items. Presence is always derived fresh (never stored),
// so a previously-resolved fp reappearing is simply new/carried again.
export function diffRuns(currentItems, baselineItems) {
  const baseFps = new Set((baselineItems || []).map(i => i.fp));
  const curFps = new Set((currentItems || []).map(i => i.fp));
  const out = new Map();
  for (const it of (currentItems || [])) out.set(it.fp, baseFps.has(it.fp) ? 'carried' : 'new');
  for (const it of (baselineItems || [])) if (!curFps.has(it.fp)) out.set(it.fp, 'resolved');
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js -t diffRuns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): diffRuns (new/carried/resolved, presence derived fresh)"
```

---

### Task 5: Gate count (`gateCount`)

**Files:**
- Modify: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { gateCount } from '../qa/findings.js';

describe('gateCount', () => {
  const cur = [item('a', 'critical'), item('b', 'high'), item('c', 'low'), item('d', 'high')];
  it('counts only NEW findings with effective severity >= high, not suppressed', () => {
    const diff = diffRuns(cur, [item('d')]); // d is carried; a,b,c new
    const lifecycle = lc({ b: { suppressed: true } });
    // a(critical,new) counts; b(high,new but suppressed) excluded; c(low) excluded; d(carried) excluded.
    expect(gateCount(cur, lifecycle, diff)).toBe(1);
  });
  it('with no baseline (all new), counts every high/critical not suppressed', () => {
    const diff = diffRuns(cur, []);
    expect(gateCount(cur, lc(), diff)).toBe(3); // a, b, d
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js -t gateCount`
Expected: FAIL — "gateCount is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `findings.js`)

```js
// The seed for the (deferred) CI gate: count of NEW findings whose EFFECTIVE
// severity is high/critical and which are not suppressed. `items` are snapshot
// items (already carry effectiveSeverity); `diff` is from diffRuns.
export function gateCount(items, lifecycle, diff) {
  const records = (lifecycle && lifecycle.records) || {};
  let n = 0;
  for (const it of (items || [])) {
    if ((diff ? diff.get(it.fp) : 'new') !== 'new') continue;
    const rec = records[it.fp];
    if (rec && rec.suppressed) continue;
    if (it.effectiveSeverity === 'high' || it.effectiveSeverity === 'critical') n++;
  }
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js -t gateCount`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): gateCount (new + effective>=high + not suppressed)"
```

---

### Task 6: Versioned storage (lifecycle + snapshots, migrate-or-quarantine)

**Files:**
- Modify: `src/qa/findings.js`
- Test: `src/__tests__/findings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import {
  loadLifecycle, saveLifecycle, upsertRecord,
  loadSnapshots, saveSnapshots, recordRun, pinBaseline, LIFECYCLE_KEY, SNAPSHOTS_KEY,
} from '../qa/findings.js';

describe('lifecycle storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty versioned store when nothing is saved', () => {
    expect(loadLifecycle()).toEqual({ fpVersion: FP_VERSION, records: {}, legacy: null });
  });
  it('tolerates corrupt JSON without throwing', () => {
    localStorage.setItem(LIFECYCLE_KEY, '{ not json');
    expect(loadLifecycle()).toEqual({ fpVersion: FP_VERSION, records: {}, legacy: null });
  });
  it('round-trips records through save/load', () => {
    const s = upsertRecord(loadLifecycle(), 'fp1', { suppressed: true, note: 'n' }, '2026-01-01');
    saveLifecycle(s);
    const back = loadLifecycle();
    expect(back.records.fp1.suppressed).toBe(true);
    expect(back.records.fp1.note).toBe('n');
    expect(back.records.fp1.status).toBe('open'); // default filled by upsert
  });
  it('quarantines records from an older fpVersion as legacy (never dropped)', () => {
    localStorage.setItem(LIFECYCLE_KEY, JSON.stringify({ fpVersion: 0, records: { oldfp: { note: 'x' } } }));
    const s = loadLifecycle();
    expect(s.records).toEqual({});
    expect(s.legacy).toEqual({ fpVersion: 0, records: { oldfp: { note: 'x' } } });
  });
});

describe('snapshot storage', () => {
  beforeEach(() => localStorage.clear());
  const snap = (fp) => ({ runId: 'r', createdAt: 'T', scopeHash: 'sh', items: [item(fp)] });

  it('defaults to null baseline/lastRun', () => {
    expect(loadSnapshots()).toEqual({ fpVersion: FP_VERSION, baseline: null, lastRun: null });
  });
  it('recordRun sets lastRun without touching baseline', () => {
    let s = pinBaseline(loadSnapshots(), snap('base'));
    s = recordRun(s, snap('latest'));
    expect(s.baseline.items[0].fp).toBe('base');
    expect(s.lastRun.items[0].fp).toBe('latest');
  });
  it('pinBaseline sets baseline without touching lastRun', () => {
    let s = recordRun(loadSnapshots(), snap('latest'));
    s = pinBaseline(s, snap('pinned'));
    expect(s.lastRun.items[0].fp).toBe('latest');
    expect(s.baseline.items[0].fp).toBe('pinned');
  });
  it('round-trips through save/load', () => {
    saveSnapshots(pinBaseline(loadSnapshots(), snap('base')));
    expect(loadSnapshots().baseline.items[0].fp).toBe('base');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings.test.js -t storage`
Expected: FAIL — "loadLifecycle is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `findings.js`)

```js
function readJSON(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable — non-fatal */ }
}

const BLANK_RECORD = () => ({
  suppressed: false, suppressReason: '', status: 'open', owner: '', note: '',
  severityOverride: null, createdAt: '', updatedAt: '', lastSeenAt: '', seenCount: 0,
});

// Load the lifecycle store. Corrupt/missing -> empty versioned store (scanning
// must never break). Older fpVersion -> records quarantined under `legacy`.
export function loadLifecycle() {
  const raw = readJSON(LIFECYCLE_KEY);
  if (!raw || typeof raw !== 'object' || !raw.records || typeof raw.records !== 'object') {
    return { fpVersion: FP_VERSION, records: {}, legacy: null };
  }
  if (raw.fpVersion !== FP_VERSION) {
    return { fpVersion: FP_VERSION, records: {}, legacy: { fpVersion: raw.fpVersion, records: raw.records } };
  }
  return { fpVersion: FP_VERSION, records: raw.records, legacy: raw.legacy || null };
}

export function saveLifecycle(state) {
  const payload = { fpVersion: FP_VERSION, records: (state && state.records) || {} };
  if (state && state.legacy) payload.legacy = state.legacy;
  writeJSON(LIFECYCLE_KEY, payload);
}

// Merge a patch into a finding's record (created from BLANK_RECORD if absent).
// `now` is an injected ISO string so this stays pure/testable.
export function upsertRecord(state, fp, patch, now = '') {
  const records = { ...((state && state.records) || {}) };
  const prev = records[fp] || { ...BLANK_RECORD(), createdAt: now };
  records[fp] = { ...prev, ...patch, updatedAt: now };
  return { fpVersion: FP_VERSION, records, legacy: (state && state.legacy) || null };
}

export function loadSnapshots() {
  const raw = readJSON(SNAPSHOTS_KEY);
  if (!raw || typeof raw !== 'object' || raw.fpVersion !== FP_VERSION) {
    return { fpVersion: FP_VERSION, baseline: null, lastRun: null };
  }
  return { fpVersion: FP_VERSION, baseline: raw.baseline || null, lastRun: raw.lastRun || null };
}

export function saveSnapshots(s) {
  writeJSON(SNAPSHOTS_KEY, { fpVersion: FP_VERSION, baseline: (s && s.baseline) || null, lastRun: (s && s.lastRun) || null });
}

// Set lastRun (completed-scan boundary); leaves baseline untouched.
export function recordRun(snapshots, snap) {
  return { fpVersion: FP_VERSION, baseline: (snapshots && snapshots.baseline) || null, lastRun: snap };
}
// Pin the given snapshot as the known-good baseline; leaves lastRun untouched.
export function pinBaseline(snapshots, snap) {
  return { fpVersion: FP_VERSION, baseline: snap, lastRun: (snapshots && snapshots.lastRun) || null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/findings.test.js`
Expected: PASS (entire `findings.test.js` green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/findings.js src/__tests__/findings.test.js
git commit -m "feat(findings): versioned lifecycle + snapshot storage with legacy quarantine"
```

---

## Phase 2 — `ruleId` threading + read-only Findings tab

### Task 7: Add `ruleId` to emitted oracle findings

**Files:**
- Modify: `src/qa/oracles.js` (the `push` in `scanSensitive` ~`oracles.js:85-94`; the three `findings.push` in `checkSchema` ~`oracles.js:149-160`; the map in `scanSensitiveLLM` ~`oracles.js:223-228`)
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test** (append to `oracles.test.js`)

```js
import { scanSensitive, checkSchema } from '../qa/oracles.js';

describe('ruleId on findings', () => {
  it('sensitive findings carry the rule id', () => {
    const out = scanSensitive({ body: { token: 'eyJabc.def.ghi' } });
    expect(out.find(f => f.title === 'JWT in response').ruleId).toBe('jwt');
  });
  it('schema findings carry stable schema:* codes', () => {
    const contract = { 'a': { type: 'string', required: true } };
    const out = checkSchema({ a: 1, b: 2 }, contract);
    expect(out.find(f => f.title === 'Type mismatch').ruleId).toBe('schema:type-mismatch');
    expect(out.find(f => f.title === 'Undeclared field').ruleId).toBe('schema:undeclared');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js -t ruleId`
Expected: FAIL — `ruleId` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `scanSensitive`'s `push` (the `findings.push({...})` object at `oracles.js:88-93`), add `ruleId: rule.id` as the first field:

```js
    findings.push({
      ruleId: rule.id,
      oracle: 'sensitive-data',
      severity: overrides[rule.group] || rule.severity,
      title: rule.title, path, evidence: redact(value), source: 'rule',
    });
```

In `checkSchema`, add a `ruleId` to each of the three pushes:

```js
      findings.push({ ruleId: 'schema:undeclared', oracle: 'schema', severity: 'low', title: 'Undeclared field', path: p, evidence: '', source: 'rule' });
```
```js
      findings.push({ ruleId: 'schema:type-mismatch', oracle: 'schema', severity: 'medium', title: 'Type mismatch', path: p, evidence: `${contract[p].type} → ${present[p]}`, source: 'rule' });
```
```js
      findings.push({ ruleId: 'schema:missing', oracle: 'schema', severity: 'medium', title: 'Missing field', path: p, evidence: '', source: 'rule' });
```

In `scanSensitiveLLM`'s `.map(...)` return (`oracles.js:223-228`), add `ruleId: 'llm-flagged'` (LLM findings are inherently ad hoc; one stable code, distinguished by path/location in the fingerprint):

```js
  return arr.filter(x => x && x.path).map(x => ({
    ruleId: 'llm-flagged',
    oracle: 'sensitive-data',
    severity: SEVERITY_ORDER.includes(x.severity) ? x.severity : 'medium',
    title: x.title || 'AI-flagged exposure',
    path: String(x.path), evidence: '', source: 'llm',
  }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS (new specs green; existing oracle specs unaffected — `ruleId` is additive).

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): tag findings with stable ruleId (sensitive/schema/llm)"
```

---

### Task 8: Carry `ruleId` + matrix location into the cross-engine union

**Files:**
- Modify: `src/qa/Security.jsx` (`matrixNormalized` memo, `Security.jsx:145-157`)
- Modify: `src/qa/BolaPanel.jsx` (`onFindings` push, `BolaPanel.jsx:118-119`)
- Modify: `src/qa/RateLimitPanel.jsx` (`onFindings` map, `RateLimitPanel.jsx:80-81`)
- Test: `src/__tests__/security-page.test.jsx` (smoke — union still renders); covered functionally in Task 11.

- [ ] **Step 1: Write the implementation (no new unit test — these are wiring changes verified by Task 9/11 panel tests and the existing security-page smoke test)**

In `Security.jsx` `matrixNormalized`, extend the pushed object to carry `ruleId` and the matrix location fields the fingerprint/label need:

```js
        for (const f of (cell && cell.findings) || []) {
          out.push({ engine: 'matrix', ruleId: f.ruleId, severity: f.severity, oracle: f.oracle,
                     title: f.title, path: f.path, evidence: f.evidence || '',
                     method: ep.method, endpoint: ep.path,
                     identityLabel: id.id === 'anon' ? 'anon' : (id.name || id.id),
                     ref: { reqId: ep.reqId, idId: id.id } });
        }
```

In `BolaPanel.jsx` `onFindings`, add `ruleId`:

```js
        if (f) out.push({ engine: 'bola', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
                          title: f.title, path: f.path, evidence: f.evidence || '',
                          ref: { testId: test.id, attackerId: a, ownerId: o } });
```

In `RateLimitPanel.jsx` `onFindings`, add `ruleId`:

```js
      return f ? { engine: 'ratelimit', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
                   title: f.title, path: f.path, evidence: f.evidence || '', ref: { testId: t0.id } } : null;
```

- [ ] **Step 2: Run the existing security smoke test to verify nothing broke**

Run: `npx vitest run src/__tests__/security-page.test.jsx src/__tests__/bola-panel.test.jsx src/__tests__/ratelimit-panel.test.jsx`
Expected: PASS (changes are additive to the union shape).

- [ ] **Step 3: Commit**

```bash
git add src/qa/Security.jsx src/qa/BolaPanel.jsx src/qa/RateLimitPanel.jsx
git commit -m "feat(security): carry ruleId + matrix location fields into findings union"
```

---

### Task 9: Findings tab — read-only table with diff badges

**Files:**
- Create: `src/qa/FindingsPanel.jsx`
- Create: `src/__tests__/findings-panel.test.jsx`
- Modify: `src/qa/i18n.jsx` (add `findings.*` keys, en-US + zh-TW)
- Modify: `src/qa/Security.jsx` (add the `findings` mode tab + render)

- [ ] **Step 1: Add i18n keys** — in `i18n.jsx`, inside the `'en-US'` dict (near the other `security.*` keys, e.g. after `security.findings.panelTitle`) add:

```js
    'findings.tab': 'Findings',
    'findings.empty': 'No findings yet — run a scan.',
    'findings.col.presence': 'State',
    'findings.col.severity': 'Severity',
    'findings.col.engine': 'Engine',
    'findings.col.rule': 'Rule',
    'findings.col.location': 'Location',
    'findings.col.owner': 'Owner',
    'findings.col.status': 'Status',
    'findings.presence.new': 'New',
    'findings.presence.carried': 'Carried',
    'findings.presence.resolved': 'Resolved',
    'findings.status.open': 'Open',
    'findings.status.acknowledged': 'Acknowledged',
    'findings.counter': '{count} new high/critical',
    'findings.pinBaseline': 'Pin current as baseline',
    'findings.baseline.none': 'No baseline — pin one to track deltas.',
    'findings.baseline.set': 'Baseline pinned ({count} findings).',
    'findings.baseline.scopeDiffers': 'Baseline scope differs',
    'findings.suppress': 'Suppress (false positive)',
    'findings.suppressReason': 'Reason',
    'findings.suppressed': 'Suppressed',
    'findings.owner': 'Owner',
    'findings.note': 'Note',
    'findings.severityOverride': 'Severity override',
    'findings.override.none': 'No override',
    'findings.legacy.notice': 'Some annotations were saved under an older fingerprint scheme and are kept as legacy. Review or clear them.',
    'findings.legacy.dismiss': 'Dismiss',
    'findings.filter.suppressed': 'Show suppressed',
```

  And the matching `'zh-TW'` block (inside the `'zh-TW'` dict, near its `security.findings.*` keys):

```js
    'findings.tab': '發現管理',
    'findings.empty': '尚無發現 — 請先執行掃描。',
    'findings.col.presence': '狀態',
    'findings.col.severity': '嚴重度',
    'findings.col.engine': '引擎',
    'findings.col.rule': '規則',
    'findings.col.location': '位置',
    'findings.col.owner': '負責人',
    'findings.col.status': '處理狀態',
    'findings.presence.new': '新增',
    'findings.presence.carried': '延續',
    'findings.presence.resolved': '已消失',
    'findings.status.open': '待處理',
    'findings.status.acknowledged': '已確認',
    'findings.counter': '{count} 個新的高/嚴重',
    'findings.pinBaseline': '將目前設為基準',
    'findings.baseline.none': '尚未設定基準 — 釘選一個以追蹤差異。',
    'findings.baseline.set': '已釘選基準（{count} 個發現）。',
    'findings.baseline.scopeDiffers': '基準範圍不同',
    'findings.suppress': '抑制（誤判）',
    'findings.suppressReason': '原因',
    'findings.suppressed': '已抑制',
    'findings.owner': '負責人',
    'findings.note': '備註',
    'findings.severityOverride': '嚴重度覆寫',
    'findings.override.none': '不覆寫',
    'findings.legacy.notice': '部分註記是以舊的指紋格式儲存，已保留為 legacy。請檢視或清除。',
    'findings.legacy.dismiss': '關閉',
    'findings.filter.suppressed': '顯示已抑制',
```

- [ ] **Step 2: Write the failing component test**

```jsx
// src/__tests__/findings-panel.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n.jsx';
import { FindingsPanel } from '../qa/FindingsPanel.jsx';

const union = [
  { engine: 'matrix', ruleId: 'jwt', severity: 'high', title: 'JWT in response',
    path: 'data.token', evidence: 'x', method: 'GET', endpoint: '/me',
    identityLabel: 'admin', ref: { reqId: 'r1', idId: 'admin' } },
];

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe('FindingsPanel (read-only)', () => {
  beforeEach(() => localStorage.clear());

  it('renders one row per finding with a presence badge', () => {
    wrap(<FindingsPanel union={union} />);
    expect(screen.getByText('JWT in response')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy(); // no baseline -> new
  });

  it('shows the empty state when there are no findings', () => {
    wrap(<FindingsPanel union={[]} />);
    expect(screen.getByText('No findings yet — run a scan.')).toBeTruthy();
  });

  it('shows the new high/critical counter', () => {
    wrap(<FindingsPanel union={union} />);
    expect(screen.getByText('1 new high/critical')).toBeTruthy();
  });
});
```

> Confirm the I18n provider export name: `grep -n "export" src/qa/i18n.jsx`. If the provider is exported under a different name (e.g. `I18n` or a context provider), use that name in the test and in `Security.jsx` — the rest of the app already wraps pages in it, so match the existing usage.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx`
Expected: FAIL — "Failed to resolve import '../qa/FindingsPanel.jsx'".

- [ ] **Step 4: Write minimal implementation**

```jsx
// src/qa/FindingsPanel.jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge } from './components.jsx';
import { useI18n } from './useI18n.js';
import { SEVERITY_ORDER } from './oracles.js';
import {
  fingerprint, ruleIdOf, locationLabel, effectiveSeverity, snapshotOf, diffRuns, gateCount,
  loadLifecycle, loadSnapshots,
} from './findings.js';

const { useState: useS, useMemo } = React;
const PRESENCE_ORDER = { new: 0, carried: 1, resolved: 2 };

// Build display rows: one per fingerprint, with effective severity, presence,
// and the lifecycle record. Same-fp occurrences are grouped (count).
function buildRows(union, lifecycle, diff) {
  const records = (lifecycle && lifecycle.records) || {};
  const byFp = new Map();
  for (const f of (union || [])) {
    const { fp } = fingerprint(f);
    const rec = records[fp];
    const existing = byFp.get(fp);
    if (existing) { existing.count += 1; continue; }
    byFp.set(fp, {
      fp, count: 1, engine: f.engine, ruleId: ruleIdOf(f), title: f.title,
      method: f.method, endpoint: f.endpoint, locationLabel: locationLabel(f),
      severity: f.severity, effectiveSeverity: effectiveSeverity(f, rec),
      presence: diff.get(fp) || 'new', record: rec || null,
    });
  }
  return [...byFp.values()].sort((a, b) =>
    (PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence]) ||
    (SEVERITY_ORDER.indexOf(b.effectiveSeverity) - SEVERITY_ORDER.indexOf(a.effectiveSeverity)));
}

function FindingsPanel({ union = [], snapshots: snapshotsProp, lifecycle: lifecycleProp, onPinBaseline }) {
  const { t } = useI18n();
  // Props win (Security.jsx owns the live state); otherwise read storage directly.
  const lifecycle = lifecycleProp || loadLifecycle();
  const snapshots = snapshotsProp || loadSnapshots();
  const [showSuppressed, setShowSuppressed] = useS(false);

  const current = useMemo(() => snapshotOf(union, lifecycle, {}), [union, lifecycle]);
  const baselineItems = (snapshots.baseline && snapshots.baseline.items) || [];
  const diff = useMemo(() => diffRuns(current.items, baselineItems), [current, baselineItems]);
  const rows = useMemo(() => buildRows(union, lifecycle, diff), [union, lifecycle, diff]);
  const gate = useMemo(() => gateCount(current.items, lifecycle, diff), [current, lifecycle, diff]);

  const visible = rows.filter(r => showSuppressed || !(r.record && r.record.suppressed));

  return (
    <div className="qa-find">
      <div className="qa-find-head">
        <span className="qa-find-counter">{t('findings.counter', { count: gate })}</span>
        {onPinBaseline && (
          <button className="qa-btn" onClick={onPinBaseline}><Icon name="flag" size={13} /> {t('findings.pinBaseline')}</button>
        )}
        <span className="qa-find-baseline">
          {snapshots.baseline
            ? t('findings.baseline.set', { count: baselineItems.length })
            : t('findings.baseline.none')}
        </span>
        <label className="qa-find-filter">
          <input type="checkbox" checked={showSuppressed} onChange={e => setShowSuppressed(e.target.checked)} />
          {t('findings.filter.suppressed')}
        </label>
      </div>

      {lifecycle.legacy && (
        <div className="qa-find-legacy">{t('findings.legacy.notice')}</div>
      )}

      {visible.length === 0 ? (
        <div className="qa-sec-empty">{t('findings.empty')}</div>
      ) : (
        <table className="qa-find-table">
          <thead><tr>
            <th>{t('findings.col.presence')}</th><th>{t('findings.col.severity')}</th>
            <th>{t('findings.col.engine')}</th><th>{t('findings.col.rule')}</th>
            <th>{t('findings.col.location')}</th>
          </tr></thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.fp} className={`qa-find-row qa-presence--${r.presence}`}>
                <td><span className={`qa-find-presence qa-presence--${r.presence}`}>{t('findings.presence.' + r.presence)}</span></td>
                <td>
                  <span className={`qa-sev--${r.effectiveSeverity}`}>{t('security.severity.' + r.effectiveSeverity)}</span>
                  {r.effectiveSeverity !== r.severity && <span className="qa-find-orig"> ({t('security.severity.' + r.severity)})</span>}
                </td>
                <td>{r.engine}</td>
                <td>{r.title}{r.count > 1 && <span className="qa-find-count"> ×{r.count}</span>}</td>
                <td>{r.method && <MethodBadge method={r.method} size="sm" />} <code>{r.locationLabel}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

Object.assign(window, { FindingsPanel });
export { FindingsPanel, buildRows };
```

- [ ] **Step 5: Wire the tab into `Security.jsx`** — import the panel and add the 4th segment.

Add to the imports block (after the `TriagePanel` import, `Security.jsx:19`):
```jsx
import { FindingsPanel } from './FindingsPanel.jsx';
```
Add a 4th tab button in the `qa-sec-tabs` div (after the `ratelimit` button, `Security.jsx:253`):
```jsx
        <button className={`qa-seg ${mode === 'findings' ? 'qa-seg--on' : ''}`} onClick={() => setMode('findings')}>{t('findings.tab')}</button>
```
Add a render branch. Change the mode dispatch (`Security.jsx:256-262`) so `findings` renders the panel. Insert before the `mode === 'bola'` ternary's matrix fallback — simplest is an explicit branch at the top of the conditional:
```jsx
      {mode === 'findings' ? (
        <FindingsPanel union={triageUnion} />
      ) : mode === 'bola' ? (
```
(Leave the existing `bola` / `ratelimit` / matrix branches unchanged.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx src/__tests__/security-page.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/qa/FindingsPanel.jsx src/__tests__/findings-panel.test.jsx src/qa/i18n.jsx src/qa/Security.jsx
git commit -m "feat(findings): read-only Findings tab with diff badges + counter"
```

---

## Phase 3 — Per-finding annotations

### Task 10: Per-row controls (suppress / status / owner / note / override)

**Files:**
- Modify: `src/qa/FindingsPanel.jsx` (add a row-expand drawer + persistence)
- Modify: `src/__tests__/findings-panel.test.jsx`

- [ ] **Step 1: Write the failing test** (append)

```jsx
import { fireEvent } from '@testing-library/react';
import { loadLifecycle, fingerprint } from '../qa/findings.js';

describe('FindingsPanel (annotations)', () => {
  beforeEach(() => localStorage.clear());

  it('suppressing a finding persists to the lifecycle store and hides it by default', () => {
    wrap(<FindingsPanel union={union} />);
    fireEvent.click(screen.getByText('JWT in response'));          // expand the row
    fireEvent.click(screen.getByLabelText('Suppress (false positive)')); // toggle suppress
    const fp = fingerprint(union[0]).fp;
    expect(loadLifecycle().records[fp].suppressed).toBe(true);
    // hidden by default (filter off)
    expect(screen.queryByText('JWT in response')).toBeNull();
  });

  it('editing the owner persists', () => {
    wrap(<FindingsPanel union={union} />);
    fireEvent.click(screen.getByText('JWT in response'));
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'alice' } });
    const fp = fingerprint(union[0]).fp;
    expect(loadLifecycle().records[fp].owner).toBe('alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx -t annotations`
Expected: FAIL — no expandable row / no "Suppress" control.

- [ ] **Step 3: Implement row expansion + persistence** in `FindingsPanel.jsx`.

Add imports for the write helpers and `useEffect`/`useCallback`:
```jsx
import {
  fingerprint, ruleIdOf, locationLabel, effectiveSeverity, snapshotOf, diffRuns, gateCount,
  loadLifecycle, saveLifecycle, upsertRecord, loadSnapshots, STATUSES,
} from './findings.js';
```
```jsx
const { useState: useS, useMemo, useEffect: useE, useCallback } = React;
```

Make the panel own a local lifecycle state when not provided, persisting on every edit. Replace the `lifecycle`/`showSuppressed` lines at the top of `FindingsPanel` with:
```jsx
  const [localLc, setLocalLc] = useS(() => lifecycleProp || loadLifecycle());
  const lifecycle = lifecycleProp || localLc;
  const [showSuppressed, setShowSuppressed] = useS(false);
  const [openFp, setOpenFp] = useS(null);

  // Patch a finding's record, persist, and reflect locally. `now` is a real ISO
  // timestamp here (UI side); findings.js stays pure by taking it as an arg.
  const patch = useCallback((fp, p) => {
    const next = upsertRecord(lifecycle, fp, p, new Date().toISOString());
    saveLifecycle(next);
    if (!lifecycleProp) setLocalLc(next);
  }, [lifecycle, lifecycleProp]);
```

Make each row clickable to toggle the drawer, and render a drawer under the open row. Replace the `<tr>` body map so each finding renders its row plus (when open) a detail row:
```jsx
            {visible.map(r => (
              <React.Fragment key={r.fp}>
                <tr className={`qa-find-row qa-presence--${r.presence}`} onClick={() => setOpenFp(openFp === r.fp ? null : r.fp)}>
                  <td><span className={`qa-find-presence qa-presence--${r.presence}`}>{t('findings.presence.' + r.presence)}</span></td>
                  <td>
                    <span className={`qa-sev--${r.effectiveSeverity}`}>{t('security.severity.' + r.effectiveSeverity)}</span>
                    {r.effectiveSeverity !== r.severity && <span className="qa-find-orig"> ({t('security.severity.' + r.severity)})</span>}
                  </td>
                  <td>{r.engine}</td>
                  <td>{r.title}{r.count > 1 && <span className="qa-find-count"> ×{r.count}</span>}{r.record && r.record.suppressed && <span className="qa-find-suppressed"> · {t('findings.suppressed')}</span>}</td>
                  <td>{r.method && <MethodBadge method={r.method} size="sm" />} <code>{r.locationLabel}</code></td>
                </tr>
                {openFp === r.fp && (
                  <tr className="qa-find-detail"><td colSpan={5}>
                    <label className="qa-find-ctl">
                      <input type="checkbox" aria-label={t('findings.suppress')}
                             checked={!!(r.record && r.record.suppressed)}
                             onChange={e => patch(r.fp, { suppressed: e.target.checked })} />
                      {t('findings.suppress')}
                    </label>
                    {r.record && r.record.suppressed && (
                      <input className="qa-inp" aria-label={t('findings.suppressReason')} placeholder={t('findings.suppressReason')}
                             value={r.record.suppressReason || ''} onChange={e => patch(r.fp, { suppressReason: e.target.value })} />
                    )}
                    <label className="qa-find-ctl">{t('findings.col.status')}:
                      <select aria-label={t('findings.col.status')} value={(r.record && r.record.status) || 'open'}
                              onChange={e => patch(r.fp, { status: e.target.value })}>
                        {STATUSES.map(s => <option key={s} value={s}>{t('findings.status.' + s)}</option>)}
                      </select>
                    </label>
                    <label className="qa-find-ctl">{t('findings.severityOverride')}:
                      <select aria-label={t('findings.severityOverride')} value={(r.record && r.record.severityOverride) || ''}
                              onChange={e => patch(r.fp, { severityOverride: e.target.value || null })}>
                        <option value="">{t('findings.override.none')}</option>
                        {SEVERITY_ORDER.map(s => <option key={s} value={s}>{t('security.severity.' + s)}</option>)}
                      </select>
                    </label>
                    <input className="qa-inp" aria-label={t('findings.owner')} placeholder={t('findings.owner')}
                           value={(r.record && r.record.owner) || ''} onChange={e => patch(r.fp, { owner: e.target.value })} />
                    <textarea className="qa-inp" aria-label={t('findings.note')} placeholder={t('findings.note')}
                              value={(r.record && r.record.note) || ''} onChange={e => patch(r.fp, { note: e.target.value })} />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx`
Expected: PASS (read-only + annotation specs green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/FindingsPanel.jsx src/__tests__/findings-panel.test.jsx
git commit -m "feat(findings): per-row suppress/status/owner/note/override controls"
```

---

## Phase 4 — Baseline pinning + snapshot lifecycle

### Task 11: Record run on completed full scan + pin baseline wiring

**Files:**
- Modify: `src/qa/Security.jsx` (lift lifecycle/snapshots state; record snapshot on completed full scan; pass `onPinBaseline`)
- Modify: `src/qa/FindingsPanel.jsx` (accept `scopeMismatch` prop for the scope-differs badge)
- Test: `src/__tests__/findings-panel.test.jsx` (pin + scope badge); `src/__tests__/security-page.test.jsx` (smoke)

- [ ] **Step 1: Write the failing test** (append to `findings-panel.test.jsx`)

```jsx
import { loadSnapshots } from '../qa/findings.js';

describe('FindingsPanel (baseline)', () => {
  beforeEach(() => localStorage.clear());

  it('calls onPinBaseline when the pin button is clicked', () => {
    let pinned = 0;
    wrap(<FindingsPanel union={union} onPinBaseline={() => { pinned += 1; }} />);
    fireEvent.click(screen.getByText('Pin current as baseline'));
    expect(pinned).toBe(1);
  });

  it('shows the scope-differs badge when scopeMismatch is true', () => {
    const snapshots = { fpVersion: 1, baseline: { items: [{ fp: 'zzz', effectiveSeverity: 'low' }], scopeHash: 'old' }, lastRun: null };
    wrap(<FindingsPanel union={union} snapshots={snapshots} scopeMismatch={true} />);
    expect(screen.getByText('Baseline scope differs')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx -t baseline`
Expected: FAIL — no "Pin current as baseline" handler wired / no scope badge.

- [ ] **Step 3: Add the scope-differs badge to `FindingsPanel.jsx`.** In the header, after the baseline span, add:
```jsx
        {scopeMismatch && <span className="qa-find-scopewarn">{t('findings.baseline.scopeDiffers')}</span>}
```
And add `scopeMismatch` to the component's destructured props:
```jsx
function FindingsPanel({ union = [], snapshots: snapshotsProp, lifecycle: lifecycleProp, onPinBaseline, scopeMismatch = false }) {
```

- [ ] **Step 4: Lift snapshot state + record-on-complete into `Security.jsx`.**

Add imports:
```jsx
import {
  loadLifecycle, loadSnapshots, saveSnapshots, snapshotOf, scopeHashOf, recordRun, pinBaseline,
} from './findings.js';
```

Add state near the other `useS` declarations (after `rateLimit`, `Security.jsx:114`):
```jsx
  const [snapshots, setSnapshots] = useS(() => loadSnapshots());
  const lifecycle = useMemo(() => loadLifecycle(), [snapshots, mode]);  // re-read after pins/edits
  const [runStamp, setRunStamp] = useS(0);   // bumped when a full scan completes
```

Compute the scope descriptor + current scope hash:
```jsx
  const scopeDescriptor = useMemo(() => ({
    endpoints: endpoints.map(e => e.reqId).sort(),
    identities: identities.map(i => i.id).sort(),
    bola: (bola.tests || []).map(x => x.id).sort(),
    rl: (rateLimit.tests || []).map(x => x.id).sort(),
  }), [endpoints, identities, bola, rateLimit]);
  const scopeHash = useMemo(() => scopeHashOf(scopeDescriptor), [scopeDescriptor]);
  const scopeMismatch = !!(snapshots.baseline && snapshots.baseline.scopeHash && snapshots.baseline.scopeHash !== scopeHash);
```

In `run()`, bump the stamp only on a completed, non-aborted full scan. Replace the `finally` block (`Security.jsx:212-214`):
```jsx
    } finally {
      setRunning(false);
      // Completed full scan (not a single-row run, not aborted) = a snapshot boundary.
      if (!rowReqId && !controller.signal.aborted) setRunStamp(s => s + 1);
    }
```

Record the snapshot from the live union after the run completes (effect reads the post-render union):
```jsx
  useE(() => {
    if (!runStamp) return;
    const snap = snapshotOf(triageUnion, loadLifecycle(),
      { runId: String(runStamp), createdAt: new Date().toISOString(), scopeHash });
    setSnapshots(prev => { const next = recordRun(prev, snap); saveSnapshots(next); return next; });
  }, [runStamp]);   // eslint-disable-line react-hooks/exhaustive-deps
```

Add a pin handler and pass props to the panel. Replace the `mode === 'findings'` branch from Task 9 Step 5:
```jsx
      {mode === 'findings' ? (
        <FindingsPanel
          union={triageUnion}
          snapshots={snapshots}
          lifecycle={lifecycle}
          scopeMismatch={scopeMismatch}
          onPinBaseline={() => {
            const snap = snapshotOf(triageUnion, loadLifecycle(),
              { runId: 'baseline', createdAt: new Date().toISOString(), scopeHash });
            setSnapshots(prev => { const next = pinBaseline(prev, snap); saveSnapshots(next); return next; });
          }}
        />
      ) : mode === 'bola' ? (
```

> Because the panel now receives `lifecycle` as a prop, its per-edit `patch` (Task 10) persists to storage but won't re-render through `Security.jsx`. That's acceptable: edits persist immediately; the page re-reads `loadLifecycle()` on the next `mode`/`snapshots` change. If you want live re-render of overrides in the counter, lift the lifecycle setter too — out of scope for this task.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/findings-panel.test.jsx src/__tests__/security-page.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite + build to confirm nothing regressed**

Run: `npx vitest run`
Expected: PASS (all suites).
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/qa/Security.jsx src/qa/FindingsPanel.jsx src/__tests__/findings-panel.test.jsx
git commit -m "feat(findings): record snapshot on completed scan + pin-baseline + scope-mismatch"
```

---

### Task 12: Styles + docs

**Files:**
- Modify: `src/qa/qa.css` (styles for `.qa-find*`, `.qa-presence--new/carried/resolved`)
- Modify: `README.md`, `README.zh-TW.md` (mention findings lifecycle in the security section)

- [ ] **Step 1: Add styles** — append `.qa-find` rules to `qa.css` following the existing `.qa-sec*` conventions (grep `qa-sec-chip`, `qa-sev--high` for the palette). Minimum: table layout, presence-badge colors (new=accent, carried=muted, resolved=struck/grey), suppressed-row dimming, detail-row padding. Reuse existing `qa-sev--*` severity colors.

```css
.qa-find-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
.qa-find-counter { font-weight: 600; }
.qa-find-table { width: 100%; border-collapse: collapse; }
.qa-find-table th, .qa-find-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--qa-border, #2a2a2a); }
.qa-find-row { cursor: pointer; }
.qa-presence--resolved { opacity: 0.55; }
.qa-find-suppressed { opacity: 0.6; font-style: italic; }
.qa-find-detail > td { background: var(--qa-surface-2, #1a1a1a); }
.qa-find-ctl { display: inline-flex; align-items: center; gap: 4px; margin-right: 12px; }
.qa-find-scopewarn, .qa-find-legacy { color: var(--qa-warn, #d8a657); }
```

- [ ] **Step 2: Verify the dev build renders the tab**

Run: `npm run build`
Expected: succeeds. (Manual visual check is optional; component tests already assert behavior.)

- [ ] **Step 3: Update READMEs** — add one bullet under the security/Findings feature list in both `README.md` and `README.zh-TW.md`, e.g. "Findings lifecycle: suppress false positives, override severity, assign owner/status/note, and diff against a pinned baseline (new/carried/resolved + new-high/critical counter)."

- [ ] **Step 4: Commit**

```bash
git add src/qa/qa.css README.md README.zh-TW.md
git commit -m "feat(findings): styles + document findings lifecycle"
```

---

## Self-review against spec

**Spec coverage:**
- False-positive suppression → Task 6 (`suppressed` field + storage), Task 10 (UI toggle + reason). ✓
- Severity override → Task 2 (`effectiveSeverity`), Task 6 (`severityOverride` field), Task 10 (override dropdown). ✓
- Owner / status / note → Task 6 (fields), Task 10 (controls); status limited to `open|acknowledged` per spec (no manual `fixed`). ✓
- Compare with previous run → Task 3 (`snapshotOf`), Task 4 (`diffRuns`), Task 6 (baseline + lastRun storage), Task 9 (presence badges), Task 11 (record on completed scan + pin baseline). ✓
- Only fail CI on new high/critical (deferred; counter computed) → Task 5 (`gateCount`), surfaced in Task 9 header. ✓
- Fingerprint excludes title/evidence, keys on ruleId → Task 1 + Task 7. ✓
- Versioned storage, legacy quarantine, corrupt-tolerant → Task 6. ✓
- Snapshots store identities only (no evidence/bodies) → Task 3 (explicit key-set assertion). ✓
- Cross-engine Findings tab → Task 8 (union carries ruleId for all engines) + Task 9 (tab). ✓
- Sensitive store (notes/reasons) → not exported anywhere in this plan; export is out of scope per spec. ✓
- Scope-mismatch awareness → Task 11. ✓
- Write timing: only on completed full scan, never on abort/streaming → Task 11 `finally` guard (`!rowReqId && !controller.signal.aborted`). ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The two notes in Task 9 (verify the I18n provider export name) and Task 11 (lifecycle re-render trade-off) are concrete instructions, not deferred work.

**Type consistency:** Verified across tasks — `fingerprint(f)` returns `{ fp, fpMaterial }` (Tasks 1/3/9/10/11 destructure `.fp`); `snapshotOf(union, lifecycle, meta)` item keys `{ fp, effectiveSeverity, engine, ruleId, path, locationLabel, count }` (Task 3 asserts exactly this set; Task 4/5/11 consume `.fp`/`.effectiveSeverity`); `diffRuns(currentItems, baselineItems)` → `Map` (Tasks 5/9/11 call `.get(fp)`); `loadLifecycle()` → `{ fpVersion, records, legacy }` (Tasks 9/10 read `.records`/`.legacy`); `upsertRecord(state, fp, patch, now)` and `effectiveSeverity(finding, record)` signatures match call sites; `STATUSES` used in Task 10 is exported in Task 6. Storage keys `LIFECYCLE_KEY`/`SNAPSHOTS_KEY` defined Task 1, used Task 6.

---

## Execution handoff

(Filled in by the assistant after saving — choose subagent-driven vs inline.)
