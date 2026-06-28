// src/__tests__/security-suite.test.js
import { describe, it, expect } from 'vitest';
import {
  normalizeMatrix,
  normalizeConformance,
  normalizeBfla,
  normalizeBola,
  normalizeFuzz,
  normalizeRateLimit,
  runSuite,
} from '../qa/securitySuite';

describe('normalizeMatrix', () => {
  it('flattens cell findings into union items with ruleId + matrix location', () => {
    const endpoints = [{ reqId: 'r1', method: 'GET', path: '/me' }];
    const identities = [{ id: 'admin', name: 'Admin' }, { id: 'anon' }];
    const results = {
      r1: {
        admin: {
          findings: [
            {
              ruleId: 'jwt',
              oracle: 'sensitive-data',
              severity: 'high',
              title: 'JWT in response',
              path: 'data.token',
              evidence: 'x',
            },
          ],
        },
        anon: { findings: [] },
      },
    };
    const out = normalizeMatrix(results, endpoints, identities);
    expect(out).toMatchObject([
      {
        engine: 'matrix',
        ruleId: 'jwt',
        severity: 'high',
        oracle: 'sensitive-data',
        title: 'JWT in response',
        path: 'data.token',
        evidence: 'x',
        method: 'GET',
        endpoint: '/me',
        identityLabel: 'Admin',
        ref: { reqId: 'r1', idId: 'admin' },
      },
    ]);
  });
  it('labels the anon identity "anon"', () => {
    const out = normalizeMatrix(
      {
        r1: {
          anon: {
            findings: [
              {
                ruleId: 'email',
                oracle: 'sensitive-data',
                severity: 'medium',
                title: 'Email',
                path: 'a',
                evidence: '',
              },
            ],
          },
        },
      },
      [{ reqId: 'r1', method: 'GET', path: '/x' }],
      [{ id: 'anon' }]
    );
    expect(out[0].identityLabel).toBe('anon');
  });
});

describe('normalizeBola', () => {
  it('emits a union item per attack finding with ruleId fallback to oracle', () => {
    const tests = [{ id: 't1' }];
    const results = {
      t1: {
        attacks: {
          a: {
            o: {
              finding: {
                oracle: 'object-authz',
                severity: 'high',
                title: 'Cross-object access confirmed',
                path: 'GET /o',
              },
            },
          },
        },
      },
    };
    const out = normalizeBola(results, tests);
    expect(out).toMatchObject([
      {
        engine: 'bola',
        ruleId: 'object-authz',
        severity: 'high',
        oracle: 'object-authz',
        title: 'Cross-object access confirmed',
        path: 'GET /o',
        evidence: '',
        ref: { testId: 't1', attackerId: 'a', ownerId: 'o' },
      },
    ]);
  });
});

describe('normalizeConformance', () => {
  it('emits schema findings with request and response evidence', () => {
    const out = normalizeConformance([
      {
        test: { id: 'c1', reqId: 'r1', method: 'GET', path: '/users/1', schema: {} },
        identity: { id: 'u', name: 'User' },
        status: 200,
        response: { status: 200, headers: {}, body: { id: 'x' } },
        findings: [
          {
            ruleId: 'schema-conformance:type',
            oracle: 'schema-conformance',
            severity: 'medium',
            title: 'Schema type violation',
            path: '$.id',
            evidence: 'expected integer',
          },
        ],
        error: null,
      },
    ]);
    expect(out).toMatchObject([
      {
        engine: 'conformance',
        ruleId: 'schema-conformance:type',
        method: 'GET',
        endpoint: '/users/1',
        identityLabel: 'User',
        ref: { reqId: 'r1', idId: 'u' },
      },
    ]);
    expect(out[0].raw.response.body).toEqual({ id: 'x' });
  });
});

describe('normalizeBfla', () => {
  it('emits BFLA findings with endpoint and identity refs', () => {
    const out = normalizeBfla([
      {
        endpoint: { reqId: 'admin', method: 'DELETE', path: '/admin/users/1' },
        identity: { id: 'u', name: 'User' },
        status: 200,
        verdict: 'vuln',
        severity: 'critical',
        finding: {
          ruleId: 'bfla',
          oracle: 'bfla',
          severity: 'critical',
          title: 'Broken function-level authorization',
          path: 'DELETE /admin/users/1',
          evidence: 'User invoked a privileged function',
        },
        response: { status: 200, headers: {}, body: { ok: true } },
        error: null,
      },
    ]);
    expect(out).toMatchObject([
      {
        engine: 'bfla',
        ruleId: 'bfla',
        severity: 'critical',
        method: 'DELETE',
        endpoint: '/admin/users/1',
        identityLabel: 'User',
        ref: { reqId: 'admin', idId: 'u' },
      },
    ]);
  });
});

describe('normalizeFuzz', () => {
  it('emits fuzz findings per suite plan', () => {
    const out = normalizeFuzz([
      {
        plan: {
          id: 'fz-r1',
          reqId: 'r1',
          method: 'GET',
          path: '/search',
          seeds: [{ name: 'q', location: { kind: 'query', key: 'q' } }],
        },
        ran: 12,
        findings: [
          {
            ruleId: 'fuzz:server-error',
            oracle: 'fuzz',
            severity: 'high',
            title: 'Fuzz input caused a server error (5xx)',
            path: 'GET /search',
            evidence: 'payload long on q',
          },
        ],
      },
    ]);
    expect(out).toMatchObject([
      {
        engine: 'fuzz',
        ruleId: 'fuzz:server-error',
        method: 'GET',
        endpoint: '/search',
        ref: { reqId: 'r1', testId: 'fz-r1' },
      },
    ]);
  });
});

describe('normalizeRateLimit', () => {
  it('emits a union item per test finding', () => {
    const tests = [{ id: 't9' }];
    const results = {
      t9: {
        finding: {
          oracle: 'rate-limit',
          severity: 'medium',
          title: 'No rate limiting',
          path: 'GET /x',
          evidence: '30 requests',
        },
      },
    };
    const out = normalizeRateLimit(results, tests);
    expect(out).toMatchObject([
      {
        engine: 'ratelimit',
        ruleId: 'rate-limit',
        severity: 'medium',
        oracle: 'rate-limit',
        title: 'No rate limiting',
        path: 'GET /x',
        evidence: '30 requests',
        ref: { testId: 't9' },
      },
    ]);
  });
  it('skips tests with no finding', () => {
    expect(normalizeRateLimit({ t9: { finding: null } }, [{ id: 't9' }])).toEqual([]);
  });
});

// A fake clock returning ascending ms so durations are deterministic.
function fakeNow() {
  let t = 1000;
  return () => (t += 1000);
}

// Build runners that record call order and return canned per-engine results.
function recordingRunners(log, opts = {}) {
  return {
    matrix: async () => {
      log.push('matrix');
      return opts.matrix ?? {};
    },
    conformance: async () => {
      log.push('conformance');
      return opts.conformance ?? [];
    },
    bfla: async () => {
      log.push('bfla');
      return opts.bfla ?? [];
    },
    bola: async () => {
      log.push('bola');
      return opts.bola ?? {};
    },
    fuzz: async () => {
      log.push('fuzz');
      return opts.fuzz ?? [];
    },
    ratelimit: async () => {
      log.push('ratelimit');
      return opts.ratelimit ?? {};
    },
  };
}

const baseConfig = {
  matrix: {
    endpoints: [{ reqId: 'r1', method: 'GET', path: '/me' }],
    identities: [{ id: 'admin' }],
  },
  conformance: {
    tests: [{ id: 'c1', reqId: 'r1', method: 'GET', path: '/me', schema: {} }],
  },
  bfla: {
    endpoints: [{ reqId: 'r2', method: 'DELETE', path: '/admin/users/1', privileged: true }],
    identities: [{ id: 'user' }],
  },
  bola: { tests: [{ id: 't1' }], identities: [{ id: 'admin' }] },
  fuzz: {
    plans: [
      {
        id: 'fz-r1',
        reqId: 'r1',
        method: 'GET',
        path: '/me',
        seeds: [{ name: 'q', location: { kind: 'query', key: 'q' } }],
      },
    ],
  },
  rateLimit: { tests: [{ id: 't9' }], identities: [{ id: 'admin' }] },
};

describe('runSuite', () => {
  it('runs engines sequentially with rate-limit last', async () => {
    const log = [];
    const rec = await runSuite(baseConfig, recordingRunners(log), { now: fakeNow() });
    expect(log).toEqual(['matrix', 'conformance', 'bfla', 'bola', 'fuzz', 'ratelimit']);
    expect(rec.status).toBe('complete');
    expect(rec.engines.map((e) => e.engine)).toEqual([
      'matrix',
      'conformance',
      'bfla',
      'bola',
      'fuzz',
      'ratelimit',
    ]);
    expect(rec.engines.every((e) => e.ran)).toBe(true);
  });

  it('skips an engine with no config and still completes', async () => {
    const log = [];
    const cfg = { ...baseConfig, fuzz: { plans: [] }, rateLimit: { tests: [], identities: [] } };
    const rec = await runSuite(cfg, recordingRunners(log), { now: fakeNow() });
    expect(log).toEqual(['matrix', 'conformance', 'bfla', 'bola']); // fuzz/ratelimit not invoked
    const rl = rec.engines.find((e) => e.engine === 'ratelimit');
    expect(rl).toMatchObject({ ran: false, skipped: 'no-config' });
    expect(rec.engines.find((e) => e.engine === 'fuzz')).toMatchObject({
      ran: false,
      skipped: 'no-config',
    });
    expect(rec.status).toBe('complete');
  });

  it('aborts mid-suite: stops, marks aborted, does not run later engines', async () => {
    const log = [];
    const controller = new AbortController();
    const runners = {
      matrix: async () => {
        log.push('matrix');
        controller.abort();
        return {};
      },
      conformance: async () => {
        log.push('conformance');
        return [];
      },
      bfla: async () => {
        log.push('bfla');
        return [];
      },
      bola: async () => {
        log.push('bola');
        return {};
      },
      fuzz: async () => {
        log.push('fuzz');
        return [];
      },
      ratelimit: async () => {
        log.push('ratelimit');
        return {};
      },
    };
    const rec = await runSuite(baseConfig, runners, { signal: controller.signal, now: fakeNow() });
    expect(log).toEqual(['matrix']); // bola/ratelimit skipped after abort
    expect(rec.status).toBe('aborted');
  });

  it('assembles the union and per-engine finding counts + durations', async () => {
    const matrix = {
      r1: {
        admin: {
          findings: [
            {
              ruleId: 'jwt',
              oracle: 'sensitive-data',
              severity: 'high',
              title: 'JWT',
              path: 'a',
              evidence: '',
            },
          ],
        },
      },
    };
    const bola = {
      t1: {
        attacks: {
          a: {
            o: { finding: { oracle: 'object-authz', severity: 'high', title: 'X', path: 'p' } },
          },
        },
      },
    };
    const ratelimit = {
      t9: {
        finding: { oracle: 'rate-limit', severity: 'medium', title: 'RL', path: 'q', evidence: '' },
      },
    };
    const rec = await runSuite(baseConfig, recordingRunners([], { matrix, bola, ratelimit }), {
      now: fakeNow(),
    });
    expect(rec.union).toHaveLength(3);
    expect(rec.engines.find((e) => e.engine === 'matrix').findingCount).toBe(1);
    expect(rec.engines.find((e) => e.engine === 'bola').findingCount).toBe(1);
    expect(rec.engines.find((e) => e.engine === 'ratelimit').findingCount).toBe(1);
    expect(rec.engines.every((e) => typeof e.durationMs === 'number')).toBe(true);
    expect(rec.durationMs).toBeGreaterThan(0);
    expect(rec.union).not.toHaveProperty('items'); // runSuite returns union, not snapshot items
  });

  it('passes each engine its own config slice (ratelimit uses the rateLimit key)', async () => {
    const received = {};
    const runners = {
      matrix: async (cfg) => {
        received.matrix = cfg;
        return {};
      },
      conformance: async (cfg) => {
        received.conformance = cfg;
        return [];
      },
      bfla: async (cfg) => {
        received.bfla = cfg;
        return [];
      },
      bola: async (cfg) => {
        received.bola = cfg;
        return {};
      },
      fuzz: async (cfg) => {
        received.fuzz = cfg;
        return [];
      },
      ratelimit: async (cfg) => {
        received.ratelimit = cfg;
        return {};
      },
    };
    await runSuite(baseConfig, runners, { now: fakeNow() });
    expect(received.matrix).toBe(baseConfig.matrix);
    expect(received.conformance).toBe(baseConfig.conformance);
    expect(received.bfla).toBe(baseConfig.bfla);
    expect(received.bola).toBe(baseConfig.bola);
    expect(received.fuzz).toBe(baseConfig.fuzz);
    expect(received.ratelimit).toBe(baseConfig.rateLimit); // must NOT be undefined
  });

  it('captures a thrown engine as error without failing the run', async () => {
    const runners = {
      matrix: async () => ({}),
      conformance: async () => [],
      bfla: async () => [],
      bola: async () => {
        throw new Error('boom');
      },
      fuzz: async () => [],
      ratelimit: async () => ({}),
    };
    const rec = await runSuite(baseConfig, runners, { now: fakeNow() });
    expect(rec.status).toBe('complete');
    const bola = rec.engines.find((e) => e.engine === 'bola');
    expect(bola.ran).toBe(true);
    expect(bola.error).toBe('boom');
    expect(bola.findingCount).toBe(0);
  });

  it('runs rate-limit last even when bola config is empty', async () => {
    const log = [];
    const cfg = { ...baseConfig, bola: { tests: [], identities: [] } };
    const rec = await runSuite(cfg, recordingRunners(log), { now: fakeNow() });
    expect(log).toEqual(['matrix', 'conformance', 'bfla', 'fuzz', 'ratelimit']); // bola skipped, ratelimit still last
    expect(rec.engines.find((e) => e.engine === 'bola')).toMatchObject({
      ran: false,
      skipped: 'no-config',
    });
  });
});

describe('normalizers attach transient raw', () => {
  it('normalizeMatrix attaches request + response from the cell', () => {
    const endpoints = [{ reqId: 'r1', method: 'GET', path: '/me' }];
    const identities = [{ id: 'admin', name: 'Admin' }];
    const results = {
      r1: {
        admin: {
          response: { status: 200, headers: { x: '1' }, body: { token: 'eyJ' } },
          findings: [
            {
              ruleId: 'jwt',
              oracle: 'sensitive-data',
              severity: 'high',
              title: 'JWT',
              path: 'token',
              evidence: 'e',
            },
          ],
        },
      },
    };
    const u = normalizeMatrix(results, endpoints, identities);
    expect(u[0].raw.request).toMatchObject({ method: 'GET', url: '/me', identity: 'Admin' });
    expect(u[0].raw.response).toMatchObject({ status: 200, body: { token: 'eyJ' } });
  });

  it('normalizeBola attaches request + response from the attack cell', () => {
    const tests = [{ id: 't1', method: 'GET', path: '/orders/:id' }];
    const results = {
      t1: {
        attacks: {
          alice: {
            bob: {
              finding: {
                ruleId: 'bola',
                oracle: 'bola',
                severity: 'high',
                title: 'BOLA',
                path: '',
                evidence: 'x',
              },
              request: { method: 'GET', path: '/orders/9', identity: 'alice', idValue: '9' },
              response: { status: 200, headers: {}, body: { id: 9 } },
            },
          },
        },
      },
    };
    const u = normalizeBola(results, tests);
    expect(u[0].raw.request).toMatchObject({ method: 'GET', url: '/orders/9', identity: 'alice' });
    expect(u[0].raw.response).toMatchObject({ status: 200, body: { id: 9 } });
  });

  it('normalizeRateLimit attaches request + stats', () => {
    const tests = [{ id: 't1', method: 'POST', path: '/login' }];
    const results = {
      t1: {
        stats: { sent: 50, completed: 50, throttleSeen: false },
        finding: {
          oracle: 'rate-limit',
          severity: 'medium',
          title: 'No throttle',
          path: 'POST /login',
          evidence: 'x',
        },
      },
    };
    const u = normalizeRateLimit(results, tests);
    expect(u[0].raw.request).toMatchObject({ method: 'POST', url: '/login' });
    expect(u[0].raw.stats).toMatchObject({ sent: 50, throttleSeen: false });
  });
});
