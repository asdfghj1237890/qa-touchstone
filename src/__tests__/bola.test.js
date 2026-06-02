// src/__tests__/bola.test.js
import { describe, it, expect } from 'vitest';
import { applyIdLocation, matchesOwner, classifyBola, bolaSeverity } from '../qa/bola.js';

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
