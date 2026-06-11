// src/__tests__/bfla.test.js
import { describe, it, expect } from 'vitest';
import { bflaPlan, classifyBfla, bflaSeverity, bflaFinding, runBfla } from '../qa/bfla';

const anon = { id: 'anon', name: 'anon', auth: { type: 'none' } };
const user = { id: 'u', name: 'user', auth: { type: 'bearer' } };           // non-privileged
const admin = { id: 'a', name: 'admin', auth: { type: 'bearer' }, privileged: true };

const adminEp = { reqId: 'e1', method: 'DELETE', path: '/admin/users/1' };   // privileged (write + admin)
const readPriv = { reqId: 'e2', method: 'GET', path: '/internal/metrics' };  // privileged (admin path)
const publicEp = { reqId: 'e3', method: 'GET', path: '/profile' };           // not privileged

describe('bflaPlan', () => {
  it('pairs each privileged endpoint with each NON-privileged identity (expectation: deny)', () => {
    const plan = bflaPlan([adminEp, readPriv, publicEp], [anon, user, admin]);
    // privileged endpoints: adminEp, readPriv. non-priv identities: anon, user. → 2×2 = 4 pairs.
    expect(plan).toHaveLength(4);
    expect(plan.every(p => p.expectation === 'deny')).toBe(true);
    // the privileged admin identity is never the attacker; the public endpoint is never targeted.
    expect(plan.some(p => p.identity.id === 'a')).toBe(false);
    expect(plan.some(p => p.endpoint.reqId === 'e3')).toBe(false);
  });
});

describe('classifyBfla', () => {
  it('an allowed privileged call by a non-priv identity is a vuln', () => {
    expect(classifyBfla({ status: 200, body: { ok: true } })).toBe('vuln');
  });
  it('a denied call is a pass — including a 200 soft-403 (body says denied)', () => {
    expect(classifyBfla({ status: 403, body: {} })).toBe('pass');
    expect(classifyBfla({ status: 200, body: { error: 'Access denied' } })).toBe('pass');
  });
  it('an error / ambiguous status is inconclusive', () => {
    expect(classifyBfla({ status: 500, body: {} })).toBe('inconclusive');
    expect(classifyBfla({ status: null })).toBe('inconclusive');
  });
});

describe('bflaSeverity', () => {
  it('a confirmed mutating BFLA is critical, a read is high', () => {
    expect(bflaSeverity('DELETE', 'vuln')).toBe('critical');
    expect(bflaSeverity('GET', 'vuln')).toBe('high');
    expect(bflaSeverity('GET', 'pass')).toBeNull();
  });
});

describe('bflaFinding', () => {
  it('emits an OWASP-API5 finding for a confirmed BFLA hole', () => {
    const f = bflaFinding(adminEp, user, 'vuln');
    expect(f).toMatchObject({ oracle: 'bfla', ruleId: 'bfla', severity: 'critical', path: 'DELETE /admin/users/1' });
    expect(f.evidence).toMatch(/user/);
  });
  it('returns null when there is no hole', () => {
    expect(bflaFinding(adminEp, user, 'pass')).toBeNull();
  });
});

describe('runBfla', () => {
  const endpoints = [adminEp, publicEp];
  const identities = [anon, user, admin];

  it('flags a privileged endpoint reachable by a non-privileged identity', async () => {
    // The server wrongly returns 200 to everyone on the admin endpoint.
    const runner = () => Promise.resolve({ status: 200, body: { deleted: true } });
    const { findings, results } = await runBfla(endpoints, identities, runner, {});
    // 1 privileged endpoint × 2 non-priv identities (anon, user) = 2 vulns
    expect(findings).toHaveLength(2);
    expect(findings.every(f => f.severity === 'critical')).toBe(true);
    expect(results.length).toBe(2);
  });

  it('reports no findings when the endpoint correctly denies under-privileged callers', async () => {
    const runner = (ep, identity) => Promise.resolve(identity.privileged ? { status: 200, body: {} } : { status: 403, body: {} });
    const { findings } = await runBfla(endpoints, identities, runner, {});
    expect(findings).toHaveLength(0);
  });

  it('stops early when aborted', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runBfla(endpoints, identities, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });
});
