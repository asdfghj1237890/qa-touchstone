// src/__tests__/findings.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FP_VERSION,
  LIFECYCLE_KEY,
  ruleIdOf,
  locationOf,
  locationLabel,
  fnv1a,
  fingerprint,
  snapshotOf,
  scopeHashOf,
  diffRuns,
  gateCount,
  loadLifecycle,
  saveLifecycle,
  upsertRecord,
  loadSnapshots,
  saveSnapshots,
  recordRun,
  pinBaseline,
} from '../qa/findings';

const matrixF = (over = {}) => ({
  engine: 'matrix',
  ruleId: 'jwt',
  severity: 'high',
  title: 'JWT in response',
  path: 'data.token',
  evidence: 'eyJ…',
  method: 'GET',
  endpoint: '/me',
  identityLabel: 'admin',
  ref: { reqId: 'r1', idId: 'admin' },
  ...over,
});

describe('FP_VERSION', () => {
  it('is a positive integer', () => {
    expect(FP_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('ruleIdOf', () => {
  it('prefers explicit ruleId', () => {
    expect(ruleIdOf({ ruleId: 'jwt', oracle: 'sensitive-data' })).toBe('jwt');
  });
  it('falls back to oracle (BOLA/rate-limit have stable oracle ids)', () => {
    expect(ruleIdOf({ oracle: 'object-authz' })).toBe('object-authz');
    expect(ruleIdOf({ oracle: 'rate-limit' })).toBe('rate-limit');
  });
  it('defaults to "unknown" when neither present', () => {
    expect(ruleIdOf({})).toBe('unknown');
  });
});

describe('locationOf', () => {
  it('matrix uses method + endpoint + identity id', () => {
    expect(locationOf(matrixF())).toBe('GET /me @admin');
  });
  it('bola uses test + attacker -> owner', () => {
    expect(
      locationOf({ engine: 'bola', ref: { testId: 't1', attackerId: 'a', ownerId: 'o' } })
    ).toBe('bola:t1:a->o');
  });
  it('ratelimit uses test id', () => {
    expect(locationOf({ engine: 'ratelimit', ref: { testId: 't9' } })).toBe('rl:t9');
  });
});

describe('fingerprint', () => {
  it('is stable when only title or evidence changes', () => {
    const a = fingerprint(matrixF());
    const b = fingerprint(matrixF({ title: 'Different wording', evidence: 'zzz' }));
    expect(b.fp).toBe(a.fp);
  });
  it('changes when ruleId, location, or normalized path changes', () => {
    const base = fingerprint(matrixF()).fp;
    expect(fingerprint(matrixF({ ruleId: 'email' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ endpoint: '/other' })).fp).not.toBe(base);
    expect(fingerprint(matrixF({ path: 'data.secret' })).fp).not.toBe(base);
  });
  it('treats array indices as equal (normalizePath collapses [n])', () => {
    expect(fingerprint(matrixF({ path: 'items[0].token' })).fp).toBe(
      fingerprint(matrixF({ path: 'items[3].token' })).fp
    );
  });
  it('exposes the canonical fpMaterial beside the hash', () => {
    expect(fingerprint(matrixF()).fpMaterial).toBe('matrix|jwt|GET /me @admin|data.token');
  });
});

describe('locationLabel', () => {
  const matrixF = (over = {}) => ({
    engine: 'matrix',
    method: 'GET',
    endpoint: '/me',
    identityLabel: 'admin',
    ref: { reqId: 'r1', idId: 'admin' },
    ...over,
  });
  it('matrix uses method, endpoint, and identity label', () => {
    expect(locationLabel(matrixF())).toBe('GET /me · admin');
  });
  it('matrix omits the identity suffix when identityLabel is absent', () => {
    expect(locationLabel(matrixF({ identityLabel: '' }))).toBe('GET /me');
  });
  it('bola uses a human label with attacker/owner', () => {
    expect(
      locationLabel({ engine: 'bola', ref: { testId: 't1', attackerId: 'a', ownerId: 'o' } })
    ).toBe('BOLA t1 (a→o)');
  });
  it('ratelimit uses a human label with the test id', () => {
    expect(locationLabel({ engine: 'ratelimit', ref: { testId: 't9' } })).toBe('Rate-limit t9');
  });
});

describe('fnv1a', () => {
  it('matches known 32-bit FNV-1a vectors (8-char hex)', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

import { effectiveSeverity } from '../qa/findings';

describe('effectiveSeverity', () => {
  it('returns the finding severity when no override', () => {
    expect(effectiveSeverity({ severity: 'medium' }, undefined)).toBe('medium');
    expect(effectiveSeverity({ severity: 'medium' }, { severityOverride: null })).toBe('medium');
  });
  it('applies a valid override', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'low' })).toBe('low');
  });
  it('ignores an invalid override value', () => {
    expect(effectiveSeverity({ severity: 'high' }, { severityOverride: 'bogus' })).toBe('high');
  });
});

const lc = (records = {}) => ({ fpVersion: FP_VERSION, records });

describe('snapshotOf', () => {
  it('keys items by fingerprint and counts collapsed occurrences', () => {
    const union = [matrixF({ path: 'items[0].token' }), matrixF({ path: 'items[1].token' })];
    const snap = snapshotOf(union, lc(), { runId: 'run1', createdAt: 'T', scopeHash: 'sh' });
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].count).toBe(2);
    expect(snap.runId).toBe('run1');
    expect(snap.scopeHash).toBe('sh');
  });
  it('records effective severity using lifecycle overrides', () => {
    const fp = fingerprint(matrixF()).fp;
    const snap = snapshotOf([matrixF()], lc({ [fp]: { severityOverride: 'low' } }), {});
    expect(snap.items[0].effectiveSeverity).toBe('low');
  });
  it('snapshot items have the expected key set', () => {
    const snap = snapshotOf([matrixF()], lc(), {});
    const item = snap.items[0];
    expect(Object.keys(item).sort()).toEqual([
      'count',
      'dfp',
      'effectiveSeverity',
      'engine',
      'evidence',
      'fp',
      'locationLabel',
      'path',
      'ruleId',
      'title',
    ]);
  });
});

import { canonicalRuleId, detailHash, diffDetail, RULE_ALIASES } from '../qa/findings';

describe('canonicalRuleId — rule-rename robustness', () => {
  it('returns the id unchanged when it has no alias', () => {
    expect(canonicalRuleId('jwt')).toBe('jwt');
    expect(canonicalRuleId('object-authz')).toBe('object-authz');
  });
  it('maps a renamed rule id onto its canonical id via the alias registry', () => {
    expect(RULE_ALIASES['jwt-in-response']).toBe('jwt');
    expect(canonicalRuleId('jwt-in-response')).toBe('jwt');
  });
});

describe('fingerprint — survives a documented rule rename', () => {
  it('a renamed rule keeps the same fingerprint as its canonical id (baseline diff no longer breaks)', () => {
    const canonical = fingerprint(matrixF({ ruleId: 'jwt' })).fp;
    const renamed = fingerprint(matrixF({ ruleId: 'jwt-in-response' })).fp;
    expect(renamed).toBe(canonical);
  });
  it('still keeps fpMaterial identical for a non-aliased id (no baseline invalidation)', () => {
    expect(fingerprint(matrixF()).fpMaterial).toBe('matrix|jwt|GET /me @admin|data.token');
  });
});

describe('detailHash — title + evidence drift dimension', () => {
  it('changes when evidence changes (e.g. a rotated JWT)', () => {
    expect(detailHash(matrixF({ evidence: 'eyJ…aaa' }))).not.toBe(
      detailHash(matrixF({ evidence: 'eyJ…bbb' }))
    );
  });
  it('changes when the title changes', () => {
    expect(detailHash(matrixF({ title: 'A' }))).not.toBe(detailHash(matrixF({ title: 'B' })));
  });
  it('is stable for identical title + evidence', () => {
    expect(detailHash(matrixF())).toBe(detailHash(matrixF()));
  });
});

describe('diffDetail — carried findings whose evidence drifted', () => {
  it('flags a carried fp whose detail hash changed, but not an unchanged one', () => {
    const cur = [
      { fp: 'a', dfp: 'x2' },
      { fp: 'b', dfp: 'y' },
    ];
    const base = [
      { fp: 'a', dfp: 'x1' },
      { fp: 'b', dfp: 'y' },
    ];
    const changed = diffDetail(cur, base);
    expect(changed.has('a')).toBe(true); // same finding, evidence rotated
    expect(changed.has('b')).toBe(false); // unchanged
  });
  it('does not flag a brand-new finding (no baseline counterpart)', () => {
    expect(diffDetail([{ fp: 'n', dfp: 'z' }], []).has('n')).toBe(false);
  });
});

describe('snapshotOf enrichment (title + evidence)', () => {
  it('copies title and masked evidence into snapshot items', () => {
    const union = [
      {
        engine: 'matrix',
        ruleId: 'jwt',
        severity: 'high',
        title: 'JWT in response',
        path: 'data.token',
        evidence: 'eyJ…<redacted>…0',
        method: 'GET',
        endpoint: '/me',
        identityLabel: 'admin',
        ref: { reqId: 'r1', idId: 'admin' },
      },
    ];
    const snap = snapshotOf(union, lc(), {});
    expect(snap.items[0].title).toBe('JWT in response');
    expect(snap.items[0].evidence).toBe('eyJ…<redacted>…0');
  });
  it('defaults title/evidence to empty string when absent', () => {
    const union = [
      {
        engine: 'bola',
        oracle: 'object-authz',
        severity: 'high',
        path: 'GET /o',
        ref: { testId: 't1', attackerId: 'a', ownerId: 'o' },
      },
    ];
    const snap = snapshotOf(union, lc(), {});
    expect(snap.items[0].title).toBe('');
    expect(snap.items[0].evidence).toBe('');
  });
});

describe('scopeHashOf', () => {
  it('is stable for the same descriptor and changes when it changes', () => {
    const a = scopeHashOf({ endpoints: ['r1', 'r2'], identities: ['admin'] });
    const b = scopeHashOf({ endpoints: ['r1', 'r2'], identities: ['admin'] });
    const c = scopeHashOf({ endpoints: ['r1'], identities: ['admin'] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

const item = (fp, sev = 'high') => ({ fp, effectiveSeverity: sev });

describe('diffRuns', () => {
  it('labels new / carried / resolved', () => {
    const cur = [item('a'), item('b')];
    const base = [item('b'), item('c')];
    const d = diffRuns(cur, base);
    expect(d.get('a')).toBe('new');
    expect(d.get('b')).toBe('carried');
    expect(d.get('c')).toBe('resolved');
  });
  it('treats everything as new when there is no baseline', () => {
    const d = diffRuns([item('a'), item('b')], []);
    expect(d.get('a')).toBe('new');
    expect(d.get('b')).toBe('new');
  });
  it('auto-reopens: a fp present in current is never stuck "resolved"', () => {
    // Even if this fp was resolved against some older baseline, diffing the
    // CURRENT run against a baseline that lacks it yields "new" (live again).
    const d = diffRuns([item('x')], [item('y')]);
    expect(d.get('x')).toBe('new'); // x is live -> new, never stuck resolved
    expect(d.get('y')).toBe('resolved'); // y absent from current
  });
});

describe('gateCount', () => {
  const cur = [item('a', 'critical'), item('b', 'high'), item('c', 'low'), item('d', 'high')];
  it('counts only NEW findings with effective severity >= high, not suppressed', () => {
    const diff = diffRuns(cur, [item('d')]); // d is carried; a,b,c new
    const lifecycle = lc({ b: { suppressed: true } });
    // a(critical,new) counts; b(high,new but suppressed) excluded; c(low) excluded; d(carried) excluded.
    expect(gateCount(cur, lifecycle, diff)).toBe(1);
  });
  it('with no baseline (all new), counts every high/critical not suppressed', () => {
    const diff = diffRuns(cur, []);
    expect(gateCount(cur, lc(), diff)).toBe(3); // a, b, d
  });
});

describe('lifecycle storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty versioned store when nothing is saved', () => {
    expect(loadLifecycle()).toEqual({ fpVersion: FP_VERSION, records: {}, legacy: null });
  });
  it('tolerates corrupt JSON without throwing', () => {
    localStorage.setItem(LIFECYCLE_KEY, '{ not json');
    expect(loadLifecycle()).toEqual({ fpVersion: FP_VERSION, records: {}, legacy: null });
  });
  it('round-trips records through save/load', () => {
    const s = upsertRecord(loadLifecycle(), 'fp1', { suppressed: true, note: 'n' }, '2026-01-01');
    saveLifecycle(s);
    const back = loadLifecycle();
    expect(back.records.fp1.suppressed).toBe(true);
    expect(back.records.fp1.note).toBe('n');
    expect(back.records.fp1.status).toBe('open'); // default filled by upsert
  });
  it('quarantines records from an older fpVersion as legacy (never dropped)', () => {
    localStorage.setItem(
      LIFECYCLE_KEY,
      JSON.stringify({ fpVersion: 0, records: { oldfp: { note: 'x' } } })
    );
    const s = loadLifecycle();
    expect(s.records).toEqual({});
    expect(s.legacy).toEqual({ fpVersion: 0, records: { oldfp: { note: 'x' } } });
  });
});

describe('snapshot storage', () => {
  beforeEach(() => localStorage.clear());
  const snap = (fp) => ({ runId: 'r', createdAt: 'T', scopeHash: 'sh', items: [item(fp)] });

  it('defaults to null baseline/lastRun', () => {
    expect(loadSnapshots()).toEqual({ fpVersion: FP_VERSION, baseline: null, lastRun: null });
  });
  it('recordRun sets lastRun without touching baseline', () => {
    let s = pinBaseline(loadSnapshots(), snap('base'));
    s = recordRun(s, snap('latest'));
    expect(s.baseline.items[0].fp).toBe('base');
    expect(s.lastRun.items[0].fp).toBe('latest');
  });
  it('pinBaseline sets baseline without touching lastRun', () => {
    let s = recordRun(loadSnapshots(), snap('latest'));
    s = pinBaseline(s, snap('pinned'));
    expect(s.lastRun.items[0].fp).toBe('latest');
    expect(s.baseline.items[0].fp).toBe('pinned');
  });
  it('round-trips through save/load', () => {
    saveSnapshots(pinBaseline(loadSnapshots(), snap('base')));
    expect(loadSnapshots().baseline.items[0].fp).toBe('base');
  });
});
