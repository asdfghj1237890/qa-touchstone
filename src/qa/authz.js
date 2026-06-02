// ── QA Touchstone — RBAC security matrix engine (pure logic, no React) ──────
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

// Built-in unauthenticated identity. Seeded into every matrix; not deletable.
export function anonIdentity() {
  return { id: 'anon', name: 'anon', auth: { type: 'none' } };
}

// Smart default expectation for an identity: anonymous → deny, otherwise allow.
export function defaultExpectation(identity) {
  return identity && identity.auth && identity.auth.type === 'none' ? 'deny' : 'allow';
}

// Return a copy of state whose expect map has an entry for every
// (endpoint, identity) pair, filling missing cells with smart defaults and
// preserving any existing user override.
export function withDefaults(state) {
  const expect = {};
  for (const ep of state.endpoints) {
    const prev = (state.expect && state.expect[ep.reqId]) || {};
    const row = {};
    for (const id of state.identities) {
      row[id.id] = prev[id.id] || defaultExpectation(id);
    }
    expect[ep.reqId] = row;
  }
  return { ...state, expect };
}

// Bulk-set one identity column across all endpoints.
export function setColumn(state, identityId, expectation) {
  const expect = {};
  for (const ep of state.endpoints) {
    expect[ep.reqId] = { ...(state.expect[ep.reqId] || {}), [identityId]: expectation };
  }
  return { ...state, expect };
}

// Bulk-set one endpoint row across all identities.
export function setRow(state, reqId, expectation) {
  const row = {};
  for (const id of state.identities) row[id.id] = expectation;
  return { ...state, expect: { ...state.expect, [reqId]: row } };
}
