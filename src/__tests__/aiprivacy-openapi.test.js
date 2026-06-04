import { describe, it, expect } from 'vitest';
import { redactOpenApi } from '../qa/aiPrivacy.js';

const SPEC = JSON.stringify({
  servers: [{ url: 'https://prod.acme.com/v1' }],
  paths: {
    '/users/{id}/orders': {
      get: {
        parameters: [{ name: 'id', example: '42831' }],
        responses: { '200': { content: { 'application/json': { schema: {
          type: 'object',
          properties: { email: { type: 'string', example: 'real@acme.com' }, total: { type: 'number', default: 99 } },
        } } } } },
      },
    },
  },
});

describe('redactOpenApi', () => {
  const out = redactOpenApi(SPEC);
  it('drops servers/host', () => { expect(out).not.toContain('prod.acme.com'); });
  it('keeps path templates + methods + field names', () => {
    expect(out).toContain('/users/{id}/orders');
    expect(out).toContain('get');
    expect(out).toContain('email');
  });
  it('strips concrete example/default values at any depth', () => {
    expect(out).not.toContain('real@acme.com');
    expect(out).not.toContain('42831');
    expect(out).not.toContain('99');
  });
  it('falls back to text redaction on unparseable input', () => {
    expect(redactOpenApi('not json email a@b.com')).toContain('<email>');
  });
});
