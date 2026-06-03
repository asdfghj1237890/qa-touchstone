// src/__tests__/security-report.test.js
import { describe, it, expect } from 'vitest';
import { buildReport } from '../qa/securityReport.js';

const item = (over = {}) => ({
  fp: 'fp1', effectiveSeverity: 'high', engine: 'matrix', ruleId: 'jwt',
  path: 'data.token', locationLabel: 'GET /me · admin', title: 'JWT in response',
  evidence: 'eyJ…<redacted>…0', count: 1, ...over,
});
const run = (items, over = {}) => ({
  runId: 'r-finish', status: 'complete', startedAt: 'T0', finishedAt: 'T1', durationMs: 5000,
  scopeHash: 'sh', engines: [{ engine: 'matrix', ran: true, durationMs: 5000, findingCount: items.length, error: null }],
  items, ...over,
});
const lc = (records = {}) => ({ fpVersion: 1, records });

describe('buildReport', () => {
  it('assembles meta, engines, summary, and findings with annotations joined by fp', () => {
    const rep = buildReport(run([item()]), null, lc({ fp1: { owner: 'alice', status: 'acknowledged' } }), {});
    expect(rep.meta.tool).toBe('QA Touchstone');
    expect(rep.meta.runId).toBe('r-finish');
    expect(rep.summary.total).toBe(1);
    expect(rep.summary.bySeverity.high).toBe(1);
    expect(rep.findings[0]).toMatchObject({ fp: 'fp1', severity: 'high', title: 'JWT in response', owner: 'alice', status: 'acknowledged', presence: 'new' });
  });
  it('newHighCritical counts new high/critical not suppressed (matches gate)', () => {
    const items = [item({ fp: 'a', effectiveSeverity: 'critical' }), item({ fp: 'b', effectiveSeverity: 'high' }), item({ fp: 'c', effectiveSeverity: 'low' })];
    const rep = buildReport(run(items), null, lc({ b: { suppressed: true } }), {});
    expect(rep.summary.newHighCritical).toBe(1); // a counts; b suppressed; c low
  });
  it('marks carried vs new via the baseline, and reconstructs resolved from baseline', () => {
    const cur = run([item({ fp: 'a' }), item({ fp: 'b' })]);
    const base = { runId: 'base', scopeHash: 'sh', items: [item({ fp: 'b' }), item({ fp: 'gone', locationLabel: 'GET /old · admin' })] };
    const rep = buildReport(cur, base, lc(), {});
    const byFp = Object.fromEntries(rep.findings.map(f => [f.fp, f]));
    expect(byFp.a.presence).toBe('new');
    expect(byFp.b.presence).toBe('carried');
    expect(byFp.gone.presence).toBe('resolved');
    expect(byFp.gone.location).toBe('GET /old · admin');
    expect(rep.summary.resolved).toBe(1);
  });
  it('redaction strict omits evidence; redacted keeps the masked string', () => {
    expect(buildReport(run([item()]), null, lc(), { redaction: 'redacted' }).findings[0].evidence).toBe('eyJ…<redacted>…0');
    expect(buildReport(run([item()]), null, lc(), { redaction: 'strict' }).findings[0]).not.toHaveProperty('evidence');
  });
  it('with no baseline, everything is new and scopeMismatch is false', () => {
    const rep = buildReport(run([item()]), null, lc(), {});
    expect(rep.findings[0].presence).toBe('new');
    expect(rep.meta.baseline).toBeNull();
    expect(rep.meta.scopeMismatch).toBe(false);
  });
});
