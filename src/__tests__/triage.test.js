// src/__tests__/triage.test.js
import { describe, it, expect } from 'vitest';
import { normalizeFindings, buildTriageInput, TRIAGE_CAP, buildTriagePrompt, parseTriage, runTriage } from '../qa/triage.js';

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

const kept = [
  { engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'Cross-object', path: 'GET /o/{id}', evidence: 'alice→bob', ref: { testId: 't', attackerId: 'a', ownerId: 'b' } },
  { engine: 'matrix', severity: 'high', oracle: 'schema', title: 'Undeclared field', path: 'user.ssn', evidence: '', ref: { reqId: 'r', idId: 'i' } },
];

describe('buildTriagePrompt', () => {
  it('embeds the indexed findings and forbids inventing findings', () => {
    const p = buildTriagePrompt([{ i: 0, severity: 'high', title: 'X' }]);
    expect(p).toContain('Never invent findings');
    expect(p).toContain('"i": 0');
  });
});

describe('parseTriage', () => {
  it('parses a clean object and resolves findingIndexes back to kept findings', () => {
    const raw = JSON.stringify({ headline: '1 worth a look', items: [
      { title: 'IDOR', category: 'object-authz', priority: 'p1', rationale: 'real', findingIndexes: [0], likelyFalsePositive: false }] });
    const out = parseTriage(raw, kept);
    expect(out.headline).toBe('1 worth a look');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].findings[0].ref).toEqual({ testId: 't', attackerId: 'a', ownerId: 'b' });
  });
  it('tolerates ```json fences and surrounding prose', () => {
    const raw = 'Sure!\n```json\n{"headline":"h","items":[{"title":"t","category":"x","priority":"zz","rationale":"r","findingIndexes":[1]}]}\n```';
    const out = parseTriage(raw, kept);
    expect(out.headline).toBe('h');
    expect(out.items[0].category).toBe('other');
    expect(out.items[0].priority).toBe('p3');
    expect(out.items[0].likelyFalsePositive).toBe(false);
  });
  it('drops out-of-range indexes and items left with zero valid refs', () => {
    const raw = JSON.stringify({ headline: 'h', items: [
      { title: 'invented', category: 'other', priority: 'p2', rationale: '', findingIndexes: [99] },
      { title: 'partial', category: 'other', priority: 'p2', rationale: '', findingIndexes: [0, 99] }] });
    const out = parseTriage(raw, kept);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].findings).toHaveLength(1);
  });
  it('returns empty triage on junk', () => {
    expect(parseTriage('not json at all', kept)).toEqual({ headline: '', items: [] });
  });
  it('de-duplicates repeated findingIndexes so the count is not inflated', () => {
    const raw = JSON.stringify({ headline: 'h', items: [
      { title: 'dup', category: 'other', priority: 'p2', rationale: '', findingIndexes: [0, 0, 0] }] });
    const out = parseTriage(raw, kept);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].findings).toHaveLength(1);
  });
});

describe('runTriage', () => {
  const union = [
    { engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'X', path: 'GET /o', evidence: '', ref: { testId: 't' } },
    { engine: 'matrix', severity: 'low', oracle: 'schema', title: 'Y', path: 'a', evidence: '', ref: { reqId: 'r', idId: 'i' } },
  ];
  it('passes the prompt to the injected callLLM and returns parsed + meta', async () => {
    let seenPrompt = '';
    const stub = async (p) => { seenPrompt = p; return JSON.stringify({ headline: 'h', items: [{ title: 't', category: 'object-authz', priority: 'p1', rationale: 'r', findingIndexes: [0] }] }); };
    const out = await runTriage(union, stub);
    expect(seenPrompt).toContain('Never invent findings');
    expect(out.headline).toBe('h');
    expect(out.total).toBe(2);
    expect(out.dropped).toBe(0);
    expect(out.items[0].findings[0].engine).toBe('bola');
  });
  it('short-circuits an empty union without calling the LLM', async () => {
    let called = false;
    const out = await runTriage([], async () => { called = true; return '{}'; });
    expect(called).toBe(false);
    expect(out).toEqual({ headline: '', items: [], dropped: 0, total: 0 });
  });
  it('reports dropped when over the cap', async () => {
    const out = await runTriage(union, async () => '{"headline":"h","items":[]}', { cap: 1 });
    expect(out.dropped).toBe(1);
    expect(out.total).toBe(2);
  });
});
