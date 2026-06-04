import { describe, it, expect } from 'vitest';
import { redactBody } from '../qa/aiPrivacy.js';

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
