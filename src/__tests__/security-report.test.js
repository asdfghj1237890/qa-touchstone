// src/__tests__/security-report.test.js
import { describe, it, expect } from 'vitest';
import { buildReport, reportToJson, reportToHtml, htmlEscape, reportToJUnit, reportToSarif, sevToSarifLevel } from '../qa/securityReport';

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

describe('reportToJson', () => {
  it('round-trips the model', () => {
    const rep = buildReport(run([item()]), null, lc(), {});
    expect(JSON.parse(reportToJson(rep))).toEqual(rep);
  });
});

describe('reportToHtml', () => {
  it('contains the gate number and a findings row', () => {
    const html = reportToHtml(buildReport(run([item()]), null, lc(), {}));
    expect(html).toContain('new high/critical');
    expect(html).toContain('JWT in response');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
  it('escapes HTML in dynamic strings (no raw script tag)', () => {
    const evil = item({ title: '<script>alert(1)</script>' });
    const html = reportToHtml(buildReport(run([evil]), null, lc(), {}));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('htmlEscape', () => {
  it('escapes the five entities', () => {
    expect(htmlEscape(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('reportToJUnit', () => {
  const mk = (records = {}, base = null) => buildReport(
    run([item({ fp: 'a', effectiveSeverity: 'critical' }), item({ fp: 'b', effectiveSeverity: 'high' }),
         item({ fp: 'c', effectiveSeverity: 'low' })]),
    base, lc(records), {});
  it('failures attribute equals the gate (new high/critical, not suppressed)', () => {
    const xml = reportToJUnit(mk());
    expect(xml).toMatch(/<testsuites [^>]*failures="2"/); // a + b are new high/critical
  });
  it('a suppressed finding becomes <skipped>, not a failure', () => {
    const xml = reportToJUnit(mk({ a: { suppressed: true } }));
    expect(xml).toMatch(/<testsuites [^>]*failures="1"/);  // only b now
    expect(xml).toMatch(/<testsuites [^>]*skipped="1"/);
    expect(xml).toContain('<skipped');
  });
  it('a carried high is a passing testcase, not a failure', () => {
    const base = { runId: 'base', scopeHash: 'sh', items: [item({ fp: 'b', effectiveSeverity: 'high' })] };
    const xml = reportToJUnit(mk({}, base));
    expect(xml).toMatch(/<testsuites [^>]*failures="1"/); // b carried -> only a fails
  });
  it('escapes XML special chars in attributes', () => {
    const xml = reportToJUnit(buildReport(run([item({ title: 'a & "b" <c>' })]), null, lc(), {}));
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('"b" <c>');
  });
});

describe('sevToSarifLevel', () => {
  it('maps severity to SARIF level', () => {
    expect(sevToSarifLevel('critical')).toBe('error');
    expect(sevToSarifLevel('high')).toBe('error');
    expect(sevToSarifLevel('medium')).toBe('warning');
    expect(sevToSarifLevel('low')).toBe('note');
    expect(sevToSarifLevel('info')).toBe('note');
  });
});

describe('buildReport redaction levels', () => {
  it('"strict" omits both evidence and evidenceArtifact', () => {
    const rep = buildReport(run([item({ evidenceArtifact: { engine: 'matrix' } })]), null, lc(), { redaction: 'strict' });
    expect(rep.findings[0].evidence).toBeUndefined();
    expect(rep.findings[0].evidenceArtifact).toBeUndefined();
    expect(rep.meta.redaction).toBe('strict');
  });
  it('"redacted" keeps the short evidence but NOT the artifact', () => {
    const rep = buildReport(run([item({ evidenceArtifact: { engine: 'matrix' } })]), null, lc(), { redaction: 'redacted' });
    expect(rep.findings[0].evidence).toBe('eyJ…<redacted>…0');
    expect(rep.findings[0].evidenceArtifact).toBeUndefined();
  });
  it('"evidence" attaches the artifact from the in-memory map by fp', () => {
    const map = new Map([['fp1', { engine: 'matrix', request: { method: 'GET', url: '/me' } }]]);
    const rep = buildReport(run([item()]), null, lc(), { redaction: 'evidence', evidence: map });
    expect(rep.meta.redaction).toBe('evidence');
    expect(rep.findings[0].evidenceArtifact).toMatchObject({ engine: 'matrix' });
  });
  it('"evidence" falls back to a persisted item artifact when the map has no entry', () => {
    const rep = buildReport(run([item({ evidenceArtifact: { engine: 'bola' } })]), null, lc(), { redaction: 'evidence' });
    expect(rep.findings[0].evidenceArtifact).toMatchObject({ engine: 'bola' });
  });
  it('"evidence" emits no evidenceArtifact key when neither map nor item has one', () => {
    const rep = buildReport(run([item()]), null, lc(), { redaction: 'evidence' });
    expect(rep.findings[0].evidenceArtifact).toBeUndefined();
    expect('evidenceArtifact' in rep.findings[0]).toBe(false);
  });
});

describe('reportToSarif', () => {
  const parse = (model) => JSON.parse(reportToSarif(model));
  it('emits a valid 2.1.0 skeleton with unique rules and a result per current finding', () => {
    const sarif = parse(buildReport(run([item({ fp: 'a' }), item({ fp: 'b', ruleId: 'jwt' })]), null, lc(), {}));
    expect(sarif.version).toBe('2.1.0');
    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe('QA Touchstone');
    expect(driver.rules.map(r => r.id)).toEqual(['jwt']); // both share ruleId jwt -> unique
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results[0].partialFingerprints.qaFingerprint).toBeTruthy();
  });
  it('sets baselineState and suppressions', () => {
    const base = { runId: 'base', scopeHash: 'sh', items: [item({ fp: 'b' })] };
    const sarif = parse(buildReport(run([item({ fp: 'a' }), item({ fp: 'b' })]), base, lc({ a: { suppressed: true, suppressReason: 'fp' } }), {}));
    const byFp = Object.fromEntries(sarif.runs[0].results.map(r => [r.partialFingerprints.qaFingerprint, r]));
    expect(byFp.a.baselineState).toBe('new');
    expect(byFp.b.baselineState).toBe('unchanged');
    expect(byFp.a.suppressions[0].justification).toBe('fp');
    expect(byFp.b.suppressions).toBeUndefined();
  });
});

describe('reportToHtml evidence artifact', () => {
  const artifact = {
    engine: 'matrix',
    request: { method: 'GET', url: '/me?token=<redacted>', identity: 'admin', headers: { authorization: '<redacted>' } },
    response: { status: 200, headers: { 'content-type': 'application/json' }, snippetPath: 'data.token', snippet: { token: 'eyJ…<redacted>…0', name: '<str:3>' }, nonJson: null, truncated: false },
  };
  it('renders an expandable <details> with the masked, escaped request line', () => {
    const map = new Map([['fp1', artifact]]);
    const html = reportToHtml(buildReport(run([item()]), null, lc(), { redaction: 'evidence', evidence: map }));
    expect(html).toContain('<details>');
    expect(html).toContain('GET /me?token=&lt;redacted&gt;');
  });
  it('falls back to the plain evidence cell when there is no artifact', () => {
    const html = reportToHtml(buildReport(run([item()]), null, lc(), { redaction: 'redacted' }));
    expect(html).not.toContain('<details>');
    expect(html).toContain('eyJ…&lt;redacted&gt;…0');
  });
});

describe('reportToHtml evidence headers are single-escaped', () => {
  it('escapes header values exactly once (no double-escape)', () => {
    const artifact = {
      engine: 'matrix',
      request: { method: 'GET', url: '/x', identity: 'a', headers: { authorization: '<redacted>' } },
      response: { status: 200, headers: { 'x-test': '<a>&b' }, snippetPath: '', snippet: { k: '<num>' }, nonJson: null, truncated: false },
    };
    const map = new Map([['fp1', artifact]]);
    const html = reportToHtml(buildReport(run([item()]), null, lc(), { redaction: 'evidence', evidence: map }));
    // request header value single-escaped
    expect(html).toContain('authorization: &lt;redacted&gt;');
    // response header value with & and <> single-escaped
    expect(html).toContain('x-test: &lt;a&gt;&amp;b');
    // and NOT double-escaped
    expect(html).not.toContain('&amp;lt;');
  });
});
