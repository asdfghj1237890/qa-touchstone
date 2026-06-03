// src/__tests__/ratelimit.test.js
import { describe, it, expect } from 'vitest';
import { THROTTLE_HEADERS, MAX_N, MAX_CONCURRENCY, detectThrottleSignal } from '../qa/ratelimit.js';
import { classifyRateLimit, rateLimitSeverity } from '../qa/ratelimit.js';
import { runBurst, summarizeRateLimit, MAX_N as CAP } from '../qa/ratelimit.js';
import { rlFindingFor } from '../qa/ratelimit.js';

describe('constants', () => {
  it('caps and the throttle-header set are exposed', () => {
    expect(MAX_N).toBe(200);
    expect(MAX_CONCURRENCY).toBe(10);
    expect(THROTTLE_HEADERS).toContain('retry-after');
    expect(THROTTLE_HEADERS).toContain('x-ratelimit-remaining');
  });
});

describe('detectThrottleSignal', () => {
  const r = (status, headers = {}) => ({ status, headers, timeMs: 1, error: null });
  it('flags a 429 anywhere in the burst', () => {
    expect(detectThrottleSignal([r(200), r(429), r(200)])).toEqual({ throttled: true, saw429: true, headerHit: false });
  });
  it('flags a rate-limit header case-insensitively', () => {
    expect(detectThrottleSignal([r(200, { 'Retry-After': '5' })]).throttled).toBe(true);
    expect(detectThrottleSignal([r(200, { 'X-RateLimit-Remaining': '0' })]).headerHit).toBe(true);
  });
  it('is not throttled when no 429 and no rate-limit headers', () => {
    expect(detectThrottleSignal([r(200, { 'content-type': 'application/json' }), r(200)])).toEqual({ throttled: false, saw429: false, headerHit: false });
  });
  it('tolerates null/empty entries', () => {
    expect(detectThrottleSignal([null, undefined, r(200)]).throttled).toBe(false);
    expect(detectThrottleSignal([]).throttled).toBe(false);
  });
});

describe('classifyRateLimit', () => {
  it('throttled is pass', () => {
    expect(classifyRateLimit({ throttled: true }, 30)).toBe('pass');
  });
  it('completed with no signal is vuln', () => {
    expect(classifyRateLimit({ throttled: false }, 30)).toBe('vuln');
  });
  it('nothing completed is inconclusive', () => {
    expect(classifyRateLimit({ throttled: false }, 0)).toBe('inconclusive');
  });
});

describe('rateLimitSeverity', () => {
  it('vuln severity follows the sensitivity flag', () => {
    expect(rateLimitSeverity('sensitive', 'vuln')).toBe('high');
    expect(rateLimitSeverity('normal', 'vuln')).toBe('low');
  });
  it('non-vuln verdicts have no finding', () => {
    expect(rateLimitSeverity('sensitive', 'pass')).toBe(null);
    expect(rateLimitSeverity('normal', 'inconclusive')).toBe(null);
  });
});

describe('runBurst', () => {
  it('collects N responses and computes stats', async () => {
    const runner = () => Promise.resolve({ status: 200, headers: {}, time: 3 });
    const { responses, stats } = await runBurst({ n: 12, concurrency: 4 }, runner, {});
    expect(responses).toHaveLength(12);
    expect(stats.sent).toBe(12);
    expect(stats.ok2xx).toBe(12);
    expect(stats.throttled).toBe(false);
  });

  it('never exceeds the configured concurrency in flight', async () => {
    let inFlight = 0, maxInFlight = 0;
    const runner = () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise(res => setTimeout(() => { inFlight--; res({ status: 200, headers: {}, time: 1 }); }, 5));
    };
    await runBurst({ n: 10, concurrency: 3 }, runner, {});
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('clamps n and concurrency to the caps', async () => {
    let calls = 0;
    const runner = () => { calls++; return Promise.resolve({ status: 200, headers: {}, time: 1 }); };
    const { stats } = await runBurst({ n: 5000, concurrency: 999 }, runner, {});
    expect(calls).toBe(CAP);   // n clamped to MAX_N
    expect(stats.sent).toBe(CAP);
  });

  it('records a thrown runner as a net error without aborting the burst', async () => {
    let i = 0;
    const runner = () => { i++; return i === 2 ? Promise.reject(new Error('boom')) : Promise.resolve({ status: 200, headers: {}, time: 1 }); };
    const { stats } = await runBurst({ n: 3, concurrency: 1 }, runner, {});
    expect(stats.sent).toBe(3);
    expect(stats.net).toBe(1);
    expect(stats.ok2xx).toBe(2);
  });

  it('does not launch when the abort signal is already set', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runBurst({ n: 10, concurrency: 2 }, () => { calls++; return Promise.resolve({ status: 200, headers: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });

  it('streams progress up to n', async () => {
    const seen = [];
    await runBurst({ n: 4, concurrency: 2 }, () => Promise.resolve({ status: 200, headers: {}, time: 1 }), { onProgress: (done, n) => seen.push([done, n]) });
    expect(seen[seen.length - 1]).toEqual([4, 4]);
    expect(seen).toHaveLength(4);
  });

  it('counts 429 and rate-limit headers in stats', async () => {
    const runner = () => Promise.resolve({ status: 429, headers: { 'Retry-After': '1' }, time: 1 });
    const { stats } = await runBurst({ n: 3, concurrency: 3 }, runner, {});
    expect(stats.c429).toBe(3);
    expect(stats.throttled).toBe(true);
  });

  it('treats a resolved status:0 as a net error, not a completed request', async () => {
    // 0 is the executor's resolved transport-error sentinel (executeRequest returns
    // { status: 0, ... } on transport/network failure rather than throwing).
    const n = 6;
    const runner = () => Promise.resolve({ status: 0, headers: {}, time: 1 });
    const { responses, stats } = await runBurst({ n, concurrency: 3 }, runner, {});
    expect(stats.net).toBe(n);
    expect(stats.sent).toBe(n);
    // completedCount = responses with a numeric status → 0 here → inconclusive.
    expect(responses.filter(x => x.status != null).length).toBe(0);
  });

  it('buckets a rotating mix of statuses into the right stats counts', async () => {
    // 8 requests, deterministic rotation by call index: 200, 404, 500, 429 ×2.
    const n = 8;
    const cycle = [
      { status: 200, time: 10 },
      { status: 404, time: 20 },
      { status: 500, time: 30 },
      { status: 429, time: 40 },
    ];
    let i = 0;
    const runner = () => { const c = cycle[i++ % cycle.length]; return Promise.resolve({ status: c.status, headers: {}, time: c.time }); };
    const { stats } = await runBurst({ n, concurrency: 1 }, runner, {});
    expect(stats.sent).toBe(n);
    expect(stats.ok2xx).toBe(2);
    expect(stats.c4xx).toBe(2);
    expect(stats.c5xx).toBe(2);
    expect(stats.c429).toBe(2);
    expect(stats.maxMs).toBe(40);
    expect(stats.avgMs).toBe(25); // (10+20+30+40)*2 / 8 = 25
  });
});

describe('summarizeRateLimit', () => {
  it('tallies per-test verdicts', () => {
    const results = { t1: { verdict: 'vuln' }, t2: { verdict: 'pass' }, t3: { verdict: 'vuln' } };
    expect(summarizeRateLimit(results)).toEqual({ total: 3, pass: 1, vuln: 2, inconclusive: 0 });
  });
});

describe('rlFindingFor', () => {
  const test = { method: 'GET', path: '/x', sensitivity: 'sensitive' };
  it('returns a finding when no throttle signal is seen', () => {
    const responses = Array.from({ length: 30 }, () => ({ status: 200, headers: {} }));
    const stats = { sent: 30 };
    const f = rlFindingFor(test, responses, stats, 'No rate limiting');
    expect(f).toMatchObject({ oracle: 'rate-limit', title: 'No rate limiting', path: 'GET /x', source: 'rule' });
    expect(['low', 'medium', 'high', 'critical']).toContain(f.severity);
  });
  it('returns null when throttling is detected (429 present)', () => {
    const responses = [{ status: 429, headers: {} }, { status: 200, headers: {} }];
    const f = rlFindingFor(test, responses, { sent: 2 }, 'No rate limiting');
    expect(f).toBeNull();
  });
});
