import { describe, it, expect } from 'vitest';
import { SEVERITY_ORDER, redact, worstSeverity } from '../qa/oracles.js';

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
