// ── QA Touchstone — rate-limit / abuse testing engine (pure logic) ──────────
// Fires a bounded real burst at an endpoint and reports whether throttling
// engages. The ABSENCE of a throttle signal is the finding. UI in RateLimitPanel.
import './setup';
import type { BurstResponse, BurstStats, Finding, QaResponse, RateLimitTest, RateLimitVerdict, Severity, ThrottleSignal, ThrottleStrength } from './types';

export const MAX_N = 200;
export const MAX_CONCURRENCY = 10;
// A 429 only counts as "strong" protection if it fires before this many requests
// slip through — absolute floor or this fraction of the burst, whichever is larger.
export const WEAK_AFTER_ABS = 20;
export const WEAK_AFTER_FRAC = 0.5;

// Lowercased header names that indicate a rate limiter is present.
export const THROTTLE_HEADERS = [
  'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
];

// Scan a burst's responses for a throttle signal: any 429, or any rate-limit
// header (compared case-insensitively). Presence of a RateLimit-* header means
// a limiter exists, so it counts as throttled even on a 2xx.
export function detectThrottleSignal(
  responses: Array<{ status?: number | null; headers?: Record<string, unknown> | null } | null | undefined> | null | undefined,
): ThrottleSignal {
  let saw429 = false, headerHit = false;
  for (const r of responses || []) {
    if (!r) continue;
    if (r.status === 429) saw429 = true;
    const hdrs = r.headers || {};
    for (const k of Object.keys(hdrs)) {
      if (THROTTLE_HEADERS.includes(k.toLowerCase())) { headerHit = true; break; }
    }
    if (saw429 && headerHit) break;
  }
  return { throttled: saw429 || headerHit, saw429, headerHit };
}

// completedCount = responses that returned a real HTTP status (net errors excluded).
export function classifyRateLimit(signal: { throttled?: boolean } | null | undefined, completedCount: number): RateLimitVerdict {
  if (signal && signal.throttled) return 'pass';
  if (completedCount > 0) return 'vuln';
  return 'inconclusive';
}

/** analyzeThrottle 的量化結果（detectThrottleSignal 的超集，形狀獨立以免破壞契約）。 */
export type ThrottleAnalysis = {
  completed: number;
  ok2xx: number;
  c429: number;
  saw429: boolean;
  headerHit: boolean;
  throttled: boolean;
  firstThrottledIndex: number;
  allowedBeforeThrottle: number;
};

// Quantify throttling rather than just detecting its presence: how many requests
// slipped through before the limiter engaged, and whether it actually enforced
// (a real 429) or is merely advertised by headers. This is what lets the caller
// distinguish "throttled after 2 requests" from "throttled after 199".
export function analyzeThrottle(
  responses: Array<{ status?: number | null; headers?: Record<string, unknown> | null } | null | undefined> | null | undefined,
): ThrottleAnalysis {
  let completed = 0, ok2xx = 0, c429 = 0, allowedBeforeThrottle = 0;
  let saw429 = false, headerHit = false, firstThrottledIndex = -1, idx = -1;
  for (const r of responses || []) {
    if (!r) continue;
    idx++;
    const st = r.status;
    if (typeof st === 'number' && st > 0) completed++;
    if (st === 429) {
      c429++;
      if (!saw429) { saw429 = true; firstThrottledIndex = idx; }
    } else if (typeof st === 'number' && st >= 200 && st <= 299) {
      ok2xx++;
      if (!saw429) allowedBeforeThrottle++;
    }
    const hdrs = r.headers || {};
    for (const k of Object.keys(hdrs)) {
      if (THROTTLE_HEADERS.includes(k.toLowerCase())) { headerHit = true; break; }
    }
  }
  return { completed, ok2xx, c429, saw429, headerHit, throttled: saw429 || headerHit, firstThrottledIndex, allowedBeforeThrottle };
}

// Grade the protection: none (no signal), strong (a 429 fired early), or weak
// (a 429 only after many requests slipped through, or headers with no enforced
// 429 at all). The weak grade is the whole point — a single late 429 is not the
// same as real protection, and a status-only "pass" hides that.
export function rateLimitStrength(a: ThrottleAnalysis | null | undefined): ThrottleStrength {
  if (!a || (!a.saw429 && !a.headerHit)) return 'none';
  if (a.saw429) {
    const budget = Math.max(WEAK_AFTER_ABS, Math.ceil(a.completed * WEAK_AFTER_FRAC));
    return a.allowedBeforeThrottle <= budget ? 'strong' : 'weak';
  }
  return 'weak'; // advertised by headers but never enforced in this burst
}

export function rateLimitSeverity(sensitivity: string | null | undefined, verdict: string | null | undefined): Severity | null {
  if (verdict !== 'vuln') return null;
  return sensitivity === 'sensitive' ? 'high' : 'low';
}

function clampInt(v: any, lo: number, hi: number): number {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

/** runBurst 注入的執行器：runner(test, index) => Promise<resp>。 */
export type BurstRunner = (test: RateLimitTest, index: number) => Promise<QaResponse | null | undefined>;

// Fire `test.n` requests through the injected `runner(test, index) => Promise<resp>`,
// keeping at most `test.concurrency` in flight (both clamped to the caps). Records
// each response, never throws out of the burst, streams opts.onProgress(done, n),
// and stops launching new requests once opts.signal aborts (in-flight ones finish).
export async function runBurst(
  test: RateLimitTest,
  runner: BurstRunner,
  opts: { signal?: AbortSignal | null; onProgress?: (done: number, n: number) => void } = {},
): Promise<{ responses: BurstResponse[]; stats: BurstStats }> {
  const { signal, onProgress } = opts;
  const n = clampInt(test && test.n, 1, MAX_N);
  const c = clampInt(test && test.concurrency, 1, MAX_CONCURRENCY);
  const responses: BurstResponse[] = [];
  let launched = 0, done = 0;
  async function worker() {
    while (launched < n) {
      if (signal && signal.aborted) return;
      const i = launched++;
      let cell: BurstResponse;
      try {
        const resp = await runner(test, i);
        cell = {
          // A 0/non-positive status is the executor's resolved transport-error
          // sentinel (executeRequest returns { status: 0 } instead of throwing on a
          // network failure); normalize it to null so it buckets as `net` and is
          // excluded from completedCount, rather than counting as a completed request.
          status: resp && typeof resp.status === 'number' && resp.status > 0 ? resp.status : null,
          headers: (resp && resp.headers) || {},
          timeMs: (resp && resp.time) || 0,
          error: null,
        };
      } catch (e: any) {
        cell = { status: null, headers: {}, timeMs: 0, error: String((e && e.message) || e) };
      }
      responses[i] = cell;
      done++;
      if (onProgress) onProgress(done, n);
    }
  }
  await Promise.all(Array.from({ length: Math.min(c, n) }, () => worker()));
  const collected = responses.filter(Boolean);
  return { responses: collected, stats: computeStats(collected) };
}

function computeStats(responses: BurstResponse[]): BurstStats {
  const s: BurstStats = {
    sent: responses.length, ok2xx: 0, c429: 0, c4xx: 0, c5xx: 0, net: 0, avgMs: 0, maxMs: 0,
    throttled: false, headerHit: false, firstThrottledIndex: -1, allowedBeforeThrottle: 0, strength: 'none',
  };
  let totMs = 0;
  for (const r of responses) {
    const st = r.status;
    if (st == null) s.net++;
    else if (st === 429) s.c429++;
    else if (st >= 500) s.c5xx++;
    else if (st >= 400) s.c4xx++;
    else if (st >= 200 && st <= 299) s.ok2xx++;
    totMs += r.timeMs || 0;
    if ((r.timeMs || 0) > s.maxMs) s.maxMs = r.timeMs || 0;
  }
  const a = analyzeThrottle(responses);
  s.throttled = a.throttled;
  s.headerHit = a.headerHit;
  s.firstThrottledIndex = a.firstThrottledIndex;
  s.allowedBeforeThrottle = a.allowedBeforeThrottle;
  s.strength = rateLimitStrength(a);
  s.avgMs = responses.length ? Math.round(totMs / responses.length) : 0;
  return s;
}

// Evaluate a burst result into a finding. Three outcomes:
//  - no protection at all          → the original high/low `title` finding
//  - weak protection (late 429, or headers-only with no enforced 429), when an
//    optional `weakTitle` is supplied → a lower-severity advisory that quantifies
//    how many requests slipped through (so a single late 429 is not sold as a pass)
//  - strong protection             → null (no finding)
// `title`/`weakTitle` are injected so this module stays i18n-free. Shared by the
// panel and the unified-suite rate-limit adapter so both produce identical findings.
export function rlFindingFor(
  test: RateLimitTest,
  responses: BurstResponse[] | null | undefined,
  stats: Pick<BurstStats, 'sent'>,
  title: string,
  weakTitle?: string,
): Finding | null {
  const a = analyzeThrottle(responses);
  if (a.completed === 0) return null; // inconclusive — nothing actually landed
  const strength = rateLimitStrength(a);
  if (strength === 'none') {
    const severity = rateLimitSeverity(test.sensitivity, 'vuln');
    if (!severity) return null;
    return {
      oracle: 'rate-limit', severity, title,
      path: `${test.method} ${test.path}`,
      evidence: `${stats.sent} requests, no 429/rate-limit headers`,
      source: 'rule',
    };
  }
  if (strength === 'weak' && weakTitle) {
    const severity: Severity = test.sensitivity === 'sensitive' ? 'medium' : 'low';
    const evidence = a.saw429
      ? `${a.allowedBeforeThrottle} of ${stats.sent} requests succeeded before the first 429 — throttling engages late`
      : `rate-limit headers present but no 429 enforced across ${stats.sent} requests`;
    return { oracle: 'rate-limit', severity, title: weakTitle, path: `${test.method} ${test.path}`, evidence, source: 'rule' };
  }
  return null; // strong protection, or weak without a weakTitle (back-compat)
}

// Tally per-test verdicts across the results map for the summary chips.
export function summarizeRateLimit(
  results: Record<string, { verdict?: RateLimitVerdict | null } | null | undefined>,
): { total: number; pass: number; vuln: number; inconclusive: number } {
  const s = { total: 0, pass: 0, vuln: 0, inconclusive: 0 };
  for (const tid in results) {
    const v = results[tid] && results[tid].verdict;
    if (!v) continue;
    s.total++; if (s[v] !== undefined) s[v]++;
  }
  return s;
}
