import { describe, it, expect } from 'vitest';
import { redactUrlForAI } from '../qa/aiPrivacy';
import { redactUrl } from '../qa/evidence';

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
    expect(redactUrlForAI('https://h/users/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/users/{id}'
    );
  });
  it('collapses secret-like path segments', () => {
    expect(redactUrlForAI('https://h/api/users/bob@acme.com/profile')).toBe(
      '/api/users/{id}/profile'
    );
    expect(redactUrlForAI('https://h/keys/AKIAIOSFODNN7EXAMPLE/rotate')).toBe('/keys/{id}/rotate');
    expect(
      redactUrlForAI(
        'https://h/reset/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      )
    ).toContain('{id}');
  });
  it('REGRESSION: evidence.redactUrl still keeps host', () => {
    expect(redactUrl('https://api.acme.com/x?t=1')).toContain('api.acme.com');
  });
});
