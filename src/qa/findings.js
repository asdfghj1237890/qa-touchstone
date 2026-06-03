// src/qa/findings.js
// ── QA Companion — findings lifecycle (pure logic, no React) ───────────────
// Stable identity, effective severity, run diff, gate counting, and versioned
// localStorage persistence for findings management. UI lives in FindingsPanel.
import './setup.js';
import { normalizePath } from './oracles.js';

export const FP_VERSION = 1;
export const LIFECYCLE_KEY = 'qa_security_lifecycle';
export const SNAPSHOTS_KEY = 'qa_security_snapshots';
export const STATUSES = ['open', 'acknowledged'];

// Stable machine code. Matrix findings carry an explicit ruleId (oracle alone
// is too coarse: 7 sensitive rules share oracle 'sensitive-data'). BOLA and
// rate-limit findings already have a stable, specific `oracle`, so reuse it.
export function ruleIdOf(f) { return (f && (f.ruleId || f.oracle)) || 'unknown'; }

// Per-engine identity component (locale-independent — feeds the fingerprint).
export function locationOf(f) {
  const r = (f && f.ref) || {};
  if (f && f.engine === 'bola') return `bola:${r.testId}:${r.attackerId}->${r.ownerId}`;
  if (f && f.engine === 'ratelimit') return `rl:${r.testId}`;
  return `${(f && f.method) || ''} ${(f && f.endpoint) || ''} @${r.idId || ''}`.trim();
}

// Human, locale-independent label for display + snapshots (survives the finding
// disappearing, so resolved rows are still explainable).
export function locationLabel(f) {
  const r = (f && f.ref) || {};
  if (f && f.engine === 'bola') return `BOLA ${r.testId} (${r.attackerId}→${r.ownerId})`;
  if (f && f.engine === 'ratelimit') return `Rate-limit ${r.testId}`;
  const id = (f && f.identityLabel) ? ` · ${f.identityLabel}` : '';
  return `${(f && f.method) || ''} ${(f && f.endpoint) || ''}${id}`.trim();
}

// FNV-1a 32-bit → 8-hex. Deterministic, dependency-free; non-crypto identity only.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// Stable identity. Excludes title (engine wording drifts) and evidence (volatile,
// may carry secrets). fpMaterial is kept beside the hash for audit/migration.
export function fingerprint(f) {
  const material = [f && f.engine, ruleIdOf(f), locationOf(f), normalizePath((f && f.path) || '')].join('|');
  return { fp: fnv1a(material), fpMaterial: material };
}
