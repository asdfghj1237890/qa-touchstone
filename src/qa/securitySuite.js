// src/qa/securitySuite.js
// ── QA Touchstone — unified security suite run (pure, no React/DOM) ─────────
// Shared per-engine finding normalizers + a sequential orchestrator that drives
// injected per-engine run adapters into one coherent RunRecord. UI: SuiteRunBar.
import './setup.js';

// Order is deliberate: rate-limit LAST so its burst can't throttle/skew the
// matrix and BOLA requests.
export const SUITE_ORDER = ['matrix', 'bola', 'ratelimit'];

// matrix results { reqId: { idId: { findings:[] } } } -> union items.
export function normalizeMatrix(results, endpoints, identities) {
  const out = [];
  for (const ep of (endpoints || [])) {
    for (const id of (identities || [])) {
      const cell = results && results[ep.reqId] && results[ep.reqId][id.id];
      for (const f of (cell && cell.findings) || []) {
        out.push({
          engine: 'matrix', ruleId: f.ruleId, severity: f.severity, oracle: f.oracle,
          title: f.title, path: f.path, evidence: f.evidence || '',
          method: ep.method, endpoint: ep.path,
          identityLabel: id.id === 'anon' ? 'anon' : (id.name || id.id),
          ref: { reqId: ep.reqId, idId: id.id },
        });
      }
    }
  }
  return out;
}

// bola results { testId: { attacks: { attackerId: { ownerId: { finding } } } } } -> union items.
export function normalizeBola(results, tests) {
  const out = [];
  for (const test of (tests || [])) {
    const atk = (results && results[test.id] && results[test.id].attacks) || {};
    for (const a in atk) for (const o in atk[a]) {
      const f = atk[a][o] && atk[a][o].finding;
      if (f) out.push({
        engine: 'bola', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
        title: f.title, path: f.path, evidence: f.evidence || '',
        ref: { testId: test.id, attackerId: a, ownerId: o },
      });
    }
  }
  return out;
}

// rate-limit results { testId: { finding } } -> union items.
export function normalizeRateLimit(results, tests) {
  const out = [];
  for (const test of (tests || [])) {
    const f = results && results[test.id] && results[test.id].finding;
    if (f) out.push({
      engine: 'ratelimit', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
      title: f.title, path: f.path, evidence: f.evidence || '', ref: { testId: test.id },
    });
  }
  return out;
}
