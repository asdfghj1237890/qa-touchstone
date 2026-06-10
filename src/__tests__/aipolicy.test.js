import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedAiPolicy, setCachedAiPolicy } from '../qa/aiPolicy';
import { resolvePolicy } from '../qa/aiPrivacy';

describe('aiPolicy cache feeds resolvePolicy', () => {
  beforeEach(() => setCachedAiPolicy(null));
  it('backend externalAllowed=false forces local', () => {
    setCachedAiPolicy({ externalAllowed: false, locked: true });
    expect(resolvePolicy({ mode: 'full' }, getCachedAiPolicy()).effectiveMode).toBe('local');
  });
});
