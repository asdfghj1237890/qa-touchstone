// ── QA Companion — response oracles (pure logic, no React) ─────────────────
// Scans a captured response for sensitive-data exposure and schema/contract
// drift, producing Finding[]. UI lives in Security.jsx; this file is unit-tested.
import './setup.js';
import { qaCallLLM } from './llm.js';

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
