// src/__tests__/ratelimit.test.js
import { describe, it, expect } from 'vitest';
import { THROTTLE_HEADERS, MAX_N, MAX_CONCURRENCY, detectThrottleSignal } from '../qa/ratelimit.js';

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
