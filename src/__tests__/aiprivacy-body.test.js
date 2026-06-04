import { describe, it, expect } from 'vitest';
import { redactBody, looksSecret } from '../qa/aiPrivacy.js';

describe('redactBody', () => {
  it('tokenizes JSON values but keeps keys', () => {
    const r = redactBody({ customerId: 'C-99', email: 'a@b.com', n: 3 }, {});
    expect(r.tree).toBeTruthy();
    expect(JSON.stringify(r.tree)).toContain('customerId');
    expect(JSON.stringify(r.tree)).not.toContain('C-99');
    expect(JSON.stringify(r.tree)).not.toContain('a@b.com');
  });
  it('emits a descriptor for non-JSON bodies (no bytes)', () => {
    const r = redactBody('<html>secret-token-here</html>', { 'content-type': 'text/html' });
    expect(r.nonJson).toBeTruthy();
    expect(r.nonJson.contentType).toBe('text/html');
    expect(JSON.stringify(r)).not.toContain('secret-token-here');
  });
});

describe('looksSecret', () => {
  it('flags secret/PII-shaped strings', () => {
    expect(looksSecret('bob@acme.com')).toBe(true);
    expect(looksSecret('4111111111111111')).toBe(true);            // Luhn-valid Visa test card
    expect(looksSecret('4111-1111-1111-1111')).toBe(true);         // dashed card
    expect(looksSecret('eyJhbGciOi.eyJzdWIiOi.SflKxwRJ')).toBe(true); // JWT
    expect(looksSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true);        // AWS access key id
    expect(looksSecret('123-45-6789')).toBe(true);                 // SSN
    expect(looksSecret('A'.repeat(40))).toBe(true);                // long opaque token
  });
  it('does NOT flag ordinary field names or short values', () => {
    expect(looksSecret('customerId')).toBe(false);
    expect(looksSecret('email')).toBe(false);
    expect(looksSecret('items')).toBe(false);
    expect(looksSecret('user_id')).toBe(false);
    expect(looksSecret('42')).toBe(false);
    expect(looksSecret('')).toBe(false);
    expect(looksSecret(null)).toBe(false);
  });
});

describe('redactBody — secret/PII object KEYS (AI egress leak)', () => {
  it('masks an email used as an object key, keeps ordinary keys', () => {
    const r = redactBody({ 'bob@acme.com': { role: 'admin' }, customerId: 'C-1' }, {});
    const s = JSON.stringify(r.tree);
    expect(s).not.toContain('bob@acme.com');
    expect(s).toContain('<redacted-key>');
    expect(s).toContain('customerId');   // ordinary key preserved
  });
  it('masks a credit-card (Luhn) object key', () => {
    const r = redactBody({ '4111111111111111': { last4: '1111' } }, {});
    expect(JSON.stringify(r.tree)).not.toContain('4111111111111111');
    expect(JSON.stringify(r.tree)).toContain('<redacted-key>');
  });
  it('masks JWT / AKIA / SSN / long-opaque keys', () => {
    const r = redactBody({
      'eyJhbGciOi.eyJzdWIiOi.SflKxwRJ': 1,
      'AKIAIOSFODNN7EXAMPLE': 2,
      '123-45-6789': 3,
      ['B'.repeat(40)]: 4,
    }, {});
    const s = JSON.stringify(r.tree);
    expect(s).not.toContain('eyJhbGciOi');
    expect(s).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(s).not.toContain('123-45-6789');
    expect(s).not.toContain('BBBBBBBB');
  });
  it('masks secret keys nested inside objects', () => {
    const r = redactBody({ users: { 'alice@acme.com': { id: 1 } } }, {});
    expect(JSON.stringify(r.tree)).not.toContain('alice@acme.com');
    expect(JSON.stringify(r.tree).match(/users/)).toBeTruthy();
  });
  it('masks secret keys inside array elements, preserving array structure', () => {
    const r = redactBody([{ 'carol@acme.com': { id: 1 } }, { id: 2 }], {});
    expect(Array.isArray(r.tree)).toBe(true);
    expect(r.tree.length).toBe(2);
    expect(JSON.stringify(r.tree)).not.toContain('carol@acme.com');
  });
  it('preserves child count when sibling secret keys collide', () => {
    const r = redactBody({ 'a@x.com': 1, 'b@y.com': 2 }, {});
    expect(Object.keys(r.tree).length).toBe(2);   // both retained, no overwrite
    const s = JSON.stringify(r.tree);
    expect(s).not.toContain('a@x.com');
    expect(s).not.toContain('b@y.com');
  });
});
