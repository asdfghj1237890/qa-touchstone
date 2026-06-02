// ── QA Companion — RBAC security matrix engine (pure logic, no React) ──────
// Identity × endpoint authorization testing: classify a real HTTP response as
// allowed/denied, compare it against a per-cell expectation, and produce a
// pass/fail/vuln verdict. UI lives in Security.jsx; this file is unit-tested.
import './setup.js';

export const SECURITY_STORAGE_KEY = 'qa_security_matrix';
export const DEFAULT_DENY_SET = [401, 403];

// Map a real HTTP status to an authorization outcome.
export function classifyOutcome(status, denySet = DEFAULT_DENY_SET) {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'other';
  if (status >= 200 && status <= 299) return 'allowed';
  if ((denySet || DEFAULT_DENY_SET).includes(status)) return 'denied';
  return 'other';
}

// Compare an expectation against an outcome. `deny` that comes back `allowed`
// is the access-control hole we flag as a vulnerability.
export function verdictFor(expectation, outcome) {
  if (expectation === 'skip') return null;
  if (outcome === 'other') return 'inconclusive';
  if (expectation === 'allow') return outcome === 'allowed' ? 'pass' : 'fail';
  return outcome === 'denied' ? 'pass' : 'vuln';   // expectation === 'deny'
}
