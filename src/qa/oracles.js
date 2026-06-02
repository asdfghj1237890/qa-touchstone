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
