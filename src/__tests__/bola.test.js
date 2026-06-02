// src/__tests__/bola.test.js
import { describe, it, expect } from 'vitest';
import { applyIdLocation } from '../qa/bola.js';

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
