// ── QA Touchstone — rate-limit / abuse testing engine (pure logic) ──────────
// Fires a bounded real burst at an endpoint and reports whether throttling
// engages. The ABSENCE of a throttle signal is the finding. UI in RateLimitPanel.
import './setup.js';

export const MAX_N = 200;
export const MAX_CONCURRENCY = 10;

// Lowercased header names that indicate a rate limiter is present.
export const THROTTLE_HEADERS = [
  'retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
];

// Scan a burst's responses for a throttle signal: any 429, or any rate-limit
// header (compared case-insensitively). Presence of a RateLimit-* header means
// a limiter exists, so it counts as throttled even on a 2xx.
export function detectThrottleSignal(responses) {
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
export function classifyRateLimit(signal, completedCount) {
  if (signal && signal.throttled) return 'pass';
  if (completedCount > 0) return 'vuln';
  return 'inconclusive';
}

export function rateLimitSeverity(sensitivity, verdict) {
  if (verdict !== 'vuln') return null;
  return sensitivity === 'sensitive' ? 'high' : 'low';
}

function clampInt(v, lo, hi) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

// Fire `test.n` requests through the injected `runner(test, index) => Promise<resp>`,
// keeping at most `test.concurrency` in flight (both clamped to the caps). Records
// each response, never throws out of the burst, streams opts.onProgress(done, n),
// and stops launching new requests once opts.signal aborts (in-flight ones finish).
export async function runBurst(test, runner, opts = {}) {
  const { signal, onProgress } = opts;
  const n = clampInt(test && test.n, 1, MAX_N);
  const c = clampInt(test && test.concurrency, 1, MAX_CONCURRENCY);
  const responses = [];
  let launched = 0, done = 0;
  async function worker() {
    while (launched < n) {
      if (signal && signal.aborted) return;
      const i = launched++;
      let cell;
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
      } catch (e) {
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

function computeStats(responses) {
  const s = { sent: responses.length, ok2xx: 0, c429: 0, c4xx: 0, c5xx: 0, net: 0, avgMs: 0, maxMs: 0, throttled: false, headerHit: false };
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
  const sig = detectThrottleSignal(responses);
  s.throttled = sig.throttled;
  s.headerHit = sig.headerHit;
  s.avgMs = responses.length ? Math.round(totMs / responses.length) : 0;
  return s;
}

// Evaluate a burst result into a finding (or null if throttling was observed).
// `title` is injected so this module stays i18n-free. Shared by the panel and
// the unified-suite rate-limit adapter so both produce identical findings.
export function rlFindingFor(test, responses, stats, title) {
  const signal = detectThrottleSignal(responses);
  const completed = (responses || []).filter(x => x.status != null).length;
  const verdict = classifyRateLimit(signal, completed);
  const severity = rateLimitSeverity(test.sensitivity, verdict);
  if (!severity) return null;
  return {
    oracle: 'rate-limit', severity, title,
    path: `${test.method} ${test.path}`,
    evidence: `${stats.sent} requests, no 429/rate-limit headers`,
    source: 'rule',
  };
}

// Tally per-test verdicts across the results map for the summary chips.
export function summarizeRateLimit(results) {
  const s = { total: 0, pass: 0, vuln: 0, inconclusive: 0 };
  for (const tid in results) {
    const v = results[tid] && results[tid].verdict;
    if (!v) continue;
    s.total++; if (s[v] !== undefined) s[v]++;
  }
  return s;
}
