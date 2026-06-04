// src/qa/evidence.js
// ── QA Touchstone — redacted evidence artifact (pure, no React/DOM) ─────────
// Turns transient raw request/response material (captured at run time, never
// persisted) into a structure-preserving, mask-by-default artifact. The ONLY
// value characters ever emitted sit at the exact finding location (reusing
// redact()); every other leaf is a type token. Scrub fns never throw and never
// emit raw on error.
import './setup.js';
import { redact } from './oracles.js';

export const REDACTED = '<redacted>';
export const SNIPPET_DEPTH = 2;
export const SNIPPET_KEYS = 12;

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
// caps; sets caps.truncated when the key cap trims a level.
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
