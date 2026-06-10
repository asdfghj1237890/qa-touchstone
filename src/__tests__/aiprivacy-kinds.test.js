import { describe, it, expect } from 'vitest';
import { AI_KINDS, buildScrubber, PRIVACY_DEFAULT_CFG } from '../qa/aiPrivacy';

const ctxR = { scrubber: buildScrubber(PRIVACY_DEFAULT_CFG), mode: 'redacted' };
const ctxF = { scrubber: buildScrubber(PRIVACY_DEFAULT_CFG), mode: 'full' };

describe('AI_KINDS response-review', () => {
  const payload = { method: 'GET', url: 'https://api.acme.com/users/42831?token=abc', status: 200, statusText: 'OK', time: 12, expected: ['status is 200'], body: { email: 'a@b.com' }, headers: {} };
  it('redacted: url host + body value gone, but prompt still has shape', () => {
    const prompt = AI_KINDS['response-review'].buildPrompt(AI_KINDS['response-review'].redact(payload, ctxR));
    expect(prompt).not.toContain('api.acme.com');
    expect(prompt).not.toContain('a@b.com');
    expect(prompt).toContain('/users/{id}');
    expect(prompt).toContain('status is 200');
  });
  it('full: sends raw body + url', () => {
    const prompt = AI_KINDS['response-review'].buildPrompt(AI_KINDS['response-review'].redact(payload, ctxF));
    expect(prompt).toContain('api.acme.com');
    expect(prompt).toContain('a@b.com');
  });
});

describe('AI_KINDS testgen / triage / sensitive-scan', () => {
  it('testgen openapi drops servers', () => {
    const p = AI_KINDS['testgen'].buildPrompt(AI_KINDS['testgen'].redact({ source: 'openapi', input: JSON.stringify({ servers: [{ url: 'https://x.acme.com' }], paths: {} }) }, ctxR));
    expect(p).not.toContain('x.acme.com');
  });
  it('triage redacts evidence text', () => {
    const p = AI_KINDS['triage'].buildPrompt(AI_KINDS['triage'].redact({ input: [{ i: 0, title: 't', evidence: 'leak a@b.com', path: 'a.b' }] }, ctxR));
    expect(p).not.toContain('a@b.com');
  });
  it('sensitive-scan redacted sends structure (keys) not values', () => {
    const p = AI_KINDS['sensitive-scan'].buildPrompt(AI_KINDS['sensitive-scan'].redact({ body: { ssn: '123-45-6789' }, headers: {} }, ctxR));
    expect(p).toContain('ssn');
    expect(p).not.toContain('123-45-6789');
  });
});
