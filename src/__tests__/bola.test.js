// src/__tests__/bola.test.js
import { describe, it, expect } from 'vitest';
import { applyIdLocation, matchesOwner, classifyBola, bolaSeverity, runBola, summarizeBola, negativeControlFailed } from '../qa/bola';
import { isIdentityKey, controlSuggestsIgnoredId } from '../qa/bola';

const baseReq = () => ({ method: 'GET', url: '/users/42/orders', params: [{ key: 'x', value: '1', on: true }], body: '' });

describe('applyIdLocation', () => {
  it('replaces the Nth non-empty path segment and preserves the query string', () => {
    const r = applyIdLocation({ ...baseReq(), url: '/users/42/orders?limit=5' }, { kind: 'path', index: 1 }, 99);
    expect(r.url).toBe('/users/99/orders?limit=5');
    expect(r._idApplied).toBe(true);
  });
  it('does not mutate the input request', () => {
    const req = baseReq();
    applyIdLocation(req, { kind: 'path', index: 1 }, 99);
    expect(req.url).toBe('/users/42/orders');
  });
  it('sets an existing query param and turns it on', () => {
    const r = applyIdLocation({ ...baseReq(), params: [{ key: 'orderId', value: 'a', on: false }] }, { kind: 'query', key: 'orderId' }, 7);
    expect(r.params.find(p => p.key === 'orderId')).toEqual({ key: 'orderId', value: '7', on: true });
  });
  it('appends a query param when absent', () => {
    const r = applyIdLocation(baseReq(), { kind: 'query', key: 'orderId' }, 7);
    expect(r.params.find(p => p.key === 'orderId')).toEqual({ key: 'orderId', value: '7', on: true });
  });
  it('sets a body JSON field at a dotted path when the parent exists', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: '{"order":{"id":1}}' }, { kind: 'body', path: 'order.id' }, 9);
    expect(JSON.parse(r.body)).toEqual({ order: { id: 9 } });
    expect(r._idApplied).toBe(true);
  });
  it('leaves a non-JSON body unchanged and flags _idApplied=false', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: 'not json' }, { kind: 'body', path: 'id' }, 9);
    expect(r.body).toBe('not json');
    expect(r._idApplied).toBe(false);
  });
  it('flags _idApplied=false when a body path parent is missing', () => {
    const r = applyIdLocation({ ...baseReq(), method: 'POST', body: '{"a":1}' }, { kind: 'body', path: 'order.id' }, 9);
    expect(JSON.parse(r.body)).toEqual({ a: 1 });
    expect(r._idApplied).toBe(false);
  });
  it('returns the request unchanged with _idApplied=false for an unknown kind', () => {
    const req = baseReq();
    const r = applyIdLocation(req, { kind: 'header' }, 9);
    expect(r.url).toBe('/users/42/orders');
    expect(r._idApplied).toBe(false);
  });
  it('flags _idApplied=false when idLocation is null/undefined', () => {
    expect(applyIdLocation(baseReq(), null, 9)._idApplied).toBe(false);
    expect(applyIdLocation(baseReq(), undefined, 9)._idApplied).toBe(false);
  });
  it('sets a body JSON field at a bracket/array path', () => {
    const r = applyIdLocation({ method: 'POST', url: '/x', params: [], body: '{"items":[{"id":1}]}' }, { kind: 'body', path: 'items[0].id' }, 9);
    expect(JSON.parse(r.body)).toEqual({ items: [{ id: 9 }] });
    expect(r._idApplied).toBe(true);
  });
});

const resp = (body) => ({ status: 200, body });

describe('matchesOwner', () => {
  it('matches when the owner id value is echoed as a leaf in the attack body', () => {
    expect(matchesOwner(resp({ id: 99, name: 'Bob' }), resp({ id: 1 }), 99)).toBe(true);
  });
  it('matches when scalar-leaf overlap with the owner reference is >= threshold', () => {
    const owner = resp({ a: 'x', b: 'y', c: 'z' });
    const attack = resp({ a: 'x', b: 'y', c: 'z', extra: 'q' }); // 3/4 overlap = 0.75
    expect(matchesOwner(attack, owner, 'noecho')).toBe(true);
  });
  it('does not match when overlap is below threshold and id is not echoed', () => {
    expect(matchesOwner(resp({ a: '1', b: '2' }), resp({ c: '3', d: '4' }), 'zzz')).toBe(false);
  });
  it('falls back to a substring check for a non-JSON attack body', () => {
    expect(matchesOwner(resp('order 99 belongs to bob'), resp({ id: 1 }), 99)).toBe(true);
  });
  it('returns false when the owner reference body has no leaves', () => {
    expect(matchesOwner(resp({ a: 1 }), resp({}), 'zzz')).toBe(false);
  });
});

describe('isIdentityKey', () => {
  it('recognizes identity-ish keys', () => {
    expect(isIdentityKey('id')).toBe(true);
    expect(isIdentityKey('userId')).toBe(true);
    expect(isIdentityKey('owner_id')).toBe(true);
    expect(isIdentityKey('uuid')).toBe(true);
    expect(isIdentityKey('accountId')).toBe(true);
  });
  it('rejects non-identity keys (page/total/count/etc.)', () => {
    expect(isIdentityKey('page')).toBe(false);
    expect(isIdentityKey('total')).toBe(false);
    expect(isIdentityKey('count')).toBe(false);
    expect(isIdentityKey('name')).toBe(false);
  });
});

describe('matchesOwner — id-echo is gated on identity-like keys (FP fix)', () => {
  it('does NOT match when a low-entropy owner id appears only at non-identity keys', () => {
    // The owner id `1` appears in the attacker's OWN object as page/total, never as
    // an identity field, and the attacker object (id:7) is not the owner's (id:1).
    // Previously this was an (accepted) false positive; now it is correctly false.
    expect(matchesOwner({ status: 200, body: { id: 7, page: 1, total: 1 } }, { status: 200, body: { id: 1 } }, 1)).toBe(false);
  });
  it('still matches when the owner id is echoed at an identity key (real cross-object read)', () => {
    expect(matchesOwner({ status: 200, body: { id: 1, name: 'Alice' } }, { status: 200, body: { id: 1 } }, 1)).toBe(true);
    expect(matchesOwner({ status: 200, body: { userId: 1, data: 'x' } }, { status: 200, body: { userId: 1 } }, 1)).toBe(true);
  });
});

describe('classifyBola', () => {
  const deny = [401, 403, 404];
  it('deny-set status is pass', () => {
    expect(classifyBola('GET', 403, true, deny)).toBe('pass');
    expect(classifyBola('GET', 404, false, deny)).toBe('pass');
  });
  it('2xx + matched is vuln; 2xx + unmatched is unconfirmed', () => {
    expect(classifyBola('GET', 200, true, deny)).toBe('vuln');
    expect(classifyBola('GET', 200, false, deny)).toBe('unconfirmed');
  });
  it('other/null status is inconclusive', () => {
    expect(classifyBola('GET', 500, true, deny)).toBe('inconclusive');
    expect(classifyBola('GET', null, true, deny)).toBe('inconclusive');
  });
});

describe('bolaSeverity', () => {
  it('confirmed read is high, confirmed mutating is critical', () => {
    expect(bolaSeverity('GET', 'vuln')).toBe('high');
    expect(bolaSeverity('DELETE', 'vuln')).toBe('critical');
    expect(bolaSeverity('post', 'vuln')).toBe('critical');
  });
  it('unconfirmed is medium; pass/inconclusive have no finding', () => {
    expect(bolaSeverity('GET', 'unconfirmed')).toBe('medium');
    expect(bolaSeverity('GET', 'pass')).toBe(null);
    expect(bolaSeverity('GET', 'inconclusive')).toBe(null);
  });
});

const idAlice = { id: 'alice', name: 'Alice', auth: {} };
const idBob   = { id: 'bob',   name: 'Bob',   auth: {} };
const test1 = { id: 't1', reqId: 'r1', method: 'GET', path: '/users/{id}', idLocation: { kind: 'path', index: 1 }, idValues: { alice: 'A1', bob: 'B1' } };

describe('runBola', () => {
  const baseState = { identities: [idAlice, idBob], tests: [test1], denySet: [401, 403, 404] };

  it('runs a reference pass then attacker×owner attacks, flagging confirmed vuln', async () => {
    // Every call returns the SAME body (so attacker body == owner reference → matched).
    const runner = () => Promise.resolve({ status: 200, body: { secret: 'shared' } });
    const seen = [];
    const results = await runBola(baseState, runner, { onCell: (tid, a, o, cell) => seen.push([tid, a, o, cell.phase]) });
    expect(results.t1.reference.alice.status).toBe(200);
    expect(results.t1.attacks.alice.bob.verdict).toBe('vuln');
    expect(results.t1.attacks.bob.alice.severity).toBe('high');
    expect(results.t1.attacks.alice.bob.finding.oracle).toBe('object-authz');
    // 2 reference + 2 attack cells streamed
    expect(seen.filter(s => s[3] === 'ref').length).toBe(2);
    expect(seen.filter(s => s[3] === 'attack').length).toBe(2);
  });

  it('marks a denied cross-access as pass', async () => {
    const runner = (t, identity, idValue) => Promise.resolve(idValue === 'A1' && identity.id === 'bob' ? { status: 403, body: {} } : { status: 200, body: { id: 1 } });
    const results = await runBola(baseState, runner, {});
    expect(results.t1.attacks.bob.alice.verdict).toBe('pass');
  });

  it('caps at unconfirmed when the owner could not read its own object (ref not 2xx)', async () => {
    let n = 0;
    const runner = () => { n++; return Promise.resolve(n <= 2 ? { status: 500, body: {} } : { status: 200, body: { x: 1 } }); };
    const results = await runBola(baseState, runner, {});
    // references both 500 → matched forced false → 2xx attacks can only be unconfirmed
    expect(['unconfirmed', 'inconclusive']).toContain(results.t1.attacks.alice.bob.verdict);
    expect(results.t1.attacks.alice.bob.verdict).not.toBe('vuln');
  });

  it('skips identities with no id value for the test', async () => {
    const state = { ...baseState, tests: [{ ...test1, idValues: { alice: 'A1' } }] };
    let calls = 0;
    await runBola(state, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, {});
    expect(calls).toBe(1);   // only Alice's reference; no attack pairs possible
  });

  it('stops early when the abort signal is set', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runBola(baseState, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });
});

describe('summarizeBola', () => {
  it('tallies attack verdicts (not reference cells)', () => {
    const results = { t1: { reference: { a: { status: 200 } }, attacks: { a: { b: { verdict: 'vuln' } }, b: { a: { verdict: 'pass' } } } } };
    expect(summarizeBola(results)).toEqual({ total: 2, vuln: 1, unconfirmed: 0, pass: 1, inconclusive: 0 });
  });
});

describe('negativeControlFailed', () => {
  const deny = [401, 403, 404];
  it('fails only when a fake id returns 2xx AND content matches the owner reference', () => {
    expect(negativeControlFailed(200, deny, true)).toBe(true);
    expect(negativeControlFailed(200, deny, false)).toBe(false);   // 2xx but no match -> keep verdicts
  });
  it('passes when a fake id is denied', () => {
    expect(negativeControlFailed(404, deny, true)).toBe(false);
    expect(negativeControlFailed(403, deny, true)).toBe(false);
  });
  it('does not demote on errors / inconclusive statuses', () => {
    expect(negativeControlFailed(null, deny, true)).toBe(false);
    expect(negativeControlFailed(500, deny, true)).toBe(false);
  });
});

describe('controlSuggestsIgnoredId — independent of the attack content oracle', () => {
  const ownerRef = { status: 200, body: { id: '1', owner: 'alice', secret: 'x' } };
  it('flags an ignored id: a fake id returns the owner object (same shape, owner id present, synthetic absent)', () => {
    const control = { status: 200, body: { id: '1', owner: 'alice', secret: 'x' } };
    expect(controlSuggestsIgnoredId(control, ownerRef, '1', '999999999')).toBe(true);
  });
  it('does not flag when the fake id yields a different shape (soft-200 empty)', () => {
    expect(controlSuggestsIgnoredId({ status: 200, body: {} }, ownerRef, '1', '999999999')).toBe(false);
  });
  it('does not flag when the synthetic id actually appears (endpoint used the id → scoped)', () => {
    const control = { status: 200, body: { id: '999999999', owner: 'nobody', secret: 'x' } };
    expect(controlSuggestsIgnoredId(control, ownerRef, '1', '999999999')).toBe(false);
  });
  it('does not flag when the owner reference is empty (nothing to compare)', () => {
    expect(controlSuggestsIgnoredId({ status: 200, body: {} }, { status: 200, body: {} }, '1', '999999999')).toBe(false);
  });
});

describe('runBola negative control', () => {
  const identities = [{ id: 'alice', name: 'alice' }, { id: 'bob', name: 'bob' }];
  const test = { id: 't1', reqId: 'r1', method: 'GET', path: '/orders/{id}',
                 idLocation: { kind: 'path', index: 1 }, idValues: { alice: '1', bob: '2' } };
  const SYNTH = '999999999';

  it('demotes all attack cells to inconclusive when a fake id returns the owner object (id ignored)', async () => {
    // Endpoint ignores the id and always returns the same object -> not object-scoped.
    const runner = async () => ({ status: 200, body: { id: '1', owner: 'alice', secret: 'x' } });
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('inconclusive');
    expect(cell.severity).toBe(null);
    expect(cell.finding).toBe(null);
    expect(cell.controlFailed).toBe(true);
    expect(results.t1.control.failed).toBe(true);
    expect(cell.status).toBe(200);   // raw response preserved
  });

  it('does NOT demote when a fake id returns 2xx but different content (soft-200, still object-scoped)', async () => {
    const runner = async (_t, _identity, idValue) => String(idValue) === SYNTH
      ? { status: 200, body: {} }                                  // soft-200 for nonexistent id
      : { status: 200, body: { id: String(idValue), data: 'real' } };
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('vuln');             // genuine finding preserved
    expect(cell.controlFailed).toBe(false);
    expect(results.t1.control.failed).toBe(false);
  });

  it('leaves verdicts intact when the control is properly denied', async () => {
    const runner = async (_t, _identity, idValue) => String(idValue) === SYNTH
      ? { status: 404, body: {} }
      : { status: 200, body: { id: String(idValue) } };
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('vuln');
    expect(cell.controlFailed).toBe(false);
    expect(results.t1.control.failed).toBe(false);
  });

  it('does not demote when the synthetic control errors / is inconclusive (500)', async () => {
    const runner = async (_t, _identity, idValue) => String(idValue) === SYNTH
      ? { status: 500, body: {} }
      : { status: 200, body: { id: String(idValue) } };
    const results = await runBola({ identities, tests: [test] }, runner, { negativeControl: true });
    const cell = results.t1.attacks.alice.bob;
    expect(cell.verdict).toBe('vuln');
    expect(cell.controlFailed).toBe(false);
    expect(results.t1.control.failed).toBe(false);
  });

  it('does not run the control when the opt is off (back-compat)', async () => {
    const seen = [];
    const runner = async (_t, _id, idValue) => { seen.push(String(idValue)); return { status: 200, body: { id: String(idValue) } }; };
    await runBola({ identities, tests: [test] }, runner);
    expect(seen).not.toContain(SYNTH);
  });
});
