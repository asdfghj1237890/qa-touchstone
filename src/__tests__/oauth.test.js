import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildOAuthTokenRequest,
  exchangeOAuthTokenWithFetch,
  parseOAuthTokenResponse,
} from '../qa/oauth';

describe('OAuth token helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a token request with substituted form fields', () => {
    const req = buildOAuthTokenRequest({
      grant: 'client_credentials',
      tokenUrl: '{{authHost}}/oauth/token',
      clientId: '{{clientId}}',
      clientSecret: '{{clientSecret}}',
      scope: 'read write',
    }, {
      authHost: 'https://auth.test',
      clientId: 'abc',
      clientSecret: 'secret',
    });

    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://auth.test/oauth/token');
    expect(req.headers).toEqual([
      { key: 'Accept', value: 'application/json', on: true },
      { key: 'Content-Type', value: 'application/x-www-form-urlencoded', on: true },
    ]);
    expect(req.form).toEqual([
      { key: 'grant_type', value: 'client_credentials', on: true },
      { key: 'client_id', value: 'abc', on: true },
      { key: 'client_secret', value: 'secret', on: true },
      { key: 'scope', value: 'read write', on: true },
    ]);
  });

  it('requires an absolute token URL', () => {
    expect(() => buildOAuthTokenRequest({ tokenUrl: '/oauth/token' })).toThrow(/absolute HTTP/);
  });

  it('parses token responses with expiry and bearer normalization', () => {
    const now = Date.now();
    const parsed = parseOAuthTokenResponse('{"access_token":"tok","token_type":"bearer","expires_in":10}', { scope: 'read' });
    expect(parsed).toMatchObject({ token: 'tok', type: 'Bearer', scope: 'read' });
    expect(parsed.expiresAt).toBeGreaterThanOrEqual(now + 10000);
  });

  it('posts URL-encoded form data via fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"access_token":"tok","token_type":"Bearer","expires_in":60}',
    });
    const req = buildOAuthTokenRequest({
      grant: 'password',
      tokenUrl: 'https://auth.test/token',
      clientId: 'client',
      username: 'user',
      password: 'pass',
    });

    const token = await exchangeOAuthTokenWithFetch(req);

    expect(token.token).toBe('tok');
    expect(fetch).toHaveBeenCalledWith('https://auth.test/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: expect.any(URLSearchParams),
    });
    const body = fetch.mock.calls[0][1].body;
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('user');
    expect(body.get('password')).toBe('pass');
  });
});
