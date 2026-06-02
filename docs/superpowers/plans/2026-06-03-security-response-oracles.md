# Security Response Oracles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure `oracles.js` layer that scans the responses the Security matrix already captures for sensitive-data exposure and schema/contract drift, surfacing the results as an independent findings layer in the matrix UI.

**Architecture:** A new pure module `src/qa/oracles.js` (unit-tested like `authz.js`) exposes `scanSensitive`, `inferContract`, `checkSchema`, `runOracles`, `summarizeFindings`, plus an optional `scanSensitiveLLM`. `src/qa/Security.jsx` runs `runOracles` in its existing `onCell` callback, keeps a transient per-endpoint baseline in a ref, and renders findings on cells, in the drawer, in an aggregated panel, and in a severity summary. `authz.js`/`runMatrix` are not touched except to persist an `oracleConfig` blob.

**Tech Stack:** React (no JSX framework beyond what's there), Vitest + @testing-library/react, the existing `qaCallLLM`/`loadLlmCfg` helpers, flat per-locale i18n in `i18n.jsx`.

**Spec:** `docs/superpowers/specs/2026-06-03-security-response-oracles-design.md`

**Note on PII scope:** The spec table lists email / phone / credit-card / national-id. This plan implements **email + Luhn-validated credit-card** (both low-false-positive) and **defers phone / national-id** — they are FP-prone and would erode the "this is a test, not a guess" credibility. They're noted in the roadmap.

---

## File Structure

- **Create** `src/qa/oracles.js` — pure oracle engine. One responsibility: turn a captured response (+ optional baseline + config) into `Finding[]`. No React, no `window` UI state.
- **Create** `src/__tests__/oracles.test.js` — unit tests for every exported function.
- **Modify** `src/qa/authz.js` — extend `saveMatrixConfig`/`loadMatrixConfig` to round-trip an `oracleConfig` blob. (Already the home of matrix persistence.)
- **Modify** `src/__tests__/authz.test.js` — assert `oracleConfig` round-trips.
- **Modify** `src/qa/Security.jsx` — baseline ref, `onCell` oracle run, cell badge, drawer findings + AI button, aggregated panel, severity summary.
- **Modify** `src/__tests__/security-page.test.jsx` — assert a leaky response surfaces a findings badge + drawer entry on the canned path.
- **Modify** `src/qa/i18n.jsx` — add `security.findings.*`, `security.oracle.*`, `security.severity.*` keys to `en-US` and `zh-TW`.
- **Modify** `src/qa/qa.css` — severity colors + badge/panel/chip styles.

**Finding shape (used everywhere — keep identical):**
```js
{ oracle: 'sensitive-data' | 'schema',
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical',
  title: string, path: string, evidence: string /* masked */, source: 'rule' | 'llm' }
```

Test command: `npx vitest run <file>`. Build: `npm run build`.

---

## Task 1: oracles.js foundation — constants, `redact`, `worstSeverity`, `walkJson`, `normalizePath`

**Files:**
- Create: `src/qa/oracles.js`
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/oracles.test.js
import { describe, it, expect } from 'vitest';
import { SEVERITY_ORDER, redact, worstSeverity } from '../qa/oracles.js';

describe('SEVERITY_ORDER', () => {
  it('ranks info < low < medium < high < critical', () => {
    expect(SEVERITY_ORDER).toEqual(['info', 'low', 'medium', 'high', 'critical']);
  });
});

describe('redact', () => {
  it('masks the middle of long secrets, keeping a short prefix/suffix', () => {
    const out = redact('eyJabcdef1234567890ghijkl9c');
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('abcdef1234567890');
    expect(out.startsWith('eyJ')).toBe(true);
  });
  it('fully masks short values', () => {
    expect(redact('abcd')).toBe('••••');
  });
});

describe('worstSeverity', () => {
  it('returns the highest-ranked severity in a finding list, or null when empty', () => {
    expect(worstSeverity([{ severity: 'low' }, { severity: 'high' }, { severity: 'medium' }])).toBe('high');
    expect(worstSeverity([])).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: FAIL — `Failed to resolve import "../qa/oracles.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/oracles.js
// ── QA Companion — response oracles (pure logic, no React) ─────────────────
// Scans a captured response for sensitive-data exposure and schema/contract
// drift, producing Finding[]. UI lives in Security.jsx; this file is unit-tested.
import './setup.js';

export const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];

// Mask the middle of a value so evidence never carries a usable secret.
export function redact(value) {
  const s = value == null ? '' : String(value);
  if (s.length <= 8) return '•'.repeat(s.length);
  return s.slice(0, 3) + '…<redacted>…' + s.slice(-2);
}

// Highest-ranked severity in a findings list (drives the cell badge color).
export function worstSeverity(findings) {
  if (!findings || !findings.length) return null;
  return findings.reduce(
    (w, f) => (SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(w) ? f.severity : w),
    'info',
  );
}

// Collapse array indices so a contract path is element-position agnostic.
export function normalizePath(p) { return String(p).replace(/\[\d+\]/g, '[]'); }

// Deep-walk a JSON value, calling visit(path, key, value) for EVERY property
// (objects and primitives alike, so key-name rules fire on object-valued keys),
// then recursing into objects/arrays. Array elements get an indexed path so
// sensitive-data findings can point at the exact element.
export function walkJson(node, visit, path = '') {
  if (node == null || typeof node !== 'object') return;
  const isArr = Array.isArray(node);
  const keys = isArr ? node.map((_, i) => String(i)) : Object.keys(node);
  for (const k of keys) {
    const v = node[k];
    const p = path ? (isArr ? `${path}[${k}]` : `${path}.${k}`) : (isArr ? `[${k}]` : k);
    visit(p, isArr ? '' : k, v);
    if (v && typeof v === 'object') walkJson(v, visit, p);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS (3 describes green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): foundation — severity order, redact, walkJson"
```

---

## Task 2: Sensitive-data oracle — `scanSensitive`

**Files:**
- Modify: `src/qa/oracles.js`
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/oracles.test.js
import { scanSensitive, DEFAULT_ORACLE_CONFIG } from '../qa/oracles.js';

const resp = (body, headers = {}) => ({ status: 200, body, headers });

describe('scanSensitive — secrets', () => {
  it('flags a JWT in a body value', () => {
    const f = scanSensitive(resp({ tok: 'eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4' }));
    expect(f.some(x => x.title === 'JWT in response' && x.severity === 'high')).toBe(true);
    expect(f[0].evidence).toContain('<redacted>');   // never the raw token
  });
  it('flags a private key block as critical', () => {
    const f = scanSensitive(resp({ k: '-----BEGIN RSA PRIVATE KEY-----\nMIIE' }));
    expect(f.some(x => x.title === 'Private key' && x.severity === 'critical')).toBe(true);
  });
  it('flags secret-named fields by key, even when the value is an object', () => {
    const f = scanSensitive(resp({ password: 'hunter2', nested: { client_secret: { rotated: true } } }));
    const titles = f.map(x => x.title);
    expect(titles.filter(t => t === 'Secret-named field present').length).toBe(2);
  });
  it('flags an AWS access key id', () => {
    const f = scanSensitive(resp({ a: 'AKIAIOSFODNN7EXAMPLE' }));
    expect(f.some(x => x.title === 'AWS access key id')).toBe(true);
  });
});

describe('scanSensitive — PII', () => {
  it('flags an email', () => {
    const f = scanSensitive(resp({ user: { email: 'a.b@example.com' } }));
    const hit = f.find(x => x.title === 'Email address');
    expect(hit).toBeTruthy();
    expect(hit.path).toBe('user.email');
  });
  it('flags only Luhn-valid card numbers', () => {
    expect(scanSensitive(resp({ c: '4242424242424242' })).some(x => x.title === 'Credit-card-like number')).toBe(true);
    expect(scanSensitive(resp({ c: '4242424242424241' })).some(x => x.title === 'Credit-card-like number')).toBe(false);
  });
});

describe('scanSensitive — internal/debug', () => {
  it('flags internal/debug field names', () => {
    const f = scanSensitive(resp({ stacktrace: 'at Foo.bar (x.js:1)' }));
    expect(f.some(x => x.title === 'Internal/debug field')).toBe(true);
  });
  it('flags leaky response headers', () => {
    const f = scanSensitive(resp({ ok: true }, { Server: 'nginx/1.2.3', 'X-Powered-By': 'Express' }));
    expect(f.filter(x => x.title === 'Server/version header').length).toBe(2);
    expect(f.find(x => x.title === 'Server/version header').path).toMatch(/^header:/);
  });
});

describe('scanSensitive — config', () => {
  it('returns nothing when the sensitive oracle is disabled', () => {
    expect(scanSensitive(resp({ email: 'a@b.co' }), { ...DEFAULT_ORACLE_CONFIG, sensitive: false })).toEqual([]);
  });
  it('applies a per-group severity override', () => {
    const f = scanSensitive(resp({ email: 'a@b.co' }), { ...DEFAULT_ORACLE_CONFIG, severityOverrides: { pii: 'low' } });
    expect(f.find(x => x.title === 'Email address').severity).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: FAIL — `scanSensitive is not exported` / `DEFAULT_ORACLE_CONFIG is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/oracles.js

export const DEFAULT_ORACLE_CONFIG = { sensitive: true, schema: true, llm: false, severityOverrides: {} };

// Each rule matches by key-name (`key`) and/or value-regex (`value`). `luhn`
// requires the matched value to pass a Luhn check (cuts card false positives).
const RULES = [
  { id: 'jwt',         group: 'secrets',  severity: 'high',     title: 'JWT in response',          value: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/ },
  { id: 'aws-key',     group: 'secrets',  severity: 'high',     title: 'AWS access key id',        value: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', group: 'secrets',  severity: 'critical', title: 'Private key',              value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'secret-name', group: 'secrets',  severity: 'critical', title: 'Secret-named field present', key: /^(password|passwd|pwd|secret|client_secret|access_token|refresh_token|api_?key|token)$/i },
  { id: 'email',       group: 'pii',      severity: 'medium',   title: 'Email address',            value: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: 'card',        group: 'pii',      severity: 'high',     title: 'Credit-card-like number',  value: /\b(?:\d[ -]?){13,19}\b/, luhn: true },
  { id: 'internal',    group: 'internal', severity: 'medium',   title: 'Internal/debug field',     key: /^(stack_?trace|exception|sql|query|internal.*|debug)$/i },
];

function luhnValid(s) {
  const d = String(s).replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export function scanSensitive(response, config = DEFAULT_ORACLE_CONFIG) {
  if (!config || config.sensitive === false) return [];
  const findings = [];
  const seen = new Set();
  const overrides = config.severityOverrides || {};
  const push = (rule, path, value) => {
    const k = rule.id + '@' + path;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push({
      oracle: 'sensitive-data',
      severity: overrides[rule.group] || rule.severity,
      title: rule.title, path, evidence: redact(value), source: 'rule',
    });
  };

  const headers = (response && response.headers) || {};
  for (const hk of Object.keys(headers)) {
    if (/^(server|x-powered-by)$/i.test(hk)) {
      push({ id: 'leaky-header', group: 'internal', severity: 'medium', title: 'Server/version header' }, 'header:' + hk, headers[hk]);
    }
  }

  const visit = (path, key, value) => {
    for (const rule of RULES) {
      if (rule.key && key && rule.key.test(key)) {
        push(rule, path, typeof value === 'object' ? '[object]' : value);
        continue;
      }
      if (rule.value && (typeof value === 'string' || typeof value === 'number')) {
        const m = String(value).match(rule.value);
        if (m) {
          if (rule.luhn && !luhnValid(m[0])) continue;
          push(rule, path, value);
        }
      }
    }
  };

  const body = response && response.body;
  if (body != null && typeof body === 'object') walkJson(body, visit);
  else if (typeof body === 'string') visit('$', '', body);   // non-JSON raw body
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): sensitive-data oracle (secrets, PII, internal, headers)"
```

---

## Task 3: Schema oracle — `inferContract` + `checkSchema`

**Files:**
- Modify: `src/qa/oracles.js`
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/oracles.test.js
import { inferContract, checkSchema } from '../qa/oracles.js';

describe('inferContract', () => {
  it('records normalized field paths and types, array indices collapsed', () => {
    const c = inferContract({ id: 1, name: 's', items: [{ x: 1 }, { x: 2 }] });
    expect(c['id'].type).toBe('number');
    expect(c['name'].type).toBe('string');
    expect(c['items[].x'].type).toBe('number');   // [] not [0]/[1]
  });
});

describe('checkSchema', () => {
  const base = inferContract({ id: 1, name: 's' });
  it('flags an undeclared field as low', () => {
    const f = checkSchema({ id: 1, name: 's', extra: true }, base);
    expect(f).toContainEqual(expect.objectContaining({ oracle: 'schema', title: 'Undeclared field', path: 'extra', severity: 'low' }));
  });
  it('flags a missing baseline field as medium', () => {
    const f = checkSchema({ id: 1 }, base);
    expect(f).toContainEqual(expect.objectContaining({ title: 'Missing field', path: 'name', severity: 'medium' }));
  });
  it('flags a type mismatch as medium', () => {
    const f = checkSchema({ id: '1', name: 's' }, base);
    expect(f).toContainEqual(expect.objectContaining({ title: 'Type mismatch', path: 'id', severity: 'medium' }));
  });
  it('returns nothing when body matches the contract', () => {
    expect(checkSchema({ id: 2, name: 't' }, base)).toEqual([]);
  });
  it('returns nothing when the schema oracle is disabled', () => {
    expect(checkSchema({ id: 1, name: 's', extra: 1 }, base, { ...DEFAULT_ORACLE_CONFIG, schema: false })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: FAIL — `inferContract is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/oracles.js

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;   // 'string' | 'number' | 'boolean' | 'object'
}

// Build a shallow contract: normalized path -> { type, required }.
export function inferContract(body) {
  const contract = {};
  if (body == null || typeof body !== 'object') return contract;
  walkJson(body, (path, _key, value) => { contract[normalizePath(path)] = { type: jsType(value), required: true }; });
  return contract;
}

// Compare a 2xx body against a contract; emit drift findings.
export function checkSchema(body, contract, config = DEFAULT_ORACLE_CONFIG) {
  if (!config || config.schema === false || !contract) return [];
  const findings = [];
  const present = {};
  if (body != null && typeof body === 'object') {
    walkJson(body, (path, _key, value) => { present[normalizePath(path)] = jsType(value); });
  }
  for (const p of Object.keys(present)) {
    if (!(p in contract)) {
      findings.push({ oracle: 'schema', severity: 'low', title: 'Undeclared field', path: p, evidence: '', source: 'rule' });
    } else if (present[p] !== contract[p].type && contract[p].type !== 'null' && present[p] !== 'null') {
      findings.push({ oracle: 'schema', severity: 'medium', title: 'Type mismatch', path: p, evidence: `${contract[p].type} → ${present[p]}`, source: 'rule' });
    }
  }
  for (const p of Object.keys(contract)) {
    if (contract[p].required && !(p in present)) {
      findings.push({ oracle: 'schema', severity: 'medium', title: 'Missing field', path: p, evidence: '', source: 'rule' });
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): schema oracle (inferContract + checkSchema drift)"
```

---

## Task 4: Orchestration — `runOracles` (with cross-bump) + `summarizeFindings`

**Files:**
- Modify: `src/qa/oracles.js`
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/oracles.test.js
import { runOracles, summarizeFindings } from '../qa/oracles.js';

describe('runOracles', () => {
  const baseline = inferContract({ id: 1 });   // body has only `id`
  it('runs sensitive on any status but schema only on 2xx with a baseline', () => {
    const cell200 = { status: 200, response: { status: 200, body: { id: 1, surprise: 'x' }, headers: {} } };
    const f = runOracles(cell200, { baseline });
    expect(f.some(x => x.oracle === 'schema' && x.title === 'Undeclared field')).toBe(true);

    const cell403 = { status: 403, response: { status: 403, body: { id: 1, surprise: 'x' }, headers: {} } };
    expect(runOracles(cell403, { baseline }).some(x => x.oracle === 'schema')).toBe(false);
  });
  it('cross-bumps an undeclared field that also leaks to high', () => {
    const cell = { status: 200, response: { status: 200, body: { id: 1, email: 'a@b.co' }, headers: {} } };
    const f = runOracles(cell, { baseline });
    const undeclared = f.find(x => x.oracle === 'schema' && x.path === 'email');
    expect(undeclared.severity).toBe('high');   // bumped from low
  });
  it('returns [] when the cell has no response', () => {
    expect(runOracles({ status: null, response: null }, {})).toEqual([]);
  });
});

describe('summarizeFindings', () => {
  it('tallies findings by severity across the grid', () => {
    const results = {
      r1: { a: { findings: [{ severity: 'high' }, { severity: 'low' }] }, b: { findings: [] } },
      r2: { a: { findings: [{ severity: 'high' }] } },
    };
    expect(summarizeFindings(results)).toEqual({ total: 3, bySeverity: { info: 0, low: 1, medium: 0, high: 2, critical: 0 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: FAIL — `runOracles is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/qa/oracles.js

// Run both oracles for one matrix cell. Schema runs only on 2xx with a baseline.
// An undeclared field that also trips a sensitive rule is bumped to `high`
// (silent overexposure is the dangerous case).
export function runOracles(cell, ctx = {}) {
  const { baseline, config = DEFAULT_ORACLE_CONFIG } = ctx;
  const resp = cell && cell.response;
  if (!resp) return [];
  const sensitive = scanSensitive(resp, config);
  const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
  const schema = is2xx && baseline ? checkSchema(resp.body, baseline, config) : [];
  const leakPaths = new Set(sensitive.map(f => normalizePath(f.path)));
  for (const f of schema) {
    if (f.title === 'Undeclared field' && leakPaths.has(f.path)) f.severity = 'high';
  }
  return [...sensitive, ...schema];
}

// Tally findings by severity across the matrix results grid.
export function summarizeFindings(results) {
  const bySeverity = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  let total = 0;
  for (const reqId in results) {
    for (const idId in results[reqId]) {
      const fs = (results[reqId][idId] && results[reqId][idId].findings) || [];
      for (const f of fs) { total++; if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++; }
    }
  }
  return { total, bySeverity };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): runOracles cross-bump + summarizeFindings"
```

---

## Task 5: Optional LLM pass — `scanSensitiveLLM`

**Files:**
- Modify: `src/qa/oracles.js`
- Test: `src/__tests__/oracles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to src/__tests__/oracles.test.js
import { scanSensitiveLLM } from '../qa/oracles.js';

describe('scanSensitiveLLM', () => {
  it('parses a JSON array out of the LLM reply into llm-sourced findings', async () => {
    const fakeLLM = async () => 'Here you go:\n[{"path":"note","title":"SSN in free text","severity":"high"}]';
    const f = await scanSensitiveLLM({ body: { note: 'ssn 078-05-1120' } }, fakeLLM);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ oracle: 'sensitive-data', source: 'llm', path: 'note', severity: 'high' });
  });
  it('returns [] when the reply has no parseable array', async () => {
    expect(await scanSensitiveLLM({ body: { ok: true } }, async () => 'nothing found')).toEqual([]);
  });
  it('coerces an unknown severity to medium', async () => {
    const f = await scanSensitiveLLM({ body: {} }, async () => '[{"path":"x","severity":"spicy"}]');
    expect(f[0].severity).toBe('medium');
  });
  it('wraps an LLM error', async () => {
    await expect(scanSensitiveLLM({ body: {} }, async () => { throw new Error('no key'); })).rejects.toThrow(/LLM scan failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: FAIL — `scanSensitiveLLM is not exported`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to the imports at the TOP of src/qa/oracles.js (under the existing setup import)
import { qaCallLLM } from './llm.js';
```

```js
// append to src/qa/oracles.js

// Optional, on-demand only. `callLLM` is injectable for tests; defaults to the
// shared qaCallLLM. Never called automatically and never blocks a matrix run.
export async function scanSensitiveLLM(response, callLLM = qaCallLLM) {
  const body = response && response.body;
  const text = typeof body === 'string' ? body : JSON.stringify(body || {}, null, 2);
  const prompt =
    'You are a security reviewer. Identify sensitive data exposure in this API ' +
    'response body: PII, secrets/tokens, or internal/debug fields a client should ' +
    'not receive. Return ONLY a JSON array of {"path","title","severity"} where ' +
    'severity is one of info,low,medium,high,critical. If nothing, return [].\n\n' +
    'Response body:\n' + text.slice(0, 4000);
  let raw;
  try { raw = await callLLM(prompt); } catch (e) { throw new Error('LLM scan failed: ' + ((e && e.message) || e)); }
  let arr;
  try { arr = JSON.parse((String(raw).match(/\[[\s\S]*\]/) || ['[]'])[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && x.path).map(x => ({
    oracle: 'sensitive-data',
    severity: SEVERITY_ORDER.includes(x.severity) ? x.severity : 'medium',
    title: x.title || 'AI-flagged exposure',
    path: String(x.path), evidence: '', source: 'llm',
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/oracles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/qa/oracles.js src/__tests__/oracles.test.js
git commit -m "feat(oracles): optional LLM sensitive-data pass"
```

---

## Task 6: Persist `oracleConfig` in the matrix config

**Files:**
- Modify: `src/qa/authz.js:131-140` (`saveMatrixConfig`)
- Test: `src/__tests__/authz.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a new describe to src/__tests__/authz.test.js
describe('persistence — oracleConfig', () => {
  it('round-trips oracleConfig when present and omits it when absent', () => {
    installLocalStorage();
    saveMatrixConfig({
      identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401],
      oracleConfig: { sensitive: true, schema: false, llm: false, severityOverrides: { pii: 'low' } },
    });
    expect(loadMatrixConfig().oracleConfig).toEqual({ sensitive: true, schema: false, llm: false, severityOverrides: { pii: 'low' } });

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().oracleConfig).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: FAIL — `loadMatrixConfig().oracleConfig` is `undefined` in the first assertion (save drops it).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `saveMatrixConfig` in `src/qa/authz.js` with:

```js
export function saveMatrixConfig(state) {
  try {
    const { identities = [], endpoints = [], expect = {}, denySet = DEFAULT_DENY_SET, oracleConfig } = state || {};
    // Persist only stable identity config — drop transient `_`-prefixed fields
    // (e.g. a fetched `_oauthToken`) so live access tokens are never written to
    // disk; the user re-fetches them in the identity editor after a reload.
    const cleanIdentities = identities.map(({ id, name, auth }) => ({ id, name, auth }));
    const payload = { identities: cleanIdentities, endpoints, expect, denySet };
    if (oracleConfig) payload.oracleConfig = oracleConfig;
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(payload));
  } catch { /* storage unavailable — non-fatal */ }
}
```

(`loadMatrixConfig` already returns the whole parsed object, so `oracleConfig` comes back for free.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz.test.js`
Expected: PASS (all authz tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/qa/authz.js src/__tests__/authz.test.js
git commit -m "feat(security): persist oracleConfig in matrix config"
```

---

## Task 7: i18n keys for findings / oracles / severities

**Files:**
- Modify: `src/qa/i18n.jsx` (after `'security.removeEndpoint'` in `en-US` ~line 260, and the matching spot in `zh-TW`)

- [ ] **Step 1: Add the keys to `en-US`**

Insert after `'security.removeEndpoint': 'Remove endpoint',` in the `en-US` block:

```js
    'security.findings.title': 'Findings',
    'security.findings.none': 'No findings',
    'security.findings.panelTitle': 'Security findings',
    'security.findings.scanAI': 'Scan with AI',
    'security.findings.aiScanning': 'Scanning…',
    'security.findings.aiUnavailable': 'Configure AI in Settings to scan',
    'security.oracle.sensitive-data': 'data leak',
    'security.oracle.schema': 'schema',
    'security.severity.info': 'info',
    'security.severity.low': 'low',
    'security.severity.medium': 'medium',
    'security.severity.high': 'high',
    'security.severity.critical': 'critical',
```

- [ ] **Step 2: Add the keys to `zh-TW`**

Insert at the matching position in the `zh-TW` block (after its `'security.removeEndpoint'` entry):

```js
    'security.findings.title': '發現',
    'security.findings.none': '無發現',
    'security.findings.panelTitle': '安全發現',
    'security.findings.scanAI': '用 AI 掃描',
    'security.findings.aiScanning': '掃描中…',
    'security.findings.aiUnavailable': '請先在設定配置 AI 才能掃描',
    'security.oracle.sensitive-data': '資料外洩',
    'security.oracle.schema': '結構',
    'security.severity.info': '資訊',
    'security.severity.low': '低',
    'security.severity.medium': '中',
    'security.severity.high': '高',
    'security.severity.critical': '嚴重',
```

- [ ] **Step 3: Verify build still compiles**

Run: `npm run build`
Expected: build succeeds (no syntax error from the inserts).

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(security): findings, oracle, and severity keys (en-US + zh-TW)"
```

---

## Task 8: Security.jsx — run oracles in `onCell`, baseline ref, cell badge

**Files:**
- Modify: `src/qa/Security.jsx` (imports ~line 9; state/refs ~line 81-95; `run`/`onCell` ~line 136-151; cell render ~line 216-228)
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('SecurityPage — matrix runs on the canned path', ...)` block in `src/__tests__/security-page.test.jsx`, and change the canned response in `beforeEach` to carry a leak (so a finding is produced):

```js
  it('surfaces a findings badge when the response leaks sensitive data', async () => {
    // Override the canned response with an email leak in the body.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));

    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — `.qa-sec-findbadge` never appears (no oracle wiring yet).

- [ ] **Step 3: Add imports**

In `src/qa/Security.jsx`, add after the `authz.js` import block (line ~12):

```js
import {
  runOracles, inferContract, summarizeFindings, scanSensitiveLLM, worstSeverity,
  SEVERITY_ORDER, DEFAULT_ORACLE_CONFIG,
} from './oracles.js';
```

- [ ] **Step 4: Add baseline ref + oracleConfig state**

In `SecurityPage`, after the `abortRef` line (~line 95) add:

```js
  const baselinesRef = useRef({});   // { [reqId]: contract } — transient, per run
  const [oracleConfig] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.oracleConfig) || DEFAULT_ORACLE_CONFIG; });
  const [aiScan, setAiScan] = useS({ busy: false, error: null });
```

Add `oracleConfig` to the persisted state memo (line ~98) so it round-trips:

```js
  const state = useMemo(() => withDefaults({ identities, endpoints, expect, denySet: denySet.length ? denySet : DEFAULT_DENY_SET, oracleConfig }), [identities, endpoints, expect, denySet, oracleConfig]);
```

- [ ] **Step 5: Run oracles in `onCell` and reset baselines per full run**

Replace the `run` function's body region that builds `partial`/`onCell` (lines ~141-147) with:

```js
    const partial = rowReqId ? { ...results } : {};
    setResults(partial);
    if (!rowReqId) baselinesRef.current = {};   // fresh baselines for a full run
    try {
      await runMatrix(target, runner, {
        signal: controller.signal,
        onCell: (reqId, idId, cell) => {
          const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
          if (is2xx && cell.response && !baselinesRef.current[reqId]) {
            baselinesRef.current[reqId] = inferContract(cell.response.body);
          }
          const findings = runOracles(cell, { baseline: baselinesRef.current[reqId], config: oracleConfig });
          setResults(r => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: { ...cell, findings } } }));
        },
      });
    } finally {
      setRunning(false);
    }
```

- [ ] **Step 6: Render the cell findings badge**

In the cell `<td>` (after the `{cell && <span className="qa-sec-verdict">…</span>}` line, ~line 225) add:

```jsx
                        {cell && cell.findings && cell.findings.length > 0 && (
                          <span className={`qa-sec-findbadge qa-sev--${worstSeverity(cell.findings)}`}>{cell.findings.length}</span>
                        )}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS (the original VULN test and the new badge test both green).

- [ ] **Step 8: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): run response oracles per cell + findings badge"
```

---

## Task 9: Security.jsx — drawer Findings section + "Scan with AI"

**Files:**
- Modify: `src/qa/Security.jsx` (drawer block ~line 255-274)
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add inside the same describe block:

```js
  it('lists findings in the cell drawer with a Scan with AI action', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));
    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });

    // Open the cell drawer by clicking the run cell (it has a result now).
    fireEvent.click(document.querySelector('.qa-sec-cell'));
    await waitFor(() => expect(document.querySelector('.qa-sec-findings')).not.toBeNull());
    expect(screen.getByText('user.email'.replace('user.', ''))).toBeTruthy; // path 'email' shown
    expect(screen.getByRole('button', { name: /Scan with AI/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — `.qa-sec-findings` not found (drawer has no findings section).

- [ ] **Step 3: Add the `scanWithAI` handler**

In `SecurityPage`, after the `stop` function (~line 152) add:

```js
  const scanWithAI = async () => {
    if (!drawer || !drawerCell || !drawerCell.response) return;
    setAiScan({ busy: true, error: null });
    try {
      const extra = await scanSensitiveLLM(drawerCell.response);
      const { reqId, idId } = drawer;
      setResults(r => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: { ...r[reqId][idId], findings: [...(r[reqId][idId].findings || []), ...extra] } } }));
      setAiScan({ busy: false, error: null });
    } catch (e) {
      setAiScan({ busy: false, error: String((e && e.message) || e) });
    }
  };
```

- [ ] **Step 4: Render the drawer Findings section + button**

In the drawer JSX, after the `{drawerCell.error && …}` line (~line 270) and before the Response label, insert:

```jsx
          {drawerCell.findings && drawerCell.findings.length > 0 && (
            <>
              <span className="qa-sec-drawer-label">{t('security.findings.title')}</span>
              <ul className="qa-sec-findings">
                {drawerCell.findings.slice().sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)).map((f, i) => (
                  <li key={i} className={`qa-sev--${f.severity}`}>
                    <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                    <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                    <code>{f.path}</code>
                    {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button className="qa-link" onClick={scanWithAI} disabled={aiScan.busy}>
            <Icon name="sparkles" size={13} /> {aiScan.busy ? t('security.findings.aiScanning') : t('security.findings.scanAI')}
          </button>
          {aiScan.error && <div className="qa-sec-drawer-err">{aiScan.error}</div>}
```

> If `Icon` has no `sparkles` glyph, use `name="zap"` (a glyph already used in the codebase). Verify against `components.jsx`'s icon set when implementing.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): drawer findings list + on-demand AI scan"
```

---

## Task 10: Security.jsx — aggregated findings panel + severity summary

**Files:**
- Modify: `src/qa/Security.jsx` (summary block ~line 168-172; after the grid `</div>` ~line 234)
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Write the failing test**

Add inside the describe block:

```js
  it('shows a severity summary chip and an aggregated findings panel after a run', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));
    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.qa-sec-findsummary')).not.toBeNull();
    expect(document.querySelector('.qa-sec-findpanel')).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: FAIL — `.qa-sec-findsummary` not found.

- [ ] **Step 3: Compute the findings summary + flattened list**

In `SecurityPage`, after the existing `summary` memo (~line 103) add:

```js
  const findSummary = useMemo(() => summarizeFindings(results), [results]);
  const allFindings = useMemo(() => {
    const out = [];
    for (const ep of endpoints) {
      for (const id of identities) {
        const cell = results[ep.reqId] && results[ep.reqId][id.id];
        for (const f of (cell && cell.findings) || []) {
          out.push({ ...f, endpoint: ep.path, method: ep.method, identity: id.id === 'anon' ? t('security.anon') : (id.name || id.id) });
        }
      }
    }
    return out.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  }, [results, endpoints, identities, t]);
```

- [ ] **Step 4: Render the severity summary**

After the existing `qa-sec-summary` block (~line 172) add:

```jsx
      {findSummary.total > 0 && (
        <div className="qa-sec-findsummary">
          {SEVERITY_ORDER.slice().reverse().filter(s => findSummary.bySeverity[s] > 0).map(s => (
            <span key={s} className={`qa-sec-findchip qa-sev--${s}`}>{findSummary.bySeverity[s]} {t('security.severity.' + s)}</span>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Render the aggregated panel**

After the grid `</div>` that closes `qa-sec-gridwrap` (~line 234), add:

```jsx
      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel">
          <h3>{t('security.findings.panelTitle')} ({allFindings.length})</h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                <MethodBadge method={f.method} size="sm" /> <code>{f.endpoint}</code>
                <span className="qa-sec-find-id">{f.identity}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(security): severity summary + aggregated findings panel"
```

---

## Task 11: CSS — severity colors, badge, chips, panel

**Files:**
- Modify: `src/qa/qa.css` (append a new section at the end)

- [ ] **Step 1: Append the styles**

```css
/* ── Security findings (response oracles) ───────────────────────────────── */
.qa-sev--info     { --sev: #6b7280; }
.qa-sev--low      { --sev: #2563eb; }
.qa-sev--medium   { --sev: #d97706; }
.qa-sev--high     { --sev: #ea580c; }
.qa-sev--critical { --sev: #dc2626; }

.qa-sec-findbadge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; margin-left: 6px;
  border-radius: 8px; font-size: 10px; font-weight: 700; line-height: 1;
  color: #fff; background: var(--sev, #6b7280);
}
.qa-sec-findsummary { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.qa-sec-findchip {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
  color: #fff; background: var(--sev, #6b7280);
}
.qa-sec-findpanel { margin-top: 18px; }
.qa-sec-findpanel h3 { font-size: 13px; margin: 0 0 8px; opacity: .8; }
.qa-sec-findlist, .qa-sec-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.qa-sec-findlist li, .qa-sec-findings li {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 6px 10px; border-radius: 8px; font-size: 12px;
  border-left: 3px solid var(--sev, #6b7280); background: rgba(127,127,127,.06);
}
.qa-sec-find-sev {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  color: var(--sev, #6b7280);
}
.qa-sec-find-oracle { font-size: 10px; opacity: .7; }
.qa-sec-find-id { font-size: 11px; opacity: .7; }
.qa-sec-find-path { font-size: 11px; }
.qa-sec-find-ev { font-size: 11px; opacity: .6; font-family: var(--qa-mono, monospace); }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/qa/qa.css
git commit -m "style(security): severity colors, findings badge/chips/panel"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all suites PASS (existing + new `oracles.test.js`, extended `authz.test.js` and `security-page.test.jsx`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build, no warnings introduced by these files.

- [ ] **Step 3: Confirm no stray TODO/placeholder in new code**

Run: `grep -rn "TODO\|FIXME\|placeholder" src/qa/oracles.js`
Expected: no output.

- [ ] **Step 4: Final commit (if anything uncommitted)**

```bash
git status
# if clean, nothing to do; otherwise commit remaining bits with an explanatory message
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** sensitive-data oracle (T2, T5) ✓ · schema/contract oracle (T3) ✓ · independent findings layer (Finding shape everywhere; T4 cross-bump) ✓ · matrix-only surfacing: cell drawer + aggregated panel (T9, T10) ✓ · rules-first + optional LLM (T2, T5) ✓ · inferred baseline + drift, 2xx-only, transient ref (T3, T8) ✓ · config persistence (T6) ✓ · zh-TW i18n (T7) ✓ · tests like authz.js (T1-T5) ✓.
- **Deviation from spec:** phone / national-id PII rules deferred (FP-prone) — noted at top and in roadmap. OpenAPI-attached schema + persisted baselines remain roadmap (spec already fenced them out of phase 1).
- **Type consistency:** Finding shape is identical across `scanSensitive`, `checkSchema`, `runOracles`, `scanSensitiveLLM`. Function names used in `Security.jsx` (`runOracles`, `inferContract`, `summarizeFindings`, `scanSensitiveLLM`, `worstSeverity`, `SEVERITY_ORDER`, `DEFAULT_ORACLE_CONFIG`) all match the exports defined in T1-T5.
- **Icon caveat:** T9 uses `Icon name="sparkles"`; fall back to an existing glyph if absent (verify in `components.jsx`).
