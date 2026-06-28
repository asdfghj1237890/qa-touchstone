// src/__tests__/coverage.test.js
import { describe, it, expect } from 'vitest';
import { buildCoverageModel } from '../qa/coverage';

describe('buildCoverageModel', () => {
  it('reports requirement, endpoint, role, and security-check gaps', () => {
    const model = buildCoverageModel({
      requests: [
        { reqId: 'r1', method: 'GET', path: '/users/{id}', folder: 'Users' },
        { reqId: 'r2', method: 'DELETE', path: '/admin/users/{id}', folder: 'Admin' },
        { reqId: 'r3', method: 'GET', path: '/billing/invoices', folder: 'Billing' },
      ],
      endpoints: [
        { reqId: 'r1', method: 'GET', path: '/users/{id}' },
        { reqId: 'r2', method: 'DELETE', path: '/admin/users/{id}', privileged: true },
      ],
      identities: [
        { id: 'anon', auth: { type: 'none' } },
        { id: 'admin', name: 'Admin', privileged: true, auth: { type: 'bearer' } },
      ],
      expect: {
        r1: { anon: 'deny', admin: 'allow' },
        r2: { anon: 'deny', admin: 'allow' },
      },
      conformanceTests: [
        { id: 'schema-r1', reqId: 'r1', method: 'GET', path: '/users/{id}', schema: {} },
      ],
      bolaTests: [{ id: 'b1', reqId: 'r1', method: 'GET', path: '/users/{id}' }],
      rateLimitTests: [],
      fuzzPlans: [{ id: 'f1', reqId: 'r1', method: 'GET', path: '/users/{id}', seeds: [] }],
    });

    expect(model.requirements).toMatchObject({ total: 3, covered: 2 });
    expect(model.requirements.gaps.map((g) => g.label)).toContain('Billing');
    expect(model.endpoints).toMatchObject({ total: 3, covered: 2 });
    expect(model.endpoints.gaps[0]).toMatchObject({ id: 'r3' });
    expect(model.roles.privileged).toBe(1);
    expect(model.roles.gaps.map((g) => g.id)).toContain('__non_privileged__');
    expect(model.checks.conformance.gaps.map((g) => g.id)).toContain('r2');
    expect(model.checks.bfla.total).toBe(1);
    expect(model.checks.bola.gaps.map((g) => g.id)).toContain('r2');
    expect(model.checks.fuzz.gaps.map((g) => g.id)).toContain('r2');
    expect(model.checks.rateLimit.gaps.map((g) => g.id)).toContain('r2');
  });

  it('treats an empty plan as fully covered with no false gap spam', () => {
    const model = buildCoverageModel({});
    expect(model.requirements.percent).toBe(100);
    expect(model.endpoints.percent).toBe(100);
    expect(model.matrixCells.percent).toBe(100);
  });
});
