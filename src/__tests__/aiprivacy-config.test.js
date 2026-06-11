import { describe, it, expect, beforeEach } from 'vitest';
import { PRIVACY_DEFAULT_CFG, loadPrivacyCfg, savePrivacyCfg } from '../qa/aiPrivacy';

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

  it('migrates a legacy unversioned cfg: renamed mode values are normalized', () => {
    // An older build persisted mode='masked'; the three-mode system calls it 'redacted'.
    localStorage.setItem('qa_ai_privacy', JSON.stringify({ mode: 'masked', lockdown: true }));
    const c = loadPrivacyCfg();
    expect(c.mode).toBe('redacted');
    expect(c.lockdown).toBe(true);
  });

  it('does not leak the internal schema-version field into the returned cfg', () => {
    savePrivacyCfg({ mode: 'local' });
    expect(loadPrivacyCfg()).not.toHaveProperty('__schemaVersion');
  });
});
