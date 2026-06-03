// src/__tests__/security-suite.test.js
import { describe, it, expect } from 'vitest';
import { normalizeMatrix, normalizeBola, normalizeRateLimit } from '../qa/securitySuite.js';

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
