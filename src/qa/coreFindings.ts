// Normalizes core Finding JSON (src-tauri/core/src/security/finding.rs) into the
// desktop's UnionFinding render model. Slice 1: matrix + oracle findings only.
import type { EngineId, Severity, UnionFinding } from './types';

/** The core Finding JSON shape returned by run_security_matrix. */
export interface CoreFinding {
  engine: string;
  severity: string;
  rule_id: string;
  oracle: string;
  title: string;
  path: string;
  evidence: string;
  method?: string;
  endpoint?: string;
  identity?: string;
}

/** Map core EngineId strings → TS EngineId. Core 'oracle' surfaces in the matrix
 *  view (as oracle findings do today); everything else is 1:1. */
function mapEngine(engine: string): EngineId {
  if (engine === 'oracle') return 'matrix';
  return engine as EngineId;
}

export function normalizeCoreFindings(findings: CoreFinding[]): UnionFinding[] {
  return findings.map((f) => ({
    engine: mapEngine(f.engine),
    ruleId: f.rule_id,
    severity: f.severity as Severity,
    oracle: f.oracle,
    title: f.title,
    path: f.path,
    evidence: f.evidence,
    method: f.method,
    endpoint: f.endpoint,
    identityLabel: f.identity,
    ref: { reqId: f.endpoint, idId: f.identity },
    raw: null,
  }));
}
