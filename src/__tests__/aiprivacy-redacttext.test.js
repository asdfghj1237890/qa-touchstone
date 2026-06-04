import { describe, it, expect } from 'vitest';
import { buildScrubber, redactText, PRIVACY_DEFAULT_CFG } from '../qa/aiPrivacy.js';

const s = buildScrubber(PRIVACY_DEFAULT_CFG);

describe('redactText heuristics', () => {
  it('masks email', () => { expect(redactText('contact bob@acme.com now', s)).toContain('<email>'); });
  it('masks uuid', () => { expect(redactText('id 550e8400-e29b-41d4-a716-446655440000', s)).toContain('<uuid>'); });
  it('masks ipv4', () => { expect(redactText('from 203.0.113.7', s)).toContain('<ip>'); });
  it('masks a luhn-valid card but NOT a random long number', () => {
    expect(redactText('card 4111111111111111', s)).toContain('<card>');
    expect(redactText('order 1234567890', s)).toContain('1234567890'); // not a card, not masked
  });
  it('does NOT mask a bare status code or timestamp', () => {
    expect(redactText('status 200 at 1717459200', s)).toContain('200');
    expect(redactText('status 200 at 1717459200', s)).toContain('1717459200');
  });
  it('masks denylisted key=value, keeps the key', () => {
    const out = redactText('tenantId=acme-7731 email=x@y.com', s);
    expect(out).toContain('tenantId=');
    expect(out).not.toContain('acme-7731');
  });
  it('masks an SSN', () => { expect(redactText('ssn 123-45-6789 here', s)).toContain('<ssn>'); });
});

describe('redactText custom layers', () => {
  it('honors custom field name and custom regex (invalid regex ignored)', () => {
    const cs = buildScrubber({ ...PRIVACY_DEFAULT_CFG, customFieldNames: ['projectCode'], customPatterns: ['PRJ-\\d+', '([bad'] });
    const out = redactText('projectCode=secret ref PRJ-42', cs);
    expect(out).toContain('projectCode=');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('PRJ-42');
  });
});
