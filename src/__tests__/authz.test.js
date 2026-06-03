import { describe, it, expect } from 'vitest';
import { classifyOutcome, verdictFor, DEFAULT_DENY_SET } from '../qa/authz.js';
import { anonIdentity, defaultExpectation, withDefaults, setColumn, setRow } from '../qa/authz.js';
import { runMatrix, summarize } from '../qa/authz.js';
import { loadMatrixConfig, saveMatrixConfig, SECURITY_STORAGE_KEY } from '../qa/authz.js';

describe('classifyOutcome', () => {
  it('2xx is allowed', () => {
    expect(classifyOutcome(200)).toBe('allowed');
    expect(classifyOutcome(204)).toBe('allowed');
  });
  it('denySet members are denied (default 401/403)', () => {
    expect(classifyOutcome(401)).toBe('denied');
    expect(classifyOutcome(403)).toBe('denied');
  });
  it('treats 404 as denied by default (hidden resource) but a custom set can exclude it', () => {
    expect(classifyOutcome(404)).toBe('denied');
    expect(classifyOutcome(404, [401, 403])).toBe('other');
  });
  it('everything else is other, incl. null/NaN (transport error)', () => {
    expect(classifyOutcome(500)).toBe('other');
    expect(classifyOutcome(302)).toBe('other');
    expect(classifyOutcome(null)).toBe('other');
    expect(classifyOutcome(undefined)).toBe('other');
  });
  it('exposes the default deny set', () => {
    expect(DEFAULT_DENY_SET).toEqual([401, 403, 404]);
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
const ep2 = { reqId: 'r2', method: 'GET', path: '/b' };
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

describe('runMatrix', () => {
  const state = withDefaults({
    identities: [anonIdentity(), { id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } }],
    endpoints: [{ reqId: 'r1', method: 'GET', path: '/a' }],
    expect: { r1: { anon: 'deny', admin: 'allow' } },
    denySet: [401, 403],
  });

  it('classifies each cell from the injected runner', async () => {
    // anon → 401 (denied, expected deny → pass); admin → 200 (allowed, expected allow → pass)
    const runner = (ep, id) => Promise.resolve({ status: id.id === 'anon' ? 401 : 200, time: 5 });
    const seen = [];
    const results = await runMatrix(state, runner, { onCell: (rid, iid, cell) => seen.push([rid, iid, cell.verdict]) });
    expect(results.r1.anon.verdict).toBe('pass');
    expect(results.r1.admin.verdict).toBe('pass');
    expect(seen.length).toBe(2);  // onCell streamed both
  });

  it('flags deny-expected-but-allowed as vuln', async () => {
    const runner = () => Promise.resolve({ status: 200, time: 1 });
    const results = await runMatrix(state, runner, {});
    expect(results.r1.anon.verdict).toBe('vuln');
  });

  it('skips cells whose expectation is skip', async () => {
    const skipState = setRow(state, 'r1', 'skip');
    let calls = 0;
    await runMatrix(skipState, () => { calls++; return Promise.resolve({ status: 200 }); }, {});
    expect(calls).toBe(0);
  });

  it('records a runner throw as inconclusive with an error', async () => {
    const runner = () => Promise.reject(new Error('boom'));
    const results = await runMatrix(state, runner, {});
    expect(results.r1.admin.verdict).toBe('inconclusive');
    expect(results.r1.admin.error).toMatch(/boom/);
  });

  it('stops early when the abort signal is set', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await runMatrix(state, () => { calls++; return Promise.resolve({ status: 200 }); }, { signal: controller.signal });
    expect(calls).toBe(0);
  });
});

describe('summarize', () => {
  it('tallies verdicts across the results grid', () => {
    const results = {
      r1: { anon: { verdict: 'pass' }, admin: { verdict: 'vuln' } },
      r2: { anon: { verdict: 'fail' }, admin: { verdict: 'inconclusive' } },
    };
    expect(summarize(results)).toEqual({ total: 4, pass: 1, fail: 1, vuln: 1, inconclusive: 1 });
  });
});

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

describe('persistence', () => {
  it('round-trips config only (no results)', () => {
    installLocalStorage();
    const state = {
      identities: [anonIdentity()], endpoints: [{ reqId: 'r1', method: 'GET', path: '/a' }],
      expect: { r1: { anon: 'deny' } }, denySet: [401, 403],
      results: { r1: { anon: { verdict: 'pass' } } },  // must NOT be persisted
    };
    saveMatrixConfig(state);
    const raw = JSON.parse(localStorage.getItem(SECURITY_STORAGE_KEY));
    expect(raw.results).toBeUndefined();
    const loaded = loadMatrixConfig();
    expect(loaded.expect.r1.anon).toBe('deny');
    expect(loaded.identities[0].id).toBe('anon');
  });
  it('returns null when nothing is stored or JSON is corrupt', () => {
    installLocalStorage();
    expect(loadMatrixConfig()).toBe(null);
    localStorage.setItem(SECURITY_STORAGE_KEY, '{not json');
    expect(loadMatrixConfig()).toBe(null);
  });
});

describe('persistence — oracleConfig', () => {
  it('round-trips oracleConfig when present and omits it when absent', () => {
    installLocalStorage();
    saveMatrixConfig({
      identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401],
      oracleConfig: { sensitive: true, schema: false, llm: false, severityOverrides: { pii: 'low' } },
    });
    expect(loadMatrixConfig().oracleConfig).toEqual({ sensitive: true, schema: false, llm: false, severityOverrides: { pii: 'low' } });

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().oracleConfig).toBeUndefined();
  });
});

describe('runMatrix — request capture', () => {
  const reqState = withDefaults({
    identities: [{ id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } }],
    endpoints: [{ reqId: 'r1', method: 'GET', path: '/a' }],
    expect: { r1: { admin: 'allow' } },
    denySet: [401, 403],
  });
  it('captures cell.request from a { request, response } runner', async () => {
    const runner = () => Promise.resolve({ request: { method: 'GET', path: '/a', identity: 'admin' }, response: { status: 200, time: 2 } });
    const results = await runMatrix(reqState, runner, {});
    expect(results.r1.admin.request).toEqual({ method: 'GET', path: '/a', identity: 'admin' });
    expect(results.r1.admin.status).toBe(200);
    expect(results.r1.admin.verdict).toBe('pass');
  });
  it('leaves cell.request null for a bare-response runner', async () => {
    const results = await runMatrix(reqState, () => Promise.resolve({ status: 200, time: 1 }), {});
    expect(results.r1.admin.request).toBe(null);
    expect(results.r1.admin.status).toBe(200);
  });
});

describe('persistence — bola', () => {
  it('round-trips a bola blob when present and omits it when absent', () => {
    installLocalStorage();
    const bola = { tests: [{ id: 't1', reqId: 'r1', method: 'GET', path: '/u/{id}', idLocation: { kind: 'path', index: 1 }, idValues: { anon: '5' } }] };
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401], bola });
    expect(loadMatrixConfig().bola).toEqual(bola);

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().bola).toBeUndefined();
  });
});

describe('persistence — rateLimit', () => {
  it('round-trips a rateLimit blob when present and omits it when absent', () => {
    installLocalStorage();
    const rateLimit = { tests: [{ id: 'rl1', reqId: 'r1', method: 'POST', path: '/login', identityId: 'anon', n: 30, concurrency: 5, sensitivity: 'sensitive' }] };
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401], rateLimit });
    expect(loadMatrixConfig().rateLimit).toEqual(rateLimit);

    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity()], endpoints: [], expect: {}, denySet: [401] });
    expect(loadMatrixConfig().rateLimit).toBeUndefined();
  });
});

import { classifyEndpoint, MUTATING_METHODS, ADMIN_PATH_TOKENS } from '../qa/authz.js';

describe('classifyEndpoint', () => {
  it('flags mutating methods as write', () => {
    expect(classifyEndpoint('POST', '/orders').reasons).toContain('write');
    expect(classifyEndpoint('delete', '/orders/1').reasons).toContain('write'); // case-insensitive
    expect(classifyEndpoint('GET', '/orders').privileged).toBe(false);
  });
  it('flags admin-ish path tokens (discrete tokens only)', () => {
    expect(classifyEndpoint('GET', '/admin/users').reasons).toContain('admin-path');
    expect(classifyEndpoint('GET', '/v1.internal.metrics').reasons).toContain('admin-path');
    expect(classifyEndpoint('GET', '/badminton/list').privileged).toBe(false); // not a substring match
  });
  it('can flag both reasons', () => {
    expect(classifyEndpoint('DELETE', '/admin/users/1')).toEqual({ privileged: true, reasons: ['write', 'admin-path'] });
  });
  it('tolerates null/empty input', () => {
    expect(classifyEndpoint(null, null)).toEqual({ privileged: false, reasons: [] });
    expect(classifyEndpoint('', '')).toEqual({ privileged: false, reasons: [] });
  });
  it('exposes the heuristic constants', () => {
    expect(MUTATING_METHODS).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
    expect(ADMIN_PATH_TOKENS).toContain('admin');
  });
});

import { endpointPrivileged } from '../qa/authz.js';

describe('endpointPrivileged', () => {
  it('uses the heuristic when there is no manual override', () => {
    expect(endpointPrivileged({ method: 'POST', path: '/orders' })).toEqual({ privileged: true, reasons: ['write'], source: 'auto' });
    expect(endpointPrivileged({ method: 'GET', path: '/orders' })).toEqual({ privileged: false, reasons: [], source: 'auto' });
  });
  it('honors a manual override either way', () => {
    expect(endpointPrivileged({ method: 'GET', path: '/orders', privileged: true })).toEqual({ privileged: true, reasons: ['manual'], source: 'manual' });
    expect(endpointPrivileged({ method: 'POST', path: '/orders', privileged: false })).toEqual({ privileged: false, reasons: ['manual'], source: 'manual' });
  });
});

const privEp = { reqId: 'p1', method: 'DELETE', path: '/admin/users/1' };
const normEp = { reqId: 'n1', method: 'GET', path: '/profile' };
const userId = { id: 'u', name: 'user', auth: { type: 'bearer' } };          // non-privileged
const adminPriv = { id: 'a', name: 'admin', auth: { type: 'bearer' }, privileged: true };

describe('defaultExpectation — endpoint-aware', () => {
  it('one-arg call keeps legacy behavior', () => {
    expect(defaultExpectation(anonIdentity())).toBe('deny');
    expect(defaultExpectation(userId)).toBe('allow');
  });
  it('anon is deny regardless of endpoint', () => {
    expect(defaultExpectation(anonIdentity(), privEp)).toBe('deny');
    expect(defaultExpectation(anonIdentity(), normEp)).toBe('deny');
  });
  it('privileged endpoint defaults a non-privileged identity to deny', () => {
    expect(defaultExpectation(userId, privEp)).toBe('deny');
  });
  it('privileged identity stays allow on a privileged endpoint', () => {
    expect(defaultExpectation(adminPriv, privEp)).toBe('allow');
  });
  it('non-privileged endpoint defaults a normal identity to allow', () => {
    expect(defaultExpectation(userId, normEp)).toBe('allow');
  });
});

describe('withDefaults — privileged endpoints', () => {
  it('defaults a non-privileged identity to deny on a privileged endpoint (new cell), preserving overrides', () => {
    const state = withDefaults({ identities: [anonIdentity(), userId, adminPriv], endpoints: [privEp], expect: { p1: { u: 'allow' } }, denySet: [401, 403] });
    expect(state.expect.p1.anon).toBe('deny');   // anon
    expect(state.expect.p1.u).toBe('allow');     // preserved override
    expect(state.expect.p1.a).toBe('allow');     // privileged identity
    const fresh = withDefaults({ identities: [userId], endpoints: [privEp], expect: {}, denySet: [401, 403] });
    expect(fresh.expect.p1.u).toBe('deny');      // smart default for a new cell
  });
});

describe('persistence — identity.privileged', () => {
  it('round-trips a privileged identity flag and omits it when absent', () => {
    installLocalStorage();
    saveMatrixConfig({ identities: [anonIdentity(), { id: 'a', name: 'admin', auth: { type: 'bearer' }, privileged: true }], endpoints: [], expect: {}, denySet: [401] });
    const loaded = loadMatrixConfig();
    expect(loaded.identities.find((i) => i.id === 'a').privileged).toBe(true);
    expect(loaded.identities.find((i) => i.id === 'anon').privileged).toBeUndefined();
  });
});
