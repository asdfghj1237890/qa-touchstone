// src/__tests__/evidence.test.js
import { describe, it, expect } from 'vitest';
import { leafToken, tokenizePath, snippetAround, SNIPPET_KEYS } from '../qa/evidence.js';

describe('leafToken', () => {
  it('emits a type token carrying no value characters', () => {
    expect(leafToken('supersecretvalue')).toBe('<str:16>');
    expect(leafToken(42)).toBe('<num>');
    expect(leafToken(true)).toBe('<bool>');
    expect(leafToken(null)).toBe('<null>');
  });
});

describe('tokenizePath', () => {
  it('splits dotted and indexed paths', () => {
    expect(tokenizePath('a.b[0].c')).toEqual(['a', 'b', '0', 'c']);
    expect(tokenizePath('token')).toEqual(['token']);
  });
});

describe('snippetAround', () => {
  it('masks an UNKNOWN-format secret by default (structural guarantee)', () => {
    const body = { user: { id: 7, blob: 'ZZZ-not-a-known-secret-format-ABC' } };
    const s = snippetAround(body, 'user.blob');
    expect(JSON.stringify(s.tree)).not.toContain('ZZZ-not-a-known-secret-format-ABC');
    expect(s.tree.id).toBe('<num>');
    expect(s.snippetPath).toBe('user.blob');
  });
  it('shows a redact() preview ONLY at the finding leaf; siblings are type tokens', () => {
    const body = { user: { token: 'abcdef999999', email: 'a@b.com' } };
    const s = snippetAround(body, 'user.token');
    expect(s.tree.token).toBe('abc…<redacted>…99');
    expect(s.tree.email).toBe('<str:7>');
  });
  it('returns a top-level overview (nothing marked) for header/non-body paths', () => {
    const s = snippetAround({ a: 1 }, 'header:server');
    expect(s.tree.a).toBe('<num>');
    expect(s.snippetPath).toBe('header:server');
  });
  it('returns null for a non-object body', () => {
    expect(snippetAround('plain text', 'x')).toBeNull();
  });
  it('flags truncation past the key cap', () => {
    const big = {};
    for (let i = 0; i < SNIPPET_KEYS + 5; i++) big['k' + i] = i;
    const s = snippetAround({ wrap: big }, 'wrap.k0');
    expect(s.truncated).toBe(true);
  });
});
