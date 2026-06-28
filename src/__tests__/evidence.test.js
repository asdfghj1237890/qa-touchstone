// src/__tests__/evidence.test.js
import { describe, it, expect } from 'vitest';
import { leafToken, tokenizePath, snippetAround, SNIPPET_KEYS, REDACTED } from '../qa/evidence';

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

import { redactUrl, redactHeaders } from '../qa/evidence';

describe('redactUrl', () => {
  it('keeps path + query keys, masks query values', () => {
    expect(redactUrl('/api/orders/123?token=abc&page=2')).toBe(
      '/api/orders/123?token=<redacted>&page=<redacted>'
    );
  });
  it('masks a secret-like (high-entropy) path segment', () => {
    const out = redactUrl('/reset/eyJhbGciOiJI.eyJzdWIiOiJ.SflKxwRJ');
    expect(out).toBe('/reset/' + REDACTED);
  });
  it('leaves short slug segments intact', () => {
    expect(redactUrl('/api/orders/42')).toBe('/api/orders/42');
  });
});

describe('redactHeaders', () => {
  it('fully masks denylisted + name-pattern headers, passes others through', () => {
    const out = redactHeaders({
      Authorization: 'Bearer x',
      Cookie: 'a=b',
      'x-session-id': 's',
      'content-type': 'application/json',
    });
    expect(out.Authorization).toBe(REDACTED);
    expect(out.Cookie).toBe(REDACTED);
    expect(out['x-session-id']).toBe(REDACTED);
    expect(out['content-type']).toBe('application/json');
  });
});

describe('redactUrl / redactHeaders leak-path regressions', () => {
  it('drops a URL fragment (OAuth implicit #access_token leaks otherwise)', () => {
    expect(redactUrl('/cb#access_token=SECRETLEAK&state=x')).toBe('/cb');
    expect(redactUrl('/cb?ok=1#access_token=SECRETLEAK')).toBe('/cb?ok=<redacted>');
  });
  it('redacts URL-valued headers (Location/Referer) that embed tokens', () => {
    const out = redactHeaders({
      Location: 'https://app/cb?code=SECRETLEAK&state=s',
      Referer: 'https://app/p?token=SECRETLEAK',
      'content-type': 'text/html',
    });
    expect(out.Location).toBe('https://app/cb?code=<redacted>&state=<redacted>');
    expect(out.Referer).toBe('https://app/p?token=<redacted>');
    expect(out['content-type']).toBe('text/html');
    expect(JSON.stringify(out)).not.toContain('SECRETLEAK');
  });
});

import { buildEvidenceArtifact, buildEvidenceMap, embedEvidence } from '../qa/evidence';
import { fingerprint } from '../qa/findings';

describe('buildEvidenceArtifact', () => {
  it('builds request + response with a masked snippet for a body finding', () => {
    const item = { engine: 'matrix', ruleId: 'jwt', path: 'data.token', identityLabel: 'admin' };
    const raw = {
      request: {
        method: 'GET',
        url: '/me?token=abc',
        identity: 'admin',
        headers: { authorization: 'Bearer x' },
      },
      response: {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'sid=1' },
        body: { data: { token: 'eyJabc.def.ghi', name: 'bob' } },
      },
    };
    const a = buildEvidenceArtifact(raw, item);
    expect(a.request.url).toBe('/me?token=<redacted>');
    expect(a.request.headers.authorization).toBe('<redacted>');
    expect(a.response.status).toBe(200);
    expect(a.response.headers['set-cookie']).toBe('<redacted>');
    expect(a.response.headers['content-type']).toBe('application/json');
    expect(a.response.snippet.token).toContain('<redacted>');
    expect(a.response.snippet.name).toBe('<str:3>');
  });
  it('emits metadata only for a non-JSON body — NO raw bytes', () => {
    const item = { engine: 'matrix', ruleId: 'x', path: '' };
    const raw = {
      request: { method: 'GET', url: '/x' },
      response: {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>secret-token-xyz</html>',
      },
    };
    const a = buildEvidenceArtifact(raw, item);
    expect(a.response.snippet).toBeNull();
    expect(a.response.nonJson).toEqual({ contentType: 'text/html', length: 29 });
    expect(JSON.stringify(a)).not.toContain('secret-token-xyz');
  });
  it('yields stats and a null response for a rate-limit finding', () => {
    const a = buildEvidenceArtifact(
      {
        request: { method: 'POST', url: '/login' },
        stats: { sent: 100, completed: 100, throttleSeen: false },
      },
      { engine: 'ratelimit' }
    );
    expect(a.response).toBeNull();
    expect(a.stats).toEqual({ sent: 100, completed: 100, throttleSeen: false });
  });
  it('never throws on garbage input', () => {
    expect(buildEvidenceArtifact(null, null)).toBeNull();
    expect(() => buildEvidenceArtifact({ response: { body: 12345 } }, {})).not.toThrow();
  });
});

describe('buildEvidenceMap + embedEvidence', () => {
  it('keys by the SAME fingerprint snapshotOf uses, and embeds onto items', () => {
    const it = {
      engine: 'matrix',
      ruleId: 'jwt',
      path: 'data.token',
      method: 'GET',
      endpoint: '/me',
      identityLabel: 'admin',
      raw: {
        request: { method: 'GET', url: '/me' },
        response: { status: 200, headers: {}, body: { data: { token: 'eyJa.bc.de' } } },
      },
    };
    const fp = fingerprint(it).fp;
    const map = buildEvidenceMap([it]);
    expect(map.has(fp)).toBe(true);
    const items = embedEvidence([{ fp }], map);
    expect(items[0].evidenceArtifact).toBeTruthy();
    expect(items[0].evidenceArtifact.response.snippet.token).toContain('<redacted>');
  });
});
