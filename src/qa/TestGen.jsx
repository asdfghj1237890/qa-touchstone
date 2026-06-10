import React from 'react';
import './setup.js';
import { Icon, MethodBadge, Spinner } from './components.jsx';
import { qaAiSend } from './llm.js';
import { useI18n } from './useI18n.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ── QA Touchstone — Test case generation (spec / BDD → cases) ──────────────
const { useState: useTG } = React;

// pdf.js is bundled locally (no CDN) and loaded on demand the first time a PDF
// is imported, so it never weighs down the initial app bundle. The worker is
// emitted as a same-origin asset by Vite (?url) and works under the Tauri CSP.
let _pdfjsPromise = null;
function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then((mod) => {
      const lib = mod.getDocument ? mod : mod.default;
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return lib;
    });
  }
  return _pdfjsPromise;
}

const SAMPLE_BDD = `Feature: User management API

  Scenario: List users returns the first page
    Given the service has seeded users
    When I GET /v1/users?page=1
    Then the response status should be 200
    And the body should contain a "data" array

  Scenario: Create a user with a valid payload
    Given I am authenticated as an admin
    When I POST /v1/users with a valid body
    Then the response status should be 201
    And the response should include the new user id

  Scenario: Reject creation when the email is missing
    Given I am authenticated as an admin
    When I POST /v1/users without an email
    Then the response status should be 400
    And the error code should be "validation_error"

  Scenario: Reject access with an expired token
    Given my access token has expired
    When I GET /v1/me
    Then the response status should be 401
    And the error should be "invalid_token"

  Scenario: Delete a user removes it
    Given a user with id 7303 exists
    When I DELETE /v1/users/7303
    Then the response status should be 204`;

const SAMPLE_OPENAPI = `{
  "openapi": "3.0.0",
  "info": { "title": "User Service", "version": "1.0.0" },
  "paths": {
    "/v1/users": {
      "get":  { "summary": "List users" },
      "post": { "summary": "Create user" }
    },
    "/v1/users/{id}": {
      "get":    { "summary": "Get user" },
      "delete": { "summary": "Delete user" }
    },
    "/v1/me": { "get": { "summary": "Current user" } }
  }
}`;

const SAMPLE_TEXT = `User Service — product requirements

The GET /v1/users endpoint must return the first page of users when no page is given, and should support page and per_page query params.
Creating a user requires a name and a valid email; a missing email should return a 400 validation error.
Only authenticated admins can create users — requests without a valid token must be rejected with 401.
Deleting a user should return 204 and remove the record permanently.
Clients that exceed 5000 requests per hour will receive a 429 rate-limit response.
The service should respond within 200 ms under normal load.`;

const METHODS_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b/i;

function classify(text) {
  const t = text.toLowerCase();
  if (/invalid|unauthor|missing|without|forbidden|expired|wrong|reject|fail|denied|not found|409|40\d|50\d/.test(t)) return 'negative';
  if (/empty|maximum|minimum|boundary|limit|too |duplicate|special|long|zero|large/.test(t)) return 'edge';
  return 'happy';
}

function inferStatus(text) {
  const m = text.match(/status (?:code )?(?:should be |is |= ?)?(\d{3})/i) || text.match(/\b(2\d\d|4\d\d|5\d\d)\b/);
  if (m) return +m[1];
  const t = text.toLowerCase();
  if (/unauthor|expired token|invalid_token/.test(t)) return 401;
  if (/forbidden/.test(t)) return 403;
  if (/not found/.test(t)) return 404;
  if (/conflict|duplicate/.test(t)) return 409;
  if (/missing|invalid|validation|without|bad request/.test(t)) return 400;
  if (/created/.test(t)) return 201;
  if (/no content|deleted|removes/.test(t)) return 204;
  return 200;
}

function inferMethodPath(steps, title) {
  const joined = steps.join(' ') + ' ' + title;
  const mm = joined.match(METHODS_RE);
  const pm = joined.match(/\s(\/[\w/{}\-?=&.]+)/);
  let method = mm ? mm[1].toUpperCase() : null;
  if (!method) {
    const t = (title + ' ' + joined).toLowerCase();
    if (/creat|add |regist|issue|submit|sign[ -]?up|upload/.test(t)) method = 'POST';
    else if (/delet|remov/.test(t)) method = 'DELETE';
    else if (/updat|edit|modif|chang|patch|renam/.test(t)) method = 'PATCH';
    else method = 'GET';
  }
  const path = pm ? pm[1] : '/';
  return { method, path };
}

function parseBDD(src) {
  const lines = src.split('\n');
  const cases = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    const sc = line.match(/^Scenario(?: Outline)?:\s*(.+)$/i);
    if (sc) { if (cur) cases.push(cur); cur = { title: sc[1].trim(), steps: [] }; continue; }
    if (cur && /^(Given|When|Then|And|But)\b/i.test(line)) cur.steps.push(line);
  }
  if (cur) cases.push(cur);
  return cases.map((c, i) => {
    const { method, path } = inferMethodPath(c.steps, c.title);
    const status = inferStatus(c.steps.join(' ') + ' ' + c.title);
    const assertions = [`response.status == ${status}`];
    const thenLine = c.steps.find(s => /^Then|^And/i.test(s) && /(contain|include|should|error|body|array|id)/i.test(s));
    if (thenLine) {
      const q = thenLine.match(/"([^"]+)"/);
      if (q) assertions.push(`response.body has "${q[1]}"`);
      else if (/array/i.test(thenLine)) assertions.push('response.body is array');
      else assertions.push('response.body matches expectation');
    }
    return { id: i, title: c.title, steps: c.steps, method, path, status, assertions, type: classify(c.title + ' ' + c.steps.join(' ')) };
  });
}

function parseOpenAPI(src) {
  let spec;
  try { spec = JSON.parse(src); } catch { return null; }
  if (!spec || !spec.paths) return [];
  const cases = [];
  let i = 0;
  Object.entries(spec.paths).forEach(([path, ops]) => {
    Object.entries(ops).forEach(([method, op]) => {
      const M = method.toUpperCase();
      const okStatus = M === 'POST' ? 201 : M === 'DELETE' ? 204 : 200;
      cases.push({
        id: i++, title: (op.summary || `${M} ${path}`) + ' — happy path',
        steps: [`When I ${M} ${path}`, `Then the response status should be ${okStatus}`],
        method: M, path, status: okStatus, type: 'happy',
        assertions: [`response.status == ${okStatus}`, M === 'GET' ? 'response.body matches schema' : 'response.body has "id"'],
      });
      if (M === 'POST') {
        cases.push({ id: i++, title: `${op.summary || path} — missing required field`, steps: [`When I POST ${path} without a required field`, 'Then the response status should be 400'], method: M, path, status: 400, type: 'negative', assertions: ['response.status == 400', 'response.body has "error"'] });
      }
      if (path.includes('/me') || path.includes('{id}')) {
        cases.push({ id: i++, title: `${op.summary || path} — unauthenticated`, steps: [`Given no access token`, `When I ${M} ${path}`, 'Then the response status should be 401'], method: M, path, status: 401, type: 'negative', assertions: ['response.status == 401'] });
      }
    });
  });
  return cases;
}

function splitReqWhenThen(s) {
  const m = s.match(/^(.*?)\bwhen\b\s+(.+?)[,;]?\s*(?:then\s+)?(should|must|will|returns?|receives?|reject|cannot)\b(.*)$/i);
  if (m) return ['When ' + m[2].trim(), 'Then it ' + (m[3] + m[4]).trim()];
  return ['Then ' + s.trim()];
}

// Free text / PRD → draft cases (heuristic: pull out requirement statements).
function parseText(src) {
  const cleaned = String(src).replace(/\r/g, '');
  const raw = cleaned.split(/\n|(?<=[.;])\s+(?=[A-Z0-9"])/);
  const REQ = /\b(must|should|shall|will|needs? to|is required|are required|cannot|can't|only|reject|returns?|receives?|respond|support)\b/i;
  const stmts = raw.map(s => s.trim()).filter(s => s.length > 14 && REQ.test(s));
  const seen = new Set();
  const out = [];
  stmts.forEach((s) => {
    const key = s.toLowerCase().slice(0, 40);
    if (seen.has(key)) return;
    seen.add(key);
    const { method, path } = inferMethodPath([s], s);
    const hasPath = /\//.test(s) && path !== '/';
    const status = inferStatus(s);
    out.push({
      id: out.length,
      title: s.replace(/\s+/g, ' ').replace(/[.;]+$/, '').slice(0, 96),
      steps: splitReqWhenThen(s),
      method, path: hasPath ? path : '—',
      status, type: classify(s),
      assertions: [`response.status == ${status}`],
      draft: !hasPath,
    });
  });
  return out;
}

const TYPE_CHIP = {
  happy:    { labelKey: 'testgen.type.happy', color: 'oklch(0.78 0.14 150)' },
  edge:     { labelKey: 'testgen.type.edge', color: 'oklch(0.8 0.14 70)' },
  negative: { labelKey: 'testgen.type.negative', color: 'oklch(0.72 0.16 18)' },
};

// ── LLM generation ────────────────────────────────────────────────────────
function extractCases(raw) {
  let txt = String(raw).trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const a = txt.indexOf('[');
  if (a < 0) return null;
  txt = txt.slice(a);
  let arr = null;
  const close = txt.lastIndexOf(']');
  if (close > 0) { try { arr = JSON.parse(txt.slice(0, close + 1)); } catch { arr = null; } }
  if (!Array.isArray(arr)) {
    // Repair truncated output: salvage every complete top-level {…} object.
    arr = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 1; i < txt.length; i++) {
      const ch = txt[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { arr.push(JSON.parse(txt.slice(start, i + 1))); } catch {} start = -1; } }
    }
  }
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.slice(0, 12).map((c, i) => ({
    id: i,
    title: String(c.title || ('Case ' + (i + 1))).slice(0, 120),
    type: ['happy', 'edge', 'negative'].includes(c.type) ? c.type : 'happy',
    method: String(c.method || 'GET').toUpperCase(),
    path: c.path ? String(c.path) : '—',
    status: parseInt(c.status, 10) || 200,
    steps: Array.isArray(c.steps) ? c.steps.map(String).slice(0, 5) : [],
    assertions: Array.isArray(c.assertions) ? c.assertions.map(String).slice(0, 5) : [`response.status == ${parseInt(c.status, 10) || 200}`],
    draft: !c.path || c.path === '—',
  }));
}

function CaseCard({ c, index, onAdd }) {
  const { t } = useI18n();
  const [open, setOpen] = useTG(index < 2);
  const chip = TYPE_CHIP[c.type];
  return (
    <div className="tg-case qa-anim-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <button className="tg-case-head" onClick={() => setOpen(o => !o)}>
        <span className="tg-chip" style={{ color: chip.color, borderColor: chip.color + '66', background: chip.color + '1a' }}>{t(chip.labelKey)}</span>
        <span className="tg-case-title">{c.title}</span>
        <MethodBadge method={c.method} size="sm" />
        <span className="tg-case-status" style={{ color: window.QATheme.statusColor(c.status) }}>{c.status}</span>
        <Icon name="chevron" size={14} className="tg-case-chev" data-open={open ? '1' : '0'} />
      </button>
      {open && (
        <div className="tg-case-body">
          <div className="tg-path">
            <MethodBadge method={c.method} size="sm" /> <code>{c.path}</code>
            {c.draft && <span className="tg-draft"><Icon name="link" size={11} /> {t('testgen.mapEndpoint')}</span>}
          </div>
          <div className="tg-steps">
            {c.steps.map((s, i) => {
              const kw = (s.match(/^(Given|When|Then|And|But)/i) || ['', ''])[1];
              return <div key={i} className="tg-step"><span className="tg-step-kw">{kw}</span><span>{s.replace(/^(Given|When|Then|And|But)\s*/i, '')}</span></div>;
            })}
          </div>
          <div className="tg-assert-label">{t('testgen.assertions')}</div>
          <div className="tg-asserts">
            {c.assertions.map((a, i) => <div key={i} className="tg-assert"><Icon name="check" size={12} /> <code>{a}</code></div>)}
          </div>
          <button className="tg-addone" onClick={() => onAdd && onAdd(c)}><Icon name="plus" size={12} /> {t('testgen.addOne')}</button>
        </div>
      )}
    </div>
  );
}

function TestGen({ openSettings, onAddTests }) {
  const { t } = useI18n();
  const [source, setSource] = useTG('bdd');
  const [toast, setToast] = useTG('');
  const caseAsserts = (c) => {
    const a = (c.assertions || []).map(window.qaParseAssertion).filter(x => x.type !== 'info');
    if (!a.some(x => x.type === 'status')) a.unshift({ type: 'status', op: 'eq', value: c.status, on: true });
    return a;
  };
  const addAll = () => {
    let n = 0;
    cases.forEach(c => { if (onAddTests && onAddTests(c.method, c.path, caseAsserts(c))) n++; });
    setToast(n ? t('testgen.toast.addedAll', { count: n, requestLabel: t(n === 1 ? 'testgen.toast.requestOne' : 'testgen.toast.requestMany') }) : t('testgen.toast.noMatches'));
    setTimeout(() => setToast(''), 2600);
  };
  const addOne = (c) => {
    const ok = onAddTests && onAddTests(c.method, c.path, caseAsserts(c));
    setToast(ok ? t('testgen.toast.addedOne', { count: caseAsserts(c).length, method: c.method, path: c.path }) : t('testgen.toast.noMatch', { method: c.method, path: c.path }));
    setTimeout(() => setToast(''), 2600);
  };
  const [input, setInput] = useTG(SAMPLE_BDD);
  const [cases, setCases] = useTG([]);
  const [busy, setBusy] = useTG(false);
  const [err, setErr] = useTG('');
  const [extracting, setExtracting] = useTG('');
  const fileRef = React.useRef(null);
  const [engine, setEngine] = useTG(() => (window.claude && window.claude.complete) ? 'ai' : 'heuristic');
  const cfg = window.loadLlmCfg();

  const SAMPLES = { bdd: SAMPLE_BDD, openapi: SAMPLE_OPENAPI, text: SAMPLE_TEXT };
  const switchSource = (s) => { setSource(s); setInput(SAMPLES[s]); setCases([]); setErr(''); };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const name = f.name.toLowerCase();
    setErr(''); setCases([]);
    try {
      if (name.endsWith('.pdf')) {
        setExtracting(f.name);
        const buf = await f.arrayBuffer();
        const pdfjsLib = await loadPdfjs();
        // isEvalSupported:false disables pdf.js's eval-based font path (defence in
        // depth vs CVE-2024-4367); we only extract text, so there is no downside.
        const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
        let text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const c = await page.getTextContent();
          text += c.items.map(i => i.str).join(' ') + '\n';
        }
        setSource('text'); setInput(text.trim() || t('testgen.err.noExtract'));
        setExtracting('');
      } else {
        const text = await f.text();
        const s = name.endsWith('.json') ? 'openapi' : (name.endsWith('.feature') ? 'bdd' : 'text');
        setSource(s); setInput(text);
      }
    } catch (ex) {
      setExtracting(''); setErr(t('testgen.err.readFile', { message: ex.message }));
    }
  };

  const runHeuristic = () => {
    setBusy(true); setErr(''); setCases([]);
    setTimeout(() => {
      const result = source === 'bdd' ? parseBDD(input) : source === 'openapi' ? parseOpenAPI(input) : parseText(input);
      if (result === null) { setErr(t('testgen.err.invalidJson')); setBusy(false); return; }
      if (result.length === 0) { setErr(t('testgen.err.noStatements')); setBusy(false); return; }
      setCases(result); setBusy(false);
    }, 1100);
  };

  const generate = async () => {
    setErr(''); setCases([]);
    if (engine === 'heuristic') { runHeuristic(); return; }
    if (cfg.provider !== 'builtin' && !cfg.key.trim()) {
      setErr(t('testgen.err.noKey')); return;
    }
    if (cfg.provider === 'builtin' && !(window.claude && window.claude.complete)) {
      setErr(t('testgen.err.builtinUnavailable')); return;
    }
    setBusy(true);
    try {
      const raw = await qaAiSend({ site: 'testgen', kind: 'testgen', payload: { source, input } });
      const parsed = extractCases(raw);
      if (!parsed || !parsed.length) { setErr(t('testgen.err.badModelOutput')); setBusy(false); return; }
      setCases(parsed); setBusy(false);
    } catch (ex) {
      if (ex && ex.name === 'AiCancelledError') { setBusy(false); return; }
      setErr(t('testgen.err.llmFailed', { message: ex.message })); setBusy(false);
    }
  };

  const aiBuiltin = cfg.provider === 'builtin';
  const modelLabel = aiBuiltin ? 'claude-haiku-4-5' : (cfg.model || 'model');

  const counts = cases.reduce((o, c) => (o[c.type] = (o[c.type] || 0) + 1, o), {});
  const endpoints = new Set(cases.filter(c => c.path !== '—').map(c => `${c.method} ${c.path}`)).size;
  const drafts = cases.filter(c => c.draft).length;
  const fileName = source === 'bdd' ? 'feature.feature' : source === 'openapi' ? 'openapi.json' : 'requirements.txt';

  return (
    <div className="tg">
      <div className="tg-source">
        <div className="tg-source-head">
          <h2>{t('testgen.title')}</h2>
          <p>{t('testgen.subtitle')}</p>
        </div>
        <div className="qa-segs qa-segs--mini tg-srctabs">
          <button data-active={source === 'bdd' ? '1' : '0'} onClick={() => switchSource('bdd')}>{t('testgen.source.bdd')}</button>
          <button data-active={source === 'openapi' ? '1' : '0'} onClick={() => switchSource('openapi')}>{t('testgen.source.openapi')}</button>
          <button data-active={source === 'text' ? '1' : '0'} onClick={() => switchSource('text')}>{t('testgen.source.text')}</button>
        </div>
        <div className="tg-editor-label">
          <span><Icon name="fileText" size={13} /> {extracting ? t('testgen.extracting', { file: extracting }) : fileName}</span>
          <button className="qa-link" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="upload" size={12} /> {t('testgen.upload')}</button>
          <input ref={fileRef} type="file" accept=".txt,.md,.feature,.json,.pdf" style={{ display: 'none' }} onChange={onFile} />
        </div>
        <textarea className="tg-editor" spellCheck="false" value={input} onChange={e => setInput(e.target.value)}
                  placeholder={t('testgen.placeholder')} />
        <div className="tg-hint"><Icon name="upload" size={11} /><span>{t('testgen.hint')}</span></div>

        <div className="tg-engine">
          <div className="qa-segs qa-segs--mini">
            <button data-active={engine === 'ai' ? '1' : '0'} onClick={() => setEngine('ai')}><Icon name="sparkle" size={13} /> {t('testgen.engine.ai')}</button>
            <button data-active={engine === 'heuristic' ? '1' : '0'} onClick={() => setEngine('heuristic')}><Icon name="code" size={13} /> {t('testgen.engine.heuristic')}</button>
          </div>
          {engine === 'ai' && <span className="tg-engine-model">{modelLabel}{aiBuiltin ? ` · ${t('testgen.noKey')}` : ''}</span>}
          <button className="qa-link tg-cfg-toggle" onClick={() => openSettings && openSettings('llm')}><Icon name="settings" size={12} /> {t('testgen.settings')}</button>
        </div>

        <button className="tg-gen" onClick={generate} disabled={busy || !!extracting}>
          {busy ? <Spinner size={14} /> : <Icon name="sparkle" size={15} />}
          {busy ? (engine === 'ai' ? t('testgen.asking') : t('testgen.generating')) : (engine === 'ai' ? t('testgen.generateAi') : t('testgen.generate'))}
        </button>
      </div>

      <div className="tg-output">
        {cases.length > 0 && (
          <div className="tg-summary qa-fade">
            <div className="tg-sum-main">
              {t('testgen.summary', { cases: cases.length, endpoints })}
              {drafts ? <>{t('testgen.summaryDrafts', { drafts })}</> : null}
            </div>
            <div className="tg-sum-chips">
              {Object.entries(TYPE_CHIP).map(([k, v]) => counts[k] ? (
                <span key={k} className="tg-chip" style={{ color: v.color, borderColor: v.color + '66', background: v.color + '1a' }}>{counts[k]} {t(v.labelKey)}</span>
              ) : null)}
              <button className="tg-addall" onClick={addAll}><Icon name="plus" size={13} /> {t('testgen.addAll')}</button>
            </div>
          </div>
        )}
        {cases.length > 0 && drafts > 0 && (
          <div className="tg-note qa-fade"><Icon name="link" size={13} /> {t('testgen.draftNote', { drafts, caseLabel: t(drafts > 1 ? 'testgen.caseMany' : 'testgen.caseOne') })}</div>
        )}

        <div className="tg-list">
          {busy && (
            <div className="tg-busy">
              <Spinner size={18} />
              <div>{engine === 'ai'
                ? t('testgen.busy.ai', { model: modelLabel, source: t(source === 'bdd' ? 'testgen.busy.source.feature' : source === 'openapi' ? 'testgen.busy.source.spec' : 'testgen.busy.source.document') })
                : t('testgen.busy.heuristic', { source: t(source === 'bdd' ? 'testgen.busy.source.scenarios' : source === 'openapi' ? 'testgen.busy.source.operations' : 'testgen.busy.source.requirements') })}</div>
            </div>
          )}
          {!busy && cases.length === 0 && !err && (
            <div className="tg-empty">
              <div className="tg-empty-icon"><Icon name="sparkle" size={26} stroke={1.5} /></div>
              <div className="tg-empty-title">{t('testgen.empty.title')}</div>
              <div className="tg-empty-sub">{t('testgen.empty.subBefore')} <kbd>{t('testgen.generate')}</kbd>{t('testgen.empty.subAfter')}</div>
            </div>
          )}
          {err && <div className="tg-err"><Icon name="x" size={15} /> {err}</div>}
          {!busy && cases.map((c, i) => <CaseCard key={c.id} c={c} index={i} onAdd={addOne} />)}
        </div>
        {toast && <div className="tg-toast qa-fade"><Icon name="check" size={13} /> {toast}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { TestGen });

export { TestGen };
