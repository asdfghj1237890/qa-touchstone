import { describe, expect, it } from 'vitest';
import { applyApiAuthentication } from '../../utils/apiAuth';

const baseRequest = () => ({
  request: {
    method: 'GET',
    header: [{ key: 'Accept', value: 'application/json' }],
    url: 'https://api.example.com/devices?existing=1',
  },
});

describe('applyApiAuthentication', () => {
  it('leaves requests unchanged for no auth', () => {
    expect(applyApiAuthentication(baseRequest(), { type: 'none' })).toEqual(baseRequest());
  });

  it('adds bearer authorization', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'bearer',
      bearerToken: 'token-123',
    });

    expect(result.request.header).toContainEqual({
      key: 'Authorization',
      value: 'Bearer token-123',
    });
  });

  it('adds API key as a header', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'apiKey',
      apiKey: { key: 'x-api-key', value: 'key-123', placement: 'header' },
    });

    expect(result.request.header).toContainEqual({ key: 'x-api-key', value: 'key-123' });
  });

  it('adds API key as a query parameter', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'apiKey',
      apiKey: { key: 'api_key', value: 'key-123', placement: 'query' },
    });

    expect(result.request.url).toBe('https://api.example.com/devices?existing=1&api_key=key-123');
  });

  it('adds basic authorization', () => {
    const result = applyApiAuthentication(baseRequest(), {
      type: 'basic',
      basic: { username: 'alice', password: 'secret' },
    });

    expect(result.request.header).toContainEqual({
      key: 'Authorization',
      value: 'Basic YWxpY2U6c2VjcmV0',
    });
  });
});
