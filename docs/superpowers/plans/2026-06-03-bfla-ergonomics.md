# BFLA Ergonomics — Auto-flag Privileged Endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-classify privileged (admin / mutating) endpoints in the RBAC matrix and, via a per-identity privileged flag, default non-privileged identities to `deny` on them — so the BFLA-relevant cells are pre-set correctly, with a per-endpoint manual override.

**Architecture:** Pure heuristic + endpoint-aware default logic added to the matrix engine `src/qa/authz.js` (`classifyEndpoint`, `endpointPrivileged`, an endpoint-aware `defaultExpectation`), surfaced in `src/qa/Security.jsx` as a per-row privileged badge/toggle, a count, and a per-identity "privileged/admin" checkbox. No new finding type; `withDefaults` still preserves existing cells.

**Tech Stack:** React, Vitest + @testing-library/react, flat per-locale i18n in `i18n.jsx`.

**Spec:** `docs/superpowers/specs/2026-06-03-bfla-ergonomics-design.md`

---

## File Structure

- **Modify** `src/qa/authz.js` — add `MUTATING_METHODS`, `ADMIN_PATH_TOKENS`, `classifyEndpoint`, `endpointPrivileged`; make `defaultExpectation` endpoint-aware; pass `ep` in `withDefaults` + `runMatrix`; persist `identity.privileged`.
- **Modify** `src/__tests__/authz.test.js` — fix the shared fixture (`ep2` → GET) + add classifier/override/default/persistence tests.
- **Modify** `src/qa/Security.jsx` — endpoint-row privileged badge + override toggle, privileged count in the toolbar, `IdentityEditor` privileged checkbox.
- **Modify** `src/__tests__/security-page.test.jsx` — badge renders + non-privileged identity defaults to `deny` on a privileged endpoint.
- **Modify** `src/qa/i18n.jsx` — `security.priv.*` keys (en-US + zh-TW).
- **Modify** `src/qa/qa.css` — badge/toggle/count styles.

Test command: `npx vitest run <file>`. Build: `npm run build`.

---

## Task 1: authz.js — `classifyEndpoint` + constants

**Files:**
- Modify: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/authz.test.js
import { classifyEndpoint, MUTATING_METHODS, ADMIN_PATH_TOKENS } from '../qa/authz.js';

describe('classifyEndpoint', () => {
  it('flags mutating methods as write', () => {
    expect(classifyEndpoint('POST', '/orders').reasons).toContain('write');
    expect(classifyEndpoint('delete', '/orders/1').reasons).toContain('write'); // case-insensitive
    expect(classifyEndpoint('GET', '/orders').privileged).toBe(false);
  });
  it('flags admin-ish path tokens (discrete tokens only)', () => {
    expect(classifyEndpoint('GET', '/admin/users').reasons).toContain('admin-path');
    expect(classifyEndpoint('GET', '/v1.internal.metrics').reasons).toContain('admin-path');
    expect(classifyEndpoint('GET', '/badminton/list').privileged).toBe(false); // not a substring match
  });
  it('can flag both reasons', () => {
    expect(classifyEndpoint('DELETE', '/admin/users/1')).toEqual({ privileged: true, reasons: ['write', 'admin-path'] });
  });
  it('tolerates null/empty input', () => {
    expect(classifyEndpoint(null, null)).toEqual({ privileged: false, reasons: [] });
    expect(classifyEndpoint('', '')).toEqual({ privileged: false, reasons: [] });
  });
  it('exposes the heuristic constants', () => {
    expect(MUTATING_METHODS).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
    expect(ADMIN_PATH_TOKENS).toContain('admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — `classifyEndpoint is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/qa/authz.js` (after `DEFAULT_DENY_SET`):

```js
// Endpoints that are high-value for BFLA testing: a mutating method, or an
// admin-ish path token. Used to set smarter default expectations.
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
export const ADMIN_PATH_TOKENS = ['admin', 'internal', 'manage', 'management', 'root', 'sudo', 'privileged', 'superuser'];

// Heuristically classify an endpoint as privileged. Pure; tolerant of empties.
export function classifyEndpoint(method, path) {
  const reasons = [];
  if (MUTATING_METHODS.includes(String(method || '').toUpperCase())) reasons.push('write');
  const tokens = String(path || '').toLowerCase().split(/[/._\-?=&]+/).filter(Boolean);
  if (tokens.some((tok) => ADMIN_PATH_TOKENS.includes(tok))) reasons.push('admin-path');
  return { privileged: reasons.length > 0, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): classifyEndpoint privileged heuristic"
```

---

## Task 2: authz.js — `endpointPrivileged` (override > heuristic)

**Files:**
- Modify: `src/qa/authz.js`
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/authz.test.js
import { endpointPrivileged } from '../qa/authz.js';

describe('endpointPrivileged', () => {
  it('uses the heuristic when there is no manual override', () => {
    expect(endpointPrivileged({ method: 'POST', path: '/orders' })).toEqual({ privileged: true, reasons: ['write'], source: 'auto' });
    expect(endpointPrivileged({ method: 'GET', path: '/orders' })).toEqual({ privileged: false, reasons: [], source: 'auto' });
  });
  it('honors a manual override either way', () => {
    expect(endpointPrivileged({ method: 'GET', path: '/orders', privileged: true })).toEqual({ privileged: true, reasons: ['manual'], source: 'manual' });
    expect(endpointPrivileged({ method: 'POST', path: '/orders', privileged: false })).toEqual({ privileged: false, reasons: ['manual'], source: 'manual' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — `endpointPrivileged is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/qa/authz.js` (after `classifyEndpoint`):

```js
// Effective privileged state for an endpoint: a manual boolean override wins,
// otherwise fall back to the heuristic. Only `ep.privileged` is persisted.
export function endpointPrivileged(ep) {
  if (ep && typeof ep.privileged === 'boolean') {
    return { privileged: ep.privileged, reasons: ['manual'], source: 'manual' };
  }
  return { ...classifyEndpoint(ep && ep.method, ep && ep.path), source: 'auto' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): endpointPrivileged with manual override"
```

---

## Task 3: authz.js — endpoint-aware `defaultExpectation` + `withDefaults` + `runMatrix`

**Files:**
- Modify: `src/qa/authz.js:36-38` (`defaultExpectation`), `:49` (`withDefaults`), `:83` (`runMatrix`)
- Test: `src/__tests__/authz.test.js` (fix the shared fixture + add tests)

- [ ] **Step 1: Fix the shared fixture, then write the failing tests**

First, in `src/__tests__/authz.test.js`, change the shared fixture so the existing column/row/withDefaults mechanics tests don't entangle the new privileged-default behavior. Find:
```js
const ep2 = { reqId: 'r2', method: 'POST', path: '/b' };
```
and change the method to GET:
```js
const ep2 = { reqId: 'r2', method: 'GET', path: '/b' };
```
(Rationale: `POST /b` would now be privileged, flipping the admin identity's default on r2 from `allow` to `deny` and breaking the `withDefaults` / `setRow` assertions that assert `r2.admin === 'allow'`. Making it GET keeps those tests about column/row mechanics; the new behavior gets its own tests below.)

Then append the new endpoint-aware tests:
```js
// append to src/__tests__/authz.test.js
const privEp = { reqId: 'p1', method: 'DELETE', path: '/admin/users/1' };
const normEp = { reqId: 'n1', method: 'GET', path: '/profile' };
const userId = { id: 'u', name: 'user', auth: { type: 'bearer' } };          // non-privileged
const adminPriv = { id: 'a', name: 'admin', auth: { type: 'bearer' }, privileged: true };

describe('defaultExpectation — endpoint-aware', () => {
  it('one-arg call keeps legacy behavior', () => {
    expect(defaultExpectation(anonIdentity())).toBe('deny');
    expect(defaultExpectation(userId)).toBe('allow');
  });
  it('anon is deny regardless of endpoint', () => {
    expect(defaultExpectation(anonIdentity(), privEp)).toBe('deny');
    expect(defaultExpectation(anonIdentity(), normEp)).toBe('deny');
  });
  it('privileged endpoint defaults a non-privileged identity to deny', () => {
    expect(defaultExpectation(userId, privEp)).toBe('deny');
  });
  it('privileged identity stays allow on a privileged endpoint', () => {
    expect(defaultExpectation(adminPriv, privEp)).toBe('allow');
  });
  it('non-privileged endpoint defaults a normal identity to allow', () => {
    expect(defaultExpectation(userId, normEp)).toBe('allow');
  });
});

describe('withDefaults — privileged endpoints', () => {
  it('defaults a non-privileged identity to deny on a privileged endpoint (new cell), preserving overrides', () => {
    const state = withDefaults({ identities: [anonIdentity(), userId, adminPriv], endpoints: [privEp], expect: { p1: { u: 'allow' } }, denySet: [401, 403] });
    expect(state.expect.p1.anon).toBe('deny');   // anon
    expect(state.expect.p1.u).toBe('allow');     // preserved override
    expect(state.expect.p1.a).toBe('allow');     // privileged identity
    const fresh = withDefaults({ identities: [userId], endpoints: [privEp], expect: {}, denySet: [401, 403] });
    expect(fresh.expect.p1.u).toBe('deny');      // smart default for a new cell
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — the new `defaultExpectation`/`withDefaults` privileged tests fail (current `defaultExpectation` ignores the endpoint). The pre-existing tests should PASS again after the `ep2`→GET fixture fix.

- [ ] **Step 3: Write minimal implementation**

In `src/qa/authz.js`, replace `defaultExpectation` (lines 35-38):

```js
// Smart default expectation. anon → deny. A privileged endpoint defaults a
// non-privileged identity to deny (the BFLA setup). `endpoint` is optional, so
// one-arg callers keep the legacy anon-only behavior.
export function defaultExpectation(identity, endpoint) {
  if (identity && identity.auth && identity.auth.type === 'none') return 'deny';
  if (endpoint && endpointPrivileged(endpoint).privileged && !(identity && identity.privileged)) return 'deny';
  return 'allow';
}
```

In `withDefaults`, pass the endpoint (line ~49):
```js
      row[id.id] = prev[id.id] ?? defaultExpectation(id, ep);
```

In `runMatrix`, pass the endpoint in the fallback (line ~83):
```js
      const expectation = ((state.expect || {})[ep.reqId] || {})[id.id] || defaultExpectation(id, ep);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS (new tests + all pre-existing tests green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): endpoint-aware defaultExpectation for BFLA defaults"
```

---

## Task 4: authz.js — persist `identity.privileged`

**Files:**
- Modify: `src/qa/authz.js` (`saveMatrixConfig`)
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a new describe to src/__tests__/authz.test.js
describe('persistence — identity.privileged', () => {
  it('round-trips a privileged identity flag and omits it when absent', () => {
    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity(), { id: 'a', name: 'admin', auth: { type: 'bearer' }, privileged: true }], endpoints: [], expect: {}, denySet: [401] });
    const loaded = loadMatrixConfig();
    expect(loaded.identities.find((i) => i.id === 'a').privileged).toBe(true);
    expect(loaded.identities.find((i) => i.id === 'anon').privileged).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — the admin identity's `privileged` is `undefined` after round-trip (saveMatrixConfig drops it).

- [ ] **Step 3: Write minimal implementation**

In `src/qa/authz.js` `saveMatrixConfig`, extend the cleaned identity to carry `privileged`:

```js
    const cleanIdentities = identities.map(({ id, name, auth, privileged }) => ({ id, name, auth, privileged }));
```

(`privileged: undefined` is dropped by `JSON.stringify`, so absent flags don't bloat storage. The `_`-prefixed transient-field stripping is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): persist identity.privileged flag"
```

---

## Task 5: i18n keys for the privileged UI

**Files:**
- Modify: `src/qa/i18n.jsx` (after the `rl.*` keys in each locale)

- [ ] **Step 1: Add the keys to `en-US`**

Insert after the last `rl.*` entry in the `en-US` block:

```js
    'security.priv.reason.write': 'write',
    'security.priv.reason.admin-path': 'admin',
    'security.priv.reason.manual': 'manual',
    'security.priv.title': 'Privileged endpoint — high-value for BFLA. Non-privileged identities default to deny.',
    'security.priv.mark': 'mark priv',
    'security.priv.count': '{count} privileged',
    'security.priv.identity': 'privileged / admin',
    'security.priv.identityHint': 'Privileged identities default to allow on privileged endpoints.',
```

- [ ] **Step 2: Add the keys to `zh-TW`**

Insert at the matching position in the `zh-TW` block:

```js
    'security.priv.reason.write': '寫入',
    'security.priv.reason.admin-path': 'admin 路徑',
    'security.priv.reason.manual': '手動',
    'security.priv.title': '高權 endpoint — BFLA 重點。非高權 identity 預設為 deny。',
    'security.priv.mark': '標高權',
    'security.priv.count': '{count} 個高權',
    'security.priv.identity': '高權 / admin',
    'security.priv.identityHint': '高權 identity 在高權 endpoint 上預設為 allow。',
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(security): privileged-endpoint badge + identity keys (en-US + zh-TW)"
```

---

## Task 6: Security.jsx — privileged badge/toggle, count, identity checkbox

**Files:**
- Modify: `src/qa/Security.jsx` (imports ~line 12; `IdentityEditor` ~line 56-59; toolbar ~line 174; endpoint row ~line 288-289)
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to the existing describe in `src/__tests__/security-page.test.jsx`:

```js
  it('flags a privileged endpoint and defaults a non-privileged identity to deny', () => {
    // Seed a matrix config: a normal (non-privileged) user identity + a DELETE /admin endpoint, no explicit expectations.
    const cfg = {
      identities: [{ id: 'anon', name: 'anon', auth: { type: 'none' } }, { id: 'u', name: 'user', auth: { type: 'bearer' } }],
      endpoints: [{ reqId: 'e1', method: 'DELETE', path: 'https://api.test/admin/users/1' }],
      expect: {}, denySet: [401, 403, 404],
    };
    installLocalStorage({ qa_locale: 'en-US', qa_security_matrix: JSON.stringify(cfg) });
    renderPage();
    // The privileged badge renders (effective-privileged via the heuristic).
    expect(document.querySelector('.qa-sec-priv--on')).not.toBeNull();
    // Both anon AND the non-privileged user default to deny on the privileged endpoint → 2 deny cells in the row.
    expect(document.querySelectorAll('td.qa-sec-cell[data-expect="deny"]').length).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — `.qa-sec-priv--on` not found (no badge yet); the deny-count assertion also fails until the endpoint-aware default (Task 3) is wired into the page via the existing `withDefaults` memo (it already is, so the failing part is the badge).

- [ ] **Step 3: Write the implementation**

(a) Import `endpointPrivileged` in `src/qa/Security.jsx` (add to the authz import block, ~line 9-12):
```js
import {
  anonIdentity, withDefaults, setColumn, setRow, runMatrix, summarize,
  loadMatrixConfig, saveMatrixConfig, DEFAULT_DENY_SET, endpointPrivileged,
} from './authz.js';
```

(b) Add an override toggle handler near `removeEndpoint` (~line 147):
```js
  const togglePriv = (reqId, val) => setEndpoints(xs => xs.map(e => e.reqId === reqId ? { ...e, privileged: val } : e));
```

(c) Add a privileged count memo near the other memos (e.g. after the `summary` memo ~line 103):
```js
  const privCount = useMemo(() => endpoints.filter(e => endpointPrivileged(e).privileged).length, [endpoints]);
```

(d) Show the count in the toolbar — add inside the `.qa-sec-toolbar` block (after the deny-set label, ~line 181):
```jsx
          {privCount > 0 && <span className="qa-sec-privcount">{t('security.priv.count', { count: privCount })}</span>}
```

(e) Render the badge/toggle in the endpoint row head. Replace the row-head path span (line ~289):
```jsx
                    <span>
                      <MethodBadge method={ep.method} size="sm" /> <code>{ep.path}</code>
                      {(() => {
                        const pv = endpointPrivileged(ep);
                        return (
                          <button type="button"
                                  className={`qa-sec-priv qa-sec-priv--${pv.privileged ? 'on' : 'off'}`}
                                  title={t('security.priv.title')}
                                  onClick={() => togglePriv(ep.reqId, !pv.privileged)}>
                            {pv.privileged ? pv.reasons.map(r => t('security.priv.reason.' + r)).join('·') : t('security.priv.mark')}
                          </button>
                        );
                      })()}
                    </span>
```

(f) Add the privileged checkbox to `IdentityEditor` — after the name input (line ~59):
```jsx
      <label className="qa-sec-privchk">
        <input type="checkbox" checked={!!identity.privileged}
               onChange={e => onChange({ ...identity, privileged: e.target.checked })} />
        {t('security.priv.identity')}
      </label>
      <span className="qa-meta">{t('security.priv.identityHint')}</span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS (existing matrix/bola/ratelimit tests + the new privileged test all green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): privileged-endpoint badge/toggle, count, identity checkbox"
```

---

## Task 7: CSS — privileged badge / toggle / count / checkbox

**Files:**
- Modify: `src/qa/qa.css` (append after the rate-limit block)

- [ ] **Step 1: Append the styles**

```css
  /* ── BFLA privileged-endpoint ergonomics ────────────────────────────────── */
  .qa-sec-priv { margin-left: 8px; padding: 1px 7px; border-radius: 9px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .03em; border: 1px solid transparent; cursor: pointer; }
  .qa-sec-priv--on { background: rgba(234,88,12,.14); color: #ea580c; border-color: rgba(234,88,12,.3); }
  .qa-sec-priv--off { background: transparent; color: var(--text-dim); border-color: var(--border); opacity: .55; font-weight: 600; }
  .qa-sec-priv--off:hover { opacity: 1; }
  .qa-sec-privcount { font-size: 11px; color: #ea580c; font-weight: 600; }
  .qa-sec-privchk { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); margin-top: 4px; }
  .qa-sec-privchk input { margin: 0; }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/qa/qa.css
git commit -m "style(security): privileged badge/toggle/count/checkbox"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites PASS (extended `authz` + `security-page`, plus all phase 1-3 suites).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Placeholder scan on touched code**

Run: `grep -rn "TODO\|FIXME" src/qa/authz.js`
Expected: no output.

- [ ] **Step 4: Final status**

```bash
git status   # expect clean working tree
git log --oneline master..HEAD | cat
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** classifier method+path with reasons (T1) ✓ · endpointPrivileged override>heuristic (T2) ✓ · endpoint-aware defaultExpectation + withDefaults + runMatrix, legacy one-arg preserved, existing cells preserved (T3) ✓ · persist identity.privileged (T4) ✓ · zh-TW i18n (T5) ✓ · row badge + override toggle + count + identity checkbox (T6) ✓ · CSS (T7) ✓.
- **Existing-test impact:** the shared `ep2` fixture is changed POST→GET (T3 step 1) so the column/row/withDefaults mechanics tests stay green and decoupled from the new privileged behavior; the new behavior has dedicated tests. The existing one-arg `defaultExpectation` tests (anon→deny, admin→allow) still pass because `endpoint` is optional.
- **Type consistency:** `classifyEndpoint → {privileged, reasons}`; `endpointPrivileged → {privileged, reasons, source}`; `defaultExpectation(identity, endpoint?)`. `endpointPrivileged` is the single source of truth used by `defaultExpectation`, the row badge, and the count. `ep.privileged` (endpoint override) and `identity.privileged` (identity flag) are distinct booleans, both optional, both persisted.
- **Deviation from spec:** none. Resetting an overridden endpoint back to pure-auto is intentionally out of scope (toggle yields an explicit boolean; remove+re-add to reset), as stated in the spec.
- **Behavior note:** smart defaults fill only missing cells (`prev ?? default`), so toggling an endpoint's privileged state or an identity's flag re-defaults only not-yet-set cells within the session; already-set/persisted cells are preserved (spec decision 5).
