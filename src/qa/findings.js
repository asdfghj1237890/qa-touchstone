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

// The seed for the (deferred) CI gate: count of NEW findings whose EFFECTIVE
// severity is high/critical and which are not suppressed. `items` are snapshot
// items (already carry effectiveSeverity); `diff` is from diffRuns.
export function gateCount(items, lifecycle, diff) {
  const records = (lifecycle && lifecycle.records) || {};
  let n = 0;
  for (const it of (items || [])) {
    if ((diff ? diff.get(it.fp) : 'new') !== 'new') continue;
    const rec = records[it.fp];
    if (rec && rec.suppressed) continue;
    if (it.effectiveSeverity === 'high' || it.effectiveSeverity === 'critical') n++;
  }
  return n;
}

function readJSON(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable — non-fatal */ }
}

const BLANK_RECORD = () => ({
  suppressed: false, suppressReason: '', status: 'open', owner: '', note: '',
  severityOverride: null, createdAt: '', updatedAt: '', lastSeenAt: '', seenCount: 0,
});

// Load the lifecycle store. Corrupt/missing -> empty versioned store (scanning
// must never break). Older fpVersion -> records quarantined under `legacy`.
export function loadLifecycle() {
  const raw = readJSON(LIFECYCLE_KEY);
  if (!raw || typeof raw !== 'object' || !raw.records || typeof raw.records !== 'object') {
    return { fpVersion: FP_VERSION, records: {}, legacy: null };
  }
  if (raw.fpVersion !== FP_VERSION) {
    return { fpVersion: FP_VERSION, records: {}, legacy: { fpVersion: raw.fpVersion, records: raw.records } };
  }
  return { fpVersion: FP_VERSION, records: raw.records, legacy: raw.legacy || null };
}

export function saveLifecycle(state) {
  const payload = { fpVersion: FP_VERSION, records: (state && state.records) || {} };
  if (state && state.legacy) payload.legacy = state.legacy;
  writeJSON(LIFECYCLE_KEY, payload);
}

// Merge a patch into a finding's record (created from BLANK_RECORD if absent).
// `now` is an injected ISO string so this stays pure/testable.
export function upsertRecord(state, fp, patch, now = '') {
  const records = { ...((state && state.records) || {}) };
  const prev = records[fp] || { ...BLANK_RECORD(), createdAt: now };
  records[fp] = { ...prev, ...patch, updatedAt: now };
  return { fpVersion: FP_VERSION, records, legacy: (state && state.legacy) || null };
}

export function loadSnapshots() {
  const raw = readJSON(SNAPSHOTS_KEY);
  if (!raw || typeof raw !== 'object' || raw.fpVersion !== FP_VERSION) {
    return { fpVersion: FP_VERSION, baseline: null, lastRun: null };
  }
  return { fpVersion: FP_VERSION, baseline: raw.baseline || null, lastRun: raw.lastRun || null };
}

export function saveSnapshots(s) {
  writeJSON(SNAPSHOTS_KEY, { fpVersion: FP_VERSION, baseline: (s && s.baseline) || null, lastRun: (s && s.lastRun) || null });
}

// Set lastRun (completed-scan boundary); leaves baseline untouched.
export function recordRun(snapshots, snap) {
  return { fpVersion: FP_VERSION, baseline: (snapshots && snapshots.baseline) || null, lastRun: snap };
}
// Pin the given snapshot as the known-good baseline; leaves lastRun untouched.
export function pinBaseline(snapshots, snap) {
  return { fpVersion: FP_VERSION, baseline: snap, lastRun: (snapshots && snapshots.lastRun) || null };
}
