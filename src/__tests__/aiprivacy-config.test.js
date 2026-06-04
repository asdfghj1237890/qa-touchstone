import { describe, it, expect, beforeEach } from 'vitest';
import { PRIVACY_DEFAULT_CFG, loadPrivacyCfg, savePrivacyCfg } from '../qa/aiPrivacy.js';

describe('privacy config', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to redacted when absent', () => {
    expect(loadPrivacyCfg().mode).toBe('redacted');
    expect(PRIVACY_DEFAULT_CFG.mode).toBe('redacted');
  });
  it('round-trips a saved cfg and fills missing fields', () => {
    savePrivacyCfg({ mode: 'local', lockdown: true });
    const c = loadPrivacyCfg();
    expect(c.mode).toBe('local');
    expect(c.lockdown).toBe(true);
    expect(Array.isArray(c.customFieldNames)).toBe(true);
  });
  it('survives corrupt storage', () => {
    localStorage.setItem('qa_ai_privacy', '{not json');
    expect(loadPrivacyCfg().mode).toBe('redacted');
  });
});
