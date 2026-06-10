import { describe, it, expect } from 'vitest';
import { SEVERITY_ORDER, redact, worstSeverity } from '../qa/oracles';

describe('SEVERITY_ORDER', () => {
  it('ranks info < low < medium < high < critical', () => {
    expect(SEVERITY_ORDER).toEqual(['info', 'low', 'medium', 'high', 'critical']);
  });
});

describe('redact', () => {
  it('masks the middle of long secrets, keeping a short prefix/suffix', () => {
    const out = redact('eyJabcdef1234567890ghijkl9c');
    expect(out).toContain('<redacted>');
    expect(out).not.toContain('abcdef1234567890');
    expect(out.startsWith('eyJ')).toBe(true);
  });
  it('fully masks short values', () => {
    expect(redact('abcd')).toBe('••••');
  });
});

describe('worstSeverity', () => {
  it('returns the highest-ranked severity in a finding list, or null when empty', () => {
    expect(worstSeverity([{ severity: 'low' }, { severity: 'high' }, { severity: 'medium' }])).toBe('high');
    expect(worstSeverity([])).toBe(null);
  });
});

import { scanSensitive, DEFAULT_ORACLE_CONFIG } from '../qa/oracles';

const resp = (body, headers = {}) => ({ status: 200, body, headers });

describe('scanSensitive — secrets', () => {
  it('flags a JWT in a body value', () => {
    const f = scanSensitive(resp({ tok: 'eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4' }));
    expect(f.some(x => x.title === 'JWT in response' && x.severity === 'high')).toBe(true);
    expect(f[0].evidence).toContain('<redacted>');   // never the raw token
  });
  it('flags a private key block as critical', () => {
    const f = scanSensitive(resp({ k: '-----BEGIN RSA PRIVATE KEY-----\nMIIE' }));
    expect(f.some(x => x.title === 'Private key' && x.severity === 'critical')).toBe(true);
  });
  it('flags secret-named fields by key, even when the value is an object', () => {
    const f = scanSensitive(resp({ password: 'hunter2', nested: { client_secret: { rotated: true } } }));
    const titles = f.map(x => x.title);
    expect(titles.filter(t => t === 'Secret-named field present').length).toBe(2);
  });
  it('flags an AWS access key id', () => {
    const f = scanSensitive(resp({ a: 'AKIAIOSFODNN7EXAMPLE' }));
    expect(f.some(x => x.title === 'AWS access key id')).toBe(true);
  });
});

describe('scanSensitive — PII', () => {
  it('flags an email', () => {
    const f = scanSensitive(resp({ user: { email: 'a.b@example.com' } }));
    const hit = f.find(x => x.title === 'Email address');
    expect(hit).toBeTruthy();
    expect(hit.path).toBe('user.email');
  });
  it('flags only Luhn-valid card numbers', () => {
    expect(scanSensitive(resp({ c: '4242424242424242' })).some(x => x.title === 'Credit-card-like number')).toBe(true);
    expect(scanSensitive(resp({ c: '4242424242424241' })).some(x => x.title === 'Credit-card-like number')).toBe(false);
  });
  it('still flags a Luhn-valid non-card number (documented over-match; over-flagging is the safe direction)', () => {
    // A 16-digit order/sequence id that happens to pass Luhn is flagged like a card.
    expect(scanSensitive(resp({ orderId: '4242424242424242' })).some(x => x.title === 'Credit-card-like number')).toBe(true);
  });
});

describe('scanSensitive — internal/debug', () => {
  it('flags internal/debug field names', () => {
    const f = scanSensitive(resp({ stacktrace: 'at Foo.bar (x.js:1)' }));
    expect(f.some(x => x.title === 'Internal/debug field')).toBe(true);
  });
  it('flags leaky response headers', () => {
    const f = scanSensitive(resp({ ok: true }, { Server: 'nginx/1.2.3', 'X-Powered-By': 'Express' }));
    expect(f.filter(x => x.title === 'Server/version header').length).toBe(2);
    expect(f.find(x => x.title === 'Server/version header').path).toMatch(/^header:/);
  });
});

describe('scanSensitive — config', () => {
  it('returns nothing when the sensitive oracle is disabled', () => {
    expect(scanSensitive(resp({ email: 'a@b.co' }), { ...DEFAULT_ORACLE_CONFIG, sensitive: false })).toEqual([]);
  });
  it('applies a per-group severity override', () => {
    const f = scanSensitive(resp({ email: 'a@b.co' }), { ...DEFAULT_ORACLE_CONFIG, severityOverrides: { pii: 'low' } });
    expect(f.find(x => x.title === 'Email address').severity).toBe('low');
  });
});

describe('scanSensitive — deep nesting (depth guard)', () => {
  // Build a ~200-level-deep object with a leak placed at a shallow level.
  const buildDeep = (depth) => {
    let node = { bottom: true };
    for (let i = 0; i < depth; i++) node = { next: node };
    return node;
  };
  it('does not throw on a pathologically deep body and still finds a shallow leak', () => {
    const deep = buildDeep(200);
    deep.email = 'a.b@example.com';   // leak at the shallow root level
    let f;
    expect(() => { f = scanSensitive(resp(deep)); }).not.toThrow();
    expect(f.some(x => x.title === 'Email address' && x.path === 'email')).toBe(true);
  });
  it('caps recursion silently: a leak past the depth limit is not visited', () => {
    // Place a leak well below WALK_MAX_DEPTH; the guard stops before reaching it.
    let node = { email: 'deep.leak@example.com' };
    for (let i = 0; i < 200; i++) node = { next: node };
    let f;
    expect(() => { f = scanSensitive(resp(node)); }).not.toThrow();
    expect(f.some(x => x.title === 'Email address')).toBe(false);   // capped, not thrown
  });
});

import { inferContract, checkSchema } from '../qa/oracles';

describe('inferContract', () => {
  it('records normalized field paths and types, array indices collapsed', () => {
    const c = inferContract({ id: 1, name: 's', items: [{ x: 1 }, { x: 2 }] });
    expect(c['id'].type).toBe('number');
    expect(c['name'].type).toBe('string');
    expect(c['items[].x'].type).toBe('number');   // [] not [0]/[1]
  });
});

describe('checkSchema', () => {
  const base = inferContract({ id: 1, name: 's' });
  it('flags an undeclared field as low', () => {
    const f = checkSchema({ id: 1, name: 's', extra: true }, base);
    expect(f).toContainEqual(expect.objectContaining({ oracle: 'schema', title: 'Undeclared field', path: 'extra', severity: 'low' }));
  });
  it('flags a missing baseline field as medium', () => {
    const f = checkSchema({ id: 1 }, base);
    expect(f).toContainEqual(expect.objectContaining({ title: 'Missing field', path: 'name', severity: 'medium' }));
  });
  it('flags a type mismatch as medium', () => {
    const f = checkSchema({ id: '1', name: 's' }, base);
    expect(f).toContainEqual(expect.objectContaining({ title: 'Type mismatch', path: 'id', severity: 'medium' }));
  });
  it('returns nothing when body matches the contract', () => {
    expect(checkSchema({ id: 2, name: 't' }, base)).toEqual([]);
  });
  it('returns nothing when the schema oracle is disabled', () => {
    expect(checkSchema({ id: 1, name: 's', extra: 1 }, base, { ...DEFAULT_ORACLE_CONFIG, schema: false })).toEqual([]);
  });
});

import { runOracles, summarizeFindings } from '../qa/oracles';

describe('runOracles', () => {
  const baseline = inferContract({ id: 1 });   // body has only `id`
  it('runs sensitive on any status but schema only on 2xx with a baseline', () => {
    const cell200 = { status: 200, response: { status: 200, body: { id: 1, surprise: 'x' }, headers: {} } };
    const f = runOracles(cell200, { baseline });
    expect(f.some(x => x.oracle === 'schema' && x.title === 'Undeclared field')).toBe(true);

    const cell403 = { status: 403, response: { status: 403, body: { id: 1, surprise: 'x' }, headers: {} } };
    expect(runOracles(cell403, { baseline }).some(x => x.oracle === 'schema')).toBe(false);
  });
  it('cross-bumps an undeclared field that also leaks to high', () => {
    const cell = { status: 200, response: { status: 200, body: { id: 1, email: 'a@b.co' }, headers: {} } };
    const f = runOracles(cell, { baseline });
    const undeclared = f.find(x => x.oracle === 'schema' && x.path === 'email');
    expect(undeclared.severity).toBe('high');   // bumped from low
  });
  it('returns [] when the cell has no response', () => {
    expect(runOracles({ status: null, response: null }, {})).toEqual([]);
  });
  it('does not throw on a pathologically deep body and still finds a shallow leak', () => {
    let node = { bottom: true };
    for (let i = 0; i < 200; i++) node = { next: node };
    node.email = 'a.b@example.com';   // leak at the shallow root level
    const cell = { status: 200, response: { status: 200, body: node, headers: {} } };
    let f;
    expect(() => { f = runOracles(cell, {}); }).not.toThrow();
    expect(f.some(x => x.title === 'Email address' && x.path === 'email')).toBe(true);
  });
});

describe('summarizeFindings', () => {
  it('tallies findings by severity across the grid', () => {
    const results = {
      r1: { a: { findings: [{ severity: 'high' }, { severity: 'low' }] }, b: { findings: [] } },
      r2: { a: { findings: [{ severity: 'high' }] } },
    };
    expect(summarizeFindings(results)).toEqual({ total: 3, bySeverity: { info: 0, low: 1, medium: 0, high: 2, critical: 0 } });
  });
});

import { scanSensitiveLLM } from '../qa/oracles';

describe('ruleId on findings', () => {
  it('sensitive findings carry the rule id', () => {
    const out = scanSensitive({ body: { tok: 'eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4' } });
    expect(out.find(f => f.title === 'JWT in response').ruleId).toBe('jwt');
  });
  it('schema findings carry stable schema:* codes', () => {
    const contract = { 'a': { type: 'string', required: true } };
    const out = checkSchema({ a: 1, b: 2 }, contract);
    expect(out.find(f => f.title === 'Type mismatch').ruleId).toBe('schema:type-mismatch');
    expect(out.find(f => f.title === 'Undeclared field').ruleId).toBe('schema:undeclared');
  });
});

describe('scanSensitiveLLM', () => {
  it('parses a JSON array out of the LLM reply into llm-sourced findings', async () => {
    const fakeLLM = async () => 'Here you go:\n[{"path":"note","title":"SSN in free text","severity":"high"}]';
    const f = await scanSensitiveLLM({ body: { note: 'ssn 078-05-1120' } }, fakeLLM);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ oracle: 'sensitive-data', source: 'llm', path: 'note', severity: 'high' });
  });
  it('returns [] when the reply has no parseable array', async () => {
    expect(await scanSensitiveLLM({ body: { ok: true } }, async () => 'nothing found')).toEqual([]);
  });
  it('coerces an unknown severity to medium', async () => {
    const f = await scanSensitiveLLM({ body: {} }, async () => '[{"path":"x","severity":"spicy"}]');
    expect(f[0].severity).toBe('medium');
  });
  it('wraps an LLM error', async () => {
    await expect(scanSensitiveLLM({ body: {} }, async () => { throw new Error('no key'); })).rejects.toThrow(/LLM scan failed/);
  });
});
