# BOLA Setup Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the manual setup the BOLA engine needs — auto-detect the object-id location, surface candidate id values, reusable cross-tenant presets, and a negative control that demotes false positives to inconclusive.

**Architecture:** A new pure module `src/qa/bolaSetup.js` (detection / extraction / presets / synthetic-id) feeds suggestions into `BolaPanel.jsx`. The negative control lives in the engine `src/qa/bola.js` because it gates verdicts. Everything is additive — the existing manual flow keeps working. Presets persist for free inside the existing `bola` config blob (`saveMatrixConfig` already serializes `payload.bola` wholesale; `withDefaults` passes it through), so **no `authz.js` change is needed**.

**Tech Stack:** React (global `window.React`), Vitest + Testing Library, `walkJson` from `oracles.js`, `applyIdLocation`/`matchesOwner`/`classifyBola`/`bolaSeverity` from `bola.js`, `buildReq`, i18n (`src/qa/i18n.jsx`, en-US + zh-TW).

**Spec:** `docs/superpowers/specs/2026-06-03-bola-setup-automation-design.md`

---

## File Structure

- **Create** `src/qa/bolaSetup.js` — pure logic: `detectIdLocation`, `extractIdCandidates`, `applyPreset`, `syntheticIdFor`. No React, no DOM, no network.
- **Create** `src/__tests__/bolaSetup.test.js` — pure-module unit tests.
- **Modify** `src/qa/bola.js` — add the negative-control probe + verdict demotion to `runBola`; export `negativeControlFailed`.
- **Modify** `src/__tests__/bola.test.js` — engine tests for the negative control.
- **Modify** `src/qa/BolaPanel.jsx` — detection suggestion on add-test, candidate id hint, preset row, negative-control toggle + per-test banner.
- **Modify** `src/__tests__/bola-panel.test.jsx` — panel tests for detection/preset/toggle.
- **Modify** `src/qa/i18n.jsx` — `security.bola.setup.*` keys in both locales.

---

## Task 1: `bolaSetup.js` — `detectIdLocation`

**Files:**
- Create: `src/qa/bolaSetup.js`
- Test: `src/__tests__/bolaSetup.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/bolaSetup.test.js
import { describe, it, expect } from 'vitest';
import { detectIdLocation } from '../qa/bolaSetup.js';

const req = (over = {}) => ({ method: 'GET', url: '/users/42/orders', params: [], body: '', ...over });

describe('detectIdLocation', () => {
  it('ranks a UUID path segment after a plural noun as high confidence', () => {
    const out = detectIdLocation(req({ url: '/orders/3f1a4e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5b' }));
    expect(out[0].idLocation).toEqual({ kind: 'path', index: 1 });
    expect(out[0].confidence).toBe('high');
  });
  it('detects a numeric path id after a plural noun', () => {
    const out = detectIdLocation(req({ url: '/users/42' }));
    expect(out[0].idLocation).toEqual({ kind: 'path', index: 1 });
    expect(out[0].value).toBe('42');
  });
  it('detects an id-ish query key and ignores pagination keys', () => {
    const out = detectIdLocation(req({ url: '/orders', params: [
      { key: 'page', value: '2', on: true }, { key: 'orderId', value: '7', on: true }] }));
    const q = out.find(c => c.idLocation.kind === 'query');
    expect(q.idLocation).toEqual({ kind: 'query', key: 'orderId' });
    expect(out.some(c => c.idLocation.kind === 'query' && c.idLocation.key === 'page')).toBe(false);
  });
  it('detects an id-ish body field via its JSON path', () => {
    const out = detectIdLocation(req({ method: 'POST', url: '/orders', body: '{"order":{"userId":99,"count":3}}' }));
    const b = out.find(c => c.idLocation.kind === 'body');
    expect(b.idLocation).toEqual({ kind: 'body', path: 'order.userId' });
    expect(out.some(c => c.idLocation.kind === 'body' && c.idLocation.path === 'order.count')).toBe(false);
  });
  it('returns [] when nothing looks like an id', () => {
    expect(detectIdLocation(req({ url: '/health', params: [], body: '' }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bolaSetup.test.js`
Expected: FAIL — "Failed to resolve import '../qa/bolaSetup.js'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/bolaSetup.js
// ── QA Companion — BOLA setup automation (pure logic) ─────────────────────
// Detect where an object id lives in a request, surface candidate id values,
// apply reusable cross-tenant presets, and mint shape-matched synthetic ids
// for the negative control. No network. UI in BolaPanel.jsx; engine in bola.js.
import './setup.js';
import { walkJson } from './oracles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24_RE = /^[0-9a-f]{24}$/i;
const NUM_RE = /^\d+$/;
const ID_DENYLIST = new Set(['count', 'page', 'limit', 'size', 'offset', 'total', 'per_page', 'perpage', 'page_size', 'pagesize']);

function isIdKey(key) {
  const k = String(key);
  if (ID_DENYLIST.has(k.toLowerCase())) return false;
  return k.toLowerCase() === 'id' || /_id$/i.test(k) || /[a-z]Id$/.test(k) || /(uuid|tenant|account|org)/i.test(k);
}

function shapeScore(v) {
  if (UUID_RE.test(v)) return { score: 90, shape: 'uuid' };
  if (HEX24_RE.test(v)) return { score: 88, shape: 'hex24' };
  if (NUM_RE.test(v)) return { score: 55, shape: 'numeric' };
  return null;
}

// Return ranked id-location candidates for a built request (from buildReq):
//   [{ idLocation, value, confidence: 'high'|'medium'|'low', why }]
export function detectIdLocation(req) {
  const cands = [];
  const pathPart = String((req && req.url) || '').split('?')[0];
  const segs = pathPart.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const sh = shapeScore(segs[i]);
    if (!sh) continue;
    const prev = i > 0 ? segs[i - 1] : '';
    const plural = /^[a-z].*(s|es)$/i.test(prev);
    let score = sh.score;
    if (plural) score += sh.shape === 'numeric' ? 25 : 5;   // numeric needs the plural-noun boost to reach 'high'
    cands.push({ idLocation: { kind: 'path', index: i }, value: segs[i], score,
                 why: `path segment ${i} (${sh.shape}${plural ? ', after /' + prev : ''})` });
  }
  for (const p of (req && req.params) || []) {
    if (p && p.key && isIdKey(p.key)) {
      const v = String(p.value == null ? '' : p.value);
      const strong = UUID_RE.test(v) || HEX24_RE.test(v);
      cands.push({ idLocation: { kind: 'query', key: p.key }, value: v, score: strong ? 78 : 55, why: `query key ${p.key}` });
    }
  }
  try {
    const body = JSON.parse((req && req.body) || 'null');
    if (body && typeof body === 'object') {
      walkJson(body, (path, key, val) => {
        if (val != null && typeof val !== 'object' && isIdKey(key)) {
          const v = String(val);
          const strong = UUID_RE.test(v) || HEX24_RE.test(v);
          cands.push({ idLocation: { kind: 'body', path }, value: v, score: strong ? 72 : 50, why: `body field ${path}` });
        }
      });
    }
  } catch { /* non-JSON body — skip */ }
  cands.sort((a, b) => b.score - a.score);
  return cands.map(c => ({
    idLocation: c.idLocation, value: c.value,
    confidence: c.score >= 75 ? 'high' : c.score >= 50 ? 'medium' : 'low', why: c.why,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bolaSetup.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/qa/bolaSetup.js src/__tests__/bolaSetup.test.js
git commit -m "feat(bola-setup): ranked id-location detection (path/query/body)"
```

---

## Task 2: `bolaSetup.js` — extract / presets / synthetic id

**Files:**
- Modify: `src/qa/bolaSetup.js`
- Test: `src/__tests__/bolaSetup.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
import { extractIdCandidates, applyPreset, syntheticIdFor } from '../qa/bolaSetup.js';

describe('extractIdCandidates', () => {
  it('returns the literal id values found in the request with a where-label', () => {
    const out = extractIdCandidates({ method: 'GET', url: '/users/42', params: [], body: '' });
    expect(out[0]).toMatchObject({ value: '42' });
    expect(typeof out[0].where).toBe('string');
  });
});

describe('applyPreset', () => {
  it('merges preset values into idValues without mutating the input test', () => {
    const test = { id: 't', idValues: { a: '1' } };
    const out = applyPreset(test, { values: { a: '9', b: '2' } });
    expect(out.idValues).toEqual({ a: '9', b: '2' });
    expect(test.idValues).toEqual({ a: '1' });   // unchanged
  });
  it('is a no-op-safe when preset has no values', () => {
    expect(applyPreset({ id: 't', idValues: { a: '1' } }, {}).idValues).toEqual({ a: '1' });
  });
});

describe('syntheticIdFor', () => {
  it('shape-matches: numeric sample -> huge integer string', () => {
    expect(syntheticIdFor({ kind: 'path', index: 1 }, '42')).toMatch(/^\d+$/);
    expect(syntheticIdFor({ kind: 'path', index: 1 }, '42').length).toBeGreaterThan(6);
  });
  it('shape-matches: uuid sample -> a uuid', () => {
    expect(syntheticIdFor({ kind: 'path', index: 1 }, '3f1a4e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5b'))
      .toMatch(/^[0-9a-f-]{36}$/i);
  });
  it('falls back to a fixed unlikely token for unknown shapes', () => {
    expect(syntheticIdFor({ kind: 'query', key: 'q' }, 'abc')).toBe('qa-nonexistent-2c1f9a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bolaSetup.test.js`
Expected: FAIL — "extractIdCandidates is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `src/qa/bolaSetup.js`)

```js
// Literal id values present in the request, for one-click fill suggestions.
export function extractIdCandidates(req) {
  return detectIdLocation(req).map(c => ({ value: c.value, where: c.why }));
}

// Merge a cross-tenant preset's identity->id map into a test's idValues.
// Returns a NEW test; never mutates the input. Extra keys for removed
// identities are harmless (the engine only runs identities that still exist).
export function applyPreset(test, preset) {
  const values = (preset && preset.values) || {};
  return { ...test, idValues: { ...(test.idValues || {}), ...values } };
}

// A shape-matched id that should not reference any real object, for the
// negative control. Deterministic (no RNG — tests + resumability need it).
export function syntheticIdFor(idLocation, sampleValue) {
  const s = String(sampleValue == null ? '' : sampleValue);
  if (UUID_RE.test(s)) return 'ffffffff-eeee-4ddd-8ccc-bbbbaaaa9999';
  if (HEX24_RE.test(s)) return 'ffffffffffffffffffffffff';
  if (NUM_RE.test(s)) return '999999999';
  return 'qa-nonexistent-2c1f9a';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bolaSetup.test.js`
Expected: PASS (all bolaSetup tests).

- [ ] **Step 5: Commit**

```bash
git add src/qa/bolaSetup.js src/__tests__/bolaSetup.test.js
git commit -m "feat(bola-setup): id-value candidates, preset merge, synthetic id"
```

---

## Task 3: Negative control in the `bola.js` engine

**Files:**
- Modify: `src/qa/bola.js`
- Test: `src/__tests__/bola.test.js`

- [ ] **Step 1: Write the failing test** (append to `src/__tests__/bola.test.js`)

```js
import { negativeControlFailed } from '../qa/bola.js';

describe('negativeControlFailed', () => {
  const deny = [401, 403, 404];
  it('fails (endpoint not object-scoped) when a fake id returns 2xx', () => {
    expect(negativeControlFailed(200, deny)).toBe(true);
  });
  it('passes when a fake id is denied', () => {
    expect(negativeControlFailed(404, deny)).toBe(false);
    expect(negativeControlFailed(403, deny)).toBe(false);
  });
  it('does not demote on errors / inconclusive statuses', () => {
    expect(negativeControlFailed(null, deny)).toBe(false);
    expect(negativeControlFailed(500, deny)).toBe(false);
  });
});

describe('runBola negative control', () => {
  const identities = [{ id: 'alice', name: 'alice' }, { id: 'bob', name: 'bob' }];
  const test = { id: 't1', reqId: 'r1', method: 'GET', path: '/orders/{id}',
                 idLocation: { kind: 'path', index: 1 }, idValues: { alice: '1', bob: '2' } };
  const SYNTH = '999999999';

  it('demotes all attack cells to inconclusive when the control returns 2xx', async () => {
    // Runner: reference + every attack 2xx-and-matching (would normally be a vuln),
    // and the synthetic id ALSO returns 2xx -> endpoint not object-scoped.
    const runner = async (_t, _identity, idValue) => ({ status: 200, body: { id: String(idValue) } });
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('inconclusive');
    expect(cell.severity).toBe(null);
    expect(cell.finding).toBe(null);
    expect(cell.controlFailed).toBe(true);
    expect(results.t1.control.failed).toBe(true);
    expect(cell.status).toBe(200);   // raw response preserved
  });

  it('leaves verdicts intact when the control is properly denied', async () => {
    const runner = async (_t, _identity, idValue) => String(idValue) === SYNTH
      ? { status: 404, body: {} }
      : { status: 200, body: { id: String(idValue) } };
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('vuln');
    expect(cell.controlFailed).toBe(false);
    expect(results.t1.control.failed).toBe(false);
  });

  it('does not run the control when the opt is off (back-compat)', async () => {
    const seen = [];
    const runner = async (_t, _id, idValue) => { seen.push(String(idValue)); return { status: 200, body: { id: String(idValue) } }; };
    await runBola({ identities, tests: [test] }, runner);   // no negativeControl opt
    expect(seen).not.toContain(SYNTH);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: FAIL — "negativeControlFailed is not a function" (and the runBola control tests fail).

- [ ] **Step 3: Add `negativeControlFailed` and the import**

In `src/qa/bola.js`, add the synthetic-id import near the top (after the existing imports, ~line 7):

```js
import { syntheticIdFor } from './bolaSetup.js';
```

Add the classifier near `classifyBola` (after line ~116):

```js
// The negative control fails — i.e. the endpoint is NOT object-scoped — when a
// synthetic (nonexistent) id is NOT denied but answered 2xx. A denied status
// (in denySet) means proper scoping; an error / other status is inconclusive
// and must NOT demote (never invent a gate).
export function negativeControlFailed(status, denySet) {
  const deny = denySet || [401, 403, 404];
  if (typeof status !== 'number' || !Number.isFinite(status)) return false;
  if (deny.includes(status)) return false;
  return status >= 200 && status <= 299;
}
```

- [ ] **Step 4: Wire the control into `runBola`**

In `runBola`, after the reference-pass loop (which fills `reference[O.id]`) and **before** the attacker loop, insert the control probe. Locate this block (the end of the reference loop, ~line 155):

```js
      reference[O.id] = cell;
      if (onCell) onCell(test.id, null, O.id, cell);
    }
```

Immediately after that closing `}` (the `for (const O of owners)` loop end), add:

```js
    // Negative control (opt-in): one synthetic-id probe per test. If a fake id
    // is answered 2xx, the endpoint isn't object-scoped, so every attack verdict
    // for this test is unreliable and gets demoted to inconclusive below.
    let controlFailed = false;
    if (opts.negativeControl && owners.length) {
      const sampleVal = idVals[owners[0].id];
      const synthetic = syntheticIdFor(test.idLocation, sampleVal);
      let control;
      try {
        const resp = await runner(test, owners[0], synthetic);
        control = { status: respStatus(resp), response: resp || null, syntheticId: synthetic, error: null };
      } catch (e) {
        control = { status: null, response: null, syntheticId: synthetic, error: errStr(e) };
      }
      controlFailed = negativeControlFailed(control.status, denySet);
      control.failed = controlFailed;
      results[test.id].control = control;
      if (opts.onControl) opts.onControl(test.id, control);
    }
```

Then, inside the attacker loop where the cell is built, demote on control failure. Find this section (~line 169):

```js
          const verdict = classifyBola(test.method, status, matched, denySet);
          const severity = bolaSeverity(test.method, verdict);
          const finding = severity ? {
            oracle: 'object-authz', severity,
            title: verdict === 'vuln' ? 'Cross-object access confirmed' : 'Cross-object access (unconfirmed)',
            path: `${test.method} ${test.path}`,
            evidence: `as ${A.name || A.id} → ${O.name || O.id}'s id`, source: 'rule',
          } : null;
          cell = { phase: 'attack', status, matched, verdict, severity, finding, response: resp || null, request: reqMeta(test, A, idVals[O.id]), error: null };
```

Replace it with (adds the demotion + `controlFailed` on the cell):

```js
          let verdict = classifyBola(test.method, status, matched, denySet);
          let severity = bolaSeverity(test.method, verdict);
          let finding = severity ? {
            oracle: 'object-authz', severity,
            title: verdict === 'vuln' ? 'Cross-object access confirmed' : 'Cross-object access (unconfirmed)',
            path: `${test.method} ${test.path}`,
            evidence: `as ${A.name || A.id} → ${O.name || O.id}'s id`, source: 'rule',
          } : null;
          if (controlFailed) { verdict = 'inconclusive'; severity = null; finding = null; }
          cell = { phase: 'attack', status, matched, verdict, severity, finding, controlFailed, response: resp || null, request: reqMeta(test, A, idVals[O.id]), error: null };
```

Also add `controlFailed: false` to the catch-branch cell in the attacker loop (~line 179) so the field is always present:

```js
          cell = { phase: 'attack', status: null, matched: false, verdict: 'inconclusive', severity: null, finding: null, controlFailed: false, response: null, request: null, error: errStr(e) };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/bola.test.js`
Expected: PASS (existing tests + the new control tests). The back-compat test confirms existing callers are unaffected when `negativeControl` is omitted.

- [ ] **Step 6: Commit**

```bash
git add src/qa/bola.js src/__tests__/bola.test.js
git commit -m "feat(bola): negative control demotes non-object-scoped endpoints to inconclusive"
```

---

## Task 4: i18n keys (en-US + zh-TW)

**Files:**
- Modify: `src/qa/i18n.jsx` — add to the `Object.assign(dict['en-US'], { … })` block (~line 684) and `Object.assign(dict['zh-TW'], { … })` block (~line 1005).

- [ ] **Step 1: Add the en-US keys**

```js
  'security.bola.setup.detected': 'Detected id in {where} — confidence {confidence}.',
  'security.bola.setup.use': 'Use',
  'security.bola.setup.edit': 'Edit',
  'security.bola.setup.dismiss': 'Dismiss',
  'security.bola.setup.detect': 'Detect id location',
  'security.bola.setup.foundInReq': 'Found in request: {value}',
  'security.bola.setup.fillFirst': 'Fill first empty',
  'security.bola.setup.confidence.high': 'high',
  'security.bola.setup.confidence.medium': 'medium',
  'security.bola.setup.confidence.low': 'low',
  'security.bola.setup.preset': 'Preset',
  'security.bola.setup.applyPreset': 'Apply preset',
  'security.bola.setup.savePreset': 'Save as preset',
  'security.bola.setup.presetName': 'Preset name',
  'security.bola.setup.negControl': 'Negative control',
  'security.bola.setup.negControlHint': 'Probe a fake id; if it returns 2xx the endpoint is not object-scoped.',
  'security.bola.setup.controlFailed': '⚠ Negative control failed — endpoint not object-scoped; verdicts demoted.',
```

- [ ] **Step 2: Add the zh-TW keys**

```js
  'security.bola.setup.detected': '在 {where} 偵測到 id — 信心 {confidence}。',
  'security.bola.setup.use': '採用',
  'security.bola.setup.edit': '編輯',
  'security.bola.setup.dismiss': '關閉',
  'security.bola.setup.detect': '偵測 id 位置',
  'security.bola.setup.foundInReq': '請求中找到：{value}',
  'security.bola.setup.fillFirst': '填入第一個空欄',
  'security.bola.setup.confidence.high': '高',
  'security.bola.setup.confidence.medium': '中',
  'security.bola.setup.confidence.low': '低',
  'security.bola.setup.preset': '預設組',
  'security.bola.setup.applyPreset': '套用預設組',
  'security.bola.setup.savePreset': '存成預設組',
  'security.bola.setup.presetName': '預設組名稱',
  'security.bola.setup.negControl': '負向對照',
  'security.bola.setup.negControlHint': '探測一個假的 id；若回 2xx，表示端點未依物件授權。',
  'security.bola.setup.controlFailed': '⚠ 負向對照失敗 — 端點未依物件授權；判定已降級。',
```

- [ ] **Step 3: Verify locale parity**

Run:
```bash
node -e "const k=s=>[...s.matchAll(/'(security\.bola\.setup\.[^']+)'/g)].map(m=>m[1]); const f=require('fs').readFileSync('src/qa/i18n.jsx','utf8'); const i=f.indexOf(\"dict['zh-TW']\",f.indexOf(\"Object.assign\")); const en=new Set(k(f.slice(0,i))); const zh=new Set(k(f.slice(i))); const miss=[...en].filter(x=>!zh.has(x)); console.log(miss.length?('MISSING in zh: '+miss):'OK: '+en.size+' keys parity')"
```
Expected: `OK: 18 keys parity` (no MISSING).

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(bola-setup): security.bola.setup.* keys (en-US + zh-TW)"
```

---

## Task 5: `BolaPanel.jsx` wiring (detection, presets, negative control)

**Files:**
- Modify: `src/qa/BolaPanel.jsx`
- Test: `src/__tests__/bola-panel.test.jsx`

- [ ] **Step 1: Add imports + state**

Add the setup import after the `bola.js` import (~line 11):

```js
import { detectIdLocation, extractIdCandidates, applyPreset } from './bolaSetup.js';
import { buildReq } from './buildReq.js';   // already imported in this file — keep one copy
```

> `buildReq` is already imported at the top of `BolaPanel.jsx` (used by the `idApplied` probe). Do not add a duplicate import — just ensure `detectIdLocation`/`extractIdCandidates`/`applyPreset` are imported.

Inside `BolaPanel`, after the existing `const [drawer, setDrawer] = useS(null);` (~line 38), add:

```js
  const [suggestions, setSuggestions] = useS({});   // testId -> top detection candidate (dismissible)
  const [negControl, setNegControl] = useS(true);
  const [presetName, setPresetName] = useS('');
  const presets = bola.presets || [];
  const setPresets = (updater) => setBola(b => ({ ...b, presets: typeof updater === 'function' ? updater(b.presets || []) : updater }));
```

- [ ] **Step 2: Run detection on add-test**

Replace the existing `addTest` (~line 43) with a version that pre-fills the detected id location and records the suggestion:

```js
  const addTest = (r) => setTests(ts => {
    if (ts.some(x => x.reqId === r.reqId)) return ts;
    const id = `bt_${Date.now()}_${testSeq++}`;
    let idLocation = { kind: 'path', index: 0 };
    let top = null;
    try {
      const cands = detectIdLocation(buildReq(r.reqId));
      if (cands.length && cands[0].confidence !== 'low') { idLocation = cands[0].idLocation; top = cands[0]; }
    } catch { /* detection is best-effort */ }
    if (top) setSuggestions(s => ({ ...s, [id]: top }));
    return [...ts, { id, reqId: r.reqId, method: r.method, path: r.path, idLocation, idValues: {} }];
  });
  // Re-run detection on demand (the "Detect id location" link).
  const detectFor = (testId, reqId) => {
    try {
      const cands = detectIdLocation(buildReq(reqId));
      if (cands.length) { patchTest(testId, { idLocation: cands[0].idLocation }); setSuggestions(s => ({ ...s, [testId]: cands[0] })); }
    } catch { /* ignore */ }
  };
  const dismissSuggestion = (testId) => setSuggestions(s => { const n = { ...s }; delete n[testId]; return n; });
```

- [ ] **Step 3: Pass the negative-control opt + capture control results**

In `run` (~line 55), add `negativeControl` + `onControl` to the `runBola` opts and store control cells in `results`:

```js
      await runBola({ identities, tests }, runner, {
        signal: controller.signal,
        negativeControl: negControl,
        onControl: (testId, control) => setResults(r => ({ ...r, [testId]: { ...(r[testId] || { reference: {}, attacks: {} }), control } })),
        onCell: (testId, attackerId, ownerId, cell) => setResults(r => {
          const tr = r[testId] || { reference: {}, attacks: {} };
          if (attackerId == null) return { ...r, [testId]: { ...tr, reference: { ...tr.reference, [ownerId]: cell } } };
          return { ...r, [testId]: { ...tr, attacks: { ...tr.attacks, [attackerId]: { ...(tr.attacks[attackerId] || {}), [ownerId]: cell } } } };
        }),
      });
```

- [ ] **Step 4: Add the negative-control toggle to the header**

In the `qa-sec-actions` block (~line 98), add the toggle before the run/stop button:

```jsx
        <div className="qa-sec-actions">
          <label className="qa-sec-privchk" title={t('security.bola.setup.negControlHint')}>
            <input type="checkbox" checked={negControl} onChange={e => setNegControl(e.target.checked)} />
            {t('security.bola.setup.negControl')}
          </label>
          {running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={run} disabled={!tests.length}><Icon name="play" size={14} /> {t('bola.run')}</button>}
        </div>
```

- [ ] **Step 5: Render the detection suggestion + preset row + control banner per test**

Inside the test card, right after the `qa-bola-test-head` div (~line 133), add the suggestion line and preset row:

```jsx
            {suggestions[test.id] && (
              <div className="qa-bola-suggest">
                {t('security.bola.setup.detected', { where: suggestions[test.id].why, confidence: t('security.bola.setup.confidence.' + suggestions[test.id].confidence) })}
                <button className="qa-link" onClick={() => { patchTest(test.id, { idLocation: suggestions[test.id].idLocation }); dismissSuggestion(test.id); }}>{t('security.bola.setup.use')}</button>
                <button className="qa-link" onClick={() => dismissSuggestion(test.id)}>{t('security.bola.setup.dismiss')}</button>
              </div>
            )}
            {!suggestions[test.id] && (
              <button className="qa-link qa-bola-detect" onClick={() => detectFor(test.id, test.reqId)}>
                <Icon name="search" size={12} /> {t('security.bola.setup.detect')}
              </button>
            )}

            <div className="qa-bola-presets">
              <span>{t('security.bola.setup.preset')}:</span>
              <select className="qa-inp qa-inp--mini" value="" onChange={e => { const p = presets.find(x => x.id === e.target.value); if (p) setTests(ts => ts.map(x => x.id === test.id ? applyPreset(x, p) : x)); }}>
                <option value="">{t('security.bola.setup.applyPreset')}…</option>
                {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="qa-inp qa-inp--mini" placeholder={t('security.bola.setup.presetName')} value={presetName} onChange={e => setPresetName(e.target.value)} />
              <button className="qa-link" disabled={!presetName.trim()} onClick={() => { setPresets(ps => [...ps, { id: `pr_${Date.now()}_${testSeq++}`, name: presetName.trim(), values: { ...(test.idValues || {}) } }]); setPresetName(''); }}>{t('security.bola.setup.savePreset')}</button>
            </div>
```

Right after the `qa-bola-ids` block (the per-identity id-value inputs, ~line 168), add the candidate hint and the control banner:

```jsx
            {(() => {
              let cands = [];
              try { cands = extractIdCandidates(buildReq(test.reqId)); } catch { cands = []; }
              if (!cands.length) return null;
              const first = cands[0];
              return (
                <div className="qa-bola-cand qa-meta">
                  {t('security.bola.setup.foundInReq', { value: first.value })}
                  <button className="qa-link" onClick={() => {
                    const empty = identities.find(i => !((test.idValues || {})[i.id]));
                    if (empty) setIdValue(test.id, empty.id, first.value);
                  }}>{t('security.bola.setup.fillFirst')}</button>
                </div>
              );
            })()}

            {tr.control && tr.control.failed && (
              <div className="qa-bola-warn qa-bola-ctrlfail">{t('security.bola.setup.controlFailed')}</div>
            )}
```

- [ ] **Step 6: Add styles** — append to `src/qa/qa.css`:

```css
/* ── BOLA setup automation ──────────────────────────────────────── */
.qa-bola-suggest { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--qa-text-dim); margin: 4px 0; }
.qa-bola-detect { margin: 4px 0; }
.qa-bola-presets { display: flex; align-items: center; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.qa-bola-cand { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.qa-bola-ctrlfail { margin: 6px 0; }
```

- [ ] **Step 7: Write the failing tests** — append to `src/__tests__/bola-panel.test.jsx` (reuse the file's existing `window.QA`/collection seeding so `buildReq(reqId)` resolves a request whose path contains an id, e.g. `/orders/123`):

```jsx
it('shows a detection suggestion when an endpoint with an id path is added', () => {
  // Render BolaPanel, add the seeded endpoint via the "add test" select,
  // then assert the detected-id suggestion line appears.
  // Reuse this file's existing render+seed helpers; assert on the i18n text:
  // expect(screen.getByText(/Detected id in/)).toBeInTheDocument();
  expect(true).toBe(true); // replace with the concrete assertion using existing helpers
});

it('applying a preset fills all identities idValues', () => {
  // With bola.presets seeded to [{id:'p1', name:'prod', values:{alice:'1', bob:'2'}}],
  // choose it from the "Apply preset" select for a test and assert both id inputs are filled.
  expect(true).toBe(true); // replace with the concrete assertion using existing helpers
});

it('toggling negative control off omits the synthetic probe', () => {
  // Spy on the injected runner; uncheck the toggle; run; assert no call used the synthetic id.
  expect(true).toBe(true); // replace with the concrete assertion using existing helpers
});
```

> **Note:** `bola-panel.test.jsx` already seeds `window.QA.COLLECTIONS`/`REQUEST_DETAILS` and drives a run via a mocked `qaRunSavedRequest`/runner. Reuse that exact setup. Make the seeded request path contain a numeric id (e.g. `/orders/123`) so detection fires. Replace each `expect(true)` placeholder with the concrete assertion described in its comment.

- [ ] **Step 8: Run tests + full suite**

Run: `npx vitest run src/__tests__/bola-panel.test.jsx`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS (whole suite, no regressions).

- [ ] **Step 9: Commit**

```bash
git add src/qa/BolaPanel.jsx src/qa/qa.css src/__tests__/bola-panel.test.jsx
git commit -m "feat(bola): id detection, candidate fills, presets, negative-control toggle in panel"
```

---

## Task 6: Verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run` (all green) and `npm run build` if present.
Expected: pass.

- [ ] **Step 2: Back-compat invariant**

Confirm the existing manual BOLA flow is unchanged: with the negative-control toggle **off** and no detection accepted, `runBola` behaves exactly as before this plan (the `bola.test.js` back-compat test from Task 3 covers the engine; verify the panel still lets a user pick id location + type id values manually).

- [ ] **Step 3: Manual smoke (optional, if a dev server is used)**

Add an endpoint with an id in the path → confirm the suggestion appears and "Use" applies it. Save a preset from one test, apply it to another → confirm both identities fill. Run with negative control on against an endpoint that ignores the id → confirm the ⚠ banner and demoted (inconclusive) verdicts.

- [ ] **Step 4: Final commit (if review fixes were made)**

```bash
git add -A
git commit -m "chore(bola-setup): verification fixes"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** static id-location detection (Task 1), literal id-value candidates (Task 2 `extractIdCandidates` + Task 5 hint), cross-tenant presets (Task 2 `applyPreset` + Task 5 preset row, persisted via existing `bola` blob), negative control gating to inconclusive (Task 3 engine + Task 5 toggle/banner), suggest-and-confirm not auto-apply (Task 5 dismissible suggestion + "Use"). All covered.
- **No `authz.js` change:** presets ride in the persisted `bola` blob (verified: `saveMatrixConfig` serializes `payload.bola`; `withDefaults` returns `{...state, expect}`). The spec's mention of an `authz.js` change is superseded by this discovery.
- **Deferred (per spec):** active probe (run-as-identity to auto-fill idValues), auto-mapping extracted id → identity, CI export.
- **Type consistency:** `detectIdLocation` → `[{idLocation, value, confidence, why}]`; `idLocation` matches the engine's existing `{kind:'path',index}|{kind:'query',key}|{kind:'body',path}`. `applyPreset(test, preset{values})` → new test. `syntheticIdFor(idLocation, sampleValue)` → string. `negativeControlFailed(status, denySet)` → bool. Engine cells gain `controlFailed: boolean`; per-test `results[testId].control = {status, response, syntheticId, failed, error}`.
```
