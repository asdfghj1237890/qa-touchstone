import { describe, it, expect } from 'vitest';
import { normalizeCoreFindings } from '../coreFindings';

describe('normalizeCoreFindings', () => {
  it('maps a matrix finding to a UnionFinding', () => {
    const [u] = normalizeCoreFindings([
      {
        engine: 'matrix',
        severity: 'high',
        rule_id: 'matrix.deny-bypass',
        oracle: 'matrix-cell',
        title: 'Access-control bypass',
        path: 'GET getU',
        evidence: 'identity `anon` reached `GET getU`',
        method: 'GET',
        endpoint: 'getU',
        identity: 'anon',
      },
    ]);
    expect(u).toEqual({
      engine: 'matrix',
      ruleId: 'matrix.deny-bypass',
      severity: 'high',
      oracle: 'matrix-cell',
      title: 'Access-control bypass',
      path: 'GET getU',
      evidence: 'identity `anon` reached `GET getU`',
      method: 'GET',
      endpoint: 'getU',
      identityLabel: 'anon',
      ref: { reqId: 'getU', idId: 'anon' },
      raw: null,
    });
  });

  it('maps core engine "oracle" to the TS matrix view', () => {
    const [u] = normalizeCoreFindings([
      {
        engine: 'oracle',
        severity: 'medium',
        rule_id: 'oracle.sensitive.pii',
        oracle: 'sensitive',
        title: 'PII in response',
        path: 'GET getU',
        evidence: 'redacted',
      },
    ]);
    expect(u).toMatchObject({ engine: 'matrix', oracle: 'sensitive' });
  });
});
