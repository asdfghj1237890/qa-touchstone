import { describe, it, expect } from 'vitest';
import { mapAuth, buildCoreConfig, type CoreConfigInput } from '../coreConfig';
import type { QaRequest } from '../buildReq';

function req(over: Partial<QaRequest> = {}): QaRequest {
  return {
    id: 'getU',
    method: 'GET',
    url: '{{apiHost}}/u',
    params: [],
    headers: [{ key: 'Accept', value: 'application/json' }],
    bodyMode: 'none',
    body: '',
    gqlQuery: '',
    gqlVars: '',
    form: [],
    auth: { type: 'none' } as QaRequest['auth'],
    ...over,
  } as QaRequest;
}

describe('mapAuth', () => {
  it('maps none/bearer/basic/apikey and oauth2→bearer', () => {
    expect(mapAuth({ type: 'none' } as any)).toEqual({ type: 'none' });
    expect(mapAuth({ type: 'bearer', bearer: 'tok' } as any)).toEqual({
      type: 'bearer',
      token: 'tok',
    });
    expect(mapAuth({ type: 'basic', basic: { user: 'u', pass: 'p' } } as any)).toEqual({
      type: 'basic',
      username: 'u',
      password: 'p',
    });
    expect(
      mapAuth({ type: 'apiKey', apiKey: { key: 'X', value: 'v', placement: 'query' } } as any)
    ).toEqual({ type: 'apikey', key: 'X', value: 'v', in: 'query' });
    // _oauthToken is an OAuthTokenResult OBJECT at runtime ({ token, type }); read .token.
    expect(
      mapAuth({ type: 'oauth2' } as any, { token: 'resolved-tok', type: 'Bearer' } as any)
    ).toEqual({
      type: 'bearer',
      token: 'resolved-tok',
    });
    // back-compat: a bare string token is still accepted.
    expect(mapAuth({ type: 'oauth2' } as any, 'str-tok')).toEqual({
      type: 'bearer',
      token: 'str-tok',
    });
  });
  it('returns null for aws (unrepresentable in core Auth)', () => {
    expect(mapAuth({ type: 'aws' } as any)).toBeNull();
  });
});

describe('buildCoreConfig', () => {
  const base: CoreConfigInput = {
    endpoints: [{ reqId: 'getU', method: 'GET', path: '/u' }],
    requestsById: { getU: req() },
    identities: [
      { id: 'admin', auth: { type: 'bearer', bearer: 't' } as any, privileged: true },
      { id: 'anon', auth: { type: 'none' } as any },
    ],
    globals: { ua: 'qa' },
    environments: [{ name: 'staging', variables: { apiHost: 'https://x' } }],
    expect: { getU: { anon: 'deny' } },
    denySet: [401, 403],
    oracleConfig: { sensitive: true, schema: true },
  };

  it('emits the exact core config subset (version, requests, identities, security)', () => {
    const c = buildCoreConfig(base) as any;
    expect(c.version).toBe(1);
    expect(c.globals).toEqual({ variables: { ua: 'qa' } });
    expect(c.environments).toEqual([{ name: 'staging', variables: { apiHost: 'https://x' } }]);
    expect(c.requests).toEqual([
      {
        id: 'getU',
        method: 'GET',
        url: '{{apiHost}}/u',
        headers: [{ key: 'Accept', value: 'application/json' }],
        query: [],
        body: null,
        assertions: [],
        privileged: null,
      },
    ]);
    expect(c.identities).toEqual([
      { id: 'admin', auth: { type: 'bearer', token: 't' }, privileged: true },
      { id: 'anon', auth: { type: 'none' }, privileged: false },
    ]);
    expect(c.security.matrix).toEqual({
      endpoints: ['getU'],
      denySet: [401, 403],
      expect: { getU: { anon: 'deny' } },
    });
    expect(c.security.oracles).toEqual({ sensitive: true, schema: true });
  });

  it('drops aws identities and prunes their expect cells', () => {
    const c = buildCoreConfig({
      ...base,
      identities: [...base.identities, { id: 'awsId', auth: { type: 'aws' } as any }],
      expect: { getU: { anon: 'deny', awsId: 'allow' } },
    }) as any;
    expect(c.identities.map((i: any) => i.id)).toEqual(['admin', 'anon']);
    expect(c.security.matrix.expect).toEqual({ getU: { anon: 'deny' } });
  });

  it('maps json body to {mode:"json"} and empty body to null', () => {
    const c = buildCoreConfig({
      ...base,
      requestsById: {
        getU: req({ method: 'POST', bodyMode: 'json', body: '{"a":1}' }),
      },
    }) as any;
    expect(c.requests[0].body).toEqual({ mode: 'json', content: '{"a":1}' });
  });

  it('drops endpoints whose reqId is missing from requestsById', () => {
    const c = buildCoreConfig({
      ...base,
      endpoints: [...base.endpoints, { reqId: 'ghost', method: 'GET', path: '/ghost' }],
    }) as any;
    // The unresolved endpoint contributes no request object...
    expect(c.requests.map((r: any) => r.id)).toEqual(['getU']);
    // ...but the matrix endpoint list still enumerates it (reqId, not the request).
    expect(c.security.matrix.endpoints).toEqual(['getU', 'ghost']);
  });

  it('omits oracles when oracleConfig is absent', () => {
    const { oracleConfig: _drop, ...withoutOracles } = base;
    const c = buildCoreConfig(withoutOracles) as any;
    expect(c.security.oracles).toBeUndefined();
    expect('oracles' in c.security).toBe(false);
  });

  it('defaults oracle flags on for an empty oracleConfig object', () => {
    const c = buildCoreConfig({ ...base, oracleConfig: {} }) as any;
    expect(c.security.oracles).toEqual({ sensitive: true, schema: true });
  });

  it('omits denySet when absent and preserves an explicit empty denySet', () => {
    const { denySet: _drop, ...withoutDenySet } = base;
    const absent = buildCoreConfig(withoutDenySet) as any;
    expect('denySet' in absent.security.matrix).toBe(false);

    const empty = buildCoreConfig({ ...base, denySet: [] }) as any;
    expect(empty.security.matrix.denySet).toEqual([]);
  });
});
