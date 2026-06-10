import { describe, it, expect } from 'vitest';
import { cookieMatches } from '../qa/cookies';

// Sane defaults for a stored cookie — tests override fields they care about.
const ck = (overrides = {}) => ({
  on: true,
  name: 'sess',
  value: 'v',
  domain: 'example.com',
  path: '/',
  expires: '',
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
  hostOnly: false,
  ...overrides,
});

describe('cookieMatches — domain', () => {
  it('matches an exact host', () => {
    expect(cookieMatches(ck({ domain: 'api.example.com' }), 'https://api.example.com/v1')).toBe(true);
  });

  it('matches a subdomain when not host-only', () => {
    expect(cookieMatches(ck({ domain: 'example.com' }), 'https://api.example.com/')).toBe(true);
  });

  it('does NOT match the parent host (cookie scope is narrower)', () => {
    expect(cookieMatches(ck({ domain: 'api.example.com' }), 'https://example.com/')).toBe(false);
  });

  it('host-only cookies do NOT match subdomains', () => {
    expect(cookieMatches(ck({ domain: 'example.com', hostOnly: true }), 'https://api.example.com/')).toBe(false);
    expect(cookieMatches(ck({ domain: 'example.com', hostOnly: true }), 'https://example.com/')).toBe(true);
  });

  it('does not match an unrelated host', () => {
    expect(cookieMatches(ck({ domain: 'example.com' }), 'https://catfact.ninja/fact')).toBe(false);
  });
});

describe('cookieMatches — path', () => {
  it('matches when request path equals cookie path', () => {
    expect(cookieMatches(ck({ path: '/v1' }), 'https://example.com/v1')).toBe(true);
  });

  it('matches when request path is a /-bounded prefix of cookie path', () => {
    expect(cookieMatches(ck({ path: '/v1' }), 'https://example.com/v1/users')).toBe(true);
  });

  it('does NOT match when prefix lacks the / boundary', () => {
    expect(cookieMatches(ck({ path: '/v1' }), 'https://example.com/v100/users')).toBe(false);
  });

  it('cookie path ending in / still matches descendants', () => {
    expect(cookieMatches(ck({ path: '/v1/' }), 'https://example.com/v1/users')).toBe(true);
  });
});

describe('cookieMatches — Secure', () => {
  it('Secure cookies are NOT sent on http', () => {
    expect(cookieMatches(ck({ secure: true }), 'http://example.com/')).toBe(false);
  });

  it('Secure cookies are sent on https', () => {
    expect(cookieMatches(ck({ secure: true }), 'https://example.com/')).toBe(true);
  });
});

describe('cookieMatches — Expires', () => {
  it('drops expired cookies', () => {
    // 2000-01-01 is firmly in the past for any session we care about.
    expect(cookieMatches(ck({ expires: '2000-01-01T00:00:00.000Z' }), 'https://example.com/')).toBe(false);
  });

  it('keeps cookies that have not expired (full ISO datetime)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(cookieMatches(ck({ expires: future }), 'https://example.com/')).toBe(true);
  });

  it('unparseable expires leaves the cookie alive', () => {
    expect(cookieMatches(ck({ expires: 'not a date' }), 'https://example.com/')).toBe(true);
  });
});

describe('cookieMatches — input safety', () => {
  it('returns false when ck.on is false', () => {
    expect(cookieMatches(ck({ on: false }), 'https://example.com/')).toBe(false);
  });

  it('returns false on an unparseable URL', () => {
    expect(cookieMatches(ck(), 'not-a-url')).toBe(false);
  });
});
