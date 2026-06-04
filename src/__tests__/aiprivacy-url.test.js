import { describe, it, expect } from 'vitest';
import { redactUrlForAI } from '../qa/aiPrivacy.js';
import { redactUrl } from '../qa/evidence.js';

describe('redactUrlForAI', () => {
  it('strips scheme+host, masks query values, keeps query keys', () => {
    const out = redactUrlForAI('https://api.acme.com/v1/users/42831?token=abc&page=2');
    expect(out).not.toContain('api.acme.com');
    expect(out).not.toContain('https');
    expect(out).toContain('?token=<redacted>');
    expect(out).toContain('page=<redacted>');
  });
  it('collapses id-like path segments to {id}', () => {
    expect(redactUrlForAI('https://h/users/42831/orders')).toBe('/users/{id}/orders');
    expect(redactUrlForAI('https://h/users/550e8400-e29b-41d4-a716-446655440000')).toBe('/users/{id}');
  });
  it('REGRESSION: evidence.redactUrl still keeps host', () => {
    expect(redactUrl('https://api.acme.com/x?t=1')).toContain('api.acme.com');
  });
});
