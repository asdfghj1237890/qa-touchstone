// src/qa/evidence.js
// ── QA Touchstone — redacted evidence artifact (pure, no React/DOM) ─────────
// Turns transient raw request/response material (captured at run time, never
// persisted) into a structure-preserving, mask-by-default artifact. The ONLY
// value characters ever emitted sit at the exact finding location (reusing
// redact()); every other leaf is a type token. Scrub fns never throw and never
// emit raw on error.
import './setup.js';
import { redact } from './oracles.js';
import { fingerprint } from './findings.js';

export const REDACTED = '<redacted>';
export const SNIPPET_DEPTH = 2;
export const SNIPPET_KEYS = 12;

const HEADER_DENY = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;
const HEADER_DENY_SUBSTR = /(token|secret|key|auth|session|cookie)/i;
const HEADER_URL_VALUED = /^(location|content-location|referer)$/i;
const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9_-]{32,}/;

// A primitive leaf -> a type token carrying NO value characters.
export function leafToken(v) {
  if (v === null) return '<null>';
  const t = typeof v;
  if (t === 'string') return `<str:${v.length}>`;
  if (t === 'number') return '<num>';
  if (t === 'boolean') return '<bool>';
  return `<${t}>`;
}

// Split a finding path ('a.b[0].c') into tokens (['a','b','0','c']).
export function tokenizePath(p) {
  const out = [];
  const re = /[^.[\]]+|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(String(p == null ? '' : p)))) out.push(m[1] != null ? m[1] : m[0]);
  return out;
}

// Recursively mask a container. A DIRECT child whose key === markKey keeps the
// redact() preview; every other leaf becomes a type token. Bounded by depth/key
// caps; sets caps.truncated when the key cap trims a level. Object/array KEYS are
// preserved verbatim — mask-by-default covers VALUES; keys are assumed field
// names, not secrets.
function scrub(node, markKey, depth, caps) {
  if (node === null || typeof node !== 'object') return leafToken(node);
  if (depth >= SNIPPET_DEPTH) return Array.isArray(node) ? '<array>' : '<object>';
  const isArr = Array.isArray(node);
  const out = isArr ? [] : {};
  const keys = isArr ? node.map((_, i) => String(i)) : Object.keys(node);
  for (const k of keys) {
    if (caps.keys >= SNIPPET_KEYS) { caps.truncated = true; break; }
    caps.keys++;
    const v = node[k];
    let child;
    if (v === null || typeof v !== 'object') {
      child = (depth === 0 && markKey != null && k === markKey) ? redact(v) : leafToken(v);
    } else {
      child = scrub(v, null, depth + 1, caps);
    }
    if (isArr) out.push(child); else out[k] = child;
  }
  return out;
}

// Window the parsed JSON body to the finding location's parent sub-tree and mask
// it. Returns { snippetPath, tree, truncated } or null when not applicable
// (non-object body, header/non-body path, or path not found).
export function snippetAround(body, findingPath) {
  try {
    if (body === null || typeof body !== 'object') return null;
    const caps = { keys: 0, truncated: false };
    if (!findingPath || /^header:/i.test(findingPath) || /\s/.test(findingPath)) {
      return { snippetPath: findingPath || '', tree: scrub(body, null, 0, caps), truncated: caps.truncated };
    }
    const tokens = tokenizePath(findingPath);
    let node = body;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (node === null || typeof node !== 'object') return null;
      node = node[tokens[i]];
    }
    if (node === null || typeof node !== 'object') return null;
    const markKey = tokens[tokens.length - 1];
    return { snippetPath: findingPath, tree: scrub(node, markKey, 0, caps), truncated: caps.truncated };
  } catch { return null; }
}

// Keep path structure (mask secret-like segments); keep query keys, mask values.
export function redactUrl(url) {
  try {
    // Drop any #fragment first — it can carry secrets (e.g. OAuth implicit #access_token=…).
    // Note: only the first '?' starts the query; any later '?' lands inside a query value,
    // which is masked anyway.
    const s = String(url == null ? '' : url).split('#')[0];
    const qIdx = s.indexOf('?');
    const pathPart = qIdx < 0 ? s : s.slice(0, qIdx);
    const queryPart = qIdx < 0 ? null : s.slice(qIdx + 1);
    const segs = pathPart.split('/').map(seg => (seg && SECRET_VALUE.test(seg)) ? REDACTED : seg).join('/');
    if (queryPart == null) return segs;
    const q = queryPart.split('&').map(pair => {
      const i = pair.indexOf('=');
      return i < 0 ? pair : pair.slice(0, i) + '=' + REDACTED;
    }).join('&');
    return segs + '?' + q;
  } catch { return REDACTED; }
}

// Fully mask denylisted header values; pass others through as strings.
export function redactHeaders(headers) {
  const out = {};
  try {
    for (const k of Object.keys(headers || {})) {
      if (HEADER_DENY.test(k) || HEADER_DENY_SUBSTR.test(k)) out[k] = REDACTED;
      else if (HEADER_URL_VALUED.test(k)) out[k] = redactUrl(String(headers[k]));
      else out[k] = String(headers[k]);
    }
  } catch { return {}; }
  return out;
}

// Case-insensitive header lookup (used to label non-JSON bodies).
export function headerVal(headers, lowerName) {
  try {
    for (const k of Object.keys(headers || {})) if (k.toLowerCase() === lowerName) return headers[k];
  } catch { /* ignore */ }
  return '';
}

// A body may arrive already-parsed (object) or as a JSON string.
function asJson(body) {
  if (body && typeof body === 'object') return { ok: true, value: body };
  if (typeof body === 'string') { try { return { ok: true, value: JSON.parse(body) }; } catch { return { ok: false }; } }
  return { ok: false };
}

// Build one redacted artifact from a union item's transient `raw`. Never throws.
export function buildEvidenceArtifact(raw, item) {
  try {
    if (!raw) return null;
    const req = raw.request || {};
    const artifact = {
      engine: (item && item.engine) || '',
      request: {
        method: req.method || '',
        url: redactUrl(req.url || req.path || ''),
        identity: req.identity || (item && item.identityLabel) || '',
        headers: redactHeaders(req.headers || {}),
      },
      response: null,
    };
    if (raw.stats) {
      const st = raw.stats;
      artifact.stats = {
        sent: st.sent != null ? st.sent : null,
        completed: st.completed != null ? st.completed : null,
        throttleSeen: !!st.throttleSeen,
      };
      return artifact;
    }
    const resp = raw.response;
    if (resp) {
      const r = { status: resp.status != null ? resp.status : null, headers: redactHeaders(resp.headers || {}), snippetPath: '', snippet: null, nonJson: null, truncated: false };
      const parsed = asJson(resp.body);
      const s = parsed.ok ? snippetAround(parsed.value, (item && item.path) || '') : null;
      if (s) { r.snippet = s.tree; r.snippetPath = s.snippetPath; r.truncated = s.truncated; }
      else if (!parsed.ok) { r.nonJson = { contentType: String(headerVal(resp.headers, 'content-type') || ''), length: typeof resp.body === 'string' ? resp.body.length : 0 }; }
      artifact.response = r;
    }
    return artifact;
  } catch { return null; }
}

// fp -> artifact for a run's union (first occurrence per fp wins, mirrors snapshotOf).
export function buildEvidenceMap(union) {
  const map = new Map();
  for (const it of (union || [])) {
    if (!it || !it.raw) continue;
    let fp;
    try { fp = fingerprint(it).fp; } catch { continue; }
    if (map.has(fp)) continue;
    const a = buildEvidenceArtifact(it.raw, it);
    if (a) map.set(fp, a);
  }
  return map;
}

// Opt-in persistence: copy artifacts onto snapshot items by fp (returns a new array).
export function embedEvidence(items, map) {
  if (!map || !map.get) return items || [];
  return (items || []).map(it => {
    const a = map.get(it.fp);
    return a ? { ...it, evidenceArtifact: a } : it;
  });
}
