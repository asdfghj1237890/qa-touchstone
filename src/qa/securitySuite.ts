// src/qa/securitySuite.ts
// ── QA Touchstone — unified security suite run (pure, no React/DOM) ─────────
// Shared per-engine finding normalizers + a sequential orchestrator that drives
// injected per-engine run adapters into one coherent RunRecord. UI: SuiteRunBar.
import './setup';
import type {
  BolaResults, BolaTest, Endpoint, EngineId, EngineRunSummary, Identity, MatrixCell,
  RateLimitResult, RateLimitTest, RunRecord, UnionFinding,
} from './types';

// Order is deliberate: rate-limit LAST so its burst can't throttle/skew the
// matrix and BOLA requests.
export const SUITE_ORDER: EngineId[] = ['matrix', 'bola', 'ratelimit'];

// matrix results { reqId: { idId: { findings:[] } } } -> union items.
export function normalizeMatrix(
  results: Record<string, Record<string, MatrixCell | null | undefined>> | null | undefined,
  endpoints: Endpoint[] | null | undefined,
  identities: Identity[] | null | undefined,
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const ep of (endpoints || [])) {
    for (const id of (identities || [])) {
      const cell = results && results[ep.reqId] && results[ep.reqId][id.id];
      const identityLabel = id.id === 'anon' ? 'anon' : (id.name || id.id);
      const resp = cell && cell.response;
      for (const f of (cell && cell.findings) || []) {
        out.push({
          engine: 'matrix', ruleId: f.ruleId!, severity: f.severity, oracle: f.oracle,
          title: f.title, path: f.path, evidence: f.evidence || '',
          method: ep.method, endpoint: ep.path, identityLabel,
          ref: { reqId: ep.reqId, idId: id.id },
          raw: {
            request: { method: ep.method, url: ep.path, identity: identityLabel },
            response: resp ? { status: resp.status, headers: resp.headers, body: resp.body } : null,
          },
        });
      }
    }
  }
  return out;
}

// bola results { testId: { attacks: { attackerId: { ownerId: { finding } } } } } -> union items.
export function normalizeBola(results: BolaResults | null | undefined, tests: BolaTest[] | null | undefined): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const test of (tests || [])) {
    const atk = (results && results[test.id] && results[test.id].attacks) || {};
    for (const a in atk) for (const o in atk[a]) {
      const cell = atk[a][o];
      const f = cell && cell.finding;
      const rq = cell && cell.request;
      const resp = cell && cell.response;
      if (f) out.push({
        engine: 'bola', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
        title: f.title, path: f.path, evidence: f.evidence || '',
        ref: { testId: test.id, attackerId: a, ownerId: o },
        raw: {
          request: rq ? { method: rq.method, url: rq.path, identity: rq.identity } : null,
          response: resp ? { status: resp.status, headers: resp.headers, body: resp.body } : null,
        },
      });
    }
  }
  return out;
}

// rate-limit results { testId: { finding } } -> union items.
export function normalizeRateLimit(
  results: Record<string, RateLimitResult | null | undefined> | null | undefined,
  tests: RateLimitTest[] | null | undefined,
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const test of (tests || [])) {
    const tr = results && results[test.id];
    const f = tr && tr.finding;
    if (f) out.push({
      engine: 'ratelimit', ruleId: f.ruleId || f.oracle, severity: f.severity, oracle: f.oracle,
      title: f.title, path: f.path, evidence: f.evidence || '', ref: { testId: test.id },
      raw: { request: { method: test.method, url: test.path }, stats: tr!.stats || null },
    });
  }
  return out;
}

/** suite 三引擎的設定（rate-limit 的設定鍵是 rateLimit）。 */
export type SuiteConfig = {
  matrix: { endpoints?: Endpoint[] | null; identities?: Identity[] | null; [k: string]: unknown };
  bola: { tests?: BolaTest[] | null; [k: string]: unknown };
  rateLimit: { tests?: RateLimitTest[] | null; [k: string]: unknown };
};

// Is an engine's config empty (nothing to run)?
function engineEmpty(engine: EngineId, config: SuiteConfig): boolean {
  if (engine === 'matrix') return !((config.matrix.endpoints || []).length && (config.matrix.identities || []).length);
  if (engine === 'bola') return !((config.bola.tests || []).length);
  return !((config.rateLimit.tests || []).length);   // ratelimit
}

const NORMALIZERS: Record<EngineId, (results: any, config: SuiteConfig) => UnionFinding[]> = {
  matrix: (results, config) => normalizeMatrix(results, config.matrix.endpoints, config.matrix.identities),
  bola: (results, config) => normalizeBola(results, config.bola.tests),
  ratelimit: (results, config) => normalizeRateLimit(results, config.rateLimit.tests),
};

// engine id -> config key (rate-limit's config lives under `rateLimit`).
const CONFIG_KEY = { matrix: 'matrix', bola: 'bola', ratelimit: 'rateLimit' } as const;

/** 注入的引擎執行 adapter：跑完整個引擎並 resolve 出該引擎的 results。 */
export type SuiteRunner = (
  config: any,
  opts: { signal?: AbortSignal | null; onProgress: (done: number, total: number) => void },
) => Promise<any>;

// Orchestrate the three engines sequentially into one RunRecord.
// `runners` = { matrix, bola, ratelimit }: async run adapters that execute a whole
// engine and resolve to its results (signature: runner(config[engine], {signal, onProgress})).
// `opts` = { signal, onProgress(engine,done,total), onEngineResult(engine,results), now=()=>Date.now() }.
// Returns { status:'complete'|'aborted', startedAt, finishedAt, durationMs, engines:[], union:[] }.
// Stays PURE: returns `union` (not snapshot items); the caller derives items via snapshotOf.
export async function runSuite(
  config: SuiteConfig,
  runners: Record<EngineId, SuiteRunner>,
  opts: {
    signal?: AbortSignal | null;
    onProgress?: (engine: EngineId, done: number, total: number) => void;
    onEngineResult?: (engine: EngineId, results: unknown) => void;
    now?: () => number;
  } = {},
): Promise<RunRecord> {
  const now = opts.now || (() => Date.now());
  const signal = opts.signal;
  const t0 = now();
  const startedAt = new Date(t0).toISOString();
  const engines: EngineRunSummary[] = [];
  const union: UnionFinding[] = [];
  let aborted = false;

  for (const engine of SUITE_ORDER) {
    if (signal && signal.aborted) { aborted = true; break; }
    if (engineEmpty(engine, config)) {
      engines.push({ engine, ran: false, skipped: 'no-config', durationMs: 0, findingCount: 0, error: null });
      continue;
    }
    const eStart = now();
    let results: any = null, error: string | null = null;
    try {
      results = await runners[engine](config[CONFIG_KEY[engine]], {
        signal,
        onProgress: (done, total) => { if (opts.onProgress) opts.onProgress(engine, done, total); },
      });
      if (opts.onEngineResult) opts.onEngineResult(engine, results);
    } catch (e: any) {
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
