# Rate-limit / Abuse Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real bounded-burst rate-limit/abuse testing to the Security page: fire N requests (with concurrency) at an endpoint as a chosen identity and flag the absence of a throttle signal (429 or `RateLimit-*` headers) as a finding whose severity is driven by a per-test sensitivity flag.

**Architecture:** A new pure module `src/qa/ratelimit.js` (throttle detection + verdict + severity + a concurrency-pool burst executor with an injected runner) plus a new `src/qa/RateLimitPanel.jsx` rendered by `Security.jsx` as a third mode (Matrix | Object-access | Rate limit). Identities are shared; findings reuse the phase-1 `Finding` shape. Guardrails: hard caps + a confirm-before-run modal. `runMatrix`/BOLA/oracles are untouched.

**Tech Stack:** React, Vitest + @testing-library/react, existing `qaRunSavedRequest` (returns `{status, headers, time}`), flat per-locale i18n in `i18n.jsx`.

**Spec:** `docs/superpowers/specs/2026-06-03-rate-limit-abuse-design.md`

---

## File Structure

- **Create** `src/qa/ratelimit.js` — pure engine: constants, `detectThrottleSignal`, `classifyRateLimit`, `rateLimitSeverity`, `runBurst`, `summarizeRateLimit`. No React.
- **Create** `src/__tests__/ratelimit.test.js` — engine unit tests.
- **Create** `src/qa/RateLimitPanel.jsx` — UI + page-side runner. Consumes shared identities.
- **Create** `src/__tests__/ratelimit-panel.test.jsx` — wiring test on the canned path.
- **Modify** `src/qa/authz.js` — persist a `rateLimit` blob in the security config.
- **Modify** `src/__tests__/authz.test.js` — assert `rateLimit` round-trips.
- **Modify** `src/qa/Security.jsx` — third mode in the toggle; own `rateLimit` state; render `RateLimitPanel`.
- **Modify** `src/__tests__/security-page.test.jsx` — assert the Rate-limit mode renders the panel.
- **Modify** `src/qa/i18n.jsx` — `security.mode.ratelimit` + `rl.*` keys (en-US + zh-TW).
- **Modify** `src/qa/qa.css` — stats card + progress + confirm-modal + verdict styles.

**Finding shape (reused from phase 1):** `{ oracle:'rate-limit', severity, title, path, evidence, source:'rule' }`.

Test command: `npx vitest run <file>`. Build: `npm run build`.

---

## Task 1: ratelimit.js — constants + `detectThrottleSignal`

**Files:**
- Create: `src/qa/ratelimit.js`
- Test: `src/__tests__/ratelimit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/ratelimit.test.js
import { describe, it, expect } from 'vitest';
import { THROTTLE_HEADERS, MAX_N, MAX_CONCURRENCY, detectThrottleSignal } from '../qa/ratelimit.js';

describe('constants', () => {
  it('caps and the throttle-header set are exposed', () => {
    expect(MAX_N).toBe(200);
    expect(MAX_CONCURRENCY).toBe(10);
    expect(THROTTLE_HEADERS).toContain('retry-after');
    expect(THROTTLE_HEADERS).toContain('x-ratelimit-remaining');
  });
});

describe('detectThrottleSignal', () => {
  const r = (status, headers = {}) => ({ status, headers, timeMs: 1, error: null });
  it('flags a 429 anywhere in the burst', () => {
    expect(detectThrottleSignal([r(200), r(429), r(200)])).toEqual({ throttled: true, saw429: true, headerHit: false });
  });
  it('flags a rate-limit header case-insensitively', () => {
    expect(detectThrottleSignal([r(200, { 'Retry-After': '5' })]).throttled).toBe(true);
    expect(detectThrottleSignal([r(200, { 'X-RateLimit-Remaining': '0' })]).headerHit).toBe(true);
  });
  it('is not throttled when no 429 and no rate-limit headers', () => {
    expect(detectThrottleSignal([r(200, { 'content-type': 'application/json' }), r(200)])).toEqual({ throttled: false, saw429: false, headerHit: false });
  });
  it('tolerates null/empty entries', () => {
    expect(detectThrottleSignal([null, undefined, r(200)]).throttled).toBe(false);
    expect(detectThrottleSignal([]).throttled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: FAIL — `Failed to resolve import "../qa/ratelimit.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/ratelimit.js
// ── QA Companion — rate-limit / abuse testing engine (pure logic) ──────────
// Fires a bounded real burst at an endpoint and reports whether throttling
// engages. The ABSENCE of a throttle signal is the finding. UI in RateLimitPanel.
import './setup.js';

export const MAX_N = 200;
export const MAX_CONCURRENCY = 10;

// Lowercased header names that indicate a rate limiter is present.
export const THROTTLE_HEADERS = [
  'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
];

// Scan a burst's responses for a throttle signal: any 429, or any rate-limit
// header (compared case-insensitively). Presence of a RateLimit-* header means
// a limiter exists, so it counts as throttled even on a 2xx.
export function detectThrottleSignal(responses) {
  let saw429 = false, headerHit = false;
  for (const r of responses || []) {
    if (!r) continue;
    if (r.status === 429) saw429 = true;
    const hdrs = r.headers || {};
    for (const k of Object.keys(hdrs)) {
      if (THROTTLE_HEADERS.includes(k.toLowerCase())) { headerHit = true; break; }
    }
    if (saw429 && headerHit) break;
  }
  return { throttled: saw429 || headerHit, saw429, headerHit };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/ratelimit.js src/__tests__/ratelimit.test.js
git commit -m "feat(ratelimit): throttle-signal detection + constants"
```

---

## Task 2: ratelimit.js — `classifyRateLimit` + `rateLimitSeverity`

**Files:**
- Modify: `src/qa/ratelimit.js`
- Test: `src/__tests__/ratelimit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/ratelimit.test.js
import { classifyRateLimit, rateLimitSeverity } from '../qa/ratelimit.js';

describe('classifyRateLimit', () => {
  it('throttled is pass', () => {
    expect(classifyRateLimit({ throttled: true }, 30)).toBe('pass');
  });
  it('completed with no signal is vuln', () => {
    expect(classifyRateLimit({ throttled: false }, 30)).toBe('vuln');
  });
  it('nothing completed is inconclusive', () => {
    expect(classifyRateLimit({ throttled: false }, 0)).toBe('inconclusive');
  });
});

describe('rateLimitSeverity', () => {
  it('vuln severity follows the sensitivity flag', () => {
    expect(rateLimitSeverity('sensitive', 'vuln')).toBe('high');
    expect(rateLimitSeverity('normal', 'vuln')).toBe('low');
  });
  it('non-vuln verdicts have no finding', () => {
    expect(rateLimitSeverity('sensitive', 'pass')).toBe(null);
    expect(rateLimitSeverity('normal', 'inconclusive')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: FAIL — `classifyRateLimit is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/ratelimit.js

// completedCount = responses that returned a real HTTP status (net errors excluded).
export function classifyRateLimit(signal, completedCount) {
  if (signal && signal.throttled) return 'pass';
  if (completedCount > 0) return 'vuln';
  return 'inconclusive';
}

export function rateLimitSeverity(sensitivity, verdict) {
  if (verdict !== 'vuln') return null;
  return sensitivity === 'sensitive' ? 'high' : 'low';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/ratelimit.js src/__tests__/ratelimit.test.js
git commit -m "feat(ratelimit): verdict classification + severity mapping"
```

---

## Task 3: ratelimit.js — `runBurst` (concurrency pool) + `summarizeRateLimit`

**Files:**
- Modify: `src/qa/ratelimit.js`
- Test: `src/__tests__/ratelimit.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/ratelimit.test.js
import { runBurst, summarizeRateLimit, MAX_N as CAP } from '../qa/ratelimit.js';

describe('runBurst', () => {
  it('collects N responses and computes stats', async () => {
    const runner = () => Promise.resolve({ status: 200, headers: {}, time: 3 });
    const { responses, stats } = await runBurst({ n: 12, concurrency: 4 }, runner, {});
    expect(responses).toHaveLength(12);
    expect(stats.sent).toBe(12);
    expect(stats.ok2xx).toBe(12);
    expect(stats.throttled).toBe(false);
  });

  it('never exceeds the configured concurrency in flight', async () => {
    let inFlight = 0, maxInFlight = 0;
    const runner = () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise(res => setTimeout(() => { inFlight--; res({ status: 200, headers: {}, time: 1 }); }, 5));
    };
    await runBurst({ n: 10, concurrency: 3 }, runner, {});
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('clamps n and concurrency to the caps', async () => {
    let calls = 0;
    const runner = () => { calls++; return Promise.resolve({ status: 200, headers: {}, time: 1 }); };
    const { stats } = await runBurst({ n: 5000, concurrency: 999 }, runner, {});
    expect(calls).toBe(CAP);   // n clamped to MAX_N
    expect(stats.sent).toBe(CAP);
  });

  it('records a thrown runner as a net error without aborting the burst', async () => {
    let i = 0;
    const runner = () => { i++; return i === 2 ? Promise.reject(new Error('boom')) : Promise.resolve({ status: 200, headers: {}, time: 1 }); };
    const { stats } = await runBurst({ n: 3, concurrency: 1 }, runner, {});
    expect(stats.sent).toBe(3);
    expect(stats.net).toBe(1);
    expect(stats.ok2xx).toBe(2);
  });

  it('does not launch when the abort signal is already set', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runBurst({ n: 10, concurrency: 2 }, () => { calls++; return Promise.resolve({ status: 200, headers: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });

  it('streams progress up to n', async () => {
    const seen = [];
    await runBurst({ n: 4, concurrency: 2 }, () => Promise.resolve({ status: 200, headers: {}, time: 1 }), { onProgress: (done, n) => seen.push([done, n]) });
    expect(seen[seen.length - 1]).toEqual([4, 4]);
    expect(seen).toHaveLength(4);
  });

  it('counts 429 and rate-limit headers in stats', async () => {
    const runner = () => Promise.resolve({ status: 429, headers: { 'Retry-After': '1' }, time: 1 });
    const { stats } = await runBurst({ n: 3, concurrency: 3 }, runner, {});
    expect(stats.c429).toBe(3);
    expect(stats.throttled).toBe(true);
  });
});

describe('summarizeRateLimit', () => {
  it('tallies per-test verdicts', () => {
    const results = { t1: { verdict: 'vuln' }, t2: { verdict: 'pass' }, t3: { verdict: 'vuln' } };
    expect(summarizeRateLimit(results)).toEqual({ total: 3, pass: 1, vuln: 2, inconclusive: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: FAIL — `runBurst is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/ratelimit.js

function clampInt(v, lo, hi) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

// Fire `test.n` requests through the injected `runner(test, index) => Promise<resp>`,
// keeping at most `test.concurrency` in flight (both clamped to the caps). Records
// each response, never throws out of the burst, streams opts.onProgress(done, n),
// and stops launching new requests once opts.signal aborts (in-flight ones finish).
export async function runBurst(test, runner, opts = {}) {
  const { signal, onProgress } = opts;
  const n = clampInt(test && test.n, 1, MAX_N);
  const c = clampInt(test && test.concurrency, 1, MAX_CONCURRENCY);
  const responses = [];
  let launched = 0, done = 0;
  async function worker() {
    while (launched < n) {
      if (signal && signal.aborted) return;
      const i = launched++;
      let cell;
      try {
        const resp = await runner(test, i);
        cell = {
          status: resp && typeof resp.status === 'number' ? resp.status : null,
          headers: (resp && resp.headers) || {},
          timeMs: (resp && resp.time) || 0,
          error: null,
        };
      } catch (e) {
        cell = { status: null, headers: {}, timeMs: 0, error: String((e && e.message) || e) };
      }
      responses[i] = cell;
      done++;
      if (onProgress) onProgress(done, n);
    }
  }
  await Promise.all(Array.from({ length: Math.min(c, n) }, () => worker()));
  const collected = responses.filter(Boolean);
  return { responses: collected, stats: computeStats(collected) };
}

function computeStats(responses) {
  const s = { sent: responses.length, ok2xx: 0, c429: 0, c4xx: 0, c5xx: 0, net: 0, avgMs: 0, maxMs: 0, throttled: false, headerHit: false };
  let totMs = 0;
  for (const r of responses) {
    const st = r.status;
    if (st == null) s.net++;
    else if (st === 429) s.c429++;
    else if (st >= 500) s.c5xx++;
    else if (st >= 400) s.c4xx++;
    else if (st >= 200 && st <= 299) s.ok2xx++;
    totMs += r.timeMs || 0;
    if ((r.timeMs || 0) > s.maxMs) s.maxMs = r.timeMs || 0;
  }
  const sig = detectThrottleSignal(responses);
  s.throttled = sig.throttled;
  s.headerHit = sig.headerHit;
  s.avgMs = responses.length ? Math.round(totMs / responses.length) : 0;
  return s;
}

// Tally per-test verdicts across the results map for the summary chips.
export function summarizeRateLimit(results) {
  const s = { total: 0, pass: 0, vuln: 0, inconclusive: 0 };
  for (const tid in results) {
    const v = results[tid] && results[tid].verdict;
    if (!v) continue;
    s.total++; if (s[v] !== undefined) s[v]++;
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ratelimit.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/ratelimit.js src/__tests__/ratelimit.test.js
git commit -m "feat(ratelimit): bounded-burst concurrency pool + stats + summarize"
```

---

## Task 4: Persist `rateLimit` in the matrix config

**Files:**
- Modify: `src/qa/authz.js` (`saveMatrixConfig`)
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a new describe to src/__tests__/authz.test.js
describe('persistence — rateLimit', () => {
  it('round-trips a rateLimit blob when present and omits it when absent', () => {
    installLocalStorage();
    const rateLimit = { tests: [{ id: 'rl1', reqId: 'r1', method: 'POST', path: '/login', identityId: 'anon', n: 30, concurrency: 5, sensitivity: 'sensitive' }] };
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401], rateLimit });
    expect(loadMatrixConfig().rateLimit).toEqual(rateLimit);

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().rateLimit).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — `loadMatrixConfig().rateLimit` is `undefined` in the first assertion.

- [ ] **Step 3: Write minimal implementation**

Edit `saveMatrixConfig` in `src/qa/authz.js` to also persist `rateLimit` when present (alongside `oracleConfig` and `bola`):

```js
export function saveMatrixConfig(state) {
  try {
    const { identities = [], endpoints = [], expect = {}, denySet = DEFAULT_DENY_SET, oracleConfig, bola, rateLimit } = state || {};
    const cleanIdentities = identities.map(({ id, name, auth }) => ({ id, name, auth }));
    const payload = { identities: cleanIdentities, endpoints, expect, denySet };
    if (oracleConfig) payload.oracleConfig = oracleConfig;
    if (bola) payload.bola = bola;
    if (rateLimit) payload.rateLimit = rateLimit;
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
git commit -m "feat(security): persist rateLimit config in matrix config"
```

---

## Task 5: i18n keys for the rate-limit UI

**Files:**
- Modify: `src/qa/i18n.jsx` (after the `bola.*` keys in each locale)

- [ ] **Step 1: Add the keys to `en-US`**

Insert after the last `bola.*` entry in the `en-US` block:

```js
    'security.mode.ratelimit': 'Rate limit',
    'rl.subtitle': 'Fire a bounded real burst and flag endpoints with no throttling.',
    'rl.addTest': 'Add endpoint to test',
    'rl.identity': 'As identity',
    'rl.count': 'Requests (N)',
    'rl.concurrency': 'Concurrency',
    'rl.sensitivity': 'Sensitivity',
    'rl.sensitive': 'sensitive',
    'rl.normal': 'normal',
    'rl.run': 'Run burst',
    'rl.noTests': 'No tests yet — add an endpoint to burst.',
    'rl.confirmTitle': 'Send real traffic?',
    'rl.confirmBody': 'Send {n} real requests to {target} as {identity}?',
    'rl.confirm': 'Send burst',
    'rl.cancel': 'Cancel',
    'rl.verdict.pass': 'throttled',
    'rl.verdict.vuln': 'NO LIMIT',
    'rl.verdict.inconclusive': 'check',
    'rl.stat.sent': 'sent',
    'rl.stat.ok': '2xx',
    'rl.stat.c429': '429',
    'rl.stat.throttleHdr': 'rate-limit headers',
    'rl.stat.err': 'errors',
    'rl.stat.avg': 'avg ms',
    'rl.stat.max': 'max ms',
    'rl.findingTitle': 'No rate limiting observed',
```

- [ ] **Step 2: Add the keys to `zh-TW`**

Insert at the matching position in the `zh-TW` block (after its `bola.*` entries):

```js
    'security.mode.ratelimit': '速率限制',
    'rl.subtitle': '發一段有上限的真實 burst，標出沒有 throttle 的 endpoint。',
    'rl.addTest': '加入要測的 endpoint',
    'rl.identity': '以身分',
    'rl.count': '請求數 (N)',
    'rl.concurrency': '並發度',
    'rl.sensitivity': '敏感度',
    'rl.sensitive': '敏感',
    'rl.normal': '一般',
    'rl.run': '執行 burst',
    'rl.noTests': '還沒有測試 — 加一個 endpoint 來 burst。',
    'rl.confirmTitle': '要發真實流量？',
    'rl.confirmBody': '要對 {target} 以 {identity} 發 {n} 筆真實請求嗎？',
    'rl.confirm': '送出 burst',
    'rl.cancel': '取消',
    'rl.verdict.pass': '有限流',
    'rl.verdict.vuln': '無限流',
    'rl.verdict.inconclusive': '待查',
    'rl.stat.sent': '送出',
    'rl.stat.ok': '2xx',
    'rl.stat.c429': '429',
    'rl.stat.throttleHdr': '限流標頭',
    'rl.stat.err': '錯誤',
    'rl.stat.avg': '平均 ms',
    'rl.stat.max': '最大 ms',
    'rl.findingTitle': '未觀察到速率限制',
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(ratelimit): mode toggle + rate-limit panel keys (en-US + zh-TW)"
```

---

## Task 6: `RateLimitPanel.jsx` — config, confirm modal, burst run, stats, findings

**Files:**
- Create: `src/qa/RateLimitPanel.jsx`
- Test: `src/__tests__/ratelimit-panel.test.jsx`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/ratelimit-panel.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitPanel } from '../qa/RateLimitPanel.jsx';
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

const identities = [{ id: 'anon', name: 'anon', auth: { type: 'none' } }];
const rl = (n = 5, sensitivity = 'sensitive') => ({ tests: [{ id: 'rl1', reqId: 'r1', method: 'POST', path: 'https://api.test/login', identityId: 'anon', n, concurrency: 2, sensitivity }] });

function renderPanel(rlState) {
  return render(
    <I18nProvider>
      <RateLimitPanel identities={identities} rateLimit={rlState} setRateLimit={() => {}}
                      env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('RateLimitPanel — runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'POST', name: 'login', path: 'https://api.test/login' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
  });

  it('requires the confirm modal before any burst, then flags a vuln + finding when unthrottled', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: {} } };
    renderPanel(rl());

    // Clicking Run opens the confirm modal but sends nothing yet.
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    expect(document.querySelector('.qa-rl-confirm')).not.toBeNull();
    expect(document.querySelector('.qa-rl-verdict')).toBeNull();

    // Confirm fires the burst.
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--vuln')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.qa-sec-findpanel, .qa-rl-findpanel')).not.toBeNull();
  });

  it('reports pass when a rate-limit header is present', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: { 'Retry-After': '5' } } };
    renderPanel(rl());
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--pass')).not.toBeNull(), { timeout: 4000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ratelimit-panel.test.jsx`
Expected: FAIL — `Failed to resolve import "../qa/RateLimitPanel.jsx"`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// src/qa/RateLimitPanel.jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge } from './components.jsx';
import { useI18n } from './useI18n.js';
import { qaRunSavedRequest } from './sendRequest.js';
import {
  runBurst, detectThrottleSignal, classifyRateLimit, rateLimitSeverity,
  summarizeRateLimit, MAX_N, MAX_CONCURRENCY,
} from './ratelimit.js';

const { useState: useS, useMemo, useRef } = React;
const VLABEL = { pass: 'rl.verdict.pass', vuln: 'rl.verdict.vuln', inconclusive: 'rl.verdict.inconclusive' };

function allRequests() {
  return (window.QA.COLLECTIONS || []).flatMap(c =>
    (c.folders || []).flatMap(f => (f.requests || []).map(r => ({ reqId: r.id, method: r.method, path: r.path }))));
}

let rlSeq = 1;

function RateLimitPanel({ identities, rateLimit, setRateLimit, env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
  const { t } = useI18n();
  const tests = rateLimit.tests || [];
  const [results, setResults] = useS({});
  const [running, setRunning] = useS(null);   // testId currently bursting
  const [confirming, setConfirming] = useS(null);   // test pending confirmation
  const abortRef = useRef(null);

  const setTests = (updater) => setRateLimit(s => ({ ...s, tests: typeof updater === 'function' ? updater(s.tests || []) : updater }));
  const addTest = (r) => setTests(ts => ts.some(x => x.reqId === r.reqId)
    ? ts
    : [...ts, { id: `rl_${Date.now()}_${rlSeq++}`, reqId: r.reqId, method: r.method, path: r.path, identityId: (identities[0] || {}).id, n: 30, concurrency: 5, sensitivity: 'sensitive' }]);
  const removeTest = (id) => setTests(ts => ts.filter(x => x.id !== id));
  const patchTest = (id, patch) => setTests(ts => ts.map(x => x.id === id ? { ...x, ...patch } : x));

  const idName = (id) => { const i = identities.find(x => x.id === id); return i ? (i.name || i.id) : id; };

  const doRun = async (test) => {
    const identity = identities.find(x => x.id === test.identityId) || identities[0];
    const runner = () => qaRunSavedRequest({ id: test.reqId }, {
      env, vars, cookies, sslVerify, authOverride: identity && identity.auth, oauthToken: identity && identity._oauthToken,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(test.id);
    setResults(r => ({ ...r, [test.id]: { progress: { done: 0, n: test.n }, stats: null, verdict: null } }));
    try {
      const { responses, stats } = await runBurst(test, runner, {
        signal: controller.signal,
        onProgress: (done, n) => setResults(r => ({ ...r, [test.id]: { ...(r[test.id] || {}), progress: { done, n } } })),
      });
      const signal = detectThrottleSignal(responses);
      const completed = responses.filter(x => x.status != null).length;
      const verdict = classifyRateLimit(signal, completed);
      const severity = rateLimitSeverity(test.sensitivity, verdict);
      const finding = severity ? {
        oracle: 'rate-limit', severity, title: t('rl.findingTitle'),
        path: `${test.method} ${test.path}`, evidence: `${stats.sent} requests, no 429/rate-limit headers`, source: 'rule',
      } : null;
      setResults(r => ({ ...r, [test.id]: { progress: { done: stats.sent, n: test.n }, stats, verdict, severity, finding } }));
    } finally {
      setRunning(null);
    }
  };
  const stop = () => { if (abortRef.current) abortRef.current.abort(); setRunning(null); };

  const summary = useMemo(() => summarizeRateLimit(results), [results]);
  const allFindings = useMemo(() => tests.map(t0 => results[t0.id] && results[t0.id].finding).filter(Boolean), [results, tests]);

  const reqs = allRequests();

  return (
    <div className="qa-rl">
      <div className="qa-sec-head">
        <div><h2>{t('security.mode.ratelimit')}</h2><p>{t('rl.subtitle')}</p></div>
      </div>

      <div className="qa-sec-summary">
        {['total', 'vuln', 'pass', 'inconclusive'].map(k => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>{summary[k] || 0} {k === 'total' ? 'Total' : t('rl.verdict.' + k)}</span>
        ))}
      </div>

      <div className="qa-sec-toolbar">
        <select className="qa-inp qa-inp--mini" value="" onChange={e => { const r = reqs.find(x => x.reqId === e.target.value); if (r) addTest(r); }}>
          <option value="">{t('rl.addTest')}…</option>
          {reqs.map(r => <option key={r.reqId} value={r.reqId}>{r.method} {r.path}</option>)}
        </select>
      </div>

      {!tests.length && <div className="qa-sec-empty">{t('rl.noTests')}</div>}

      {tests.map(test => {
        const res = results[test.id];
        const isRunning = running === test.id;
        return (
          <div key={test.id} className="qa-rl-test">
            <div className="qa-rl-test-head">
              <MethodBadge method={test.method} size="sm" /> <code>{test.path}</code>
              <button className="qa-sec-x" onClick={() => removeTest(test.id)}><Icon name="x" size={11} /></button>
            </div>

            <div className="qa-rl-cfg">
              <label>{t('rl.identity')}:
                <select className="qa-inp qa-inp--mini" value={test.identityId} onChange={e => patchTest(test.id, { identityId: e.target.value })}>
                  {identities.map(i => <option key={i.id} value={i.id}>{i.name || i.id}</option>)}
                </select>
              </label>
              <label>{t('rl.count')}:
                <input className="qa-inp qa-inp--mini" type="number" min="1" max={MAX_N} value={test.n}
                       onChange={e => patchTest(test.id, { n: Math.max(1, Math.min(MAX_N, parseInt(e.target.value, 10) || 1)) })} />
              </label>
              <label>{t('rl.concurrency')}:
                <input className="qa-inp qa-inp--mini" type="number" min="1" max={MAX_CONCURRENCY} value={test.concurrency}
                       onChange={e => patchTest(test.id, { concurrency: Math.max(1, Math.min(MAX_CONCURRENCY, parseInt(e.target.value, 10) || 1)) })} />
              </label>
              <label>{t('rl.sensitivity')}:
                <select className="qa-inp qa-inp--mini" value={test.sensitivity} onChange={e => patchTest(test.id, { sensitivity: e.target.value })}>
                  <option value="sensitive">{t('rl.sensitive')}</option>
                  <option value="normal">{t('rl.normal')}</option>
                </select>
              </label>
              {isRunning
                ? <button className="qa-btn qa-btn--danger qa-btn--sm" onClick={stop}><Icon name="stop" size={12} /> {t('security.stop')}</button>
                : <button className="qa-btn qa-btn--primary qa-btn--sm" onClick={() => setConfirming(test)}><Icon name="play" size={12} /> {t('rl.run')}</button>}
            </div>

            {res && res.progress && isRunning && (
              <div className="qa-rl-progress"><div className="qa-rl-progress-bar" style={{ width: `${Math.round((res.progress.done / res.progress.n) * 100)}%` }} /></div>
            )}

            {res && res.stats && (
              <div className="qa-rl-result">
                <span className={`qa-rl-verdict qa-rl-verdict--${res.verdict}`}>{t(VLABEL[res.verdict] || 'rl.verdict.inconclusive')}</span>
                <span className="qa-rl-stat">{res.stats.sent} {t('rl.stat.sent')}</span>
                <span className="qa-rl-stat">{res.stats.ok2xx} {t('rl.stat.ok')}</span>
                <span className="qa-rl-stat">{res.stats.c429} {t('rl.stat.c429')}</span>
                <span className="qa-rl-stat">{res.stats.headerHit ? '✓' : '—'} {t('rl.stat.throttleHdr')}</span>
                <span className="qa-rl-stat">{res.stats.net} {t('rl.stat.err')}</span>
                <span className="qa-rl-stat">{res.stats.avgMs} {t('rl.stat.avg')}</span>
                <span className="qa-rl-stat">{res.stats.maxMs} {t('rl.stat.max')}</span>
              </div>
            )}
          </div>
        );
      })}

      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel qa-rl-findpanel">
          <h3>{t('security.findings.panelTitle')} ({allFindings.length})</h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="qa-sec-modal" onClick={() => setConfirming(null)}>
          <div className="qa-sec-modal-body qa-rl-confirm" onClick={e => e.stopPropagation()}>
            <h3>{t('rl.confirmTitle')}</h3>
            <p>{t('rl.confirmBody', { n: confirming.n, target: `${confirming.method} ${confirming.path}`, identity: idName(confirming.identityId) })}</p>
            <div className="qa-rl-confirm-actions">
              <button className="qa-link" onClick={() => setConfirming(null)}>{t('rl.cancel')}</button>
              <button className="qa-btn qa-btn--danger" onClick={() => { const test = confirming; setConfirming(null); doRun(test); }}>{t('rl.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { RateLimitPanel });
export { RateLimitPanel };
```

> Note on `t('rl.confirmBody', {...})`: this uses the i18n interpolation form. Verify `useI18n`'s `t` supports a params object (the codebase already uses it elsewhere, e.g. `t('perf.stageMeta', { seconds, vus })`). If for any reason it doesn't, fall back to building the string from the three values inline — but it does.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ratelimit-panel.test.jsx`
Expected: PASS (confirm modal gates the burst; vuln+finding on unthrottled canned 200; pass when `Retry-After` present).

- [ ] **Step 5: Commit**

```bash
git add src/qa/RateLimitPanel.jsx src/__tests__/ratelimit-panel.test.jsx
git commit -m "feat(ratelimit): RateLimitPanel — config, confirm modal, burst, stats, findings"
```

---

## Task 7: Security.jsx — third mode (Rate limit) in the toggle

**Files:**
- Modify: `src/qa/Security.jsx`
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to the existing describe in `src/__tests__/security-page.test.jsx`:

```js
  it('switches to the Rate-limit mode via the header toggle', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Rate limit/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl')).not.toBeNull());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — no "Rate limit" button / `.qa-rl` never renders.

- [ ] **Step 3: Write minimal implementation**

In `src/qa/Security.jsx`:

(a) Add the import after the `BolaPanel` import (line ~17):
```js
import { RateLimitPanel } from './RateLimitPanel.jsx';
```

(b) Add `rateLimit` state after the `bola` state (line ~105):
```js
  const [rateLimit, setRateLimit] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.rateLimit) || { tests: [] }; });
```

(c) Thread `rateLimit` into the persisted `state` memo (add to the `withDefaults` object AND the dep array, line ~108):
```js
  const state = useMemo(() => withDefaults({ identities, endpoints, expect, denySet: denySet.length ? denySet : DEFAULT_DENY_SET, oracleConfig, bola, rateLimit }), [identities, endpoints, expect, denySet, oracleConfig, bola, rateLimit]);
```

(d) Add the third toggle button in `.qa-sec-modetoggle` (after the `bola` button, line ~220):
```jsx
          <button className={`qa-seg ${mode === 'ratelimit' ? 'qa-seg--on' : ''}`} onClick={() => setMode('ratelimit')}>{t('security.mode.ratelimit')}</button>
```

(e) Change the body branch (currently `{mode === 'bola' ? <BolaPanel/> : (<>…matrix…</>)}`, lines ~229-232) to handle three modes. Replace the opening of that ternary:
```jsx
      {mode === 'bola' ? (
        <BolaPanel identities={identities} bola={bola} setBola={setBola}
                   env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
      ) : mode === 'ratelimit' ? (
        <RateLimitPanel identities={identities} rateLimit={rateLimit} setRateLimit={setRateLimit}
                        env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
      ) : (
      <>
```
(Leave the existing matrix `<> … </>` body and its closing `)}` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS (existing matrix + bola-toggle tests + the new rate-limit toggle test all green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): Rate-limit mode in the Security toggle"
```

---

## Task 8: CSS — rate-limit panel, stats, progress, confirm modal

**Files:**
- Modify: `src/qa/qa.css` (append after the BOLA block)

- [ ] **Step 1: Append the styles**

```css
  /* ── Rate-limit / abuse mode ────────────────────────────────────────────── */
  .qa-rl-test { margin-top: 14px; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .qa-rl-test-head { display: flex; align-items: center; gap: 8px; }
  .qa-rl-test-head code { font-family: var(--font-mono); font-size: 12.5px; }
  .qa-rl-cfg { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 10px; font-size: 12px; color: var(--text-dim); }
  .qa-rl-cfg label { display: inline-flex; align-items: center; gap: 4px; }
  .qa-rl-cfg .qa-inp--mini { width: 90px; }
  .qa-btn--sm { padding: 4px 10px; font-size: 12px; }
  .qa-rl-progress { margin-top: 10px; height: 6px; border-radius: 3px; background: rgba(127,127,127,.15); overflow: hidden; }
  .qa-rl-progress-bar { height: 100%; background: var(--accent, #4f8cff); transition: width .15s linear; }
  .qa-rl-result { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; font-size: 12px; }
  .qa-rl-stat { color: var(--text-dim); }
  .qa-rl-verdict { font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 10px; }
  .qa-rl-verdict--vuln { background: rgba(220,38,38,.14); color: #dc2626; }
  .qa-rl-verdict--pass { background: rgba(22,163,74,.14); color: #16a34a; }
  .qa-rl-verdict--inconclusive { background: rgba(127,127,127,.12); color: var(--text-dim); }
  .qa-rl-confirm h3 { margin: 0 0 8px; font-size: 14px; }
  .qa-rl-confirm p { margin: 0 0 14px; font-size: 13px; color: var(--text-dim); }
  .qa-rl-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/qa/qa.css
git commit -m "style(ratelimit): panel, stats, progress, confirm-modal styles"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites PASS (existing + new `ratelimit.test.js`, `ratelimit-panel.test.jsx`, extended `authz`/`security-page`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Placeholder scan on new code**

Run: `grep -rn "TODO\|FIXME" src/qa/ratelimit.js src/qa/RateLimitPanel.jsx`
Expected: no output.

- [ ] **Step 4: Final status**

```bash
git status   # expect clean working tree
git log --oneline master..HEAD | cat
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** throttle detection 429+headers case-insensitive (T1) ✓ · verdict pass/vuln/inconclusive (T2) ✓ · severity sensitive=high/normal=low (T2) ✓ · bounded burst with concurrency pool, caps clamped, abort, progress, per-request error isolation (T3) ✓ · persistence under `rateLimit` (T4) ✓ · zh-TW i18n (T5) ✓ · RateLimitPanel config (identity/N/concurrency/sensitivity) + confirm-before-run modal + progress + stats card + findings (T6) ✓ · third Security mode (T7) ✓ · CSS (T8) ✓.
- **Type consistency:** burst response cell `{status, headers, timeMs, error}` is produced by `runBurst` (T3) and consumed by `detectThrottleSignal` (T1) and the panel's `completed` filter (T6). `test` shape `{id, reqId, method, path, identityId, n, concurrency, sensitivity}` is identical across persistence (T4), engine (T3), and panel (T6). `Finding` shape matches phase 1. The `runBurst` runner signature `(test, index) => Promise<resp>` matches the panel's runner (T6) which ignores the index.
- **Deviation from spec:** none of substance. The findings panel is rendered inside `RateLimitPanel` reusing the phase-1 `qa-sec-findpanel` classes (same as BOLA), not a lifted shared component.
- **Canned-path note:** the executor returns `window.QA.RESPONSES[reqId]` (with its `headers`) for every call, so a burst of identical canned responses is deterministic: no rate-limit header → `vuln`+finding; a `Retry-After` header → `pass`. That exercises the full detect→classify→severity→finding chain.
- **Real-traffic caveat:** outside tests (Tauri/dev), `runBurst` fires real requests. Caps (200/10) + the confirm modal are the guardrails; the Stop button aborts.
