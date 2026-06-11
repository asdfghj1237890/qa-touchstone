// src/__tests__/fuzz.test.js
import { describe, it, expect } from 'vitest';
import {
  FUZZ_PAYLOADS, fuzzCasesFor, classifyFuzzResponse, fuzzFinding, runFuzz,
} from '../qa/fuzz';

describe('FUZZ_PAYLOADS', () => {
  it('includes the staple boundary + injection payloads', () => {
    const ids = FUZZ_PAYLOADS.map(p => p.id);
    expect(ids).toEqual(expect.arrayContaining(['empty', 'long', 'sqli', 'xss', 'path-traversal']));
  });
  it('marks dangerous payloads so reflection can be judged', () => {
    expect(FUZZ_PAYLOADS.find(p => p.id === 'xss').dangerous).toBe('xss');
    expect(FUZZ_PAYLOADS.find(p => p.id === 'empty').dangerous).toBeFalsy();
  });
});

describe('fuzzCasesFor', () => {
  it('expands a seed into one case per payload, carrying the seed location', () => {
    const cases = fuzzCasesFor({ name: 'id', location: { kind: 'query', key: 'id' }, value: '1' });
    expect(cases.length).toBe(FUZZ_PAYLOADS.length);
    expect(cases[0]).toMatchObject({ seedName: 'id', location: { kind: 'query', key: 'id' } });
    expect(cases.every(c => 'payload' in c)).toBe(true);
  });
});

describe('classifyFuzzResponse', () => {
  const p = (id) => FUZZ_PAYLOADS.find(x => x.id === id);
  it('flags a 5xx as a server error (the fuzz input broke the endpoint)', () => {
    expect(classifyFuzzResponse(p('long'), { status: 500, body: '' })).toMatchObject({ signal: 'server-error', severity: 'high' });
  });
  it('flags a leaked stack trace / SQL error regardless of status', () => {
    expect(classifyFuzzResponse(p('sqli'), { status: 200, body: 'You have an error in your SQL syntax near ...' }).signal).toBe('error-leak');
    expect(classifyFuzzResponse(p('xss'), { status: 200, body: 'Traceback (most recent call last):' }).signal).toBe('error-leak');
  });
  it('flags reflected dangerous input (XSS echoed back) as high', () => {
    const r = classifyFuzzResponse(p('xss'), { status: 200, body: '<div><script>alert(1)</script></div>' });
    expect(r).toMatchObject({ signal: 'reflected', severity: 'high' });
  });
  it('does not flag a clean, well-handled response', () => {
    expect(classifyFuzzResponse(p('sqli'), { status: 400, body: { error: 'invalid id' } }).signal).toBe('ok');
  });
  it('does not call an echoed BENIGN payload a reflection vuln', () => {
    expect(classifyFuzzResponse(p('empty'), { status: 200, body: '' }).signal).toBe('ok');
  });
});

describe('fuzzFinding', () => {
  const meta = { method: 'GET', path: '/items' };
  it('produces a fuzz finding for a server error', () => {
    const f = fuzzFinding(meta, { seedName: 'id', payload: FUZZ_PAYLOADS.find(p => p.id === 'long') }, { status: 500, body: '' });
    expect(f).toMatchObject({ oracle: 'fuzz', ruleId: 'fuzz:server-error', severity: 'high', path: 'GET /items' });
  });
  it('returns null when the response is clean', () => {
    expect(fuzzFinding(meta, { seedName: 'id', payload: FUZZ_PAYLOADS.find(p => p.id === 'sqli') }, { status: 200, body: { ok: true } })).toBeNull();
  });
});

describe('runFuzz', () => {
  const plan = { method: 'GET', path: '/items', seeds: [{ name: 'id', location: { kind: 'query', key: 'id' }, value: '1' }] };
  it('runs every case through the injected runner and collects findings', async () => {
    // The runner 500s only on the long payload; everything else is clean.
    const runner = (seed, payload) => Promise.resolve(payload.id === 'long' ? { status: 500, body: '' } : { status: 200, body: { ok: true } });
    const { findings, ran } = await runFuzz(plan, runner, {});
    expect(ran).toBe(FUZZ_PAYLOADS.length);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('fuzz:server-error');
  });
  it('stops launching when aborted', async () => {
    const c = new AbortController(); c.abort();
    let calls = 0;
    await runFuzz(plan, () => { calls++; return Promise.resolve({ status: 200, body: {} }); }, { signal: c.signal });
    expect(calls).toBe(0);
  });
});
