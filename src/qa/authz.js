// ── QA Touchstone — RBAC security matrix engine (pure logic, no React) ──────
// Identity × endpoint authorization testing: classify a real HTTP response as
// allowed/denied, compare it against a per-cell expectation, and produce a
// pass/fail/vuln verdict. UI lives in Security.jsx; this file is unit-tested.
import './setup.js';

export const SECURITY_STORAGE_KEY = 'qa_security_matrix';
// 404 is included by default: APIs commonly return "not found" instead of 403
// to hide a protected resource's existence, so it counts as a denial. Override
// per matrix (e.g. back to [401, 403]) when a 404 should mean "missing", not "denied".
export const DEFAULT_DENY_SET = [401, 403, 404];

// Map a real HTTP status to an authorization outcome.
export function classifyOutcome(status, denySet = DEFAULT_DENY_SET) {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'other';
  if (status >= 200 && status <= 299) return 'allowed';
  if (denySet.includes(status)) return 'denied';
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
      row[id.id] = prev[id.id] ?? defaultExpectation(id);
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

// Run the matrix. `runner(endpoint, identity) => Promise<response>` is injected
// so tests can stub it and the page can plug in the real executor. Streams each
// finished cell via opts.onCell(reqId, identityId, cell). Honors opts.signal.
export async function runMatrix(state, runner, opts = {}) {
  const { signal, onCell } = opts;
  const denySet = state.denySet || DEFAULT_DENY_SET;
  const results = {};
  for (const ep of state.endpoints) {
    results[ep.reqId] = results[ep.reqId] || {};
    for (const id of state.identities) {
      if (signal && signal.aborted) return results;
      const expectation = ((state.expect || {})[ep.reqId] || {})[id.id] || defaultExpectation(id);
      if (expectation === 'skip') continue;
      let cell;
      try {
        // The runner may return a bare response, or a { request, response }
        // wrapper when the caller wants the resolved request captured on the cell.
        const out = await runner(ep, id);
        const wrapped = out && typeof out === 'object' && 'response' in out;
        const resp = wrapped ? out.response : out;
        const request = wrapped ? (out.request || null) : null;
        const status = resp && typeof resp.status === 'number' ? resp.status : null;
        const outcome = classifyOutcome(status, denySet);
        cell = { status, outcome, verdict: verdictFor(expectation, outcome), timeMs: (resp && resp.time) || 0, request, response: resp || null, error: null };
      } catch (e) {
        cell = { status: null, outcome: 'other', verdict: 'inconclusive', timeMs: 0, request: null, response: null, error: String((e && e.message) || e) };
      }
      results[ep.reqId][id.id] = cell;
      if (onCell) onCell(ep.reqId, id.id, cell);
    }
  }
  return results;
}

// Tally verdicts across a results grid for the summary chips.
export function summarize(results) {
  const s = { total: 0, pass: 0, fail: 0, vuln: 0, inconclusive: 0 };
  for (const reqId in results) {
    for (const idId in results[reqId]) {
      const v = results[reqId][idId] && results[reqId][idId].verdict;
      if (!v) continue;
      s.total++;
      if (s[v] !== undefined) s[v]++;
    }
  }
  return s;
}

// Load persisted matrix CONFIG (identities/endpoints/expect/denySet). Results
// are transient and never persisted. Returns null on miss or corrupt data.
export function loadMatrixConfig() {
  try {
    const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
  } catch { return null; }
}

export function saveMatrixConfig(state) {
  try {
    const { identities = [], endpoints = [], expect = {}, denySet = DEFAULT_DENY_SET, oracleConfig, bola } = state || {};
    // Persist only stable identity config — drop transient `_`-prefixed fields
    // (e.g. a fetched `_oauthToken`) so live access tokens are never written to
    // disk; the user re-fetches them in the identity editor after a reload.
    const cleanIdentities = identities.map(({ id, name, auth }) => ({ id, name, auth }));
    const payload = { identities: cleanIdentities, endpoints, expect, denySet };
    if (oracleConfig) payload.oracleConfig = oracleConfig;
    if (bola) payload.bola = bola;
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(payload));
  } catch { /* storage unavailable — non-fatal */ }
}
