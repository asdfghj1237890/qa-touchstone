// src/__tests__/security-suite.test.js
import { describe, it, expect } from 'vitest';
import { normalizeMatrix, normalizeBola, normalizeRateLimit, runSuite } from '../qa/securitySuite.js';

describe('normalizeMatrix', () => {
  it('flattens cell findings into union items with ruleId + matrix location', () => {
    const endpoints = [{ reqId: 'r1', method: 'GET', path: '/me' }];
    const identities = [{ id: 'admin', name: 'Admin' }, { id: 'anon' }];
    const results = { r1: {
      admin: { findings: [{ ruleId: 'jwt', oracle: 'sensitive-data', severity: 'high', title: 'JWT in response', path: 'data.token', evidence: 'x' }] },
      anon: { findings: [] },
    } };
    const out = normalizeMatrix(results, endpoints, identities);
    expect(out).toEqual([{
      engine: 'matrix', ruleId: 'jwt', severity: 'high', oracle: 'sensitive-data',
      title: 'JWT in response', path: 'data.token', evidence: 'x',
      method: 'GET', endpoint: '/me', identityLabel: 'Admin', ref: { reqId: 'r1', idId: 'admin' },
    }]);
  });
  it('labels the anon identity "anon"', () => {
    const out = normalizeMatrix(
      { r1: { anon: { findings: [{ ruleId: 'email', oracle: 'sensitive-data', severity: 'medium', title: 'Email', path: 'a', evidence: '' }] } } },
      [{ reqId: 'r1', method: 'GET', path: '/x' }], [{ id: 'anon' }]);
    expect(out[0].identityLabel).toBe('anon');
  });
});

describe('normalizeBola', () => {
  it('emits a union item per attack finding with ruleId fallback to oracle', () => {
    const tests = [{ id: 't1' }];
    const results = { t1: { attacks: { a: { o: { finding: { oracle: 'object-authz', severity: 'high', title: 'Cross-object access confirmed', path: 'GET /o' } } } } } };
    const out = normalizeBola(results, tests);
    expect(out).toEqual([{
      engine: 'bola', ruleId: 'object-authz', severity: 'high', oracle: 'object-authz',
      title: 'Cross-object access confirmed', path: 'GET /o', evidence: '',
      ref: { testId: 't1', attackerId: 'a', ownerId: 'o' },
    }]);
  });
});

describe('normalizeRateLimit', () => {
  it('emits a union item per test finding', () => {
    const tests = [{ id: 't9' }];
    const results = { t9: { finding: { oracle: 'rate-limit', severity: 'medium', title: 'No rate limiting', path: 'GET /x', evidence: '30 requests' } } };
    const out = normalizeRateLimit(results, tests);
    expect(out).toEqual([{
      engine: 'ratelimit', ruleId: 'rate-limit', severity: 'medium', oracle: 'rate-limit',
      title: 'No rate limiting', path: 'GET /x', evidence: '30 requests', ref: { testId: 't9' },
    }]);
  });
  it('skips tests with no finding', () => {
    expect(normalizeRateLimit({ t9: { finding: null } }, [{ id: 't9' }])).toEqual([]);
  });
});

// A fake clock returning ascending ms so durations are deterministic.
function fakeNow() { let t = 1000; return () => (t += 1000); }

// Build runners that record call order and return canned per-engine results.
function recordingRunners(log, opts = {}) {
  return {
    matrix: async () => { log.push('matrix'); return opts.matrix ?? {}; },
    bola: async () => { log.push('bola'); return opts.bola ?? {}; },
    ratelimit: async () => { log.push('ratelimit'); return opts.ratelimit ?? {}; },
  };
}

const baseConfig = {
  matrix: { endpoints: [{ reqId: 'r1', method: 'GET', path: '/me' }], identities: [{ id: 'admin' }] },
  bola: { tests: [{ id: 't1' }], identities: [{ id: 'admin' }] },
  rateLimit: { tests: [{ id: 't9' }], identities: [{ id: 'admin' }] },
};

describe('runSuite', () => {
  it('runs engines sequentially in matrix -> bola -> ratelimit order', async () => {
    const log = [];
    const rec = await runSuite(baseConfig, recordingRunners(log), { now: fakeNow() });
    expect(log).toEqual(['matrix', 'bola', 'ratelimit']);
    expect(rec.status).toBe('complete');
    expect(rec.engines.map(e => e.engine)).toEqual(['matrix', 'bola', 'ratelimit']);
    expect(rec.engines.every(e => e.ran)).toBe(true);
  });

  it('skips an engine with no config and still completes', async () => {
    const log = [];
    const cfg = { ...baseConfig, rateLimit: { tests: [], identities: [] } };
    const rec = await runSuite(cfg, recordingRunners(log), { now: fakeNow() });
    expect(log).toEqual(['matrix', 'bola']);          // ratelimit not invoked
    const rl = rec.engines.find(e => e.engine === 'ratelimit');
    expect(rl).toMatchObject({ ran: false, skipped: 'no-config' });
    expect(rec.status).toBe('complete');
  });

  it('aborts mid-suite: stops, marks aborted, does not run later engines', async () => {
    const log = [];
    const controller = new AbortController();
    const runners = {
      matrix: async () => { log.push('matrix'); controller.abort(); return {}; },
      bola: async () => { log.push('bola'); return {}; },
      ratelimit: async () => { log.push('ratelimit'); return {}; },
    };
    const rec = await runSuite(baseConfig, runners, { signal: controller.signal, now: fakeNow() });
    expect(log).toEqual(['matrix']);                  // bola/ratelimit skipped after abort
    expect(rec.status).toBe('aborted');
  });

  it('assembles the union and per-engine finding counts + durations', async () => {
    const matrix = { r1: { admin: { findings: [{ ruleId: 'jwt', oracle: 'sensitive-data', severity: 'high', title: 'JWT', path: 'a', evidence: '' }] } } };
    const bola = { t1: { attacks: { a: { o: { finding: { oracle: 'object-authz', severity: 'high', title: 'X', path: 'p' } } } } } };
    const ratelimit = { t9: { finding: { oracle: 'rate-limit', severity: 'medium', title: 'RL', path: 'q', evidence: '' } } };
    const rec = await runSuite(baseConfig, recordingRunners([], { matrix, bola, ratelimit }), { now: fakeNow() });
    expect(rec.union).toHaveLength(3);
    expect(rec.engines.find(e => e.engine === 'matrix').findingCount).toBe(1);
    expect(rec.engines.find(e => e.engine === 'bola').findingCount).toBe(1);
    expect(rec.engines.find(e => e.engine === 'ratelimit').findingCount).toBe(1);
    expect(rec.engines.every(e => typeof e.durationMs === 'number')).toBe(true);
    expect(rec.durationMs).toBeGreaterThan(0);
    expect(rec.union).not.toHaveProperty('items');     // runSuite returns union, not snapshot items
  });

  it('passes each engine its own config slice (ratelimit uses the rateLimit key)', async () => {
    const received = {};
    const runners = {
      matrix: async (cfg) => { received.matrix = cfg; return {}; },
      bola: async (cfg) => { received.bola = cfg; return {}; },
      ratelimit: async (cfg) => { received.ratelimit = cfg; return {}; },
    };
    await runSuite(baseConfig, runners, { now: fakeNow() });
    expect(received.matrix).toBe(baseConfig.matrix);
    expect(received.bola).toBe(baseConfig.bola);
    expect(received.ratelimit).toBe(baseConfig.rateLimit);   // must NOT be undefined
  });
});
