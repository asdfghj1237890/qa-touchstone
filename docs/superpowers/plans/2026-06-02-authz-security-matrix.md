# Authz / Security Test Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new **Security** page that runs an identity × endpoint RBAC matrix — sending each saved request once per identity with that identity's auth, classifying the real response as allow/deny, and rendering a pass/fail/vuln grid.

**Architecture:** A pure, unit-tested engine (`src/qa/authz.js`) holds all matrix logic (outcome/verdict classification, smart defaults, bulk-fill, run loop, persistence). A React page (`src/qa/Security.jsx`) drives it, reusing the existing executor bridge via `qaRunSavedRequest` (extended with an auth override) and the existing auth UI (extracted from `RequestBuilder.jsx` into a shared `AuthEditor.jsx`). A new `security` route + nav item make it reachable.

**Tech Stack:** React 18 (no JSX transform surprises — bare identifiers need ESM imports per this codebase's `window`-mirror convention), Vite, Vitest + @testing-library/react, the app's `window.QA*` globals and `executor.js`/`buildReq.js`/`sendRequest.js` bridge.

**Reference spec:** `docs/superpowers/specs/2026-06-02-authz-security-matrix-design.md`

**Working directory note:** This project's git repo is the `qa-companion/` directory. All paths below are relative to it. Run all `npm`/`git` commands from inside `qa-companion/`. Work happens on branch `feat/authz-security-matrix` (already created; the spec is already committed there).

---

## File Structure

**Created:**
- `src/qa/authz.js` — pure matrix engine + persistence. No React.
- `src/qa/AuthEditor.jsx` — shared auth UI extracted from RequestBuilder (AuthEditor, OAuth2Editor, AUTH_TYPES, OAUTH_GRANTS).
- `src/qa/Security.jsx` — the Security page.
- `src/__tests__/authz.test.js` — unit tests for the engine.
- `src/__tests__/security-page.test.jsx` — component smoke test (canned path).

**Modified:**
- `src/qa/components.jsx` — add shared `FieldRow` + `SecretInput` atoms (moved from RequestBuilder so AuthEditor.jsx and RequestBuilder can both use them).
- `src/qa/RequestBuilder.jsx` — import `AuthEditor`/`AUTH_TYPES`/`OAUTH_GRANTS` from `AuthEditor.jsx` and `FieldRow`/`SecretInput` from `components.jsx`; delete the local copies.
- `src/qa/sendRequest.js` — accept `ctx.authOverride` in `qaRunSavedRequest`.
- `src/App.jsx` — register the `security` route and render `<SecurityPage/>`.
- `src/qa/Sidebar.jsx` — add the `security` nav-rail item (shield icon).
- `src/qa/i18n.jsx` — add `route.security` + `security.*` keys for `en-US` and `zh-TW`.
- `src/qa/qa.css` — grid + page styles.

---

## Task 1: Extend `qaRunSavedRequest` with an auth override

The matrix sends the same saved request under different identities. The cleanest reuse is to let the existing shared runner accept an auth override, so cookie/var/env resolution is not duplicated.

**Files:**
- Modify: `src/qa/sendRequest.js`
- Test: `src/__tests__/sendRequest.test.js`

- [ ] **Step 1: Read the existing test to match its style and mocks**

Run: `sed -n '1,60p' src/__tests__/sendRequest.test.js`
Note how it seeds `window.QA.COLLECTIONS`/`REQUEST_DETAILS`/`RESPONSES` and asserts on the canned response.

- [ ] **Step 2: Write a failing test for the auth override**

Add to `src/__tests__/sendRequest.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { qaRunSavedRequest } from '../qa/sendRequest.js';
import { buildReq } from '../qa/buildReq.js';

describe('qaRunSavedRequest — authOverride', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'bearer' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 2, body: { ok: true }, headers: {} } };
  });

  it('overrides req.auth before sending without throwing', async () => {
    const resp = await qaRunSavedRequest(
      { id: 'r1' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, authOverride: { type: 'none' } },
    );
    expect(resp.status).toBe(200);
  });

  it('defaults to the saved request auth when no override is given', () => {
    const req = buildReq('r1');
    expect(req.auth.type).toBe('bearer');
  });
});
```

- [ ] **Step 3: Run it and confirm the override test fails**

Run: `npx vitest run src/__tests__/sendRequest.test.js -t "overrides req.auth"`
Expected: FAIL (the override is ignored today; the assertion may pass by luck on the canned path — if so, the real signal is Step 5's implementation making the override actually apply). If it already passes, still implement Step 4 so the override is honored deliberately.

- [ ] **Step 4: Implement the override in `qaRunSavedRequest`**

In `src/qa/sendRequest.js`, change the destructuring and the `req` construction:

```js
export async function qaRunSavedRequest(reqMeta, ctx = {}) {
  const { env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true, oauthToken, collectionId, localVars = {}, authOverride } = ctx;
  const req = buildReq(reqMeta.id);
  if (authOverride) req.auth = authOverride;
  const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label, collectionId, localVars);
  // ...unchanged below...
```

(Leave the rest of the function exactly as-is.)

- [ ] **Step 5: Run the full sendRequest suite**

Run: `npx vitest run src/__tests__/sendRequest.test.js`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/qa/sendRequest.js src/__tests__/sendRequest.test.js
git commit -m "feat(security): let qaRunSavedRequest take an auth override"
```

---

## Task 2: Engine — outcome & verdict classification (TDD)

**Files:**
- Create: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write failing tests for classification**

Create `src/__tests__/authz.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { classifyOutcome, verdictFor, DEFAULT_DENY_SET } from '../qa/authz.js';

describe('classifyOutcome', () => {
  it('2xx is allowed', () => {
    expect(classifyOutcome(200)).toBe('allowed');
    expect(classifyOutcome(204)).toBe('allowed');
  });
  it('denySet members are denied (default 401/403)', () => {
    expect(classifyOutcome(401)).toBe('denied');
    expect(classifyOutcome(403)).toBe('denied');
  });
  it('honors a custom denySet (e.g. 404 hides a resource)', () => {
    expect(classifyOutcome(404, [401, 403, 404])).toBe('denied');
    expect(classifyOutcome(404)).toBe('other');
  });
  it('everything else is other, incl. null/NaN (transport error)', () => {
    expect(classifyOutcome(500)).toBe('other');
    expect(classifyOutcome(302)).toBe('other');
    expect(classifyOutcome(null)).toBe('other');
    expect(classifyOutcome(undefined)).toBe('other');
  });
  it('exposes the default deny set', () => {
    expect(DEFAULT_DENY_SET).toEqual([401, 403]);
  });
});

describe('verdictFor', () => {
  it('allow + allowed = pass; allow + denied = fail', () => {
    expect(verdictFor('allow', 'allowed')).toBe('pass');
    expect(verdictFor('allow', 'denied')).toBe('fail');
  });
  it('deny + denied = pass; deny + allowed = vuln', () => {
    expect(verdictFor('deny', 'denied')).toBe('pass');
    expect(verdictFor('deny', 'allowed')).toBe('vuln');
  });
  it('any other outcome = inconclusive', () => {
    expect(verdictFor('allow', 'other')).toBe('inconclusive');
    expect(verdictFor('deny', 'other')).toBe('inconclusive');
  });
  it('skip = null (not run)', () => {
    expect(verdictFor('skip', 'allowed')).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL with "Failed to resolve import '../qa/authz.js'".

- [ ] **Step 3: Implement classification in `authz.js`**

Create `src/qa/authz.js`:

```js
// ── QA Companion — RBAC security matrix engine (pure logic, no React) ──────
// Identity × endpoint authorization testing: classify a real HTTP response as
// allowed/denied, compare it against a per-cell expectation, and produce a
// pass/fail/vuln verdict. UI lives in Security.jsx; this file is unit-tested.
import './setup.js';

export const SECURITY_STORAGE_KEY = 'qa_security_matrix';
export const DEFAULT_DENY_SET = [401, 403];

// Map a real HTTP status to an authorization outcome.
export function classifyOutcome(status, denySet = DEFAULT_DENY_SET) {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'other';
  if (status >= 200 && status <= 299) return 'allowed';
  if ((denySet || DEFAULT_DENY_SET).includes(status)) return 'denied';
  return 'other';
}

// Compare an expectation against an outcome. `deny` that comes back `allowed`
// is the access-control hole we flag as a vulnerability.
export function verdictFor(expectation, outcome) {
  if (expectation === 'skip') return null;
  if (outcome === 'other') return 'inconclusive';
  if (expectation === 'allow') return outcome === 'allowed' ? 'pass' : 'fail';
  return outcome === 'denied' ? 'pass' : 'vuln';   // expectation === 'deny'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): add outcome/verdict classification engine"
```

---

## Task 3: Engine — identities, smart defaults & bulk-fill (TDD)

**Files:**
- Modify: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/authz.test.js`:

```js
import { anonIdentity, defaultExpectation, withDefaults, setColumn, setRow } from '../qa/authz.js';

const idAnon = anonIdentity();
const idAdmin = { id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } };
const ep1 = { reqId: 'r1', method: 'GET', path: '/a' };
const ep2 = { reqId: 'r2', method: 'POST', path: '/b' };
const baseState = { identities: [idAnon, idAdmin], endpoints: [ep1, ep2], expect: {}, denySet: [401, 403] };

describe('anonIdentity', () => {
  it('is a non-empty identity with auth type none', () => {
    expect(idAnon.id).toBe('anon');
    expect(idAnon.auth.type).toBe('none');
  });
});

describe('defaultExpectation', () => {
  it('anon defaults to deny, named identities to allow', () => {
    expect(defaultExpectation(idAnon)).toBe('deny');
    expect(defaultExpectation(idAdmin)).toBe('allow');
  });
});

describe('withDefaults', () => {
  it('fills every (endpoint,identity) cell using smart defaults, preserving overrides', () => {
    const state = withDefaults({ ...baseState, expect: { r1: { admin: 'deny' } } });
    expect(state.expect.r1.anon).toBe('deny');   // smart default
    expect(state.expect.r1.admin).toBe('deny');  // preserved override
    expect(state.expect.r2.admin).toBe('allow'); // smart default
    expect(state.expect.r2.anon).toBe('deny');
  });
});

describe('setColumn / setRow', () => {
  it('setColumn sets one identity across all endpoints', () => {
    const state = setColumn(withDefaults(baseState), 'admin', 'deny');
    expect(state.expect.r1.admin).toBe('deny');
    expect(state.expect.r2.admin).toBe('deny');
    expect(state.expect.r1.anon).toBe('deny');   // untouched
  });
  it('setRow sets one endpoint across all identities', () => {
    const state = setRow(withDefaults(baseState), 'r1', 'skip');
    expect(state.expect.r1.admin).toBe('skip');
    expect(state.expect.r1.anon).toBe('skip');
    expect(state.expect.r2.admin).toBe('allow'); // untouched
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/authz.test.js -t "withDefaults"`
Expected: FAIL ("anonIdentity is not a function" / import errors).

- [ ] **Step 3: Implement in `authz.js`**

Append to `src/qa/authz.js`:

```js
// Built-in unauthenticated identity. Seeded into every matrix; not deletable.
export function anonIdentity() {
  return { id: 'anon', name: 'anon', auth: { type: 'none' } };
}

// Smart default expectation for an identity: anonymous → deny, otherwise allow.
export function defaultExpectation(identity) {
  return identity && identity.auth && identity.auth.type === 'none' ? 'deny' : 'allow';
}

// Return a copy of state whose expect map has an entry for every
// (endpoint, identity) pair, filling missing cells with smart defaults and
// preserving any existing user override.
export function withDefaults(state) {
  const expect = {};
  for (const ep of state.endpoints) {
    const prev = (state.expect && state.expect[ep.reqId]) || {};
    const row = {};
    for (const id of state.identities) {
      row[id.id] = prev[id.id] || defaultExpectation(id);
    }
    expect[ep.reqId] = row;
  }
  return { ...state, expect };
}

// Bulk-set one identity column across all endpoints.
export function setColumn(state, identityId, expectation) {
  const expect = {};
  for (const ep of state.endpoints) {
    expect[ep.reqId] = { ...(state.expect[ep.reqId] || {}), [identityId]: expectation };
  }
  return { ...state, expect };
}

// Bulk-set one endpoint row across all identities.
export function setRow(state, reqId, expectation) {
  const row = {};
  for (const id of state.identities) row[id.id] = expectation;
  return { ...state, expect: { ...state.expect, [reqId]: row } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): add identities, smart defaults, and bulk-fill"
```

---

## Task 4: Engine — `runMatrix` + `summarize` (TDD)

**Files:**
- Modify: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/authz.test.js`:

```js
import { runMatrix, summarize } from '../qa/authz.js';

describe('runMatrix', () => {
  const state = withDefaults({
    identities: [anonIdentity(), { id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } }],
    endpoints: [{ reqId: 'r1', method: 'GET', path: '/a' }],
    expect: { r1: { anon: 'deny', admin: 'allow' } },
    denySet: [401, 403],
  });

  it('classifies each cell from the injected runner', async () => {
    // anon → 401 (denied, expected deny → pass); admin → 200 (allowed, expected allow → pass)
    const runner = (ep, id) => Promise.resolve({ status: id.id === 'anon' ? 401 : 200, time: 5 });
    const seen = [];
    const results = await runMatrix(state, runner, { onCell: (rid, iid, cell) => seen.push([rid, iid, cell.verdict]) });
    expect(results.r1.anon.verdict).toBe('pass');
    expect(results.r1.admin.verdict).toBe('pass');
    expect(seen.length).toBe(2);  // onCell streamed both
  });

  it('flags deny-expected-but-allowed as vuln', async () => {
    const runner = () => Promise.resolve({ status: 200, time: 1 });
    const results = await runMatrix(state, runner, {});
    expect(results.r1.anon.verdict).toBe('vuln');
  });

  it('skips cells whose expectation is skip', async () => {
    const skipState = setRow(state, 'r1', 'skip');
    let calls = 0;
    await runMatrix(skipState, () => { calls++; return Promise.resolve({ status: 200 }); }, {});
    expect(calls).toBe(0);
  });

  it('records a runner throw as inconclusive with an error', async () => {
    const runner = () => Promise.reject(new Error('boom'));
    const results = await runMatrix(state, runner, {});
    expect(results.r1.admin.verdict).toBe('inconclusive');
    expect(results.r1.admin.error).toMatch(/boom/);
  });

  it('stops early when the abort signal is set', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await runMatrix(state, () => { calls++; return Promise.resolve({ status: 200 }); }, { signal: controller.signal });
    expect(calls).toBe(0);
  });
});

describe('summarize', () => {
  it('tallies verdicts across the results grid', () => {
    const results = {
      r1: { anon: { verdict: 'pass' }, admin: { verdict: 'vuln' } },
      r2: { anon: { verdict: 'fail' }, admin: { verdict: 'inconclusive' } },
    };
    expect(summarize(results)).toEqual({ total: 4, pass: 1, fail: 1, vuln: 1, inconclusive: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/authz.test.js -t "runMatrix"`
Expected: FAIL ("runMatrix is not a function").

- [ ] **Step 3: Implement in `authz.js`**

Append to `src/qa/authz.js`:

```js
// Run the matrix. `runner(endpoint, identity) => Promise<response>` is injected
// so tests can stub it and the page can plug in the real executor. Streams each
// finished cell via opts.onCell(reqId, identityId, cell). Honors opts.signal.
export async function runMatrix(state, runner, opts = {}) {
  const { signal, onCell } = opts;
  const denySet = state.denySet || DEFAULT_DENY_SET;
  const results = {};
  for (const ep of state.endpoints) {
    results[ep.reqId] = results[ep.reqId] || {};
    for (const id of state.identities) {
      if (signal && signal.aborted) return results;
      const expectation = (state.expect[ep.reqId] || {})[id.id] || defaultExpectation(id);
      if (expectation === 'skip') continue;
      let cell;
      try {
        const resp = await runner(ep, id);
        const status = resp && typeof resp.status === 'number' ? resp.status : null;
        const outcome = classifyOutcome(status, denySet);
        cell = { status, outcome, verdict: verdictFor(expectation, outcome), timeMs: (resp && resp.time) || 0, response: resp || null, error: null };
      } catch (e) {
        cell = { status: null, outcome: 'other', verdict: 'inconclusive', timeMs: 0, response: null, error: String((e && e.message) || e) };
      }
      results[ep.reqId][id.id] = cell;
      if (onCell) onCell(ep.reqId, id.id, cell);
    }
  }
  return results;
}

// Tally verdicts across a results grid for the summary chips.
export function summarize(results) {
  const s = { total: 0, pass: 0, fail: 0, vuln: 0, inconclusive: 0 };
  for (const reqId in results) {
    for (const idId in results[reqId]) {
      const v = results[reqId][idId] && results[reqId][idId].verdict;
      if (!v) continue;
      s.total++;
      if (s[v] !== undefined) s[v]++;
    }
  }
  return s;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): add runMatrix executor loop and summarize"
```

---

## Task 5: Engine — persistence (TDD)

**Files:**
- Modify: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/authz.test.js`:

```js
import { loadMatrixConfig, saveMatrixConfig, SECURITY_STORAGE_KEY } from '../qa/authz.js';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

describe('persistence', () => {
  it('round-trips config only (no results)', () => {
    installLocalStorage();
    const state = {
      identities: [anonIdentity()], endpoints: [{ reqId: 'r1', method: 'GET', path: '/a' }],
      expect: { r1: { anon: 'deny' } }, denySet: [401, 403],
      results: { r1: { anon: { verdict: 'pass' } } },  // must NOT be persisted
    };
    saveMatrixConfig(state);
    const raw = JSON.parse(localStorage.getItem(SECURITY_STORAGE_KEY));
    expect(raw.results).toBeUndefined();
    const loaded = loadMatrixConfig();
    expect(loaded.expect.r1.anon).toBe('deny');
    expect(loaded.identities[0].id).toBe('anon');
  });
  it('returns null when nothing is stored or JSON is corrupt', () => {
    installLocalStorage();
    expect(loadMatrixConfig()).toBe(null);
    localStorage.setItem(SECURITY_STORAGE_KEY, '{not json');
    expect(loadMatrixConfig()).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/authz.test.js -t "persistence"`
Expected: FAIL ("loadMatrixConfig is not a function").

- [ ] **Step 3: Implement in `authz.js`**

Append to `src/qa/authz.js`:

```js
// Load persisted matrix CONFIG (identities/endpoints/expect/denySet). Results
// are transient and never persisted. Returns null on miss or corrupt data.
export function loadMatrixConfig() {
  try {
    const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
  } catch { return null; }
}

export function saveMatrixConfig(state) {
  try {
    const { identities = [], endpoints = [], expect = {}, denySet = DEFAULT_DENY_SET } = state || {};
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify({ identities, endpoints, expect, denySet }));
  } catch { /* storage unavailable — non-fatal */ }
}
```

- [ ] **Step 4: Run to verify pass + full engine suite**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): persist matrix config to localStorage"
```

---

## Task 6: Extract shared auth UI into `AuthEditor.jsx`

The Security identity editor reuses the app's auth UI. Today `AuthEditor` is an internal component of `RequestBuilder.jsx`. Move the generic primitives to `components.jsx` and the auth-specific UI to a new `AuthEditor.jsx`. **Behavior must not change** — this is a pure move + re-import.

**Files:**
- Modify: `src/qa/components.jsx` (add `FieldRow`, `SecretInput`)
- Create: `src/qa/AuthEditor.jsx` (move `AUTH_TYPES`, `OAUTH_GRANTS`, `OAuth2Editor`, `AuthEditor`)
- Modify: `src/qa/RequestBuilder.jsx` (delete the moved code, import it instead)
- Test: existing `src/__tests__/request-builder-options.test.jsx` guards regressions.

- [ ] **Step 1: Add `FieldRow` + `SecretInput` to `components.jsx`**

Open `src/qa/RequestBuilder.jsx`, copy the exact current bodies of `FieldRow` and `SecretInput` (around lines 62–87). Paste them into `src/qa/components.jsx` near the other atoms. `SecretInput` uses `useI18n` and `React.useState` — `components.jsx` already imports React and useI18n (verify with `grep -n "useI18n\|useState\|^import" src/qa/components.jsx`); add the import if missing. Add both names to the file's `Object.assign(window, { ... })` mirror and its `export { ... }` list.

- [ ] **Step 2: Create `src/qa/AuthEditor.jsx`**

Move `AUTH_TYPES`, `OAUTH_GRANTS`, `OAuth2Editor`, and `AuthEditor` here verbatim from RequestBuilder. Header:

```jsx
import React from 'react';
import './setup.js';
import { Dropdown, Icon, Spinner, FieldRow, SecretInput } from './components.jsx';
import { useI18n } from './useI18n.js';

const { useState: useStateAE } = React;
```

Then paste `AUTH_TYPES`, `OAUTH_GRANTS`, `OAuth2Editor`, `AuthEditor` exactly as they are in RequestBuilder, but:
- Rename the local `useStateRB` references inside `OAuth2Editor` to `useStateAE` (it uses `useStateRB` for `busy`/`error`/grant state).
- `AuthEditor` references `window.QA.CRED_PROFILES` for the AWS branch — leave as-is (it reads the window global, no import needed).

End the file with:

```jsx
Object.assign(window, { AuthEditor, OAuth2Editor });
export { AuthEditor, OAuth2Editor, AUTH_TYPES, OAUTH_GRANTS };
```

- [ ] **Step 3: Update `RequestBuilder.jsx` to import instead of define**

- Delete the now-moved definitions (`FieldRow`, `SecretInput`, `AUTH_TYPES`, `OAUTH_GRANTS`, `OAuth2Editor`, `AuthEditor`) from `RequestBuilder.jsx`.
- Update its imports:

```jsx
import { Dropdown, Icon, MiniCheck, Spinner, FieldRow, SecretInput } from './components.jsx';
import { AuthEditor, AUTH_TYPES } from './AuthEditor.jsx';
```

(`KVTable` and `VarHint` stay in RequestBuilder — they are not auth UI. If `KVTable`/other code referenced `FieldRow`/`SecretInput`, they now come from the import. `AUTH_TYPES` import is only needed if RequestBuilder still references it directly; if not, drop it.)

- [ ] **Step 4: Build to catch import/identifier errors**

Run: `npx vite build`
Expected: builds with no "is not defined" / unresolved-import errors.

- [ ] **Step 5: Run RequestBuilder + app tests to confirm no regression**

Run: `npx vitest run src/__tests__/request-builder-options.test.jsx src/__tests__/App.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/qa/components.jsx src/qa/AuthEditor.jsx src/qa/RequestBuilder.jsx
git commit -m "refactor(security): extract shared AuthEditor + FieldRow/SecretInput"
```

---

## Task 7: i18n keys for the Security page

Add all strings up front so the UI tasks can reference them. The app fails loudly on missing keys in dev, so define both locales.

**Files:**
- Modify: `src/qa/i18n.jsx`

- [ ] **Step 1: Add `en-US` keys**

In the `'en-US'` block of `dict`, near the other `route.*` keys add `'route.security': 'Security',`. Then, near the end of the `en-US` block, add:

```js
    'security.title': 'Security Matrix',
    'security.subtitle': 'Run an RBAC matrix — each endpoint, once per identity.',
    'security.identities': 'Identities',
    'security.addIdentity': 'Add identity',
    'security.identityName': 'Name',
    'security.anon': 'anon',
    'security.endpoints': 'Endpoints',
    'security.addEndpoints': 'Add endpoints',
    'security.pickEndpoints': 'Pick saved requests',
    'security.noEndpoints': 'No endpoints yet — add saved requests to build the matrix.',
    'security.noIdentities': 'Add at least one identity (anon is built in).',
    'security.expect.allow': 'allow',
    'security.expect.deny': 'deny',
    'security.expect.skip': 'skip',
    'security.runAll': 'Run all',
    'security.runRow': 'Run row',
    'security.stop': 'Stop',
    'security.running': 'Running…',
    'security.denySet': 'Deny statuses',
    'security.denySetHint': 'Comma-separated statuses treated as a denial (default 401, 403).',
    'security.col.bulk': 'Set whole column',
    'security.row.bulk': 'Set whole row',
    'security.verdict.pass': 'pass',
    'security.verdict.fail': 'fail',
    'security.verdict.vuln': 'VULN',
    'security.verdict.inconclusive': 'check',
    'security.summary.total': 'Total',
    'security.summary.pass': 'Pass',
    'security.summary.fail': 'Fail',
    'security.summary.vuln': 'Vulnerabilities',
    'security.summary.inconclusive': 'Inconclusive',
    'security.cell.expected': 'Expected',
    'security.cell.actual': 'Actual',
    'security.cell.request': 'Request',
    'security.cell.response': 'Response',
    'security.cell.notRun': 'not run',
    'security.removeIdentity': 'Remove identity',
    'security.removeEndpoint': 'Remove endpoint',
```

- [ ] **Step 2: Add the matching `zh-TW` keys**

In the `'zh-TW'` block add `'route.security': '安全',` near the other routes, then:

```js
    'security.title': '安全矩陣',
    'security.subtitle': '執行 RBAC 矩陣 — 每個端點，逐一身分各跑一次。',
    'security.identities': '身分',
    'security.addIdentity': '新增身分',
    'security.identityName': '名稱',
    'security.anon': '匿名',
    'security.endpoints': '端點',
    'security.addEndpoints': '加入端點',
    'security.pickEndpoints': '挑選已儲存的請求',
    'security.noEndpoints': '尚無端點 — 加入已儲存的請求以建立矩陣。',
    'security.noIdentities': '請至少新增一個身分（匿名為內建）。',
    'security.expect.allow': '允許',
    'security.expect.deny': '拒絕',
    'security.expect.skip': '略過',
    'security.runAll': '全部執行',
    'security.runRow': '執行此列',
    'security.stop': '停止',
    'security.running': '執行中…',
    'security.denySet': '拒絕狀態碼',
    'security.denySetHint': '以逗號分隔、視為拒絕的狀態碼（預設 401、403）。',
    'security.col.bulk': '整欄設定',
    'security.row.bulk': '整列設定',
    'security.verdict.pass': '通過',
    'security.verdict.fail': '失敗',
    'security.verdict.vuln': '漏洞',
    'security.verdict.inconclusive': '待查',
    'security.summary.total': '總計',
    'security.summary.pass': '通過',
    'security.summary.fail': '失敗',
    'security.summary.vuln': '漏洞',
    'security.summary.inconclusive': '待查',
    'security.cell.expected': '預期',
    'security.cell.actual': '實際',
    'security.cell.request': '請求',
    'security.cell.response': '回應',
    'security.cell.notRun': '未執行',
    'security.removeIdentity': '移除身分',
    'security.removeEndpoint': '移除端點',
```

- [ ] **Step 3: Build to confirm the dict still parses**

Run: `npx vite build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "feat(security): add i18n keys (en-US + zh-TW)"
```

---

## Task 8: Register the `security` route + nav item (stub page)

Make the page reachable before fleshing it out, so dev/test can navigate to it.

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/qa/Sidebar.jsx`
- Create: `src/qa/Security.jsx` (minimal stub for now)

- [ ] **Step 1: Create a minimal `Security.jsx` stub**

```jsx
import React from 'react';
import './setup.js';
import { useI18n } from './useI18n.js';

function SecurityPage() {
  const { t } = useI18n();
  return <div className="qa-sec"><h2>{t('security.title')}</h2><p>{t('security.subtitle')}</p></div>;
}

Object.assign(window, { SecurityPage });
export { SecurityPage };
```

- [ ] **Step 2: Wire the route in `App.jsx`**

- Add the import near the other page imports (after the `Runner` import):

```jsx
import { SecurityPage } from './qa/Security.jsx';
```

- Add `security: 'route.security'` to the `ROUTE_KEYS` map.
- In the route render block (next to `{route === 'runner' && ...}`) add:

```jsx
          {route === 'security' && <SecurityPage env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} oauthTokens={oauthTokens} setOauthTokens={setOauthTokens} />}
```

(Confirm `setOauthTokens` exists in App's state — `grep -n "setOauthTokens\|oauthTokens" src/App.jsx`. It does; it's the setter paired with `oauthTokens`.)

- [ ] **Step 3: Add the nav-rail item in `Sidebar.jsx`**

In `NavRail`'s items array, add after the `runner` entry:

```jsx
    { key: 'security', icon: 'shield', label: t('route.security') },
```

- [ ] **Step 4: Build + verify navigation in the App test**

Run: `npx vite build`
Expected: success.

Run: `npx vitest run src/__tests__/App.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/qa/Sidebar.jsx src/qa/Security.jsx
git commit -m "feat(security): register Security route and nav item"
```

---

## Task 9: Build the Security page

Replace the stub with the full page: identity manager (reusing `AuthEditor`), endpoint picker, expectations grid with bulk-fill + smart defaults, execution (run all / run row / stop), summary chips, and a cell-detail drawer. Persists config on change.

**Files:**
- Modify: `src/qa/Security.jsx`
- Modify: `src/qa/qa.css`

- [ ] **Step 1: Write the full `Security.jsx`**

Replace the file contents with:

```jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge, Spinner, Dropdown } from './components.jsx';
import { AuthEditor } from './AuthEditor.jsx';
import { useI18n } from './useI18n.js';
import { qaRunSavedRequest } from './sendRequest.js';
import { buildOAuthTokenRequest, exchangeOAuthTokenWithFetch, parseOAuthTokenResponse } from './oauth.js';
import {
  anonIdentity, withDefaults, setColumn, setRow, runMatrix, summarize,
  loadMatrixConfig, saveMatrixConfig, DEFAULT_DENY_SET,
} from './authz.js';

const { useState: useS, useEffect: useE, useMemo, useRef } = React;
const EXPECTS = ['allow', 'deny', 'skip'];
const VERDICT_LABEL = { pass: 'security.verdict.pass', fail: 'security.verdict.fail', vuln: 'security.verdict.vuln', inconclusive: 'security.verdict.inconclusive' };

// Build the EMPTY auth shape AuthEditor expects (mirrors buildReq.EMPTY_REQ.auth).
function blankAuth() {
  return {
    type: 'none', bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', code: '', redirectUri: '', username: '', password: '' },
  };
}

let idSeq = 1;
function newIdentity() { return { id: `id_${Date.now()}_${idSeq++}`, name: '', auth: blankAuth() }; }

// All saved requests, folder-grouped, for the endpoint picker.
function allRequests() {
  return (window.QA.COLLECTIONS || []).flatMap(c =>
    (c.folders || []).flatMap(f => (f.requests || []).map(r => ({ reqId: r.id, method: r.method, path: r.path, name: r.name, folder: f.name }))));
}

function IdentityEditor({ identity, onChange, onClose, env, vars, sslVerify }) {
  const { t } = useI18n();
  // AuthEditor reads req.auth and calls patch({auth}); adapt to our identity shape.
  const fakeReq = { auth: identity.auth };
  const patch = ({ auth }) => onChange({ ...identity, auth });
  const fetchOAuth = async () => {
    const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label);
    const tokenRequest = buildOAuthTokenRequest(identity.auth.oauth2 || {}, map);
    const token = await exchangeOAuthTokenWithFetch(tokenRequest).catch(async () => {
      // Tauri path not available in this editor context; fall back to fetch helper above.
      return null;
    });
    if (token) onChange({ ...identity, _oauthToken: token });
  };
  return (
    <div className="qa-sec-idedit">
      <input className="qa-inp" placeholder={t('security.identityName')} value={identity.name}
             onChange={e => onChange({ ...identity, name: e.target.value })} />
      <AuthEditor req={fakeReq} patch={patch} oauthToken={identity._oauthToken} onFetchOAuth={fetchOAuth} />
      <button className="qa-link" onClick={onClose}><Icon name="check" size={13} /> {t('common.done') || 'Done'}</button>
    </div>
  );
}

function EndpointPicker({ existing, onAdd, onClose }) {
  const { t } = useI18n();
  const reqs = allRequests();
  const have = new Set(existing.map(e => e.reqId));
  return (
    <div className="qa-sec-picker">
      <div className="qa-sec-picker-head">{t('security.pickEndpoints')}<button className="qa-iconbtn" onClick={onClose}><Icon name="x" size={13} /></button></div>
      <div className="qa-sec-picker-list">
        {reqs.length === 0 && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}
        {reqs.map(r => (
          <button key={r.reqId} className="qa-sec-picker-row" disabled={have.has(r.reqId)}
                  onClick={() => onAdd({ reqId: r.reqId, method: r.method, path: r.path })}>
            <MethodBadge method={r.method} size="sm" /> <code>{r.path}</code>
            {have.has(r.reqId) && <Icon name="check" size={12} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function SecurityPage({ env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
  const { t } = useI18n();
  const [identities, setIdentities] = useS(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.identities && cfg.identities.length) ? cfg.identities : [anonIdentity()];
  });
  const [endpoints, setEndpoints] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.endpoints) || []; });
  const [expect, setExpect] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.expect) || {}; });
  const [denySet, setDenySet] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.denySet) || DEFAULT_DENY_SET; });
  const [results, setResults] = useS({});
  const [running, setRunning] = useS(false);
  const [editId, setEditId] = useS(null);
  const [picking, setPicking] = useS(false);
  const [drawer, setDrawer] = useS(null);   // { reqId, idId }
  const abortRef = useRef(null);

  // Normalize expectations to fill defaults for the current identities×endpoints.
  const state = useMemo(() => withDefaults({ identities, endpoints, expect, denySet }), [identities, endpoints, expect, denySet]);

  // Persist config (not results) whenever it changes.
  useE(() => { saveMatrixConfig(state); }, [state]);

  const summary = useMemo(() => summarize(results), [results]);

  const cycleCell = (reqId, idId) => {
    const cur = state.expect[reqId][idId];
    const next = EXPECTS[(EXPECTS.indexOf(cur) + 1) % EXPECTS.length];
    setExpect(e => ({ ...e, [reqId]: { ...(state.expect[reqId]), [idId]: next } }));
  };
  const bulkCol = (idId, val) => setExpect(setColumn(state, idId, val).expect);
  const bulkRow = (reqId, val) => setExpect(setRow(state, reqId, val).expect);

  const addIdentity = () => { const id = newIdentity(); setIdentities(xs => [...xs, id]); setEditId(id.id); };
  const removeIdentity = (id) => { if (id === 'anon') return; setIdentities(xs => xs.filter(x => x.id !== id)); };
  const removeEndpoint = (reqId) => setEndpoints(xs => xs.filter(x => x.reqId !== reqId));

  const runner = (ep, identity) => qaRunSavedRequest({ id: ep.reqId }, {
    env, vars, cookies, sslVerify, authOverride: identity.auth, oauthToken: identity._oauthToken,
  });

  const run = async (rowReqId = null) => {
    const target = rowReqId ? { ...state, endpoints: state.endpoints.filter(e => e.reqId === rowReqId) } : state;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    const partial = rowReqId ? { ...results } : {};
    setResults(partial);
    await runMatrix(target, runner, {
      signal: controller.signal,
      onCell: (reqId, idId, cell) => setResults(r => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: cell } })),
    });
    setRunning(false);
  };
  const stop = () => { if (abortRef.current) abortRef.current.abort(); setRunning(false); };

  const editing = identities.find(i => i.id === editId);
  const drawerCell = drawer && results[drawer.reqId] && results[drawer.reqId][drawer.idId];

  return (
    <div className="qa-sec">
      <div className="qa-sec-head">
        <div><h2>{t('security.title')}</h2><p>{t('security.subtitle')}</p></div>
        <div className="qa-sec-actions">
          {running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={() => run()} disabled={!endpoints.length}><Icon name="play" size={14} /> {t('security.runAll')}</button>}
        </div>
      </div>

      <div className="qa-sec-summary">
        {['total', 'pass', 'fail', 'vuln', 'inconclusive'].map(k => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>{summary[k] || 0} {t('security.summary.' + k)}</span>
        ))}
      </div>

      <div className="qa-sec-toolbar">
        <button className="qa-link" onClick={addIdentity}><Icon name="plus" size={13} /> {t('security.addIdentity')}</button>
        <button className="qa-link" onClick={() => setPicking(true)}><Icon name="plus" size={13} /> {t('security.addEndpoints')}</button>
        <label className="qa-sec-deny">
          {t('security.denySet')}:
          <input className="qa-inp qa-inp--mini" value={denySet.join(', ')}
                 onChange={e => setDenySet(e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite))} />
        </label>
      </div>

      {!endpoints.length && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}

      {endpoints.length > 0 && (
        <div className="qa-sec-gridwrap">
          <table className="qa-sec-grid">
            <thead>
              <tr>
                <th className="qa-sec-corner">{t('security.endpoints')}</th>
                {identities.map(id => (
                  <th key={id.id} className="qa-sec-colhead">
                    <button className="qa-sec-colname" onClick={() => setEditId(id.id)} title={id.auth.type}>
                      {id.id === 'anon' ? t('security.anon') : (id.name || id.id)} <span className="qa-sec-authtype">{id.auth.type}</span>
                    </button>
                    <div className="qa-sec-bulk">
                      {EXPECTS.map(v => <button key={v} onClick={() => bulkCol(id.id, v)} title={t('security.col.bulk')}>{t('security.expect.' + v)[0]}</button>)}
                      {id.id !== 'anon' && <button className="qa-sec-x" onClick={() => removeIdentity(id.id)} title={t('security.removeIdentity')}><Icon name="x" size={11} /></button>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {endpoints.map(ep => (
                <tr key={ep.reqId}>
                  <th className="qa-sec-rowhead">
                    <span><MethodBadge method={ep.method} size="sm" /> <code>{ep.path}</code></span>
                    <span className="qa-sec-rowtools">
                      <button onClick={() => run(ep.reqId)} disabled={running} title={t('security.runRow')}><Icon name="play" size={11} /></button>
                      {EXPECTS.map(v => <button key={v} onClick={() => bulkRow(ep.reqId, v)} title={t('security.row.bulk')}>{t('security.expect.' + v)[0]}</button>)}
                      <button className="qa-sec-x" onClick={() => removeEndpoint(ep.reqId)} title={t('security.removeEndpoint')}><Icon name="x" size={11} /></button>
                    </span>
                  </th>
                  {identities.map(id => {
                    const exp = state.expect[ep.reqId][id.id];
                    const cell = results[ep.reqId] && results[ep.reqId][id.id];
                    const v = cell && cell.verdict;
                    return (
                      <td key={id.id} className={`qa-sec-cell qa-sec-cell--${v || 'none'}`}
                          data-expect={exp}
                          onClick={() => (cell ? setDrawer({ reqId: ep.reqId, idId: id.id }) : cycleCell(ep.reqId, id.id))}>
                        <span className="qa-sec-exp" onClick={(e) => { e.stopPropagation(); cycleCell(ep.reqId, id.id); }}>{t('security.expect.' + exp)}</span>
                        {cell && <span className="qa-sec-verdict">{cell.status ?? '—'} · {t(VERDICT_LABEL[v] || 'security.cell.notRun')}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="qa-sec-modal" onClick={() => setEditId(null)}>
          <div className="qa-sec-modal-body" onClick={e => e.stopPropagation()}>
            <IdentityEditor identity={editing} env={env} vars={vars} sslVerify={sslVerify}
                            onChange={(nx) => setIdentities(xs => xs.map(x => x.id === nx.id ? nx : x))}
                            onClose={() => setEditId(null)} />
          </div>
        </div>
      )}

      {picking && (
        <div className="qa-sec-modal" onClick={() => setPicking(false)}>
          <div className="qa-sec-modal-body" onClick={e => e.stopPropagation()}>
            <EndpointPicker existing={endpoints} onClose={() => setPicking(false)}
                            onAdd={(ep) => setEndpoints(xs => xs.some(x => x.reqId === ep.reqId) ? xs : [...xs, ep])} />
          </div>
        </div>
      )}

      {drawerCell && (
        <div className="qa-sec-drawer">
          <div className="qa-sec-drawer-head">
            {t('security.cell.response')} · {drawerCell.status ?? '—'} · {t(VERDICT_LABEL[drawerCell.verdict] || 'security.cell.notRun')}
            <button className="qa-iconbtn" onClick={() => setDrawer(null)}><Icon name="x" size={14} /></button>
          </div>
          {drawerCell.error && <div className="qa-sec-drawer-err">{drawerCell.error}</div>}
          <pre className="qa-sec-drawer-body">{JSON.stringify(drawerCell.response && drawerCell.response.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { SecurityPage });
export { SecurityPage };
```

- [ ] **Step 2: Add styles to `qa.css`**

Append a `qa-sec*` block (grid table, colored cells per verdict, chips, modal/drawer). Match existing tokens (`oklch` accents already used in TestGen's `TYPE_CHIP`). Minimum required classes: `.qa-sec`, `.qa-sec-head`, `.qa-sec-summary`, `.qa-sec-chip` (+ `--total/--pass/--fail/--vuln/--inconclusive`), `.qa-sec-toolbar`, `.qa-sec-grid` (table), `.qa-sec-cell` (+ `--pass`green/`--fail`amber/`--vuln`red/`--inconclusive`yellow/`--none`neutral), `.qa-sec-colhead/.qa-sec-rowhead/.qa-sec-bulk`, `.qa-sec-modal/.qa-sec-modal-body`, `.qa-sec-drawer`, `.qa-sec-empty`, `.qa-inp--mini`, `.qa-btn--danger`. Reuse existing `.qa-btn`, `.qa-link`, `.qa-inp`, `.qa-iconbtn`, `.qa-segs` where present (grep `qa.css` to confirm names before inventing new ones).

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: success, no unresolved imports. (`common.done` may be undefined — the code falls back to `'Done'`; optionally add `common.done` to i18n.)

- [ ] **Step 4: Commit**

```bash
git add src/qa/Security.jsx src/qa/qa.css
git commit -m "feat(security): build the RBAC matrix page (grid, run, drawer)"
```

---

## Task 10: Component smoke test (canned path)

**Files:**
- Create: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityPage } from '../qa/Security.jsx';
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

function renderPage() {
  return render(
    <I18nProvider>
      <SecurityPage env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('SecurityPage — matrix runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });   // start with a clean, seeded matrix
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 4, body: { ok: true }, headers: {} } };
  });

  it('adds an endpoint and runs the anon row, surfacing a verdict', async () => {
    renderPage();
    // Open the endpoint picker and add r1.
    fireEvent.click(screen.getByText('Add endpoints'));
    fireEvent.click(await screen.findByText('https://api.test/thing'));
    // Close picker (click its X) — the row should now be in the grid.
    fireEvent.click(screen.getByText('Security Matrix'));   // click elsewhere is fine; grid renders regardless
    // Run all (canned r1 → 200; anon expected deny → vuln).
    await waitFor(() => expect(screen.getByRole('button', { name: /Run all/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Run all/ }));
    await waitFor(() => expect(screen.getByText(/VULN/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
```

> Note for the implementer: the picker may render inside a modal; if the "Add endpoints" / path text isn't found, adjust the queries to match the actual rendered text (the canned `path` is `https://api.test/thing`). The assertion that matters: after Run all, a `VULN` verdict appears (anon hitting a 200 it should be denied).

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS. If the modal/picker query needs tweaking, fix the selectors (not the component) until it passes deterministically.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/security-page.test.jsx
git commit -m "test(security): smoke-test the matrix page on the canned path"
```

---

## Task 11: Full verification & branch wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — all prior suites plus `authz.test.js` and `security-page.test.jsx`. Confirm no regressions in RequestBuilder/App from the AuthEditor extraction.

- [ ] **Step 2: Production build**

Run: `npx vite build`
Expected: success, no warnings about unresolved imports or undefined identifiers.

- [ ] **Step 3: Manual smoke (optional, if a dev server is available)**

Run: `npx vite` then open the app, click the shield nav item, add an identity + endpoints, set expectations, and Run all. Confirm the grid fills and a `deny→200` cell shows VULN.

- [ ] **Step 4: Verify the working tree is clean and review the diff**

Run: `git status` and `git log --oneline feat/authz-security-matrix ^master`
Expected: a clean tree and the sequence of feature commits.

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge / PR / cleanup.

---

## Self-Review

**Spec coverage:**
- Identities (Security-managed, name + auth, built-in anon) → Tasks 3 (`anonIdentity`), 9 (`IdentityEditor`, reuses extracted AuthEditor from Task 6). ✓
- Endpoints from existing collections → Task 9 (`EndpointPicker` reads `window.QA.COLLECTIONS`). ✓
- Per-cell expectations + column/row bulk-fill + smart defaults → Tasks 3 (`withDefaults`/`setColumn`/`setRow`) + 9 (`cycleCell`/`bulkCol`/`bulkRow`). ✓
- Classification engine (outcome + verdict table incl. `deny→allowed=vuln`) → Task 2. ✓
- Configurable denySet (default 401/403) → Tasks 2 (`DEFAULT_DENY_SET`), 9 (deny-set input). ✓
- Execution via existing executor bridge, abortable, progressive fill → Tasks 1 (authOverride), 4 (`runMatrix`), 9 (`run`/`stop`). ✓
- Grid UI + summary chips + cell drawer → Task 9. ✓
- Persistence of config only (not results) → Task 5 + Task 9 (`useEffect` save). ✓
- i18n zh-TW + en-US → Task 7. ✓
- Unit tests + component smoke test → Tasks 2–5, 10. ✓
- AuthEditor extraction (targeted refactor) → Task 6. ✓
- Route + nav (shield) → Task 8. ✓
- Forward hook for CI export (serializable results) → satisfied by the plain-object `CellResult`/results shape in Task 4 (no extra work). ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The one soft spot — exact `qa.css` rules — lists the required class names and styling intent rather than inventing brittle pixel values; this is appropriate for CSS that must match an existing design system (grep before adding). ✓

**Type consistency:** `CellResult` fields (`status/outcome/verdict/timeMs/response/error`) are produced in `runMatrix` (Task 4) and consumed in the grid + drawer (Task 9). `state` shape (`identities/endpoints/expect/denySet`) is consistent across `withDefaults`/`setColumn`/`setRow`/`runMatrix`/`saveMatrixConfig` and the page. `qaRunSavedRequest(reqMeta, ctx)` with `ctx.authOverride`/`ctx.oauthToken` matches Task 1. Verdict keys (`pass/fail/vuln/inconclusive`) align between `verdictFor`, `summarize`, `VERDICT_LABEL`, the summary chips, and the cell classNames. ✓
