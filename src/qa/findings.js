// src/qa/findings.js
// ── QA Companion — findings lifecycle (pure logic, no React) ───────────────
// Stable identity, effective severity, run diff, gate counting, and versioned
// localStorage persistence for findings management. UI lives in FindingsPanel.
import './setup.js';
import { SEVERITY_ORDER, normalizePath } from './oracles.js';

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

// Override wins only if it's a recognized severity; otherwise the original.
export function effectiveSeverity(finding, record) {
  const ov = record && record.severityOverride;
  return (ov && SEVERITY_ORDER.includes(ov)) ? ov : (finding && finding.severity);
}

// Aggregate a finding union into compact snapshot items (identities, NOT
// findings). `path` is the normalized JSON field path (a key name, never a
// value) — safe to store and useful for explaining resolved rows. `meta`
// carries { runId, createdAt, scopeHash }.
export function snapshotOf(union, lifecycle, meta = {}) {
  const records = (lifecycle && lifecycle.records) || {};
  const byFp = new Map();
  for (const f of (union || [])) {
    const { fp } = fingerprint(f);
    const existing = byFp.get(fp);
    if (existing) { existing.count += 1; continue; }
    byFp.set(fp, {
      fp,
      effectiveSeverity: effectiveSeverity(f, records[fp]),
      engine: f.engine,
      ruleId: ruleIdOf(f),
      path: normalizePath((f && f.path) || ''),
      locationLabel: locationLabel(f),
      count: 1,
    });
  }
  return {
    runId: meta.runId || '', createdAt: meta.createdAt || '', scopeHash: meta.scopeHash || '',
    items: [...byFp.values()],
  };
}

// Stable hash of the scanned surface (NOT the findings), so a diff across a
// changed test surface can be flagged instead of misread as fixes/regressions.
export function scopeHashOf(descriptor) { return fnv1a(JSON.stringify(descriptor || {})); }

// Presence map fp -> 'new' | 'carried' | 'resolved', comparing current items
// against a baseline's items. Presence is always derived fresh (never stored),
// so a previously-resolved fp reappearing is simply new/carried again.
export function diffRuns(currentItems, baselineItems) {
  const baseFps = new Set((baselineItems || []).map(i => i.fp));
  const curFps = new Set((currentItems || []).map(i => i.fp));
  const out = new Map();
  for (const it of (currentItems || [])) out.set(it.fp, baseFps.has(it.fp) ? 'carried' : 'new');
  for (const it of (baselineItems || [])) if (!curFps.has(it.fp)) out.set(it.fp, 'resolved');
  return out;
}
