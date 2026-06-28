import { describe, it, expect } from 'vitest';
import { qaParseSetCookie, qaMergeCookie, qaCookieDefaultPath } from '../qa/engine';

describe('qaCookieDefaultPath', () => {
  it('returns / for root or pathless input', () => {
    expect(qaCookieDefaultPath('/')).toBe('/');
    expect(qaCookieDefaultPath('')).toBe('/');
    expect(qaCookieDefaultPath('no-leading-slash')).toBe('/');
  });

  it('returns the directory (up to last /) for nested paths', () => {
    expect(qaCookieDefaultPath('/v1/users')).toBe('/v1');
    expect(qaCookieDefaultPath('/v1/users/42')).toBe('/v1/users');
  });

  it('returns / when the only slash is the leading one', () => {
    expect(qaCookieDefaultPath('/fact')).toBe('/');
  });
});

describe('qaParseSetCookie — RFC 6265 §5.3 Domain validation (CRITICAL)', () => {
  it('rejects a Set-Cookie whose Domain does not domain-match the response host', () => {
    // Attacker on evil.test tries to inject a cookie scoped to staging.
    expect(qaParseSetCookie('x=1; Domain=staging.api.acme.dev', 'evil.test')).toBeNull();
  });

  it('accepts Domain attr equal to the response host', () => {
    const ck = qaParseSetCookie('x=1; Domain=api.example.com', 'api.example.com');
    expect(ck).toBeTruthy();
    expect(ck.domain).toBe('api.example.com');
    expect(ck.hostOnly).toBe(false);
  });

  it('accepts Domain attr that is a parent of the response host', () => {
    const ck = qaParseSetCookie('x=1; Domain=example.com', 'api.example.com');
    expect(ck).toBeTruthy();
    expect(ck.domain).toBe('example.com');
    expect(ck.hostOnly).toBe(false);
  });

  it('strips a leading dot from Domain before validating', () => {
    const ck = qaParseSetCookie('x=1; Domain=.example.com', 'api.example.com');
    expect(ck.domain).toBe('example.com');
  });

  it('rejects a single-label (public-suffix-ish) Domain like `com`', () => {
    // Without a Public Suffix List the dot-count is our cheap guard against
    // a response from evil.com poisoning every .com host via Domain=com.
    expect(qaParseSetCookie('x=1; Domain=com', 'evil.com')).toBeNull();
    expect(qaParseSetCookie('x=1; Domain=co', 'evil.co')).toBeNull();
  });

  it('rejects common 2-label public suffixes (best-effort PSL)', () => {
    // foo.co.uk must not be able to scope a cookie to co.uk and poison
    // every co.uk sibling. Same for github.io subdomains etc.
    expect(qaParseSetCookie('x=1; Domain=co.uk', 'evil.co.uk')).toBeNull();
    expect(qaParseSetCookie('x=1; Domain=com.au', 'evil.com.au')).toBeNull();
    expect(qaParseSetCookie('x=1; Domain=github.io', 'evil.github.io')).toBeNull();
    // A genuine domain at the same depth is still allowed:
    const ck = qaParseSetCookie('x=1; Domain=example.co.uk', 'sub.example.co.uk');
    expect(ck).toBeTruthy();
    expect(ck.domain).toBe('example.co.uk');
  });

  it('rejects expanded-PSL entries (ccTLD seconds + SaaS suffixes)', () => {
    // Spot-check a few entries from the expanded list. If these regress, the
    // PSL has shrunk and a class of cookie-poisoning attack is reopened.
    for (const dom of [
      'co.jp',
      'co.kr',
      'com.tw',
      'co.in',
      'com.br',
      'co.za',
      'vercel.app',
      'netlify.app',
      'herokuapp.com',
      'ngrok.app',
    ]) {
      // attacker sits at <attacker>.<dom>, tries to scope to the suffix
      expect(qaParseSetCookie('x=1; Domain=' + dom, 'evil.' + dom)).toBeNull();
    }
  });
});

describe('qaParseSetCookie — hostOnly & defaults', () => {
  it('defaults hostOnly=true when no Domain attribute is present', () => {
    const ck = qaParseSetCookie('s=1', 'api.example.com', '/v1');
    expect(ck.hostOnly).toBe(true);
    expect(ck.domain).toBe('api.example.com');
  });

  it('defaults path to RFC 6265 default-path of the request path', () => {
    const ck = qaParseSetCookie('s=1', 'h.example.com', '/v1/users');
    expect(ck.path).toBe('/v1');
  });

  it('keeps an explicit Path attribute', () => {
    const ck = qaParseSetCookie('s=1; Path=/admin', 'h.example.com', '/v1/users');
    expect(ck.path).toBe('/admin');
  });

  it('stores Max-Age as full ISO datetime (not date-only)', () => {
    const ck = qaParseSetCookie('s=1; Max-Age=3600', 'h.example.com');
    // ISO is 24 characters: 2026-05-30T11:22:33.000Z
    expect(ck.expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('qaMergeCookie — path is part of the identity key', () => {
  it('does NOT clobber a same-name cookie with a different path', () => {
    const root = { name: 's', value: 'A', domain: 'h.example.com', path: '/', on: true };
    const admin = { name: 's', value: 'B', domain: 'h.example.com', path: '/admin', on: true };
    const jar1 = qaMergeCookie([], root);
    const jar2 = qaMergeCookie(jar1, admin);
    expect(jar2).toHaveLength(2);
    expect(jar2.find((c) => c.path === '/').value).toBe('A');
    expect(jar2.find((c) => c.path === '/admin').value).toBe('B');
  });

  it('updates the value of the matching name+domain+path entry', () => {
    const v1 = { name: 's', value: 'A', domain: 'h.example.com', path: '/', on: true };
    const v2 = { name: 's', value: 'A2', domain: 'h.example.com', path: '/', on: true };
    const jar = qaMergeCookie([v1], v2);
    expect(jar).toHaveLength(1);
    expect(jar[0].value).toBe('A2');
  });
});
