# Batch AI Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-engine, findings-only, advisory AI layer to the Security page that condenses matrix + BOLA + rate-limit findings into a short, prioritized, categorized triage — never mutating the real findings.

**Architecture:** A new pure module `src/qa/triage.js` (normalize → cap → prompt → one `qaCallLLM` call → defensive parse) and a thin `src/qa/TriagePanel.jsx` card placed above the mode tabs in `Security.jsx`. Findings reach the card via callback-up aggregation: `BolaPanel`/`RateLimitPanel` emit a normalized list upward; matrix findings are normalized in `Security.jsx`. Triage output lives in its own transient state.

**Tech Stack:** React (global `window.React`), Vitest + Testing Library, the existing `qaCallLLM` shared LLM helper, i18n via `useI18n` (`src/qa/i18n.jsx`, en-US + zh-TW).

**Spec:** `docs/superpowers/specs/2026-06-03-batch-ai-triage-design.md`

---

## File Structure

- **Create** `src/qa/triage.js` — pure logic: `normalizeFindings`, `buildTriageInput`, `buildTriagePrompt`, `parseTriage`, `runTriage`. No React, no DOM.
- **Create** `src/qa/TriagePanel.jsx` — the collapsible "AI Triage" card. Thin; calls `runTriage`.
- **Create** `src/__tests__/triage.test.js` — pure-module unit tests.
- **Create** `src/__tests__/triage-panel.test.jsx` — component tests (inject a stub triage runner).
- **Modify** `src/qa/Security.jsx` — normalize matrix findings, hold bola/ratelimit findings, build the union, render `TriagePanel` above the tabs, pass `onGoToEngine={setMode}`.
- **Modify** `src/qa/BolaPanel.jsx` — add `onFindings` prop; emit normalized BOLA findings on results change.
- **Modify** `src/qa/RateLimitPanel.jsx` — add `onFindings` prop; emit normalized rate-limit findings on results change.
- **Modify** `src/qa/i18n.jsx` — `security.triage.*` keys in both locales.
- **Modify** `src/qa/qa.css` — `.qa-sec-triage*` styles.

**Normalized finding shape** (used everywhere in this plan):
```js
{ engine, severity, oracle, title, path, evidence, ref }
// ref: matrix {reqId, idId} | bola {testId, attackerId, ownerId} | ratelimit {testId}
```

---

## Task 1: `triage.js` — normalize + cap

**Files:**
- Create: `src/qa/triage.js`
- Test: `src/__tests__/triage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/triage.test.js
import { describe, it, expect } from 'vitest';
import { normalizeFindings, buildTriageInput, TRIAGE_CAP } from '../qa/triage.js';

const f = (severity, over = {}) => ({ severity, oracle: 'schema', title: 'T', path: 'a.b', evidence: 'e', ...over });

describe('normalizeFindings', () => {
  it('tags engine and ref, defaulting evidence to empty string', () => {
    const out = normalizeFindings('bola', [{ severity: 'high', oracle: 'object-authz', title: 'X', path: 'GET /o' }],
      (_finding, i) => ({ testId: 't', i }));
    expect(out).toEqual([{ engine: 'bola', severity: 'high', oracle: 'object-authz', title: 'X', path: 'GET /o', evidence: '', ref: { testId: 't', i: 0 } }]);
  });
  it('returns [] for empty/missing input', () => {
    expect(normalizeFindings('matrix', null, () => ({}))).toEqual([]);
  });
});

describe('buildTriageInput', () => {
  it('sorts by severity desc and assigns stable indexes', () => {
    const union = [f('low'), f('critical'), f('medium')];
    const { input } = buildTriageInput(union);
    expect(input.map(x => x.severity)).toEqual(['critical', 'medium', 'low']);
    expect(input.map(x => x.i)).toEqual([0, 1, 2]);
  });
  it('caps to N keeping highest severity and reports dropped count', () => {
    const union = [f('critical'), f('high'), f('low')];
    const { input, kept, dropped } = buildTriageInput(union, 2);
    expect(input.map(x => x.severity)).toEqual(['critical', 'high']);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
  });
  it('default cap is TRIAGE_CAP', () => {
    expect(TRIAGE_CAP).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: FAIL — "Failed to resolve import '../qa/triage.js'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/qa/triage.js
// ── QA Companion — batch AI triage (pure logic) ───────────────────────────
// Normalize findings across engines, cap by severity, build/parse a single
// advisory LLM pass. Never mutates the real findings. UI in TriagePanel.jsx.
import './setup.js';
import { qaCallLLM } from './llm.js';
import { SEVERITY_ORDER } from './oracles.js';

export const TRIAGE_CAP = 150;
export const TRIAGE_CATEGORIES = ['object-authz', 'schema-drift', 'sensitive-exposure', 'rate-limit', 'auth-matrix', 'false-positive', 'other'];
const PRIORITIES = ['p1', 'p2', 'p3'];

// Normalize one engine's findings into the flat triage shape with a back-ref.
// refOf(finding, index) -> ref object the panel uses to navigate back.
export function normalizeFindings(engine, findings, refOf) {
  return (findings || []).map((f, i) => ({
    engine, severity: f.severity, oracle: f.oracle, title: f.title,
    path: f.path, evidence: f.evidence || '', ref: refOf ? refOf(f, i) : null,
  }));
}

// Cap the union by severity (highest first) and tag each kept finding with a
// stable index `i`. Returns { input (sent to LLM), kept (for back-refs), dropped }.
export function buildTriageInput(union, cap = TRIAGE_CAP) {
  const sorted = (union || []).slice().sort(
    (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  const kept = sorted.slice(0, cap);
  const input = kept.map((f, i) => ({
    i, engine: f.engine, severity: f.severity, oracle: f.oracle, title: f.title, path: f.path, evidence: f.evidence,
  }));
  return { input, kept, dropped: Math.max(0, sorted.length - kept.length) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/qa/triage.js src/__tests__/triage.test.js
git commit -m "feat(triage): normalize + severity-capped triage input"
```

---

## Task 2: `triage.js` — prompt + defensive parse

**Files:**
- Modify: `src/qa/triage.js`
- Test: `src/__tests__/triage.test.js`

- [ ] **Step 1: Write the failing test** (append to `src/__tests__/triage.test.js`)

```js
import { buildTriagePrompt, parseTriage } from '../qa/triage.js';

const kept = [
  { engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'Cross-object', path: 'GET /o/{id}', evidence: 'alice→bob', ref: { testId: 't', attackerId: 'a', ownerId: 'b' } },
  { engine: 'matrix', severity: 'high', oracle: 'schema', title: 'Undeclared field', path: 'user.ssn', evidence: '', ref: { reqId: 'r', idId: 'i' } },
];

describe('buildTriagePrompt', () => {
  it('embeds the indexed findings and forbids inventing findings', () => {
    const p = buildTriagePrompt([{ i: 0, severity: 'high', title: 'X' }]);
    expect(p).toContain('Never invent findings');
    expect(p).toContain('"i": 0');
  });
});

describe('parseTriage', () => {
  it('parses a clean object and resolves findingIndexes back to kept findings', () => {
    const raw = JSON.stringify({ headline: '1 worth a look', items: [
      { title: 'IDOR', category: 'object-authz', priority: 'p1', rationale: 'real', findingIndexes: [0], likelyFalsePositive: false }] });
    const out = parseTriage(raw, kept);
    expect(out.headline).toBe('1 worth a look');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].findings[0].ref).toEqual({ testId: 't', attackerId: 'a', ownerId: 'b' });
  });
  it('tolerates ```json fences and surrounding prose', () => {
    const raw = 'Sure!\n```json\n{"headline":"h","items":[{"title":"t","category":"x","priority":"zz","rationale":"r","findingIndexes":[1]}]}\n```';
    const out = parseTriage(raw, kept);
    expect(out.headline).toBe('h');
    expect(out.items[0].category).toBe('other');   // invalid enum coerced
    expect(out.items[0].priority).toBe('p3');       // invalid priority coerced
    expect(out.items[0].likelyFalsePositive).toBe(false); // missing -> false
  });
  it('drops out-of-range indexes and items left with zero valid refs', () => {
    const raw = JSON.stringify({ headline: 'h', items: [
      { title: 'invented', category: 'other', priority: 'p2', rationale: '', findingIndexes: [99] },
      { title: 'partial', category: 'other', priority: 'p2', rationale: '', findingIndexes: [0, 99] }] });
    const out = parseTriage(raw, kept);
    expect(out.items).toHaveLength(1);             // first dropped (zero valid refs)
    expect(out.items[0].findings).toHaveLength(1); // 99 stripped, 0 kept
  });
  it('returns empty triage on junk', () => {
    expect(parseTriage('not json at all', kept)).toEqual({ headline: '', items: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: FAIL — "buildTriagePrompt is not a function".

- [ ] **Step 3: Write minimal implementation** (append to `src/qa/triage.js`)

```js
export function buildTriagePrompt(input) {
  return (
    'You are triaging security findings from an automated API scan. ' +
    'Group related findings, surface the few that truly need a human, and flag likely false positives. ' +
    'Categories you may use: ' + TRIAGE_CATEGORIES.join(', ') + '. ' +
    'Return ONLY a JSON object: {"headline": string, "items": [{"title": string, "category": string, ' +
    '"priority": "p1"|"p2"|"p3", "rationale": string, "findingIndexes": number[], "likelyFalsePositive": boolean}]}. ' +
    'Reference findings only by their `i` index. Never invent findings.\n\n' +
    'Findings:\n' + JSON.stringify(input, null, 2)
  );
}

// Defensive parse: strip code fences, extract the first balanced JSON object,
// validate items, resolve findingIndexes back to `kept`, drop invalid refs and
// zero-ref items, coerce bad enums. Total failure -> empty triage.
export function parseTriage(raw, kept) {
  let obj;
  try {
    const text = String(raw).replace(/```json/gi, '').replace(/```/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : text);
  } catch { return { headline: '', items: [] }; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items)) return { headline: '', items: [] };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    const idxs = Array.isArray(it.findingIndexes) ? it.findingIndexes : [];
    const findings = idxs.filter(n => Number.isInteger(n) && n >= 0 && n < kept.length).map(n => kept[n]);
    if (!findings.length) continue;   // drop invented / zero-ref items
    items.push({
      title: String(it.title || findings[0].title || 'Finding cluster'),
      category: TRIAGE_CATEGORIES.includes(it.category) ? it.category : 'other',
      priority: PRIORITIES.includes(it.priority) ? it.priority : 'p3',
      rationale: String(it.rationale || ''),
      likelyFalsePositive: it.likelyFalsePositive === true,
      findings,
    });
  }
  return { headline: String(obj.headline || ''), items };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: PASS (all triage tests).

- [ ] **Step 5: Commit**

```bash
git add src/qa/triage.js src/__tests__/triage.test.js
git commit -m "feat(triage): prompt builder + defensive parser with back-ref validation"
```

---

## Task 3: `triage.js` — `runTriage` orchestration

**Files:**
- Modify: `src/qa/triage.js`
- Test: `src/__tests__/triage.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
import { runTriage } from '../qa/triage.js';

describe('runTriage', () => {
  const union = [
    { engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'X', path: 'GET /o', evidence: '', ref: { testId: 't' } },
    { engine: 'matrix', severity: 'low', oracle: 'schema', title: 'Y', path: 'a', evidence: '', ref: { reqId: 'r', idId: 'i' } },
  ];
  it('passes the prompt to the injected callLLM and returns parsed + meta', async () => {
    let seenPrompt = '';
    const stub = async (p) => { seenPrompt = p; return JSON.stringify({ headline: 'h', items: [{ title: 't', category: 'object-authz', priority: 'p1', rationale: 'r', findingIndexes: [0] }] }); };
    const out = await runTriage(union, stub);
    expect(seenPrompt).toContain('Never invent findings');
    expect(out.headline).toBe('h');
    expect(out.total).toBe(2);
    expect(out.dropped).toBe(0);
    expect(out.items[0].findings[0].engine).toBe('bola');
  });
  it('short-circuits an empty union without calling the LLM', async () => {
    let called = false;
    const out = await runTriage([], async () => { called = true; return '{}'; });
    expect(called).toBe(false);
    expect(out).toEqual({ headline: '', items: [], dropped: 0, total: 0 });
  });
  it('reports dropped when over the cap', async () => {
    const out = await runTriage(union, async () => '{"headline":"h","items":[]}', { cap: 1 });
    expect(out.dropped).toBe(1);
    expect(out.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: FAIL — "runTriage is not a function".

- [ ] **Step 3: Write minimal implementation** (append)

```js
// Orchestration. `callLLM` is injectable for tests; defaults to qaCallLLM.
// Returns { headline, items, dropped, total }. Empty union -> no LLM call.
export async function runTriage(union, callLLM = qaCallLLM, opts = {}) {
  const cap = opts.cap || TRIAGE_CAP;
  const { input, kept, dropped } = buildTriageInput(union, cap);
  const total = (union || []).length;
  if (!input.length) return { headline: '', items: [], dropped: 0, total: 0 };
  const raw = await callLLM(buildTriagePrompt(input));
  const parsed = parseTriage(raw, kept);
  return { ...parsed, dropped, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/triage.test.js`
Expected: PASS (all triage tests).

- [ ] **Step 5: Commit**

```bash
git add src/qa/triage.js src/__tests__/triage.test.js
git commit -m "feat(triage): runTriage orchestration with injectable LLM"
```

---

## Task 4: i18n keys (en-US + zh-TW)

**Files:**
- Modify: `src/qa/i18n.jsx` — add to the `Object.assign(dict['en-US'], { … })` block (starts ~line 684) and the `Object.assign(dict['zh-TW'], { … })` block (starts ~line 1005).

- [ ] **Step 1: Add the en-US keys**

Find the `Object.assign(dict['en-US'], {` block and add these entries inside it (near the other `security.*` keys):

```js
  'security.triage.title': 'AI Triage',
  'security.triage.run': 'Triage with AI',
  'security.triage.running': 'Triaging…',
  'security.triage.empty': 'Run a scan first — no findings to triage.',
  'security.triage.aiUnavailable': 'No AI provider configured (Settings → AI / LLM).',
  'security.triage.none': 'AI found nothing worth escalating.',
  'security.triage.capped': 'Triaged {kept} of {total} findings ({dropped} dropped, lowest severity).',
  'security.triage.fp': 'likely false positive',
  'security.triage.count': '{count} finding(s)',
  'security.triage.goto': 'Go to {engine}',
  'security.triage.p1': 'P1',
  'security.triage.p2': 'P2',
  'security.triage.p3': 'P3',
  'security.triage.engine.matrix': 'RBAC matrix',
  'security.triage.engine.bola': 'Object access',
  'security.triage.engine.ratelimit': 'Rate limit',
  'security.triage.cat.object-authz': 'Object authz',
  'security.triage.cat.schema-drift': 'Schema drift',
  'security.triage.cat.sensitive-exposure': 'Sensitive data',
  'security.triage.cat.rate-limit': 'Rate limit',
  'security.triage.cat.auth-matrix': 'Auth matrix',
  'security.triage.cat.false-positive': 'False positive',
  'security.triage.cat.other': 'Other',
```

- [ ] **Step 2: Add the zh-TW keys**

Find the `Object.assign(dict['zh-TW'], {` block and add the matching entries:

```js
  'security.triage.title': 'AI 分流',
  'security.triage.run': '用 AI 分流',
  'security.triage.running': '分流中…',
  'security.triage.empty': '請先執行掃描 — 沒有可分流的結果。',
  'security.triage.aiUnavailable': '尚未設定 AI 供應商（設定 → AI / LLM）。',
  'security.triage.none': 'AI 沒有找到需要優先處理的項目。',
  'security.triage.capped': '已分流 {total} 筆中的 {kept} 筆（捨去 {dropped} 筆最低嚴重度）。',
  'security.triage.fp': '疑似誤判',
  'security.triage.count': '{count} 筆結果',
  'security.triage.goto': '前往 {engine}',
  'security.triage.p1': 'P1',
  'security.triage.p2': 'P2',
  'security.triage.p3': 'P3',
  'security.triage.engine.matrix': 'RBAC 矩陣',
  'security.triage.engine.bola': '物件存取',
  'security.triage.engine.ratelimit': '速率限制',
  'security.triage.cat.object-authz': '物件授權',
  'security.triage.cat.schema-drift': 'Schema 偏移',
  'security.triage.cat.sensitive-exposure': '敏感資料',
  'security.triage.cat.rate-limit': '速率限制',
  'security.triage.cat.auth-matrix': '權限矩陣',
  'security.triage.cat.false-positive': '誤判',
  'security.triage.cat.other': '其他',
```

- [ ] **Step 3: Verify both locales have identical key sets**

Run:
```bash
node -e "const k=s=>[...s.matchAll(/'(security\.triage\.[^']+)'/g)].map(m=>m[1]); const f=require('fs').readFileSync('src/qa/i18n.jsx','utf8'); const en=f.slice(f.indexOf(\"dict['en-US']\")); const zh=f.slice(f.indexOf(\"dict['zh-TW']\")); const E=new Set(k(en.slice(0,zh.length?en.indexOf(\"dict['zh-TW']\"):en.length))); const Z=new Set(k(zh)); const miss=[...E].filter(x=>!Z.has(x)); console.log(miss.length?('MISSING in zh: '+miss):'OK: '+E.size+' keys parity')"
```
Expected: `OK: 23 keys parity` (or similar count, no MISSING).

- [ ] **Step 4: Commit**

```bash
git add src/qa/i18n.jsx
git commit -m "i18n(triage): security.triage.* keys (en-US + zh-TW)"
```

---

## Task 5: `TriagePanel.jsx` component + styles

**Files:**
- Create: `src/qa/TriagePanel.jsx`
- Modify: `src/qa/qa.css`
- Test: `src/__tests__/triage-panel.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/__tests__/triage-panel.test.jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TriagePanel } from '../qa/TriagePanel.jsx';

const union = [{ engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'IDOR', path: 'GET /o/{id}', evidence: 'alice→bob', ref: { testId: 't' } }];
const triageResult = { headline: '1 worth a look', total: 1, dropped: 0, items: [
  { title: 'IDOR cluster', category: 'object-authz', priority: 'p1', rationale: 'confirmed cross-object read', likelyFalsePositive: false, findings: union }] };

describe('TriagePanel', () => {
  it('disables the button when no AI provider is configured', () => {
    render(<TriagePanel union={union} aiReady={false} onGoToEngine={() => {}} />);
    expect(screen.getByText('Triage with AI').closest('button')).toBeDisabled();
  });
  it('disables the button when the union is empty', () => {
    render(<TriagePanel union={[]} aiReady={true} onGoToEngine={() => {}} />);
    expect(screen.getByText('Triage with AI').closest('button')).toBeDisabled();
  });
  it('runs triage and renders items; "Go to" calls onGoToEngine', async () => {
    const onGo = vi.fn();
    const runner = vi.fn(async () => triageResult);
    render(<TriagePanel union={union} aiReady={true} onGoToEngine={onGo} runner={runner} />);
    fireEvent.click(screen.getByText('Triage with AI'));
    await waitFor(() => expect(screen.getByText('IDOR cluster')).toBeInTheDocument());
    expect(screen.getByText('1 worth a look')).toBeInTheDocument();
    fireEvent.click(screen.getByText('IDOR cluster'));               // expand the item
    fireEvent.click(screen.getByText('Go to Object access'));        // engine label for 'bola'
    expect(onGo).toHaveBeenCalledWith('bola');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/triage-panel.test.jsx`
Expected: FAIL — "Failed to resolve import '../qa/TriagePanel.jsx'".

- [ ] **Step 3: Write the component**

```jsx
// src/qa/TriagePanel.jsx
// QA Companion — batch AI triage card. Advisory only: renders a separate
// prioritized/clustered view over the union of engine findings and never
// mutates them. Pure logic lives in triage.js.
import React from 'react';
import './setup.js';
import { Icon } from './components.jsx';
import { useI18n } from './useI18n.js';
import { runTriage } from './triage.js';

const { useState: useS } = React;
const PRIO_LABEL = { p1: 'security.triage.p1', p2: 'security.triage.p2', p3: 'security.triage.p3' };

function TriagePanel({ union = [], aiReady, onGoToEngine, runner }) {
  const { t } = useI18n();
  const doTriage = runner || runTriage;
  const [open, setOpen] = useS(true);
  const [busy, setBusy] = useS(false);
  const [error, setError] = useS(null);
  const [triage, setTriage] = useS(null);
  const [expanded, setExpanded] = useS({});

  const run = async () => {
    setBusy(true); setError(null);
    try { setTriage(await doTriage(union)); }
    catch (e) { setError(String((e && e.message) || e)); }
    finally { setBusy(false); }
  };

  const disabled = busy || !aiReady || !union.length;
  const hint = !aiReady ? t('security.triage.aiUnavailable') : (!union.length ? t('security.triage.empty') : undefined);

  return (
    <div className="qa-sec-triage">
      <div className="qa-sec-triage-head">
        <button className="qa-iconbtn" onClick={() => setOpen(o => !o)} title={t('security.triage.title')}>
          <Icon name="chevron" size={14} className={open ? '' : 'qa-rot-90'} />
        </button>
        <h3><Icon name="sparkle" size={14} /> {t('security.triage.title')}</h3>
        <button className="qa-link" onClick={run} disabled={disabled} title={hint}>
          <Icon name="zap" size={13} /> {busy ? t('security.triage.running') : t('security.triage.run')}
        </button>
      </div>

      {open && (
        <div className="qa-sec-triage-body">
          {error && <div className="qa-sec-drawer-err">{error}</div>}
          {triage && triage.dropped > 0 && (
            <div className="qa-meta">{t('security.triage.capped', { kept: triage.total - triage.dropped, total: triage.total, dropped: triage.dropped })}</div>
          )}
          {triage && triage.headline && <div className="qa-sec-triage-headline">{triage.headline}</div>}
          {triage && triage.items.length === 0 && <div className="qa-sec-empty">{t('security.triage.none')}</div>}
          {triage && triage.items.map((it, i) => (
            <div key={i} className={`qa-sec-triage-item qa-prio--${it.priority}`}>
              <div className="qa-sec-triage-item-head" onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}>
                <span className={`qa-sec-triage-prio qa-prio--${it.priority}`}>{t(PRIO_LABEL[it.priority])}</span>
                <span className="qa-sec-triage-cat">{t('security.triage.cat.' + it.category)}</span>
                <span className="qa-sec-triage-title">{it.title}</span>
                {it.likelyFalsePositive && <span className="qa-sec-triage-fp">{t('security.triage.fp')}</span>}
                <span className="qa-meta">{t('security.triage.count', { count: it.findings.length })}</span>
              </div>
              {it.rationale && <div className="qa-sec-triage-rationale">{it.rationale}</div>}
              {expanded[i] && (
                <ul className="qa-sec-findlist">
                  {it.findings.map((f, j) => (
                    <li key={j} className={`qa-sev--${f.severity}`}>
                      <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                      <span className="qa-sec-find-oracle">{t('security.triage.engine.' + f.engine)}</span>
                      <code className="qa-sec-find-path">{f.path}</code>
                      {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                      <button className="qa-link qa-sec-triage-goto" onClick={() => onGoToEngine && onGoToEngine(f.engine)}>
                        {t('security.triage.goto', { engine: t('security.triage.engine.' + f.engine) })}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TriagePanel });
export { TriagePanel };
```

- [ ] **Step 4: Add styles** — append to `src/qa/qa.css`:

```css
/* ── AI Triage card ─────────────────────────────────────────────── */
.qa-sec-triage { border: 1px solid var(--qa-border); border-radius: 10px; margin-bottom: 12px; background: var(--qa-surface); }
.qa-sec-triage-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.qa-sec-triage-head h3 { margin: 0; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.qa-sec-triage-head .qa-link { margin-left: auto; }
.qa-sec-triage-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.qa-sec-triage-headline { font-weight: 600; }
.qa-sec-triage-item { border: 1px solid var(--qa-border); border-radius: 8px; padding: 8px 10px; }
.qa-sec-triage-item-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.qa-sec-triage-title { font-weight: 600; }
.qa-sec-triage-prio { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
.qa-prio--p1 .qa-sec-triage-prio, .qa-sec-triage-prio.qa-prio--p1 { background: #fde2e1; color: #b42318; }
.qa-prio--p2 .qa-sec-triage-prio, .qa-sec-triage-prio.qa-prio--p2 { background: #fef0c7; color: #b54708; }
.qa-prio--p3 .qa-sec-triage-prio, .qa-sec-triage-prio.qa-prio--p3 { background: #eaecf0; color: #475467; }
.qa-sec-triage-cat { font-size: 11px; color: var(--qa-text-dim); }
.qa-sec-triage-fp { font-size: 11px; color: #b54708; background: #fef0c7; padding: 1px 6px; border-radius: 4px; }
.qa-sec-triage-rationale { font-size: 12px; color: var(--qa-text-dim); margin-top: 4px; }
.qa-sec-triage-goto { margin-left: auto; }
.qa-rot-90 { transform: rotate(-90deg); }
```

> Note: if any `var(--qa-*)` token name differs in `qa.css`, match the names already used by `.qa-sec-findpanel`/`.qa-sec-chip` nearby. Visual only — not test-blocking.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/triage-panel.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/qa/TriagePanel.jsx src/qa/qa.css src/__tests__/triage-panel.test.jsx
git commit -m "feat(triage): advisory TriagePanel card + styles"
```

---

## Task 6: Wire the union + card into `Security.jsx`

**Files:**
- Modify: `src/qa/Security.jsx`
- Test: `src/__tests__/security-page.test.jsx`

- [ ] **Step 1: Add the imports and React hook**

At the top of `src/qa/Security.jsx`, add `useCallback` to the React destructure (line ~20):

```js
const { useState: useS, useEffect: useE, useMemo, useRef, useCallback } = React;
```

Add the panel import after the `BolaPanel` import (line ~17):

```js
import { TriagePanel } from './TriagePanel.jsx';
```

- [ ] **Step 2: Add normalized-findings state + memos**

Immediately after the existing `allFindings` memo (ends ~line 135), add:

```js
  // Cross-engine triage union. Matrix findings are normalized here (with a
  // {reqId, idId} back-ref); BOLA/rate-limit panels report their own normalized
  // lists upward via onFindings. Stable callbacks so the child effects don't loop.
  const [bolaFindings, setBolaFindings] = useS([]);
  const [rlFindings, setRlFindings] = useS([]);
  const onBolaFindings = useCallback((list) => setBolaFindings(list), []);
  const onRlFindings = useCallback((list) => setRlFindings(list), []);
  const matrixNormalized = useMemo(() => {
    const out = [];
    for (const ep of endpoints) {
      for (const id of identities) {
        const cell = results[ep.reqId] && results[ep.reqId][id.id];
        for (const f of (cell && cell.findings) || []) {
          out.push({ engine: 'matrix', severity: f.severity, oracle: f.oracle, title: f.title,
                     path: f.path, evidence: f.evidence || '', ref: { reqId: ep.reqId, idId: id.id } });
        }
      }
    }
    return out;
  }, [results, endpoints, identities]);
  const triageUnion = useMemo(() => [...matrixNormalized, ...bolaFindings, ...rlFindings], [matrixNormalized, bolaFindings, rlFindings]);
```

- [ ] **Step 3: Render the card above the tabs**

Change the opening of the return JSX (line ~225) from:

```jsx
    <div className="qa-sec">
      <div className="qa-sec-tabs">
```

to:

```jsx
    <div className="qa-sec">
      <TriagePanel union={triageUnion} aiReady={aiReady} onGoToEngine={setMode} />
      <div className="qa-sec-tabs">
```

(`aiReady` and `setMode` are already in scope above the return.)

- [ ] **Step 4: Pass the callbacks to the child panels**

Update the `BolaPanel` render (line ~233) to add `onFindings`:

```jsx
        <BolaPanel identities={identities} bola={bola} setBola={setBola} onFindings={onBolaFindings}
                   env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
```

Update the `RateLimitPanel` render (line ~236) to add `onFindings`:

```jsx
        <RateLimitPanel identities={identities} rateLimit={rateLimit} setRateLimit={setRateLimit} onFindings={onRlFindings}
                        env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />
```

- [ ] **Step 5: Write the failing test** — append to `src/__tests__/security-page.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SecurityPage } from '../qa/SecurityPage.jsx?triage'; // see note below

describe('SecurityPage triage card', () => {
  it('renders the AI Triage card above the tabs', () => {
    render(<SecurityPage env={{ label: 'None', baseUrl: '' }} vars={[]} cookies={[]} sslVerify={true} />);
    expect(screen.getByText('AI Triage')).toBeInTheDocument();
  });
});
```

> **Note:** match the existing import style already used at the top of `security-page.test.jsx` (it imports `SecurityPage` from `'../qa/Security.jsx'`). Reuse that exact import; the `?triage` above is a placeholder — delete it and use the same import the file already has. Ensure `window.QA` is seeded the same way the existing tests in this file do (copy their `beforeEach`/setup).

- [ ] **Step 6: Run test to verify it fails, then passes**

Run: `npx vitest run src/__tests__/security-page.test.jsx`
Expected: first FAIL (card not wired) if run before Steps 1-4, then PASS after. Since steps 1-4 are already applied, expect PASS. Also run the full suite:

Run: `npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/qa/Security.jsx src/__tests__/security-page.test.jsx
git commit -m "feat(triage): wire cross-engine union + TriagePanel into Security page"
```

---

## Task 7: Emit normalized findings from BOLA + rate-limit panels

**Files:**
- Modify: `src/qa/BolaPanel.jsx`
- Modify: `src/qa/RateLimitPanel.jsx`
- Test: `src/__tests__/bola-panel.test.jsx`, `src/__tests__/ratelimit-panel.test.jsx`

- [ ] **Step 1: Add `useEffect` to BolaPanel's React destructure** (line ~14)

```js
const { useState: useS, useEffect: useE, useMemo, useRef } = React;
```

- [ ] **Step 2: Accept `onFindings` and emit on results change**

Add `onFindings` to the `BolaPanel` signature (line ~33):

```js
function BolaPanel({ identities, bola, setBola, onFindings, env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
```

Immediately after the existing `allFindings` memo (ends ~line 84), add:

```js
  // Report normalized findings upward for cross-engine AI triage (advisory).
  useE(() => {
    if (!onFindings) return;
    const out = [];
    for (const test of tests) {
      const atk = (results[test.id] && results[test.id].attacks) || {};
      for (const a in atk) for (const o in atk[a]) {
        const f = atk[a][o] && atk[a][o].finding;
        if (f) out.push({ engine: 'bola', severity: f.severity, oracle: f.oracle, title: f.title,
                          path: f.path, evidence: f.evidence || '', ref: { testId: test.id, attackerId: a, ownerId: o } });
      }
    }
    onFindings(out);
  }, [results, tests, onFindings]);
```

- [ ] **Step 3: Add `useEffect` to RateLimitPanel's React destructure** (line ~16)

```js
const { useState: useS, useEffect: useE, useMemo, useRef } = React;
```

- [ ] **Step 4: Accept `onFindings` and emit on results change**

Add `onFindings` to the `RateLimitPanel` signature (line ~26):

```js
function RateLimitPanel({ identities, rateLimit, setRateLimit, onFindings, env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
```

Immediately after the existing `allFindings` memo (line ~73), add:

```js
  // Report normalized findings upward for cross-engine AI triage (advisory).
  useE(() => {
    if (!onFindings) return;
    const out = tests.map(t0 => {
      const f = results[t0.id] && results[t0.id].finding;
      return f ? { engine: 'ratelimit', severity: f.severity, oracle: f.oracle, title: f.title,
                   path: f.path, evidence: f.evidence || '', ref: { testId: t0.id } } : null;
    }).filter(Boolean);
    onFindings(out);
  }, [results, tests, onFindings]);
```

- [ ] **Step 5: Write the failing tests**

Append to `src/__tests__/bola-panel.test.jsx` (reuse the file's existing setup/`window.QA` seeding and identities):

```jsx
it('emits normalized findings to onFindings when an attack cell has a finding', async () => {
  const onFindings = vi.fn();
  // Render BolaPanel with identities/bola that produce a finding, drive a run,
  // then assert the latest onFindings call contains an engine:'bola' item with a ref.
  // (Mirror this file's existing run-driving helper; assert shape only.)
  // Example assertion once a run has produced a 'vuln' cell:
  // const last = onFindings.mock.calls.at(-1)[0];
  // expect(last[0]).toMatchObject({ engine: 'bola', ref: { testId: expect.any(String) } });
  expect(typeof onFindings).toBe('function');
});
```

> **Note:** the BOLA/rate-limit panel tests in this repo already drive a run via an injected runner / mocked `qaRunSavedRequest`. Reuse that exact mechanism from the existing tests in each file; the new test only adds the `onFindings` spy and asserts the emitted shape (`engine`, `severity`, `path`, `ref`). Write the concrete assertion against a finding the existing setup already produces.

Append the analogous test to `src/__tests__/ratelimit-panel.test.jsx` asserting `engine: 'ratelimit'` and `ref: { testId }`.

- [ ] **Step 6: Run tests + full suite**

Run: `npx vitest run src/__tests__/bola-panel.test.jsx src/__tests__/ratelimit-panel.test.jsx`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS (whole suite, no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/qa/BolaPanel.jsx src/qa/RateLimitPanel.jsx src/__tests__/bola-panel.test.jsx src/__tests__/ratelimit-panel.test.jsx
git commit -m "feat(triage): emit normalized findings from BOLA + rate-limit panels"
```

---

## Task 8: Manual verification + invariant check

**Files:** none (verification only).

- [ ] **Step 1: Build/lint sanity**

Run: `npx vitest run` (full suite green) and, if the repo has it, `npm run build` to confirm no import/JSX errors.
Expected: all tests pass; build succeeds.

- [ ] **Step 2: Invariant — triage never mutates real findings**

Confirm by code review that `TriagePanel` holds triage output in its own `useS` state and that `Security.jsx`/`BolaPanel`/`RateLimitPanel` never read triage output back into their `results`/`findings`. The matrix findings panel ([Security.jsx](../../../src/qa/Security.jsx)), the BOLA findings panel, and the rate-limit findings panel must render exactly as before this feature.

- [ ] **Step 3: Manual smoke (optional, if a dev server is used)**

With an AI provider configured: add endpoints/identities, run the matrix (and optionally BOLA + rate-limit), click **Triage with AI**, confirm the card lists prioritized items, expanding shows linked findings, and **Go to {engine}** switches tabs. With no provider configured, confirm the button is disabled with the hint.

- [ ] **Step 4: Final commit (if any review fixes were made)**

```bash
git add -A
git commit -m "chore(triage): verification fixes"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** findings-only input (Tasks 1-3), all-three-engine scope (Tasks 6-7), advisory-only/never-mutates (Task 8 invariant; triage state is isolated), callback-up aggregation (Tasks 6-7), transient on-demand (TriagePanel state), capped with no silent truncation (Task 1 `dropped` + Task 4 `capped` string + Task 5 render), defensive parse / no invented findings (Task 2). All covered.
- **Deferred (per spec, not in this plan):** auto-opening the destination drawer; triaging raw bodies; persisting/exporting triage.
- **Type consistency:** the normalized finding shape `{engine, severity, oracle, title, path, evidence, ref}` is identical across `triage.js`, `Security.jsx`, `BolaPanel.jsx`, `RateLimitPanel.jsx`. `runTriage` returns `{headline, items, dropped, total}`; `parseTriage` returns `{headline, items}` (Task 3 adds `dropped`/`total`). Each `item` is `{title, category, priority, rationale, likelyFalsePositive, findings}`.
