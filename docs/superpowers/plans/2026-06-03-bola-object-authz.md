# BOLA / IDOR Object-Authorization Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add object-level authorization (BOLA/IDOR) testing to the Security page: mark where an object id lives in a request, give each identity an id it owns, then run a reference pass + attacker×owner attack pass that confirms cross-object access by content, not just status.

**Architecture:** A new pure module `src/qa/bola.js` (mutation + content-match + verdict + run loop, unit-tested like `authz.js`/`oracles.js`) plus a new `src/qa/BolaPanel.jsx` UI rendered by `Security.jsx` behind a Matrix|Object-access mode toggle. Identities are shared with the matrix; findings reuse the phase-1 `Finding` shape and severity CSS. `runMatrix`/the RBAC engine is untouched; `qaRunSavedRequest` gains an optional `mutate` hook so the request can be rewritten before execution.

**Tech Stack:** React, Vitest + @testing-library/react, existing `buildReq`/`executeRequest`/`qaRunSavedRequest`/`qaVarMap` helpers, `walkJson` from `oracles.js`, flat per-locale i18n in `i18n.jsx`.

**Spec:** `docs/superpowers/specs/2026-06-03-bola-object-authz-design.md`

---

## File Structure

- **Create** `src/qa/bola.js` — pure engine: `applyIdLocation`, `matchesOwner`, `classifyBola`, `bolaSeverity`, `runBola`, `summarizeBola`, constants. No React.
- **Create** `src/__tests__/bola.test.js` — unit tests for the engine.
- **Create** `src/qa/BolaPanel.jsx` — the Object-access UI + the page-side runner. Consumes shared identities.
- **Create** `src/__tests__/bola-panel.test.jsx` — wiring test on the canned path.
- **Modify** `src/qa/sendRequest.js` — add an optional `mutate(req) => req` hook to `qaRunSavedRequest`.
- **Modify** `src/__tests__/sendRequest.test.js` — assert the mutate hook rewrites the executed request.
- **Modify** `src/qa/authz.js` — persist a `bola` blob in the security config.
- **Modify** `src/__tests__/authz.test.js` — assert `bola` round-trips.
- **Modify** `src/qa/Security.jsx` — Matrix|Object-access mode toggle; own `bola` state; render `BolaPanel`.
- **Modify** `src/qa/i18n.jsx` — `bola.*` keys (en-US + zh-TW).
- **Modify** `src/qa/qa.css` — mode toggle + BOLA grid styles.

**Finding shape (reused from phase 1):** `{ oracle:'object-authz', severity, title, path, evidence, source:'rule' }`.

Test command: `npx vitest run <file>`. Build: `npm run build`.

---

## Task 1: bola.js — `applyIdLocation`

**Files:**
- Create: `src/qa/bola.js`
- Test: `src/__tests__/bola.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/bola.test.js
import { describe, it, expect } from 'vitest';
import { applyIdLocation } from '../qa/bola.js';

const baseReq = () => ({ method: 'GET', url: '/users/42/orders', params: [{ key: 'x', value: '1', on: true }], body: '' });

describe('applyIdLocation', () => {
  it('replaces the Nth non-empty path segment and preserves the query string', () => {
    const r = applyIdLocation({ ...baseReq(), url: '/users/42/orders?limit=5' }, { kind: 'path', index: 1 }, 99);
    expect(r.url).toBe('/users/99/orders?limit=5');
    expect(r._idApplied).toBe(true);
  });
  it('does not mutate the input request', () => {
    const req = baseReq();
    applyIdLocation(req, { kind: 'path', index: 1 }, 99);
    expect(req.url).toBe('/users/42/orders');
  });
  it('sets an existing query param and turns it on', () => {
    const r = applyIdLocation({ ...baseReq(), params: [{ key: 'orderId', value: 'a', on: false }] }, { kind: 'query', key: 'orderId' }, 7);
    expect(r.params.find(p => p.key === 'orderId')).toEqual({ key: 'orderId', value: '7', on: true });
  });
  it('appends a query param when absent', () => {
    const r = applyIdLocation(baseReq(), { kind: 'query', key: 'orderId' }, 7);
    expect(r.params.find(p => p.key === 'orderId')).toEqual({ key: 'orderId', value: '7', on: true });
  });
  it('sets a body JSON field at a dotted path when the parent exists', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: '{"order":{"id":1}}' }, { kind: 'body', path: 'order.id' }, 9);
    expect(JSON.parse(r.body)).toEqual({ order: { id: 9 } });
    expect(r._idApplied).toBe(true);
  });
  it('leaves a non-JSON body unchanged and flags _idApplied=false', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: 'not json' }, { kind: 'body', path: 'id' }, 9);
    expect(r.body).toBe('not json');
    expect(r._idApplied).toBe(false);
  });
  it('flags _idApplied=false when a body path parent is missing', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: '{"a":1}' }, { kind: 'body', path: 'order.id' }, 9);
    expect(JSON.parse(r.body)).toEqual({ a: 1 });
    expect(r._idApplied).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: FAIL — `Failed to resolve import "../qa/bola.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/bola.js
// ── QA Companion — object-level authz (BOLA/IDOR) engine (pure logic) ──────
// Mutate a request's object id, run a reference + attacker×owner attack pass,
// and confirm cross-object access by content. UI lives in BolaPanel.jsx.
import './setup.js';
import { walkJson } from './oracles.js';

export const MATCH_THRESHOLD = 0.6;
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Return a copy of `req` with the object id at `idLocation` overwritten by
// `value`. Never mutates `req`. Sets `_idApplied` to whether it took effect.
export function applyIdLocation(req, idLocation, value) {
  const out = { ...req, params: (req.params || []).map(p => ({ ...p })) };
  const v = String(value);
  if (!idLocation) { out._idApplied = false; return out; }
  if (idLocation.kind === 'path') {
    const [pathPart, queryPart] = String(out.url || '').split('?');
    const segs = pathPart.split('/');
    let seen = -1, applied = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '') continue;
      seen++;
      if (seen === idLocation.index) { segs[i] = v; applied = true; break; }
    }
    out.url = segs.join('/') + (queryPart ? '?' + queryPart : '');
    out._idApplied = applied;
  } else if (idLocation.kind === 'query') {
    const existing = out.params.find(p => p.key === idLocation.key);
    if (existing) { existing.value = v; existing.on = true; }
    else out.params.push({ key: idLocation.key, value: v, on: true });
    out._idApplied = true;
  } else if (idLocation.kind === 'body') {
    out._idApplied = false;
    try {
      const obj = JSON.parse(out.body || 'null');
      if (obj && typeof obj === 'object' && setAtPath(obj, idLocation.path, v)) {
        out.body = JSON.stringify(obj);
        out._idApplied = true;
      }
    } catch { /* non-JSON body — leave unchanged */ }
  } else {
    out._idApplied = false;
  }
  return out;
}

// Set value at a dot/bracket path only if every parent exists. Returns success.
function setAtPath(obj, path, value) {
  const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  if (!keys.length) return false;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null || typeof cur !== 'object' || !(keys[i] in cur)) return false;
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (cur == null || typeof cur !== 'object' || !(last in cur)) return false;
  cur[last] = value;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/bola.js src/__tests__/bola.test.js
git commit -m "feat(bola): applyIdLocation request mutation (path/query/body)"
```

---

## Task 2: bola.js — `matchesOwner` (content confirmation)

**Files:**
- Modify: `src/qa/bola.js`
- Test: `src/__tests__/bola.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/bola.test.js
import { matchesOwner } from '../qa/bola.js';

const resp = (body) => ({ status: 200, body });

describe('matchesOwner', () => {
  it('matches when the owner id value is echoed as a leaf in the attack body', () => {
    expect(matchesOwner(resp({ id: 99, name: 'Bob' }), resp({ id: 1 }), 99)).toBe(true);
  });
  it('matches when scalar-leaf overlap with the owner reference is >= threshold', () => {
    const owner = resp({ a: 'x', b: 'y', c: 'z' });
    const attack = resp({ a: 'x', b: 'y', c: 'z', extra: 'q' }); // 3/4 overlap = 0.75
    expect(matchesOwner(attack, owner, 'noecho')).toBe(true);
  });
  it('does not match when overlap is below threshold and id is not echoed', () => {
    expect(matchesOwner(resp({ a: '1', b: '2' }), resp({ c: '3', d: '4' }), 'zzz')).toBe(false);
  });
  it('falls back to a substring check for a non-JSON attack body', () => {
    expect(matchesOwner(resp('order 99 belongs to bob'), resp({ id: 1 }), 99)).toBe(true);
  });
  it('returns false when the owner reference body has no leaves', () => {
    expect(matchesOwner(resp({ a: 1 }), resp({}), 'zzz')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: FAIL — `matchesOwner is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/bola.js

function scalarLeaves(body) {
  const set = new Set();
  if (body != null && typeof body === 'object') {
    walkJson(body, (_p, _k, v) => { if (v != null && typeof v !== 'object') set.add(String(v)); });
  } else if (body != null) {
    set.add(String(body));
  }
  return set;
}

// True when the attacker's response actually reflects the owner's object:
// (a) the owner id value is echoed in the body, or
// (b) scalar-leaf Jaccard overlap with the owner reference >= MATCH_THRESHOLD.
export function matchesOwner(attackResp, ownerRef, ownerIdValue) {
  const aBody = attackResp && attackResp.body;
  const idv = String(ownerIdValue);
  if (aBody != null && typeof aBody === 'object') {
    if (scalarLeaves(aBody).has(idv)) return true;
  } else if (typeof aBody === 'string') {
    if (aBody.includes(idv)) return true;
  }
  const oBody = ownerRef && ownerRef.body;
  if (aBody && typeof aBody === 'object' && oBody && typeof oBody === 'object') {
    const A = scalarLeaves(aBody), O = scalarLeaves(oBody);
    if (O.size === 0) return false;
    let inter = 0;
    for (const x of O) if (A.has(x)) inter++;
    const union = A.size + O.size - inter;
    if (union > 0 && inter / union >= MATCH_THRESHOLD) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/bola.js src/__tests__/bola.test.js
git commit -m "feat(bola): matchesOwner content confirmation (id-echo + leaf overlap)"
```

---

## Task 3: bola.js — `classifyBola` + `bolaSeverity`

**Files:**
- Modify: `src/qa/bola.js`
- Test: `src/__tests__/bola.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/bola.test.js
import { classifyBola, bolaSeverity } from '../qa/bola.js';

describe('classifyBola', () => {
  const deny = [401, 403, 404];
  it('deny-set status is pass', () => {
    expect(classifyBola('GET', 403, true, deny)).toBe('pass');
    expect(classifyBola('GET', 404, false, deny)).toBe('pass');
  });
  it('2xx + matched is vuln; 2xx + unmatched is unconfirmed', () => {
    expect(classifyBola('GET', 200, true, deny)).toBe('vuln');
    expect(classifyBola('GET', 200, false, deny)).toBe('unconfirmed');
  });
  it('other/null status is inconclusive', () => {
    expect(classifyBola('GET', 500, true, deny)).toBe('inconclusive');
    expect(classifyBola('GET', null, true, deny)).toBe('inconclusive');
  });
});

describe('bolaSeverity', () => {
  it('confirmed read is high, confirmed mutating is critical', () => {
    expect(bolaSeverity('GET', 'vuln')).toBe('high');
    expect(bolaSeverity('DELETE', 'vuln')).toBe('critical');
    expect(bolaSeverity('post', 'vuln')).toBe('critical');
  });
  it('unconfirmed is medium; pass/inconclusive have no finding', () => {
    expect(bolaSeverity('GET', 'unconfirmed')).toBe('medium');
    expect(bolaSeverity('GET', 'pass')).toBe(null);
    expect(bolaSeverity('GET', 'inconclusive')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: FAIL — `classifyBola is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/bola.js

export function classifyBola(method, status, matched, denySet) {
  const deny = denySet || [401, 403, 404];
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'inconclusive';
  if (deny.includes(status)) return 'pass';
  if (status >= 200 && status <= 299) return matched ? 'vuln' : 'unconfirmed';
  return 'inconclusive';
}

export function bolaSeverity(method, verdict) {
  if (verdict === 'vuln') return MUTATING_METHODS.includes(String(method).toUpperCase()) ? 'critical' : 'high';
  if (verdict === 'unconfirmed') return 'medium';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/bola.js src/__tests__/bola.test.js
git commit -m "feat(bola): classifyBola verdict + bolaSeverity mapping"
```

---

## Task 4: bola.js — `runBola` + `summarizeBola`

**Files:**
- Modify: `src/qa/bola.js`
- Test: `src/__tests__/bola.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/bola.test.js
import { runBola, summarizeBola } from '../qa/bola.js';

const idAlice = { id: 'alice', name: 'Alice', auth: {} };
const idBob   = { id: 'bob',   name: 'Bob',   auth: {} };
const test1 = { id: 't1', reqId: 'r1', method: 'GET', path: '/users/{id}', idLocation: { kind: 'path', index: 1 }, idValues: { alice: 'A1', bob: 'B1' } };

describe('runBola', () => {
  const baseState = { identities: [idAlice, idBob], tests: [test1], denySet: [401, 403, 404] };

  it('runs a reference pass then attacker×owner attacks, flagging confirmed vuln', async () => {
    // Every call returns the SAME body (so attacker body == owner reference → matched).
    const runner = () => Promise.resolve({ status: 200, body: { secret: 'shared' } });
    const seen = [];
    const results = await runBola(baseState, runner, { onCell: (tid, a, o, cell) => seen.push([tid, a, o, cell.phase]) });
    expect(results.t1.reference.alice.status).toBe(200);
    expect(results.t1.attacks.alice.bob.verdict).toBe('vuln');
    expect(results.t1.attacks.bob.alice.severity).toBe('high');
    expect(results.t1.attacks.alice.bob.finding.oracle).toBe('object-authz');
    // 2 reference + 2 attack cells streamed
    expect(seen.filter(s => s[3] === 'ref').length).toBe(2);
    expect(seen.filter(s => s[3] === 'attack').length).toBe(2);
  });

  it('marks a denied cross-access as pass', async () => {
    const runner = (t, identity, idValue) => Promise.resolve(idValue === 'A1' && identity.id === 'bob' ? { status: 403, body: {} } : { status: 200, body: { id: 1 } });
    const results = await runBola(baseState, runner, {});
    expect(results.t1.attacks.bob.alice.verdict).toBe('pass');
  });

  it('caps at unconfirmed when the owner could not read its own object (ref not 2xx)', async () => {
    let n = 0;
    const runner = () => { n++; return Promise.resolve(n <= 2 ? { status: 500, body: {} } : { status: 200, body: { x: 1 } }); };
    const results = await runBola(baseState, runner, {});
    // references both 500 → matched forced false → 2xx attacks can only be unconfirmed
    expect(['unconfirmed', 'inconclusive']).toContain(results.t1.attacks.alice.bob.verdict);
    expect(results.t1.attacks.alice.bob.verdict).not.toBe('vuln');
  });

  it('skips identities with no id value for the test', async () => {
    const state = { ...baseState, tests: [{ ...test1, idValues: { alice: 'A1' } }] };
    let calls = 0;
    await runBola(state, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, {});
    expect(calls).toBe(1);   // only Alice's reference; no attack pairs possible
  });

  it('stops early when the abort signal is set', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runBola(baseState, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });
});

describe('summarizeBola', () => {
  it('tallies attack verdicts (not reference cells)', () => {
    const results = { t1: { reference: { a: { status: 200 } }, attacks: { a: { b: { verdict: 'vuln' } }, b: { a: { verdict: 'pass' } } } } };
    expect(summarizeBola(results)).toEqual({ total: 2, vuln: 1, unconfirmed: 0, pass: 1, inconclusive: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: FAIL — `runBola is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/bola.js

function respStatus(resp) { return resp && typeof resp.status === 'number' ? resp.status : null; }
function errStr(e) { return String((e && e.message) || e); }
function reqMeta(test, identity, idValue) {
  return { method: test.method, path: test.path, identity: identity.name || identity.id, idValue: String(idValue) };
}

// Run object-level authz tests. `runner(test, identity, idValue) => Promise<response>`
// is injected (the page builds+mutates+executes). Streams each finished cell via
// opts.onCell(testId, attackerId|null, ownerId, cell). Honors opts.signal.
export async function runBola(state, runner, opts = {}) {
  const { signal, onCell } = opts;
  const denySet = state.denySet || [401, 403, 404];
  const results = {};
  for (const test of state.tests || []) {
    if (signal && signal.aborted) return results;
    const idVals = test.idValues || {};
    const owners = (state.identities || []).filter(i => idVals[i.id] != null && idVals[i.id] !== '');
    const reference = {};
    results[test.id] = { reference, attacks: {} };

    for (const O of owners) {
      if (signal && signal.aborted) return results;
      let cell;
      try {
        const resp = await runner(test, O, idVals[O.id]);
        cell = { phase: 'ref', status: respStatus(resp), response: resp || null, request: reqMeta(test, O, idVals[O.id]), error: null };
      } catch (e) {
        cell = { phase: 'ref', status: null, response: null, request: null, error: errStr(e) };
      }
      reference[O.id] = cell;
      if (onCell) onCell(test.id, null, O.id, cell);
    }

    for (const A of owners) {
      results[test.id].attacks[A.id] = {};
      for (const O of owners) {
        if (A.id === O.id) continue;
        if (signal && signal.aborted) return results;
        let cell;
        try {
          const resp = await runner(test, A, idVals[O.id]);
          const status = respStatus(resp);
          const ref = reference[O.id];
          const refOk = ref && typeof ref.status === 'number' && ref.status >= 200 && ref.status <= 299;
          const matched = refOk ? matchesOwner(resp, ref.response, idVals[O.id]) : false;
          const verdict = classifyBola(test.method, status, matched, denySet);
          const severity = bolaSeverity(test.method, verdict);
          const finding = severity ? {
            oracle: 'object-authz', severity,
            title: verdict === 'vuln' ? 'Cross-object access confirmed' : 'Cross-object access (unconfirmed)',
            path: `${test.method} ${test.path}`,
            evidence: `as ${A.name || A.id} → ${O.name || O.id}'s id`, source: 'rule',
          } : null;
          cell = { phase: 'attack', status, matched, verdict, severity, finding, response: resp || null, request: reqMeta(test, A, idVals[O.id]), error: null };
        } catch (e) {
          cell = { phase: 'attack', status: null, matched: false, verdict: 'inconclusive', severity: null, finding: null, response: null, request: null, error: errStr(e) };
        }
        results[test.id].attacks[A.id][O.id] = cell;
        if (onCell) onCell(test.id, A.id, O.id, cell);
      }
    }
  }
  return results;
}

// Tally attack-cell verdicts across all tests (reference cells excluded).
export function summarizeBola(results) {
  const s = { total: 0, vuln: 0, unconfirmed: 0, pass: 0, inconclusive: 0 };
  for (const tid in results) {
    const atk = (results[tid] && results[tid].attacks) || {};
    for (const a in atk) {
      for (const o in atk[a]) {
        const v = atk[a][o] && atk[a][o].verdict;
        if (!v) continue;
        s.total++; if (s[v] !== undefined) s[v]++;
      }
    }
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/bola.js src/__tests__/bola.test.js
git commit -m "feat(bola): runBola reference+attack passes + summarizeBola"
```

---

## Task 5: `qaRunSavedRequest` — optional `mutate` hook

**Files:**
- Modify: `src/qa/sendRequest.js`
- Test: `src/__tests__/sendRequest.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a new test to src/__tests__/sendRequest.test.js (imports qaRunSavedRequest already present there)
import { describe, it, expect, beforeEach } from 'vitest';
import { qaRunSavedRequest } from '../qa/sendRequest.js';

describe('qaRunSavedRequest — mutate hook', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/users/42' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 2, body: { ok: true }, headers: {} } };
  });
  it('applies mutate(req) before execution so the sent URL reflects the change', async () => {
    let sentUrl = null;
    const mutate = (req) => { sentUrl = req.url; return { ...req, url: req.url.replace('/42', '/99') }; };
    const resp = await qaRunSavedRequest({ id: 'r1' }, { env: { label: 'None', baseUrl: '' }, mutate });
    expect(sentUrl).toBe('https://api.test/users/42');   // mutate saw the original built url
    expect(resp.status).toBe(200);                        // canned path still returns
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/sendRequest.test.js`
Expected: FAIL — `sentUrl` stays `null` (mutate never called).

- [ ] **Step 3: Write minimal implementation**

Edit `src/qa/sendRequest.js`: add `mutate` to the destructured ctx and apply it right after `authOverride`, then use the result everywhere `req` was used:

```js
export async function qaRunSavedRequest(reqMeta, ctx = {}) {
  const { env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true, oauthToken, collectionId, localVars = {}, authOverride, mutate } = ctx;
  let req = buildReq(reqMeta.id);
  if (authOverride) req.auth = authOverride;
  // Optional last-mile rewrite (e.g. BOLA id substitution) before var-substitution.
  if (mutate) req = mutate(req);
  const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label, collectionId, localVars);
  const urlSub = window.qaSubstitute(req.url || '', map);
  const isAbsolute = /^https?:\/\//i.test(urlSub);
  const fullUrl = isAbsolute ? urlSub : (window.qaSubstitute(env.baseUrl || '', map) + urlSub);
  const reqCookies = (cookies || [])
    .filter((c) => cookieMatches(c, fullUrl))
    .sort((a, b) => (b.path || '/').length - (a.path || '/').length);
  return executeRequest(req, env, map, { cookies: reqCookies, sslVerify, oauthToken });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/sendRequest.test.js`
Expected: PASS (existing sendRequest tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/sendRequest.js src/__tests__/sendRequest.test.js
git commit -m "feat(sendRequest): optional mutate(req) hook for last-mile rewrites"
```

---

## Task 6: Persist `bola` in the matrix config

**Files:**
- Modify: `src/qa/authz.js` (`saveMatrixConfig`)
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a new describe to src/__tests__/authz.test.js
describe('persistence — bola', () => {
  it('round-trips a bola blob when present and omits it when absent', () => {
    installLocalStorage();
    const bola = { tests: [{ id: 't1', reqId: 'r1', method: 'GET', path: '/u/{id}', idLocation: { kind: 'path', index: 1 }, idValues: { anon: '5' } }] };
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401], bola });
    expect(loadMatrixConfig().bola).toEqual(bola);

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().bola).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — `loadMatrixConfig().bola` is `undefined` in the first assertion.

- [ ] **Step 3: Write minimal implementation**

Edit `saveMatrixConfig` in `src/qa/authz.js` to also persist `bola` when present:

```js
export function saveMatrixConfig(state) {
  try {
    const { identities = [], endpoints = [], expect = {}, denySet = DEFAULT_DENY_SET, oracleConfig, bola } = state || {};
    const cleanIdentities = identities.map(({ id, name, auth }) => ({ id, name, auth }));
    const payload = { identities: cleanIdentities, endpoints, expect, denySet };
    if (oracleConfig) payload.oracleConfig = oracleConfig;
    if (bola) payload.bola = bola;
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(payload));
  } catch { /* storage unavailable — non-fatal */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): persist bola config in matrix config"
```

---

## Task 7: i18n keys for the BOLA UI

**Files:**
- Modify: `src/qa/i18n.jsx` (after the phase-1 `security.severity.*` keys in each locale)

- [ ] **Step 1: Add the keys to `en-US`**

Insert after `'security.severity.critical': 'critical',` in the `en-US` block:

```js
    'security.mode.matrix': 'RBAC matrix',
    'security.mode.bola': 'Object access (BOLA)',
    'bola.subtitle': 'Object-level authz — access another identity’s object by swapping its id.',
    'bola.addTest': 'Add endpoint to test',
    'bola.idLocation': 'Object id location',
    'bola.kind.path': 'Path segment',
    'bola.kind.query': 'Query param',
    'bola.kind.body': 'Body field',
    'bola.pathIndex': 'Segment #',
    'bola.queryKey': 'Param key',
    'bola.bodyPath': 'JSON path',
    'bola.idValues': 'Owned id per identity',
    'bola.run': 'Run BOLA',
    'bola.reference': 'reference (own id)',
    'bola.attacker': 'attacker',
    'bola.owner': 'target owner',
    'bola.noTests': 'No tests yet — add an endpoint and mark its object id.',
    'bola.verdict.vuln': 'BOLA',
    'bola.verdict.unconfirmed': 'open?',
    'bola.verdict.pass': 'pass',
    'bola.verdict.inconclusive': 'check',
    'bola.matched': 'content matched owner',
    'bola.notApplied': 'id location not applied to this request',
```

- [ ] **Step 2: Add the keys to `zh-TW`**

Insert at the matching position in the `zh-TW` block (after its `'security.severity.critical'` entry):

```js
    'security.mode.matrix': 'RBAC 矩陣',
    'security.mode.bola': '物件越權 (BOLA)',
    'bola.subtitle': '物件層授權 — 換掉 id 去存取別的 identity 的物件。',
    'bola.addTest': '加入要測的 endpoint',
    'bola.idLocation': '物件 id 位置',
    'bola.kind.path': '路徑段',
    'bola.kind.query': 'Query 參數',
    'bola.kind.body': 'Body 欄位',
    'bola.pathIndex': '第幾段',
    'bola.queryKey': '參數 key',
    'bola.bodyPath': 'JSON 路徑',
    'bola.idValues': '每個 identity 擁有的 id',
    'bola.run': '執行 BOLA',
    'bola.reference': '基準（自己的 id）',
    'bola.attacker': '攻擊者',
    'bola.owner': '目標擁有者',
    'bola.noTests': '還沒有測試 — 加一個 endpoint 並標記它的物件 id。',
    'bola.verdict.vuln': '越權',
    'bola.verdict.unconfirmed': '可疑',
    'bola.verdict.pass': '通過',
    'bola.verdict.inconclusive': '待查',
    'bola.matched': '內容符合擁有者',
    'bola.notApplied': 'id 位置未套用到此請求',
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(bola): mode toggle + BOLA panel keys (en-US + zh-TW)"
```

---

## Task 8: `BolaPanel.jsx` — config, runner, result grid, findings

**Files:**
- Create: `src/qa/BolaPanel.jsx`
- Test: `src/__tests__/bola-panel.test.jsx`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/bola-panel.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BolaPanel } from '../qa/BolaPanel.jsx';
import { I18nProvider } from '../qa/i18n.jsx';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }, clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

const identities = [
  { id: 'alice', name: 'Alice', auth: { type: 'none' } },
  { id: 'bob', name: 'Bob', auth: { type: 'none' } },
];
const bola = { tests: [{ id: 't1', reqId: 'r1', method: 'GET', path: 'https://api.test/users/42', idLocation: { kind: 'path', index: 1 }, idValues: { alice: 'A1', bob: 'B1' } }] };

function renderPanel() {
  let cur = bola;
  const setBola = (next) => { cur = typeof next === 'function' ? next(cur) : next; };
  return render(
    <I18nProvider>
      <BolaPanel identities={identities} bola={bola} setBola={setBola}
                 env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('BolaPanel — runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'user', path: 'https://api.test/users/42' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    // Same canned body for every call → attacker body == owner reference → matched → vuln.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 9, body: { secret: 'shared' }, headers: {} } };
  });

  it('runs the configured test and surfaces a confirmed BOLA cell + finding', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Run BOLA/i }));
    await waitFor(() => expect(document.querySelector('.qa-bola-cell--vuln')).not.toBeNull(), { timeout: 4000 });
    // A finding badge / panel shows the object-authz finding.
    await waitFor(() => expect(document.querySelector('.qa-sec-findpanel, .qa-bola-findpanel')).not.toBeNull());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola-panel.test.jsx`
Expected: FAIL — `Failed to resolve import "../qa/BolaPanel.jsx"`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// src/qa/BolaPanel.jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge } from './components.jsx';
import { useI18n } from './useI18n.js';
import { qaRunSavedRequest } from './sendRequest.js';
import { applyIdLocation, runBola, summarizeBola } from './bola.js';
import { SEVERITY_ORDER } from './oracles.js';

const { useState: useS, useMemo, useRef } = React;
const VLABEL = { vuln: 'bola.verdict.vuln', unconfirmed: 'bola.verdict.unconfirmed', pass: 'bola.verdict.pass', inconclusive: 'bola.verdict.inconclusive' };

function allRequests() {
  return (window.QA.COLLECTIONS || []).flatMap(c =>
    (c.folders || []).flatMap(f => (f.requests || []).map(r => ({ reqId: r.id, method: r.method, path: r.path, name: r.name }))));
}

let testSeq = 1;

function BolaPanel({ identities, bola, setBola, env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
  const { t } = useI18n();
  const tests = bola.tests || [];
  const [results, setResults] = useS({});
  const [running, setRunning] = useS(false);
  const [drawer, setDrawer] = useS(null);   // { testId, attackerId, ownerId }
  const abortRef = useRef(null);

  const setTests = (updater) => setBola(b => ({ ...b, tests: typeof updater === 'function' ? updater(b.tests || []) : updater }));

  const addTest = (r) => setTests(ts => ts.some(x => x.reqId === r.reqId)
    ? ts
    : [...ts, { id: `bt_${Date.now()}_${testSeq++}`, reqId: r.reqId, method: r.method, path: r.path, idLocation: { kind: 'path', index: 0 }, idValues: {} }]);
  const removeTest = (id) => setTests(ts => ts.filter(x => x.id !== id));
  const patchTest = (id, patch) => setTests(ts => ts.map(x => x.id === id ? { ...x, ...patch } : x));
  const setIdValue = (id, identityId, value) => setTests(ts => ts.map(x => x.id === id ? { ...x, idValues: { ...x.idValues, [identityId]: value } } : x));

  const runner = (test, identity, idValue) => qaRunSavedRequest({ id: test.reqId }, {
    env, vars, cookies, sslVerify, authOverride: identity.auth, oauthToken: identity._oauthToken,
    mutate: (req) => applyIdLocation(req, test.idLocation, idValue),
  });

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults({});
    try {
      await runBola({ identities, tests }, runner, {
        signal: controller.signal,
        onCell: (testId, attackerId, ownerId, cell) => setResults(r => {
          const tr = r[testId] || { reference: {}, attacks: {} };
          if (attackerId == null) return { ...r, [testId]: { ...tr, reference: { ...tr.reference, [ownerId]: cell } } };
          return { ...r, [testId]: { ...tr, attacks: { ...tr.attacks, [attackerId]: { ...(tr.attacks[attackerId] || {}), [ownerId]: cell } } } };
        }),
      });
    } finally { setRunning(false); }
  };
  const stop = () => { if (abortRef.current) abortRef.current.abort(); setRunning(false); };

  const summary = useMemo(() => summarizeBola(results), [results]);
  const allFindings = useMemo(() => {
    const out = [];
    for (const test of tests) {
      const atk = (results[test.id] && results[test.id].attacks) || {};
      for (const a in atk) for (const o in atk[a]) {
        const f = atk[a][o] && atk[a][o].finding;
        if (f) out.push(f);
      }
    }
    return out.sort((x, y) => SEVERITY_ORDER.indexOf(y.severity) - SEVERITY_ORDER.indexOf(x.severity));
  }, [results, tests]);

  const reqs = allRequests();
  const drawerCell = drawer && results[drawer.testId]
    && (drawer.attackerId == null
      ? results[drawer.testId].reference[drawer.ownerId]
      : (results[drawer.testId].attacks[drawer.attackerId] || {})[drawer.ownerId]);

  const owned = (test) => identities.filter(i => (test.idValues || {})[i.id] != null && test.idValues[i.id] !== '');

  return (
    <div className="qa-bola">
      <div className="qa-sec-head">
        <div><h2>{t('security.mode.bola')}</h2><p>{t('bola.subtitle')}</p></div>
        <div className="qa-sec-actions">
          {running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={run} disabled={!tests.length}><Icon name="play" size={14} /> {t('bola.run')}</button>}
        </div>
      </div>

      <div className="qa-sec-summary">
        {['total', 'vuln', 'unconfirmed', 'pass', 'inconclusive'].map(k => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>{summary[k] || 0} {t('bola.verdict.' + k) !== 'bola.verdict.' + k ? t('bola.verdict.' + k) : k}</span>
        ))}
      </div>

      <div className="qa-sec-toolbar">
        <select className="qa-inp qa-inp--mini" value="" onChange={e => { const r = reqs.find(x => x.reqId === e.target.value); if (r) addTest(r); }}>
          <option value="">{t('bola.addTest')}…</option>
          {reqs.map(r => <option key={r.reqId} value={r.reqId}>{r.method} {r.path}</option>)}
        </select>
      </div>

      {!tests.length && <div className="qa-sec-empty">{t('bola.noTests')}</div>}

      {tests.map(test => {
        const ow = owned(test);
        const tr = results[test.id] || { reference: {}, attacks: {} };
        return (
          <div key={test.id} className="qa-bola-test">
            <div className="qa-bola-test-head">
              <MethodBadge method={test.method} size="sm" /> <code>{test.path}</code>
              <button className="qa-sec-x" onClick={() => removeTest(test.id)}><Icon name="x" size={11} /></button>
            </div>

            <div className="qa-bola-loc">
              <label>{t('bola.idLocation')}:</label>
              <select className="qa-inp qa-inp--mini" value={test.idLocation.kind}
                      onChange={e => patchTest(test.id, { idLocation: e.target.value === 'path' ? { kind: 'path', index: 0 } : e.target.value === 'query' ? { kind: 'query', key: '' } : { kind: 'body', path: '' } })}>
                <option value="path">{t('bola.kind.path')}</option>
                <option value="query">{t('bola.kind.query')}</option>
                <option value="body">{t('bola.kind.body')}</option>
              </select>
              {test.idLocation.kind === 'path' && (
                <input className="qa-inp qa-inp--mini" type="number" min="0" placeholder={t('bola.pathIndex')}
                       value={test.idLocation.index}
                       onChange={e => patchTest(test.id, { idLocation: { kind: 'path', index: parseInt(e.target.value, 10) || 0 } })} />
              )}
              {test.idLocation.kind === 'query' && (
                <input className="qa-inp qa-inp--mini" placeholder={t('bola.queryKey')} value={test.idLocation.key}
                       onChange={e => patchTest(test.id, { idLocation: { kind: 'query', key: e.target.value } })} />
              )}
              {test.idLocation.kind === 'body' && (
                <input className="qa-inp qa-inp--mini" placeholder={t('bola.bodyPath')} value={test.idLocation.path}
                       onChange={e => patchTest(test.id, { idLocation: { kind: 'body', path: e.target.value } })} />
              )}
            </div>

            <div className="qa-bola-ids">
              <span className="qa-bola-ids-label">{t('bola.idValues')}:</span>
              {identities.map(i => (
                <label key={i.id} className="qa-bola-idval">
                  {i.name || i.id}
                  <input className="qa-inp qa-inp--mini" value={(test.idValues || {})[i.id] || ''}
                         onChange={e => setIdValue(test.id, i.id, e.target.value)} />
                </label>
              ))}
            </div>

            {ow.length >= 2 && (
              <table className="qa-bola-grid">
                <thead>
                  <tr>
                    <th>{t('bola.attacker')} ↓ / {t('bola.owner')} →</th>
                    {ow.map(o => <th key={o.id}>{o.name || o.id}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ow.map(a => (
                    <tr key={a.id}>
                      <th>{a.name || a.id}</th>
                      {ow.map(o => {
                        if (a.id === o.id) {
                          const ref = tr.reference[o.id];
                          return <td key={o.id} className="qa-bola-cell qa-bola-cell--ref">{ref ? `${ref.status ?? '—'} ${t('bola.reference')}` : '·'}</td>;
                        }
                        const cell = (tr.attacks[a.id] || {})[o.id];
                        const v = cell && cell.verdict;
                        return (
                          <td key={o.id} className={`qa-bola-cell qa-bola-cell--${v || 'none'} ${cell && cell.severity ? 'qa-sev--' + cell.severity : ''}`}
                              onClick={() => cell && setDrawer({ testId: test.id, attackerId: a.id, ownerId: o.id })}>
                            {cell ? `${cell.status ?? '—'} · ${t(VLABEL[v] || 'bola.verdict.inconclusive')}` : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel qa-bola-findpanel">
          <h3>{t('security.findings.panelTitle')} ({allFindings.length})</h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.sensitive-data') && 'object-authz'}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {drawerCell && (
        <div className="qa-sec-drawer">
          <div className="qa-sec-drawer-head">
            <span>{drawerCell.status ?? '—'}{drawerCell.verdict ? ' · ' + t(VLABEL[drawerCell.verdict] || 'bola.verdict.inconclusive') : ''}</span>
            <button className="qa-iconbtn" onClick={() => setDrawer(null)}><Icon name="x" size={14} /></button>
          </div>
          {drawerCell.request && (
            <>
              <span className="qa-sec-drawer-label">{t('security.cell.request')}</span>
              <div className="qa-sec-drawer-req">
                <div><MethodBadge method={drawerCell.request.method} size="sm" /> <code>{drawerCell.request.path}</code></div>
                <div className="qa-sec-drawer-id">{drawerCell.request.identity} · id={drawerCell.request.idValue}</div>
              </div>
            </>
          )}
          {drawerCell.matched && <div className="qa-sec-drawer-id">{t('bola.matched')}</div>}
          {drawerCell.error && <div className="qa-sec-drawer-err">{drawerCell.error}</div>}
          <span className="qa-sec-drawer-label">{t('security.cell.response')}</span>
          <pre className="qa-sec-drawer-body">{JSON.stringify(drawerCell.response && drawerCell.response.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BolaPanel });
export { BolaPanel };
```

> Note on the summary chip line: `t('bola.verdict.' + k)` is used for `vuln/unconfirmed/pass/inconclusive`; `total` has no such key, so the ternary falls back to the raw key `'total'`. If you prefer, add a `'bola.verdict.total'` key — but the fallback keeps the test green without it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bola-panel.test.jsx`
Expected: PASS (a `.qa-bola-cell--vuln` appears and the findings panel renders).

- [ ] **Step 5: Commit**

```bash
git add src/qa/BolaPanel.jsx src/__tests__/bola-panel.test.jsx
git commit -m "feat(bola): BolaPanel — config, runner, attacker×owner grid, findings"
```

---

## Task 9: Security.jsx — Matrix | Object-access mode toggle

**Files:**
- Modify: `src/qa/Security.jsx`
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to the existing describe block in `src/__tests__/security-page.test.jsx`:

```js
  it('switches to the Object-access (BOLA) mode via the header toggle', async () => {
    renderPage();
    const bolaToggle = screen.getByRole('button', { name: /Object access/i });
    fireEvent.click(bolaToggle);
    await waitFor(() => expect(document.querySelector('.qa-bola')).not.toBeNull());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — no button named "Object access" / `.qa-bola` never renders.

- [ ] **Step 3: Write minimal implementation**

In `src/qa/Security.jsx`:

(a) Add imports near the other qa imports:
```js
import { BolaPanel } from './BolaPanel.jsx';
```

(b) Add `mode` and `bola` state alongside the other `useS` calls (near the `denySet`/`oracleConfig` state):
```js
  const [mode, setMode] = useS('matrix');
  const [bola, setBola] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.bola) || { tests: [] }; });
```

(c) Thread `bola` into the persisted `state` memo so it round-trips (add `bola` to the object passed to `withDefaults` and to the dep array):
```js
  const state = useMemo(() => withDefaults({ identities, endpoints, expect, denySet: denySet.length ? denySet : DEFAULT_DENY_SET, oracleConfig, bola }), [identities, endpoints, expect, denySet, oracleConfig, bola]);
```

(d) Add the mode toggle in the header, right after the opening `<div className="qa-sec-head">`'s title `<div>` block (i.e. inside `qa-sec-actions`, before the run button), OR as its own row. Use this toggle block immediately after `<div className="qa-sec-head">`...title...`</div>` and before `<div className="qa-sec-actions">`:
```jsx
        <div className="qa-sec-modetoggle">
          <button className={`qa-seg ${mode === 'matrix' ? 'qa-seg--on' : ''}`} onClick={() => setMode('matrix')}>{t('security.mode.matrix')}</button>
          <button className={`qa-seg ${mode === 'bola' ? 'qa-seg--on' : ''}`} onClick={() => setMode('bola')}>{t('security.mode.bola')}</button>
        </div>
```

(e) Wrap the existing matrix body (everything from the summary chips down through the grid + modals + drawer) so it only renders in matrix mode, and render `BolaPanel` in bola mode. The simplest correct structure: immediately after the `</div>` that closes `qa-sec-head`, branch:
```jsx
      {mode === 'bola' ? (
        <BolaPanel identities={identities} bola={bola} setBola={setBola}
                   env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
      ) : (
        <>
          {/* existing: qa-sec-summary, qa-sec-findsummary, qa-sec-toolbar, grid, modals, drawer, findpanel */}
        </>
      )}
```
Move the existing matrix JSX (summary through the end of the component's existing body) inside that `<> … </>`. Keep the run button in the header guarded so it only shows in matrix mode:
```jsx
        <div className="qa-sec-actions">
          {mode === 'matrix' && (running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={() => run()} disabled={!endpoints.length}><Icon name="play" size={14} /> {t('security.runAll')}</button>)}
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS (existing matrix tests + the new toggle test all green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): Matrix | Object-access mode toggle hosting BolaPanel"
```

---

## Task 10: CSS — mode toggle + BOLA grid

**Files:**
- Modify: `src/qa/qa.css` (append after the phase-1 findings block)

- [ ] **Step 1: Append the styles**

```css
  /* ── BOLA / object-access mode ──────────────────────────────────────────── */
  .qa-sec-modetoggle { display: inline-flex; gap: 2px; background: var(--surface-2, rgba(127,127,127,.1)); border-radius: 8px; padding: 2px; }
  .qa-seg { border: 0; background: transparent; color: var(--text-dim); font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
  .qa-seg--on { background: var(--surface, #fff); color: var(--text); }
  .qa-bola-test { margin-top: 14px; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .qa-bola-test-head { display: flex; align-items: center; gap: 8px; }
  .qa-bola-test-head code { font-family: var(--font-mono); font-size: 12.5px; }
  .qa-bola-loc, .qa-bola-ids { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; font-size: 12px; }
  .qa-bola-ids-label { color: var(--text-dim); }
  .qa-bola-idval { display: inline-flex; align-items: center; gap: 4px; color: var(--text-dim); }
  .qa-bola-grid { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .qa-bola-grid th, .qa-bola-grid td { border: 1px solid var(--border); padding: 6px 10px; font-size: 12px; text-align: center; }
  .qa-bola-grid th { color: var(--text-dim); font-weight: 600; }
  .qa-bola-cell { cursor: pointer; }
  .qa-bola-cell--ref { color: var(--text-dim); cursor: default; }
  .qa-bola-cell--vuln { background: rgba(220,38,38,.14); color: #dc2626; font-weight: 700; }
  .qa-bola-cell--unconfirmed { background: rgba(217,119,6,.12); color: #d97706; }
  .qa-bola-cell--pass { background: rgba(127,127,127,.06); }
  .qa-bola-cell--inconclusive { color: var(--text-dim); }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/qa/qa.css
git commit -m "style(bola): mode toggle + object-access grid styles"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites PASS (existing + new `bola.test.js`, `bola-panel.test.jsx`, extended `authz`/`sendRequest`/`security-page`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Placeholder scan on new code**

Run: `grep -rn "TODO\|FIXME\|placeholder" src/qa/bola.js src/qa/BolaPanel.jsx`
Expected: no output.

- [ ] **Step 4: Final status**

```bash
git status   # expect clean working tree
git log --oneline master..HEAD | cat
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** id-location model + mutation (T1) ✓ · content confirmation id-echo+overlap (T2) ✓ · verdict table + severity GET=high/mutating=critical/unconfirmed=medium (T3) ✓ · reference+attack run loop, skip-missing-id, abort, ref-not-2xx caps unconfirmed (T4) ✓ · request rewrite via mutate hook (T5) ✓ · persistence under `bola` (T6) ✓ · zh-TW i18n (T7) ✓ · BolaPanel config/runner/grid/drawer/findings, shared identities (T8) ✓ · mode toggle in Security page (T9) ✓ · CSS (T10) ✓.
- **Type consistency:** `idLocation` shape `{kind, index|key|path}` identical across `applyIdLocation` (T1), `runBola`/runner (T4, T8), and the editor (T8). `Finding` shape matches phase 1. `runBola`'s `onCell(testId, attackerId|null, ownerId, cell)` is consumed exactly that way in `BolaPanel` (T8). Result shape `{reference, attacks}` consistent across T4 engine, T8 UI, and `summarizeBola`.
- **Deviation from spec:** none of substance. The aggregated findings panel is rendered inside `BolaPanel` reusing the phase-1 `qa-sec-findpanel`/severity CSS rather than lifting Security.jsx's panel into a shared component (kept simple; same visual language). Auto-discovery, cross-tenant presets, and rate-limit remain roadmap as specified.
- **Canned-path note:** the BOLA wiring test relies on the canned executor returning the same body for every call, so attacker body == owner reference → overlap 1.0 → confirmed vuln. That exercises the full reference→attack→match→finding chain deterministically.
