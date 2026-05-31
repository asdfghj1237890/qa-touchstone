# Real Execution + AI Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Collection Runner and Monitors execute real HTTP and assert on live responses, and add a single-response AI review to the response panel.

**Architecture:** Two shared pure-ish helpers — `qa/buildReq.js` (extracted from App.jsx) and `qa/sendRequest.js` (`qaRunSavedRequest`, reuses the existing `executeRequest`) — are consumed by Runner and Monitors so batch runs hit the network and run assertions on live responses (falling back to canned responses outside Tauri, exactly as single-send already does). A second helper `qa/llm.js` (`qaCallLLM`, extracted from TestGen) powers an "AI review" affordance in `ResponsePanel`.

**Tech Stack:** React 18 (classic, via `window.React`), Vite 6, Vitest 3 + @testing-library/react, Tauri v2 backend (HTTP via `execute_postman_request`).

---

## File Structure

- Create: `src/qa/buildReq.js` — pure `buildReq(id)` + `DEFAULT_HEADERS` + `EMPTY_REQ`, extracted verbatim from `App.jsx`. One responsibility: turn a saved-request id into a full request object.
- Create: `src/qa/sendRequest.js` — `qaRunSavedRequest(reqMeta, ctx)`: build req, resolve vars, match cookies, call `executeRequest`, return live response. Shared by Runner + Monitors.
- Create: `src/qa/llm.js` — `qaCallLLM(prompt)`: provider dispatch (builtin/openai/custom) extracted from TestGen.
- Modify: `src/App.jsx` — import `buildReq` from the new module (drop the local copy); pass `cookies`/`sslVerify`/`oauthTokens` into `<Runner>` and `<MonitorsPage>`.
- Modify: `src/qa/Runner.jsx` — async run loop via `qaRunSavedRequest`; assert on live response.
- Modify: `src/qa/Monitors.jsx` — `runNow` executes real requests + assertions instead of `Math.random()`.
- Modify: `src/qa/TestGen.jsx` — use `qaCallLLM` (remove local `callLLM`).
- Modify: `src/qa/ResponsePanel.jsx` — add AI-review state + button + panel.
- Tests: `src/__tests__/sendRequest.test.js`, `src/__tests__/runner-real.test.jsx`, `src/__tests__/monitors-real.test.jsx`, `src/__tests__/llm.test.js`.

Run all tests with: `npx vitest run` (expected baseline before changes: **117 passed**).

---

## Task 0: Extract `buildReq` into a shared module

**Files:**
- Create: `src/qa/buildReq.js`
- Modify: `src/App.jsx` (remove local `DEFAULT_HEADERS`, `EMPTY_REQ`, `buildReq`; import them)

- [ ] **Step 1: Create `src/qa/buildReq.js`** with the exact logic currently in App.jsx

```js
// ── QA Companion — build a full request object from a saved-request id ─────
// Extracted from App.jsx so the Collection Runner and Monitors can construct
// the same request shape the API client sends, without duplicating logic.
import './setup.js';

export const DEFAULT_HEADERS = [{ key: 'Accept', value: 'application/json', on: true }];

// Placeholder request used when no collections are loaded yet. Components guard
// on req.id, but React's initial render still needs a valid shape.
export const EMPTY_REQ = {
  id: '', method: 'GET', url: '', params: [], headers: DEFAULT_HEADERS.map(h => ({ ...h })),
  bodyMode: 'none', body: '', gqlQuery: '', gqlVars: '', form: [],
  auth: {
    type: 'none', bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '' },
  },
};

export function buildReq(id) {
  const { COLLECTIONS, REQUEST_DETAILS } = window.QA;
  const all = COLLECTIONS.flatMap(c => c.folders.flatMap(f => f.requests));
  const meta = all.find(r => r.id === id) || all[0];
  if (!meta) return { ...EMPTY_REQ, headers: DEFAULT_HEADERS.map(h => ({ ...h })) };
  const det = REQUEST_DETAILS[meta.id] || {};
  const isGql = !!det.graphql;
  return {
    id: meta.id,
    method: meta.method,
    url: meta.path.split('?')[0],
    params: (det.params || []).map(p => ({ ...p })),
    headers: DEFAULT_HEADERS.map(h => ({ ...h })),
    bodyMode: isGql ? 'graphql' : (det.body ? 'json' : 'none'),
    body: det.body || '',
    gqlQuery: isGql ? det.graphql.query : '',
    gqlVars: isGql ? det.graphql.variables : '',
    form: [],
    auth: {
      type: det.auth || 'none', bearer: '',
      apiKey: { key: '', value: '', placement: 'header' },
      basic: { user: '', pass: '' },
      aws: { profile: '', service: '', region: '' },
      oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '' },
    },
  };
}
```

- [ ] **Step 2: In `src/App.jsx`, replace the local definitions with an import**

Remove the local `const DEFAULT_HEADERS = ...`, the `const EMPTY_REQ = {...}`, and the `function buildReq(id) {...}`. Add near the other `./qa/*` imports at the top:

```js
import { buildReq, DEFAULT_HEADERS } from './qa/buildReq.js';
```

(If `DEFAULT_HEADERS` is not referenced elsewhere in App.jsx after removal, import only `buildReq`.)

- [ ] **Step 3: Run the existing App suite to verify no regression**

Run: `npx vitest run src/__tests__/App.test.jsx`
Expected: PASS (8 tests) — App still renders, sends, and shows 200.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: **117 passed**.

- [ ] **Step 5: Commit**

```bash
git add src/qa/buildReq.js src/App.jsx
git commit -m "Extract buildReq into a shared module"
```

---

## Task 1: `qa/sendRequest.js` — run a saved request for real

**Files:**
- Create: `src/qa/sendRequest.js`
- Test: `src/__tests__/sendRequest.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { qaRunSavedRequest } from '../qa/sendRequest.js';

// Outside Tauri, executeRequest falls back to window.QA.RESPONSES[req.id].
// Seed a collection + canned response and confirm the helper returns it.
describe('qaRunSavedRequest (canned fallback, no Tauri)', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 12, size: 5, body: { ok: true }, headers: {} } };
  });

  it('returns the live (canned) response for a saved request', async () => {
    const resp = await qaRunSavedRequest(
      { id: 'r1', method: 'GET', path: 'https://api.test/thing' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, collectionId: 'c1' }
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/sendRequest.test.js`
Expected: FAIL — cannot resolve `../qa/sendRequest.js`.

- [ ] **Step 3: Create `src/qa/sendRequest.js`**

```js
// ── QA Companion — run a saved request for real (shared by Runner/Monitors) ─
// Builds the same request shape the API client sends, resolves variables,
// matches cookies, and calls executeRequest. Outside Tauri, executeRequest
// falls back to canned responses, so batch callers still work in dev/test.
import './setup.js';
import { executeRequest } from './executor.js';
import { buildReq } from './buildReq.js';
import { cookieMatches } from './cookies.js';

export async function qaRunSavedRequest(reqMeta, ctx = {}) {
  const { env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true, oauthToken, collectionId } = ctx;
  const req = buildReq(reqMeta.id);
  const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label, collectionId, {});
  // Resolve the URL the same way the live executor does, for cookie matching.
  const urlSub = window.qaSubstitute(req.url || '', map);
  const isAbsolute = /^https?:\/\//i.test(urlSub);
  const fullUrl = isAbsolute ? urlSub : (window.qaSubstitute(env.baseUrl || '', map) + urlSub);
  const reqCookies = (cookies || [])
    .filter((c) => cookieMatches(c, fullUrl))
    .sort((a, b) => (b.path || '/').length - (a.path || '/').length);
  return executeRequest(req, env, map, { cookies: reqCookies, sslVerify, oauthToken });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/sendRequest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/sendRequest.js src/__tests__/sendRequest.test.js
git commit -m "Add qaRunSavedRequest: run a saved request via the live executor"
```

---

## Task 2 (Item 1): Runner hits the real network

**Files:**
- Modify: `src/qa/Runner.jsx`
- Modify: `src/App.jsx` (pass `cookies`/`sslVerify`/`oauthTokens`)
- Test: `src/__tests__/runner-real.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Runner } from '../qa/Runner.jsx';

describe('Runner runs real requests + live assertions (canned fallback)', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 9, size: 4, body: { ok: true }, headers: {} } };
  });

  it('reports assertion pass/total from the live response', async () => {
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(<Runner env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} tests={tests}
                   cookies={[]} sslVerify={true} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run 1 request/ }));
    await waitFor(() => expect(screen.getByText('1/1')).toBeInTheDocument(), { timeout: 4000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/runner-real.test.jsx`
Expected: FAIL — Runner still reads `window.QA.RESPONSES` synchronously and never awaits; the assertion count may be wrong or the run shape mismatched. (If it happens to pass against canned, the real proof is Step 4's behavior, but the prop wiring below is still required.)

- [ ] **Step 3: Rewrite the `run()` body in `src/qa/Runner.jsx`**

Add the import at the top of `Runner.jsx`:

```js
import { qaRunSavedRequest } from './sendRequest.js';
```

Change the component signature to accept the new props:

```js
function Runner({ env, vars, tests, cookies = [], sslVerify = true, oauthTokens = {} }) {
```

Replace the synchronous `step()` loop in `run()` with an async sequence (keep `stop`, `progress`, `delay`, and the `iters` cap):

```js
  const run = () => {
    if (running) { stop(); return; }
    const reqs = colReqs.filter(r => selIds.includes(r.id));
    if (!reqs.length) return;
    const queue = [];
    for (let i = 0; i < iters; i++) reqs.forEach(r => queue.push({ iter: i + 1, r, data: dataRows ? dataRows[i] : null }));
    setResults([]); setProgress(0); setPhase('running');
    const acc = [];
    let cancelled = false;
    timerRef.current = { cancel: () => { cancelled = true; } };
    (async () => {
      for (let k = 0; k < queue.length; k++) {
        if (cancelled) break;
        const { iter, r, data } = queue[k];
        const map = window.qaVarMap(vars, env.label, colId, data || undefined);
        let resp;
        try {
          resp = await qaRunSavedRequest(r, { env, vars, cookies, sslVerify, oauthToken: oauthTokens[r.id], collectionId: colId });
        } catch (e) {
          resp = { status: 0, statusText: String(e), time: 0, size: 0, body: null, headers: {} };
        }
        if (cancelled) break;
        const res = window.qaRunAssertions(tests[r.id] || [], resp);
        acc.push({
          iter, name: r.name, method: r.method,
          path: window.qaSubstitute(r.path.split('?')[0], map),
          status: resp.status, time: resp.time,
          passed: res.filter(x => x.pass).length, total: res.length,
        });
        setResults([...acc]); setProgress((k + 1) / queue.length);
        if ((+delay || 0) > 0) await new Promise(res2 => setTimeout(res2, +delay));
      }
      setPhase('done'); timerRef.current = null;
    })();
  };
```

Update `stop()` to cancel the async loop (it currently calls `clearTimeout`):

```js
  const stop = () => { if (timerRef.current && timerRef.current.cancel) timerRef.current.cancel(); timerRef.current = null; setPhase(p => p === 'running' ? 'done' : p); };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/runner-real.test.jsx`
Expected: PASS — `1/1` assertions shown, sourced from `qaRunAssertions` on the live (canned) response.

- [ ] **Step 5: Wire props in `src/App.jsx`**

Find the Runner route render and add the new props:

```js
{route === 'runner' && <Runner env={env} vars={vars} tests={tests} cookies={cookies} sslVerify={sslVerify} oauthTokens={oauthTokens} />}
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: **all passing** (118+ now).

- [ ] **Step 7: Commit**

```bash
git add src/qa/Runner.jsx src/App.jsx src/__tests__/runner-real.test.jsx
git commit -m "Item 1: Collection Runner executes real requests and asserts on live responses"
```

---

## Task 3 (Item 3): Monitors "Run now" executes for real

**Files:**
- Modify: `src/qa/Monitors.jsx`
- Modify: `src/App.jsx` (pass `vars`/`cookies`/`sslVerify`/`tests`/`oauthTokens`)
- Test: `src/__tests__/monitors-real.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MonitorsPage } from '../qa/Monitors.jsx';

describe('Monitors Run now executes real assertions (canned fallback)', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 7, size: 4, body: { ok: true }, headers: {} } };
    window.QA.MONITORS = [{ id: 'm1', name: 'M', collectionId: 'c1', env: 'None', cadence: 'Every hour',
      region: 'us-east-1', enabled: true, nextRun: 'in 5 min', runs: [] }];
  });

  it('records a deterministic pass run (1/1) instead of random', async () => {
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/monitors-real.test.jsx`
Expected: FAIL — `runNow` uses `Math.random()` and `n = col.count`, so the result is non-deterministic and assertion-blind; `1/1 passed` is not reliably produced.

- [ ] **Step 3: Rewrite `runNow` in `src/qa/Monitors.jsx`**

Add the import at the top:

```js
import { qaRunSavedRequest } from './sendRequest.js';
```

Change the page signature:

```js
function MonitorsPage({ env, setRoute, vars, cookies = [], sslVerify = true, tests = {}, oauthTokens = {} }) {
```

Replace the `runNow` body:

```js
  const runNow = (id) => {
    setRunning(id);
    const mon = monitors.find(m => m.id === id);
    const col = window.QA.COLLECTIONS.find(c => c.id === (mon && mon.collectionId));
    const reqs = col ? col.folders.flatMap(f => f.requests) : [];
    (async () => {
      let passed = 0, failed = 0, ms = 0;
      for (const r of reqs) {
        let resp;
        try {
          resp = await qaRunSavedRequest(r, { env, vars, cookies, sslVerify, oauthToken: oauthTokens[r.id], collectionId: col.id });
        } catch (e) {
          resp = { status: 0, time: 0 };
        }
        ms += resp.time || 0;
        const asserts = window.qaRunAssertions(tests[r.id] || [], resp);
        // A request with no assertions counts as pass iff status < 400.
        const ok = asserts.length ? asserts.every(a => a.pass) : (resp.status >= 200 && resp.status < 400);
        if (ok) passed += 1; else failed += 1;
      }
      const now = new Date();
      const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const run = { at, status: failed ? 'fail' : 'pass', passed, failed, ms };
      setMonitors(ms2 => ms2.map(m => m.id === id ? { ...m, runs: [run, ...m.runs].slice(0, 20) } : m));
      setRunning(null);
    })();
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/monitors-real.test.jsx`
Expected: PASS — `1/1 passed` shown.

- [ ] **Step 5: Wire props in `src/App.jsx`**

```js
{route === 'monitors' && <MonitorsPage env={env} setRoute={setRoute} vars={vars} cookies={cookies} sslVerify={sslVerify} tests={tests} oauthTokens={oauthTokens} />}
```

(Match the existing MonitorsPage render; add the missing props.)

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add src/qa/Monitors.jsx src/App.jsx src/__tests__/monitors-real.test.jsx
git commit -m "Item 3: Monitors Run now executes real requests and tallies real assertions"
```

---

## Task 4: `qa/llm.js` — extract the LLM call

**Files:**
- Create: `src/qa/llm.js`
- Modify: `src/qa/TestGen.jsx` (use `qaCallLLM`)
- Test: `src/__tests__/llm.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { qaCallLLM } from '../qa/llm.js';

describe('qaCallLLM provider dispatch', () => {
  beforeEach(() => {
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('hello from builtin') };
  });

  it('uses the built-in Claude provider', async () => {
    const out = await qaCallLLM('hi');
    expect(out).toBe('hello from builtin');
    expect(window.claude.complete).toHaveBeenCalledOnce();
  });

  it('throws when built-in is selected but unavailable', async () => {
    window.claude = undefined;
    await expect(qaCallLLM('hi')).rejects.toThrow(/built-in/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/llm.test.js`
Expected: FAIL — cannot resolve `../qa/llm.js`.

- [ ] **Step 3: Create `src/qa/llm.js`** (logic lifted verbatim from TestGen's `callLLM`)

```js
// ── QA Companion — shared LLM call (built-in Claude / OpenAI / custom) ─────
import './setup.js';

export async function qaCallLLM(prompt) {
  const cfg = window.loadLlmCfg();
  if (cfg.provider === 'builtin') {
    if (!(window.claude && window.claude.complete)) throw new Error('built-in Claude unavailable');
    return await window.claude.complete({ messages: [{ role: 'user', content: prompt }] });
  }
  const url = cfg.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : cfg.baseUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from provider');
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/llm.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Use it in `src/qa/TestGen.jsx`**

Add the import:

```js
import { qaCallLLM } from './llm.js';
```

Delete the local `const callLLM = async (prompt) => { ... };` block, and replace its one call site inside `generate()`:

```js
      const raw = await qaCallLLM(buildPrompt(source, input));
```

- [ ] **Step 6: Run the TestGen-related + full suite**

Run: `npx vitest run`
Expected: all passing (TestGen behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/qa/llm.js src/qa/TestGen.jsx src/__tests__/llm.test.js
git commit -m "Extract qaCallLLM into a shared module; TestGen reuses it"
```

---

## Task 5 (Item 2): ResponsePanel AI review

**Files:**
- Modify: `src/qa/ResponsePanel.jsx`
- Test: `src/__tests__/response-ai-review.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponsePanel } from '../qa/ResponsePanel.jsx';

describe('ResponsePanel AI review', () => {
  beforeEach(() => {
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('Looks correct: 200 with the expected body.') };
  });

  it('reviews the response with the model and shows the verdict', async () => {
    const req = { method: 'GET', url: 'https://api.test/thing', headers: [], auth: { type: 'none' }, bodyMode: 'none', body: '' };
    const response = { status: 200, statusText: 'OK', time: 10, size: 4, body: { ok: true }, headers: {} };
    render(<ResponsePanel state="done" response={response} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/response-ai-review.test.jsx`
Expected: FAIL — no "AI review" button exists.

- [ ] **Step 3: Add the AI-review feature to `src/qa/ResponsePanel.jsx`**

Add imports at the top (the file already imports React + components):

```js
import { qaCallLLM } from './llm.js';
```

Inside `ResponsePanel`, after the existing `useStateRP` hooks (near `const [menu, setMenu]`), add:

```js
  const [aiState, setAiState] = useStateRP('idle'); // idle | loading | done | error
  const [aiText, setAiText] = useStateRP('');
  const reviewWithAI = async () => {
    if (!response) return;
    setAiState('loading'); setAiText('');
    const expected = (testList || []).map(t => window.qaAssertLabel ? window.qaAssertLabel(t) : JSON.stringify(t));
    const bodyStr = response.body == null ? '(no body)' : JSON.stringify(response.body).slice(0, 1500);
    const prompt = [
      'You are a senior QA engineer reviewing one API response. Be terse (max 4 lines).',
      'Say whether it looks correct, and flag anything suspicious (wrong status, error body, missing fields, security smells).',
      `REQUEST: ${req.method} ${req.url}`,
      expected.length ? `EXPECTED (assertions): ${expected.join('; ')}` : 'EXPECTED: (none specified)',
      `RESPONSE: ${response.status} ${response.statusText}, ${response.time}ms`,
      `BODY: ${bodyStr}`,
    ].join('\n');
    try {
      const out = await qaCallLLM(prompt);
      setAiText(String(out || '').trim() || '(empty response)'); setAiState('done');
    } catch (e) {
      setAiText('AI review unavailable: ' + e.message + '. Configure a provider in Settings → AI / LLM.'); setAiState('error');
    }
  };
```

In the `state === 'done'` render region (after the assertions/tests block, before the closing `</section>`), add the affordance:

```jsx
          <div className="qa-resp-ai">
            <button className="qa-hist-expbtn" onClick={reviewWithAI} disabled={aiState === 'loading'}>
              <Icon name="sparkle" size={13} /> {aiState === 'loading' ? 'Reviewing…' : 'AI review'}
            </button>
            {aiState !== 'idle' && aiState !== 'loading' && (
              <div className="qa-resp-ai-out" data-err={aiState === 'error' ? '1' : '0'}>{aiText}</div>
            )}
          </div>
```

(Place this inside the existing `done`-state JSX. Use the `Icon` already imported by the file. If `qaAssertLabel` is not on `window`, the `||` fallback stringifies the assertion — no crash.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/response-ai-review.test.jsx`
Expected: PASS — clicking "AI review" shows the model's verdict text.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/qa/ResponsePanel.jsx src/__tests__/response-ai-review.test.jsx
git commit -m "Item 2: AI review of a single response in the response panel"
```

---

## Final verification

- [ ] **Run the whole suite**: `npx vitest run` → all green.
- [ ] **Manual smoke (Tauri)**: `npm run tauri dev` → API Client send still works; Runner on the demo collection shows real statuses + assertion counts; Monitors "Run now" produces a real pass/fail; a sent response's "AI review" returns a verdict (built-in Claude or configured provider).
- [ ] **Update the assessment doc** `docs/ai-era-api-testing-assessment.md`: mark items 1/3/2 done, leave authz/schema scan as the remaining gap.

---

## Self-Review notes

- **Spec coverage:** Shared `sendRequest.js` (Task 1) + `llm.js` (Task 4) ✓; Item 1 Runner (Task 2) ✓; Item 3 Monitors (Task 3) ✓; Item 2 ResponsePanel (Task 5) ✓; `buildReq` extraction (Task 0) supports Tasks 1–3 ✓. Non-goals (background cadence, batch AI, authz scan, App.send refactor) intentionally absent.
- **Type/name consistency:** `qaRunSavedRequest(reqMeta, ctx)` signature identical across Tasks 1–3; `qaCallLLM(prompt)` identical across Tasks 4–5; prop names `cookies`/`sslVerify`/`oauthTokens`/`tests` consistent in Runner, Monitors, and App wiring.
- **Canned-fallback caveat:** all tests run without Tauri, so they exercise the assertion/aggregation path against `window.QA.RESPONSES`. Real-network behavior is covered by the manual Tauri smoke step (the network layer itself is unchanged, proven `executeRequest`).
