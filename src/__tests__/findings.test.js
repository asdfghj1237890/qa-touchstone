// src/__tests__/findings.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FP_VERSION, ruleIdOf, locationOf, locationLabel, fnv1a, fingerprint,
} from '../qa/findings.js';

const matrixF = (over = {}) => ({
  engine: 'matrix', ruleId: 'jwt', severity: 'high', title: 'JWT in response',
  path: 'data.token', evidence: 'eyJ…', method: 'GET', endpoint: '/me',
  identityLabel: 'admin', ref: { reqId: 'r1', idId: 'admin' }, ...over,
});

describe('FP_VERSION', () => {
  it('is a positive integer', () => { expect(FP_VERSION).toBeGreaterThanOrEqual(1); });
});

describe('ruleIdOf', () => {
  it('prefers explicit ruleId', () => { expect(ruleIdOf({ ruleId: 'jwt', oracle: 'sensitive-data' })).toBe('jwt'); });
  it('falls back to oracle (BOLA/rate-limit have stable oracle ids)', () => {
    expect(ruleIdOf({ oracle: 'object-authz' })).toBe('object-authz');
    expect(ruleIdOf({ oracle: 'rate-limit' })).toBe('rate-limit');
  });
  it('defaults to "unknown" when neither present', () => { expect(ruleIdOf({})).toBe('unknown'); });
});

describe('locationOf', () => {
  it('matrix uses method + endpoint + identity id', () => {
    expect(locationOf(matrixF())).toBe('GET /me @admin');
  });
  it('bola uses test + attacker -> owner', () => {
    expect(locationOf({ engine: 'bola', ref: { testId: 't1', attackerId: 'a', ownerId: 'o' } }))
      .toBe('bola:t1:a->o');
  });
  it('ratelimit uses test id', () => {
    expect(locationOf({ engine: 'ratelimit', ref: { testId: 't9' } })).toBe('rl:t9');
  });
});

describe('fingerprint', () => {
  it('is stable when only title or evidence changes', () => {
    const a = fingerprint(matrixF());
    const b = fingerprint(matrixF({ title: 'Different wording', evidence: 'zzz' }));
    expect(b.fp).toBe(a.fp);
  });
  it('changes when ruleId, location, or normalized path changes', () => {
    const base = fingerprint(matrixF()).fp;
    expect(fingerprint(matrixF({ ruleId: 'email' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ endpoint: '/other' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ path: 'data.secret' })).fp).not.toBe(base);
  });
  it('treats array indices as equal (normalizePath collapses [n])', () => {
    expect(fingerprint(matrixF({ path: 'items[0].token' })).fp)
      .toBe(fingerprint(matrixF({ path: 'items[3].token' })).fp);
  });
  it('exposes the canonical fpMaterial beside the hash', () => {
    expect(fingerprint(matrixF()).fpMaterial).toBe('matrix|jwt|GET /me @admin|data.token');
  });
});

describe('locationLabel', () => {
  const matrixF = (over = {}) => ({
    engine: 'matrix', method: 'GET', endpoint: '/me', identityLabel: 'admin',
    ref: { reqId: 'r1', idId: 'admin' }, ...over,
  });
  it('matrix uses method, endpoint, and identity label', () => {
    expect(locationLabel(matrixF())).toBe('GET /me · admin');
  });
  it('matrix omits the identity suffix when identityLabel is absent', () => {
    expect(locationLabel(matrixF({ identityLabel: '' }))).toBe('GET /me');
  });
  it('bola uses a human label with attacker/owner', () => {
    expect(locationLabel({ engine: 'bola', ref: { testId: 't1', attackerId: 'a', ownerId: 'o' } }))
      .toBe('BOLA t1 (a→o)');
  });
  it('ratelimit uses a human label with the test id', () => {
    expect(locationLabel({ engine: 'ratelimit', ref: { testId: 't9' } })).toBe('Rate-limit t9');
  });
});

describe('fnv1a', () => {
  it('matches known 32-bit FNV-1a vectors (8-char hex)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

import { effectiveSeverity } from '../qa/findings.js';

describe('effectiveSeverity', () => {
  it('returns the finding severity when no override', () => {
    expect(effectiveSeverity({ severity: 'medium' }, undefined)).toBe('medium');
    expect(effectiveSeverity({ severity: 'medium' }, { severityOverride: null })).toBe('medium');
  });
  it('applies a valid override', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'low' })).toBe('low');
  });
  it('ignores an invalid override value', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'bogus' })).toBe('high');
  });
});
