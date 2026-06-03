// src/__tests__/triage.test.js
import { describe, it, expect } from 'vitest';
import { normalizeFindings, buildTriageInput, TRIAGE_CAP } from '../qa/triage.js';

const f = (severity, over = {}) => ({ severity, oracle: 'schema', title: 'T', path: 'a.b', evidence: 'e', ...over });

describe('normalizeFindings', () => {
  it('tags engine and ref, defaulting evidence to empty string', () => {
    const out = normalizeFindings('bola', [{ severity: 'high', oracle: 'object-authz', title: 'X', path: 'GET /o' }],
      (_finding, i) => ({ testId: 't', i }));
    expect(out).toEqual([{ engine: 'bola', severity: 'high', oracle: 'object-authz', title: 'X', path: 'GET /o', evidence: '', ref: { testId: 't', i: 0 } }]);
  });
  it('returns [] for empty/missing input', () => {
    expect(normalizeFindings('matrix', null, () => ({}))).toEqual([]);
  });
});

describe('buildTriageInput', () => {
  it('sorts by severity desc and assigns stable indexes', () => {
    const union = [f('low'), f('critical'), f('medium')];
    const { input } = buildTriageInput(union);
    expect(input.map(x => x.severity)).toEqual(['critical', 'medium', 'low']);
    expect(input.map(x => x.i)).toEqual([0, 1, 2]);
  });
  it('caps to N keeping highest severity and reports dropped count', () => {
    const union = [f('critical'), f('high'), f('low')];
    const { input, kept, dropped } = buildTriageInput(union, 2);
    expect(input.map(x => x.severity)).toEqual(['critical', 'high']);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
  });
  it('default cap is TRIAGE_CAP', () => {
    expect(TRIAGE_CAP).toBe(150);
  });
});
