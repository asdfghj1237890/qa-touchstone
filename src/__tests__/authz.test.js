import { describe, it, expect } from 'vitest';
import { classifyOutcome, verdictFor, DEFAULT_DENY_SET } from '../qa/authz.js';
import { anonIdentity, defaultExpectation, withDefaults, setColumn, setRow } from '../qa/authz.js';

describe('classifyOutcome', () => {
  it('2xx is allowed', () => {
    expect(classifyOutcome(200)).toBe('allowed');
    expect(classifyOutcome(204)).toBe('allowed');
  });
  it('denySet members are denied (default 401/403)', () => {
    expect(classifyOutcome(401)).toBe('denied');
    expect(classifyOutcome(403)).toBe('denied');
  });
  it('honors a custom denySet (e.g. 404 hides a resource)', () => {
    expect(classifyOutcome(404, [401, 403, 404])).toBe('denied');
    expect(classifyOutcome(404)).toBe('other');
  });
  it('everything else is other, incl. null/NaN (transport error)', () => {
    expect(classifyOutcome(500)).toBe('other');
    expect(classifyOutcome(302)).toBe('other');
    expect(classifyOutcome(null)).toBe('other');
    expect(classifyOutcome(undefined)).toBe('other');
  });
  it('exposes the default deny set', () => {
    expect(DEFAULT_DENY_SET).toEqual([401, 403]);
  });
});

describe('verdictFor', () => {
  it('allow + allowed = pass; allow + denied = fail', () => {
    expect(verdictFor('allow', 'allowed')).toBe('pass');
    expect(verdictFor('allow', 'denied')).toBe('fail');
  });
  it('deny + denied = pass; deny + allowed = vuln', () => {
    expect(verdictFor('deny', 'denied')).toBe('pass');
    expect(verdictFor('deny', 'allowed')).toBe('vuln');
  });
  it('any other outcome = inconclusive', () => {
    expect(verdictFor('allow', 'other')).toBe('inconclusive');
    expect(verdictFor('deny', 'other')).toBe('inconclusive');
  });
  it('skip = null (not run)', () => {
    expect(verdictFor('skip', 'allowed')).toBe(null);
  });
});

const idAnon = anonIdentity();
const idAdmin = { id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } };
const ep1 = { reqId: 'r1', method: 'GET', path: '/a' };
const ep2 = { reqId: 'r2', method: 'POST', path: '/b' };
const baseState = { identities: [idAnon, idAdmin], endpoints: [ep1, ep2], expect: {}, denySet: [401, 403] };

describe('anonIdentity', () => {
  it('is a non-empty identity with auth type none', () => {
    expect(idAnon.id).toBe('anon');
    expect(idAnon.auth.type).toBe('none');
  });
});

describe('defaultExpectation', () => {
  it('anon defaults to deny, named identities to allow', () => {
    expect(defaultExpectation(idAnon)).toBe('deny');
    expect(defaultExpectation(idAdmin)).toBe('allow');
  });
});

describe('withDefaults', () => {
  it('fills every (endpoint,identity) cell using smart defaults, preserving overrides', () => {
    const state = withDefaults({ ...baseState, expect: { r1: { admin: 'deny' } } });
    expect(state.expect.r1.anon).toBe('deny');   // smart default
    expect(state.expect.r1.admin).toBe('deny');  // preserved override
    expect(state.expect.r2.admin).toBe('allow'); // smart default
    expect(state.expect.r2.anon).toBe('deny');
  });
});

describe('setColumn / setRow', () => {
  it('setColumn sets one identity across all endpoints', () => {
    const state = setColumn(withDefaults(baseState), 'admin', 'deny');
    expect(state.expect.r1.admin).toBe('deny');
    expect(state.expect.r2.admin).toBe('deny');
    expect(state.expect.r1.anon).toBe('deny');   // untouched
  });
  it('setRow sets one endpoint across all identities', () => {
    const state = setRow(withDefaults(baseState), 'r1', 'skip');
    expect(state.expect.r1.admin).toBe('skip');
    expect(state.expect.r1.anon).toBe('skip');
    expect(state.expect.r2.admin).toBe('allow'); // untouched
  });
});
