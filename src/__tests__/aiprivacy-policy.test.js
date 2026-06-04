import { describe, it, expect } from 'vitest';
import { resolvePolicy, assertEgressAllowed, EgressBlockedError, classifyDestination } from '../qa/aiPrivacy.js';

const cfg = (m, extra = {}) => ({ mode: m, lockdown: false, selfManagedAttested: false, customFieldNames: [], customPatterns: [], ...extra });

describe('resolvePolicy precedence', () => {
  it('uses the user mode when nothing overrides', () => {
    expect(resolvePolicy(cfg('full'), null).effectiveMode).toBe('full');
  });
  it('lockdown toggle forces local', () => {
    const p = resolvePolicy(cfg('full', { lockdown: true }), null);
    expect(p.effectiveMode).toBe('local');
    expect(p.locked).toBe(true);
  });
  it('backend disable beats user mode', () => {
    const p = resolvePolicy(cfg('full'), { externalAllowed: false, locked: true });
    expect(p.effectiveMode).toBe('local');
    expect(p.source).toBe('backend');
  });
});

describe('assertEgressAllowed', () => {
  const openai = classifyDestination({ provider: 'openai' });
  const local = classifyDestination({ provider: 'custom', baseUrl: 'http://localhost:11434' });
  const publicCustom = classifyDestination({ provider: 'custom', baseUrl: 'https://llm.acme.com' });
  it('redacted allows cloud', () => { expect(() => assertEgressAllowed('redacted', openai, cfg('redacted'))).not.toThrow(); });
  it('local blocks cloud', () => { expect(() => assertEgressAllowed('local', openai, cfg('local'))).toThrow(EgressBlockedError); });
  it('local allows loopback', () => { expect(() => assertEgressAllowed('local', local, cfg('local'))).not.toThrow(); });
  it('local blocks public custom unless attested', () => {
    expect(() => assertEgressAllowed('local', publicCustom, cfg('local'))).toThrow();
    expect(() => assertEgressAllowed('local', publicCustom, cfg('local', { selfManagedAttested: true }))).not.toThrow();
  });
});
