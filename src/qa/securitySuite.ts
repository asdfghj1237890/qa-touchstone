// src/qa/securitySuite.ts
// ── QA Touchstone — unified security suite run (pure, no React/DOM) ─────────
// Shared per-engine finding normalizers + a sequential orchestrator that drives
// injected per-engine run adapters into one coherent RunRecord. UI: SuiteRunBar.
import './setup';
import type {
  BolaResults,
  BolaTest,
  BflaResult,
  ConformanceResult,
  Endpoint,
  EngineId,
  EngineRunSummary,
  FuzzSuiteResult,
  Identity,
  MatrixCell,
  RateLimitResult,
  RateLimitTest,
  RunRecord,
  UnionFinding,
} from './types';

// Order is deliberate: rate-limit LAST so its burst can't throttle/skew the
// matrix/BOLA/BFLA/fuzz requests.
export const SUITE_ORDER: EngineId[] = [
  'matrix',
  'conformance',
  'bfla',
  'bola',
  'fuzz',
  'ratelimit',
];

// matrix results { reqId: { idId: { findings:[] } } } -> union items.
export function normalizeMatrix(
  results: Record<string, Record<string, MatrixCell | null | undefined>> | null | undefined,
  endpoints: Endpoint[] | null | undefined,
  identities: Identity[] | null | undefined
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const ep of endpoints || []) {
    for (const id of identities || []) {
      const cell = results && results[ep.reqId] && results[ep.reqId][id.id];
      const identityLabel = id.id === 'anon' ? 'anon' : id.name || id.id;
      const resp = cell && cell.response;
      for (const f of (cell && cell.findings) || []) {
        out.push({
          engine: 'matrix',
          ruleId: f.ruleId!,
          severity: f.severity,
          oracle: f.oracle,
          title: f.title,
          path: f.path,
          evidence: f.evidence || '',
          method: ep.method,
          endpoint: ep.path,
          identityLabel,
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
export function normalizeBola(
  results: BolaResults | null | undefined,
  tests: BolaTest[] | null | undefined
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const test of tests || []) {
    const atk = (results && results[test.id] && results[test.id].attacks) || {};
    for (const a in atk)
      for (const o in atk[a]) {
        const cell = atk[a][o];
        const f = cell && cell.finding;
        const rq = cell && cell.request;
        const resp = cell && cell.response;
        if (f)
          out.push({
            engine: 'bola',
            ruleId: f.ruleId || f.oracle,
            severity: f.severity,
            oracle: f.oracle,
            title: f.title,
            path: f.path,
            evidence: f.evidence || '',
            ref: { testId: test.id, attackerId: a, ownerId: o },
            raw: {
              request: rq ? { method: rq.method, url: rq.path, identity: rq.identity } : null,
              response: resp
                ? { status: resp.status, headers: resp.headers, body: resp.body }
                : null,
            },
          });
      }
  }
  return out;
}

// conformance results -> union items.
export function normalizeConformance(
  results: ConformanceResult[] | null | undefined
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const cell of results || []) {
    const test = cell && cell.test;
    if (!test) continue;
    const identityLabel =
      cell.identity && cell.identity.id === 'anon'
        ? 'anon'
        : (cell.identity && (cell.identity.name || cell.identity.id)) || '';
    for (const f of cell.findings || []) {
      out.push({
        engine: 'conformance',
        ruleId: f.ruleId || f.oracle,
        severity: f.severity,
        oracle: f.oracle,
        title: f.title,
        path: f.path,
        evidence: f.evidence || '',
        method: test.method,
        endpoint: test.path,
        identityLabel,
        ref: { reqId: test.reqId, idId: cell.identity ? cell.identity.id : undefined },
        raw: {
          request: { method: test.method, url: test.path, identity: identityLabel },
          response: cell.response
            ? {
                status: cell.response.status,
                headers: cell.response.headers,
                body: cell.response.body,
              }
            : null,
        },
      });
    }
  }
  return out;
}

// BFLA results -> union items.
export function normalizeBfla(results: BflaResult[] | null | undefined): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const cell of results || []) {
    const f = cell && cell.finding;
    const endpoint = cell && cell.endpoint;
    const identity = cell && cell.identity;
    if (!f || !endpoint || !identity) continue;
    const identityLabel = identity.id === 'anon' ? 'anon' : identity.name || identity.id;
    out.push({
      engine: 'bfla',
      ruleId: f.ruleId || f.oracle,
      severity: f.severity,
      oracle: f.oracle,
      title: f.title,
      path: f.path,
      evidence: f.evidence || '',
      method: endpoint.method,
      endpoint: endpoint.path,
      identityLabel,
      ref: { reqId: endpoint.reqId, idId: identity.id },
      raw: {
        request: { method: endpoint.method, url: endpoint.path, identity: identityLabel },
        response: cell.response
          ? {
              status: cell.response.status,
              headers: cell.response.headers,
              body: cell.response.body,
            }
          : null,
      },
    });
  }
  return out;
}

// fuzz results -> union items.
export function normalizeFuzz(results: FuzzSuiteResult[] | null | undefined): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const item of results || []) {
    const plan = item && item.plan;
    if (!plan) continue;
    for (const f of item.findings || []) {
      out.push({
        engine: 'fuzz',
        ruleId: f.ruleId || f.oracle,
        severity: f.severity,
        oracle: f.oracle,
        title: f.title,
        path: f.path,
        evidence: f.evidence || '',
        method: plan.method,
        endpoint: plan.path,
        ref: { reqId: plan.reqId, testId: plan.id },
        raw: { request: { method: plan.method, url: plan.path } },
      });
    }
  }
  return out;
}

// rate-limit results { testId: { finding } } -> union items.
export function normalizeRateLimit(
  results: Record<string, RateLimitResult | null | undefined> | null | undefined,
  tests: RateLimitTest[] | null | undefined
): UnionFinding[] {
  const out: UnionFinding[] = [];
  for (const test of tests || []) {
    const tr = results && results[test.id];
    const f = tr && tr.finding;
    if (f)
      out.push({
        engine: 'ratelimit',
        ruleId: f.ruleId || f.oracle,
        severity: f.severity,
        oracle: f.oracle,
        title: f.title,
        path: f.path,
        evidence: f.evidence || '',
        ref: { testId: test.id },
        raw: { request: { method: test.method, url: test.path }, stats: tr!.stats || null },
      });
  }
  return out;
}

/** suite 引擎設定（rate-limit 的設定鍵是 rateLimit）。 */
export type SuiteConfig = {
  matrix: { endpoints?: Endpoint[] | null; identities?: Identity[] | null; [k: string]: unknown };
  conformance?: { tests?: unknown[] | null; [k: string]: unknown };
  bfla?: { endpoints?: Endpoint[] | null; identities?: Identity[] | null; [k: string]: unknown };
  bola: { tests?: BolaTest[] | null; [k: string]: unknown };
  fuzz?: { plans?: unknown[] | null; [k: string]: unknown };
  rateLimit: { tests?: RateLimitTest[] | null; [k: string]: unknown };
};

// Is an engine's config empty (nothing to run)?
function engineEmpty(engine: EngineId, config: SuiteConfig): boolean {
  if (engine === 'matrix')
    return !((config.matrix.endpoints || []).length && (config.matrix.identities || []).length);
  if (engine === 'conformance')
    return !((config.conformance && config.conformance.tests) || []).length;
  if (engine === 'bfla')
    return (
      !((config.bfla && config.bfla.endpoints) || []).length ||
      !((config.bfla && config.bfla.identities) || []).length
    );
  if (engine === 'bola') return !(config.bola.tests || []).length;
  if (engine === 'fuzz') return !((config.fuzz && config.fuzz.plans) || []).length;
  return !(config.rateLimit.tests || []).length; // ratelimit
}

const NORMALIZERS: Record<EngineId, (results: any, config: SuiteConfig) => UnionFinding[]> = {
  matrix: (results, config) =>
    normalizeMatrix(results, config.matrix.endpoints, config.matrix.identities),
  conformance: (results) => normalizeConformance(results),
  bfla: (results) => normalizeBfla(results),
  bola: (results, config) => normalizeBola(results, config.bola.tests),
  fuzz: (results) => normalizeFuzz(results),
  ratelimit: (results, config) => normalizeRateLimit(results, config.rateLimit.tests),
};

// engine id -> config key (rate-limit's config lives under `rateLimit`).
const CONFIG_KEY = {
  matrix: 'matrix',
  conformance: 'conformance',
  bfla: 'bfla',
  bola: 'bola',
  fuzz: 'fuzz',
  ratelimit: 'rateLimit',
} as const;

/** 注入的引擎執行 adapter：跑完整個引擎並 resolve 出該引擎的 results。 */
export type SuiteRunner = (
  config: any,
  opts: { signal?: AbortSignal | null; onProgress: (done: number, total: number) => void }
) => Promise<any>;

// Orchestrate the suite engines sequentially into one RunRecord.
// `runners` maps each engine id to an async adapter that executes the whole engine
// and resolves to its results (signature: runner(config[engine], {signal, onProgress})).
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
  } = {}
): Promise<RunRecord> {
  const now = opts.now || (() => Date.now());
  const signal = opts.signal;
  const t0 = now();
  const startedAt = new Date(t0).toISOString();
  const engines: EngineRunSummary[] = [];
  const union: UnionFinding[] = [];
  let aborted = false;

  for (const engine of SUITE_ORDER) {
    if (signal && signal.aborted) {
      aborted = true;
      break;
    }
    if (engineEmpty(engine, config)) {
      engines.push({
        engine,
        ran: false,
        skipped: 'no-config',
        durationMs: 0,
        findingCount: 0,
        error: null,
      });
      continue;
    }
    const eStart = now();
    let results: any = null,
      error: string | null = null;
    try {
      results = await runners[engine](config[CONFIG_KEY[engine]], {
        signal,
        onProgress: (done, total) => {
          if (opts.onProgress) opts.onProgress(engine, done, total);
        },
      });
      if (opts.onEngineResult) opts.onEngineResult(engine, results);
    } catch (e: any) {
      error = String((e && e.message) || e);
    }
    const items = error ? [] : NORMALIZERS[engine](results, config);
    union.push(...items);
    engines.push({
      engine,
      ran: true,
      durationMs: now() - eStart,
      findingCount: items.length,
      error,
    });
    if (signal && signal.aborted) {
      aborted = true;
      break;
    }
  }

  const tEnd = now();
  return {
    status: aborted ? 'aborted' : 'complete',
    startedAt,
    finishedAt: new Date(tEnd).toISOString(),
    durationMs: tEnd - t0,
    engines,
    union,
  };
}
