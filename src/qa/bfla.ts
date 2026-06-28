// ── QA Touchstone — function-level authz (BFLA) engine (pure logic) ──────────
// OWASP API5: a lower-privilege identity must not be able to invoke a higher-
// privilege FUNCTION. The full matrix can express this cell-by-cell; this engine
// auto-derives the high-value subset — every privileged endpoint × every
// non-privileged identity, expectation deny — so a user gets a one-click BFLA
// scan without hand-building a matrix. It composes the shared authz primitives
// (privileged detection + soft-deny-aware classification), it does not re-derive
// them. UI builds + executes; this module decides the plan and the verdicts.
import './setup';
import {
  endpointPrivileged,
  classifyResponseOutcome,
  MUTATING_METHODS,
  DEFAULT_DENY_SET,
} from './authz';
import type { Endpoint, Finding, Identity, QaResponse, Severity, Verdict } from './types';

export interface BflaPair {
  endpoint: Endpoint;
  identity: Identity;
  expectation: 'deny';
}

function isPrivilegedIdentity(id: Identity | null | undefined): boolean {
  return !!(id && id.privileged === true);
}

// Derive the BFLA plan: privileged endpoints crossed with non-privileged
// identities (the only pairs where reaching the function is a violation).
export function bflaPlan(
  endpoints: Endpoint[] | null | undefined,
  identities: Identity[] | null | undefined
): BflaPair[] {
  const plan: BflaPair[] = [];
  for (const ep of endpoints || []) {
    if (!endpointPrivileged(ep).privileged) continue;
    for (const id of identities || []) {
      if (isPrivilegedIdentity(id)) continue; // a privileged identity is allowed — not the attacker
      plan.push({ endpoint: ep, identity: id, expectation: 'deny' });
    }
  }
  return plan;
}

// Verdict for a privileged call by a non-privileged identity. Body-aware: a 200
// soft-403 counts as a (correct) denial, not a hole.
export function classifyBfla(
  resp: QaResponse | null | undefined,
  denySet: number[] = DEFAULT_DENY_SET
): Verdict {
  const outcome = classifyResponseOutcome(resp || null, denySet);
  if (outcome === 'allowed') return 'vuln'; // reached a privileged function — BFLA hole
  if (outcome === 'denied') return 'pass';
  return 'inconclusive';
}

export function bflaSeverity(
  method: string | null | undefined,
  verdict: Verdict | string | null | undefined
): Severity | null {
  if (verdict !== 'vuln') return null;
  return MUTATING_METHODS.includes(String(method).toUpperCase()) ? 'critical' : 'high';
}

export function bflaFinding(
  endpoint: Endpoint,
  identity: Identity,
  verdict: Verdict | string
): Finding | null {
  const severity = bflaSeverity(endpoint && endpoint.method, verdict);
  if (!severity) return null;
  return {
    oracle: 'bfla',
    ruleId: 'bfla',
    severity,
    title: 'Broken function-level authorization',
    path: `${endpoint.method} ${endpoint.path}`,
    evidence: `${identity.name || identity.id} (non-privileged) invoked a privileged function`,
    source: 'rule',
  };
}

export interface BflaResultCell {
  endpoint: Endpoint;
  identity: Identity;
  status: number | null;
  verdict: Verdict;
  severity: Severity | null;
  finding: Finding | null;
  response: QaResponse | null;
  error: string | null;
}

/** runBfla 注入的執行器：runner(endpoint, identity) => Promise<resp>。 */
export type BflaRunner = (
  endpoint: Endpoint,
  identity: Identity
) => Promise<QaResponse | null | undefined>;

// Run the derived plan through the injected runner. Streams each finished cell via
// opts.onCell and returns the collected cells + findings. Honors opts.signal.
export async function runBfla(
  endpoints: Endpoint[] | null | undefined,
  identities: Identity[] | null | undefined,
  runner: BflaRunner,
  opts: {
    signal?: AbortSignal | null;
    denySet?: number[];
    onCell?: (cell: BflaResultCell) => void;
  } = {}
): Promise<{ results: BflaResultCell[]; findings: Finding[] }> {
  const { signal, onCell } = opts;
  const denySet = opts.denySet || DEFAULT_DENY_SET;
  const results: BflaResultCell[] = [];
  const findings: Finding[] = [];
  for (const pair of bflaPlan(endpoints, identities)) {
    if (signal && signal.aborted) return { results, findings };
    let cell: BflaResultCell;
    try {
      const resp = await runner(pair.endpoint, pair.identity);
      const status = resp && typeof resp.status === 'number' ? resp.status : null;
      const verdict = classifyBfla(resp || null, denySet);
      const severity = bflaSeverity(pair.endpoint.method, verdict);
      const finding = bflaFinding(pair.endpoint, pair.identity, verdict);
      cell = {
        endpoint: pair.endpoint,
        identity: pair.identity,
        status,
        verdict,
        severity,
        finding,
        response: resp || null,
        error: null,
      };
    } catch (e: any) {
      cell = {
        endpoint: pair.endpoint,
        identity: pair.identity,
        status: null,
        verdict: 'inconclusive',
        severity: null,
        finding: null,
        response: null,
        error: String((e && e.message) || e),
      };
    }
    results.push(cell);
    if (cell.finding) findings.push(cell.finding);
    if (onCell) onCell(cell);
  }
  return { results, findings };
}
