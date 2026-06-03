// src/__tests__/ratelimit.test.js
import { describe, it, expect } from 'vitest';
import { THROTTLE_HEADERS, MAX_N, MAX_CONCURRENCY, detectThrottleSignal } from '../qa/ratelimit.js';
import { classifyRateLimit, rateLimitSeverity } from '../qa/ratelimit.js';
import { runBurst, summarizeRateLimit, MAX_N as CAP } from '../qa/ratelimit.js';

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
});

describe('summarizeRateLimit', () => {
  it('tallies per-test verdicts', () => {
    const results = { t1: { verdict: 'vuln' }, t2: { verdict: 'pass' }, t3: { verdict: 'vuln' } };
    expect(summarizeRateLimit(results)).toEqual({ total: 3, pass: 1, vuln: 2, inconclusive: 0 });
  });
});
