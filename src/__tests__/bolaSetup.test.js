// src/__tests__/bolaSetup.test.js
import { describe, it, expect } from 'vitest';
import { detectIdLocation } from '../qa/bolaSetup.js';

const req = (over = {}) => ({ method: 'GET', url: '/users/42/orders', params: [], body: '', ...over });

describe('detectIdLocation', () => {
  it('ranks a UUID path segment after a plural noun as high confidence', () => {
    const out = detectIdLocation(req({ url: '/orders/3f1a4e2b-1c2d-4e5f-8a9b-0c1d2e3f4a5b' }));
    expect(out[0].idLocation).toEqual({ kind: 'path', index: 1 });
    expect(out[0].confidence).toBe('high');
  });
  it('detects a numeric path id after a plural noun', () => {
    const out = detectIdLocation(req({ url: '/users/42' }));
    expect(out[0].idLocation).toEqual({ kind: 'path', index: 1 });
    expect(out[0].value).toBe('42');
  });
  it('detects an id-ish query key and ignores pagination keys', () => {
    const out = detectIdLocation(req({ url: '/orders', params: [
      { key: 'page', value: '2', on: true }, { key: 'orderId', value: '7', on: true }] }));
    const q = out.find(c => c.idLocation.kind === 'query');
    expect(q.idLocation).toEqual({ kind: 'query', key: 'orderId' });
    expect(out.some(c => c.idLocation.kind === 'query' && c.idLocation.key === 'page')).toBe(false);
  });
  it('detects an id-ish body field via its JSON path', () => {
    const out = detectIdLocation(req({ method: 'POST', url: '/orders', body: '{"order":{"userId":99,"count":3}}' }));
    const b = out.find(c => c.idLocation.kind === 'body');
    expect(b.idLocation).toEqual({ kind: 'body', path: 'order.userId' });
    expect(out.some(c => c.idLocation.kind === 'body' && c.idLocation.path === 'order.count')).toBe(false);
  });
  it('returns [] when nothing looks like an id', () => {
    expect(detectIdLocation(req({ url: '/health', params: [], body: '' }))).toEqual([]);
  });
  it('does not treat substring-only matches like "organic" as an id key', () => {
    const out = detectIdLocation({ method: 'GET', url: '/x', params: [
      { key: 'organic', value: 'true', on: true },
      { key: 'tenant', value: 'acme', on: true }] });
    expect(out.some(c => c.idLocation.kind === 'query' && c.idLocation.key === 'organic')).toBe(false);
    expect(out.some(c => c.idLocation.kind === 'query' && c.idLocation.key === 'tenant')).toBe(true);
  });
});
