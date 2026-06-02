import { describe, it, expect } from 'vitest';
import { classifyOutcome, verdictFor, DEFAULT_DENY_SET } from '../qa/authz.js';

describe('classifyOutcome', () => {
  it('2xx is allowed', () => {
    expect(classifyOutcome(200)).toBe('allowed');
    expect(classifyOutcome(204)).toBe('allowed');
  });
  it('denySet members are denied (default 401/403)', () => {
    expect(classifyOutcome(401)).toBe('denied');
    expect(classifyOutcome(403)).toBe('denied');
  });
  it('honors a custom denySet (e.g. 404 hides a resource)', () => {
    expect(classifyOutcome(404, [401, 403, 404])).toBe('denied');
    expect(classifyOutcome(404)).toBe('other');
  });
  it('everything else is other, incl. null/NaN (transport error)', () => {
    expect(classifyOutcome(500)).toBe('other');
    expect(classifyOutcome(302)).toBe('other');
    expect(classifyOutcome(null)).toBe('other');
    expect(classifyOutcome(undefined)).toBe('other');
  });
  it('exposes the default deny set', () => {
    expect(DEFAULT_DENY_SET).toEqual([401, 403]);
  });
});

describe('verdictFor', () => {
  it('allow + allowed = pass; allow + denied = fail', () => {
    expect(verdictFor('allow', 'allowed')).toBe('pass');
    expect(verdictFor('allow', 'denied')).toBe('fail');
  });
  it('deny + denied = pass; deny + allowed = vuln', () => {
    expect(verdictFor('deny', 'denied')).toBe('pass');
    expect(verdictFor('deny', 'allowed')).toBe('vuln');
  });
  it('any other outcome = inconclusive', () => {
    expect(verdictFor('allow', 'other')).toBe('inconclusive');
    expect(verdictFor('deny', 'other')).toBe('inconclusive');
  });
  it('skip = null (not run)', () => {
    expect(verdictFor('skip', 'allowed')).toBe(null);
  });
});
