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

// Is an engine's config empty (nothing to run)?
function engineEmpty(engine, config) {
  if (engine === 'matrix') return !((config.matrix.endpoints || []).length && (config.matrix.identities || []).length);
  if (engine === 'bola') return !((config.bola.tests || []).length);
  return !((config.rateLimit.tests || []).length);   // ratelimit
}

const NORMALIZERS = {
  matrix: (results, config) => normalizeMatrix(results, config.matrix.endpoints, config.matrix.identities),
  bola: (results, config) => normalizeBola(results, config.bola.tests),
  ratelimit: (results, config) => normalizeRateLimit(results, config.rateLimit.tests),
};

// Orchestrate the three engines sequentially into one RunRecord.
// `runners` = { matrix, bola, ratelimit }: async run adapters that execute a whole
// engine and resolve to its results (signature: runner(config[engine], {signal, onProgress})).
// `opts` = { signal, onProgress(engine,done,total), onEngineResult(engine,results), now=()=>Date.now() }.
// Returns { status:'complete'|'aborted', startedAt, finishedAt, durationMs, engines:[], union:[] }.
// Stays PURE: returns `union` (not snapshot items); the caller derives items via snapshotOf.
export async function runSuite(config, runners, opts = {}) {
  const now = opts.now || (() => Date.now());
  const signal = opts.signal;
  const t0 = now();
  const startedAt = new Date(t0).toISOString();
  const engines = [];
  const union = [];
  let aborted = false;

  for (const engine of SUITE_ORDER) {
    if (signal && signal.aborted) { aborted = true; break; }
    if (engineEmpty(engine, config)) {
      engines.push({ engine, ran: false, skipped: 'no-config', durationMs: 0, findingCount: 0, error: null });
      continue;
    }
    const eStart = now();
    let results = null, error = null;
    try {
      results = await runners[engine](config[engine], {
        signal,
        onProgress: (done, total) => { if (opts.onProgress) opts.onProgress(engine, done, total); },
      });
      if (opts.onEngineResult) opts.onEngineResult(engine, results);
    } catch (e) {
      error = String((e && e.message) || e);
    }
    const items = error ? [] : NORMALIZERS[engine](results, config);
    union.push(...items);
    engines.push({ engine, ran: true, durationMs: now() - eStart, findingCount: items.length, error });
    if (signal && signal.aborted) { aborted = true; break; }
  }

  const tEnd = now();
  return {
    status: aborted ? 'aborted' : 'complete',
    startedAt, finishedAt: new Date(tEnd).toISOString(), durationMs: tEnd - t0,
    engines, union,
  };
}
