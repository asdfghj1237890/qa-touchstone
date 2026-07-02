// ── QA Touchstone — RBAC security matrix engine (pure logic, no React) ──────
// Identity × endpoint authorization testing: classify a real HTTP response as
// allowed/denied, compare it against a per-cell expectation, and produce a
// pass/fail/vuln verdict. UI lives in Security.jsx; this file is unit-tested.
import './setup';
import type {
  BolaConfig,
  Endpoint,
  Expectation,
  ExpectMap,
  Identity,
  MatrixCell,
  MatrixConfig,
  MatrixResults,
  MatrixState,
  OracleConfig,
  Outcome,
  QaResponse,
  RateLimitConfig,
  Verdict,
} from './types';

export const SECURITY_STORAGE_KEY = 'qa_security_matrix';
// 404 is included by default: APIs commonly return "not found" instead of 403
// to hide a protected resource's existence, so it counts as a denial. Override
// per matrix (e.g. back to [401, 403]) when a 404 should mean "missing", not "denied".
export const DEFAULT_DENY_SET = [401, 403, 404];

// Endpoints that are high-value for BFLA testing: a mutating method, or an
// admin-ish path token. Used to set smarter default expectations.
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
export const ADMIN_PATH_TOKENS = [
  'admin',
  'internal',
  'manage',
  'management',
  'root',
  'sudo',
  'privileged',
  'superuser',
];

// Heuristically classify an endpoint as privileged. Pure; tolerant of empties.
export function classifyEndpoint(
  method: string | null | undefined,
  path: string | null | undefined
): { privileged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (MUTATING_METHODS.includes(String(method || '').toUpperCase())) reasons.push('write');
  const tokens = String(path || '')
    .toLowerCase()
    .split(/[/._\-?=&]+/)
    .filter(Boolean);
  if (tokens.some((tok) => ADMIN_PATH_TOKENS.includes(tok))) reasons.push('admin-path');
  return { privileged: reasons.length > 0, reasons };
}

// Effective privileged state for an endpoint: a manual boolean override wins,
// otherwise fall back to the heuristic. Only `ep.privileged` is persisted.
export function endpointPrivileged(ep: Partial<Endpoint> | null | undefined): {
  privileged: boolean;
  reasons: string[];
  source: 'manual' | 'auto';
} {
  if (ep && typeof ep.privileged === 'boolean') {
    return { privileged: ep.privileged, reasons: ['manual'], source: 'manual' };
  }
  return { ...classifyEndpoint(ep && ep.method, ep && ep.path), source: 'auto' };
}

// Map a real HTTP status to an authorization outcome.
export function classifyOutcome(
  status: number | null | undefined,
  denySet: number[] = DEFAULT_DENY_SET
): Outcome {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'other';
  if (status >= 200 && status <= 299) return 'allowed';
  if (denySet.includes(status)) return 'denied';
  return 'other';
}

// ── Soft-deny detection ──────────────────────────────────────────────────────
// Many real APIs return HTTP 200 while *denying* the request in the body
// ("soft 403"): `{ "error": "Access denied" }`, `{ "status": "forbidden" }`,
// etc. A status-only oracle reads those as `allowed`, which both raises false
// `vuln`s on deny-cells and, worse, hides a broken allow-cell behind a false
// `pass`. detectSoftDeny inspects a body for a denial/error marker so the
// matrix can classify it correctly.
//
// Precision matters more than recall here (a noisy security scanner gets muted):
//  - Machine status/code fields may carry a *bare* token ("forbidden").
//  - Human prose fields require an unambiguous *phrase* so "Forbidden City" in a
//    title is not mistaken for an authorization denial.
const DENY_TOKEN_RE =
  /^(?:access[_\s-]?denied|denied|forbidden|unauthoriz(?:ed|ation)|unauthoris(?:ed|ation)|permission[_\s-]?denied|not[_\s-]?allowed|insufficient[_\s-]?(?:scope|privilege|permission|role)|login[_\s-]?required|auth(?:entication)?[_\s-]?required)$/i;
const DENY_PHRASE_RE =
  /\b(?:access denied|permission denied|authoriz(?:ation|ed) denied|not authoriz(?:ed|ation)|unauthoriz(?:ed|ation)|unauthoris(?:ed|ation)|you (?:do not|don't) have permission|insufficient (?:permission|permissions|privilege|privileges|scope|scopes|role)|must be logged in|login required|authentication required|not allowed to)\b/i;
const STATUS_FIELD_KEYS = new Set([
  'status',
  'code',
  'result',
  'outcome',
  'errorcode',
  'error_code',
  'reason_code',
]);
const PROSE_FIELD_KEYS = new Set([
  'message',
  'msg',
  'detail',
  'details',
  'title',
  'description',
  'reason',
  'error_description',
  'errordescription',
]);
const ERROR_MARKER_KEYS = new Set(['error', 'errors', 'errorcode', 'error_code']);

function valueDenies(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (DENY_PHRASE_RE.test(v)) return true;
  // `error` is treated as a status field too: `{ "error": "forbidden" }`.
  if ((STATUS_FIELD_KEYS.has(key) || key === 'error') && DENY_TOKEN_RE.test(v)) return true;
  return false;
}

function scanForDenyPhrase(node: unknown, depth: number): boolean {
  if (node == null || depth > 6) return false;
  if (Array.isArray(node)) return node.some((v) => scanForDenyPhrase(v, depth + 1));
  if (typeof node !== 'object') return false;
  for (const [rawKey, value] of Object.entries(node as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (
      (STATUS_FIELD_KEYS.has(key) || PROSE_FIELD_KEYS.has(key) || key === 'error') &&
      valueDenies(key, value)
    )
      return true;
    if (value && typeof value === 'object' && scanForDenyPhrase(value, depth + 1)) return true;
  }
  return false;
}

function isTruthyMarker(v: unknown): boolean {
  if (v == null || v === false || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  if (typeof v === 'number') return v !== 0;
  return true; // non-empty string or true
}

function hasErrorMarker(body: Record<string, unknown>): boolean {
  for (const [rawKey, value] of Object.entries(body)) {
    if (ERROR_MARKER_KEYS.has(rawKey.toLowerCase()) && isTruthyMarker(value)) return true;
  }
  return false;
}

export type SoftOutcome = 'denied' | 'error' | null;
// Inspect a response body for an in-band denial. Returns:
//  'denied' — an unambiguous authorization-denial marker is present (soft 403)
//  'error'  — a generic error marker is present but no auth phrase (ambiguous)
//  null     — looks like a genuine success (caller keeps the status-based outcome)
export function detectSoftDeny(resp: QaResponse | null | undefined): SoftOutcome {
  const body = resp && resp.body;
  if (body == null) return null;
  if (typeof body === 'string')
    return DENY_PHRASE_RE.test(body) || DENY_TOKEN_RE.test(body.trim()) ? 'denied' : null;
  if (typeof body !== 'object') return null;
  if (scanForDenyPhrase(body, 0)) return 'denied';
  if (hasErrorMarker(body as Record<string, unknown>)) return 'error';
  return null;
}

// Body-aware authorization outcome. Trusts a real deny status, but when the
// status is a 2xx it consults the body: a soft-403 becomes `denied`, a generic
// 200-with-error becomes `other` (inconclusive — not a clean grant), and a plain
// success stays `allowed`.
export function classifyResponseOutcome(
  resp: QaResponse | null | undefined,
  denySet: number[] = DEFAULT_DENY_SET
): Outcome {
  const status = resp && typeof resp.status === 'number' ? resp.status : null;
  const base = classifyOutcome(status, denySet);
  if (base !== 'allowed') return base;
  const soft = detectSoftDeny(resp);
  if (soft === 'denied') return 'denied';
  if (soft === 'error') return 'other';
  return 'allowed';
}

// Compare an expectation against an outcome. `deny` that comes back `allowed`
// is the access-control hole we flag as a vulnerability.
export function verdictFor(expectation: Expectation, outcome: Outcome): Verdict | null {
  if (expectation === 'skip') return null;
  if (outcome === 'other') return 'inconclusive';
  if (expectation === 'allow') return outcome === 'allowed' ? 'pass' : 'fail';
  return outcome === 'denied' ? 'pass' : 'vuln'; // expectation === 'deny'
}

// Built-in unauthenticated identity. Seeded into every matrix; not deletable.
export function anonIdentity(): Identity {
  return { id: 'anon', name: 'anon', auth: { type: 'none' } };
}

// Smart default expectation. anon → deny. A privileged endpoint defaults a
// non-privileged identity to deny (the BFLA setup). `endpoint` is optional, so
// one-arg callers keep the legacy anon-only behavior.
export function defaultExpectation(
  identity: Identity | null | undefined,
  endpoint?: Endpoint | null
): Expectation {
  if (identity && identity.auth && identity.auth.type === 'none') return 'deny';
  if (endpoint && endpointPrivileged(endpoint).privileged && !(identity && identity.privileged))
    return 'deny';
  return 'allow';
}

// Return a copy of state whose expect map has an entry for every
// (endpoint, identity) pair, filling missing cells with smart defaults and
// preserving any existing user override.
export function withDefaults(state: MatrixState): MatrixState {
  const expect: ExpectMap = {};
  for (const ep of state.endpoints) {
    const prev = (state.expect && state.expect[ep.reqId]) || {};
    const row: Record<string, Expectation> = {};
    for (const id of state.identities) {
      row[id.id] = prev[id.id] ?? defaultExpectation(id, ep);
    }
    expect[ep.reqId] = row;
  }
  return { ...state, expect };
}

// Bulk-set one identity column across all endpoints.
export function setColumn(
  state: MatrixState,
  identityId: string,
  expectation: Expectation
): MatrixState {
  const expect: ExpectMap = {};
  for (const ep of state.endpoints) {
    expect[ep.reqId] = { ...(state.expect[ep.reqId] || {}), [identityId]: expectation };
  }
  return { ...state, expect };
}

// Bulk-set one endpoint row across all identities.
export function setRow(state: MatrixState, reqId: string, expectation: Expectation): MatrixState {
  const row: Record<string, Expectation> = {};
  for (const id of state.identities) row[id.id] = expectation;
  return { ...state, expect: { ...state.expect, [reqId]: row } };
}

/** runMatrix 注入的執行器：可回傳裸 response 或 { request, response } 包裝。 */
export type MatrixRunner = (
  endpoint: Endpoint,
  identity: Identity
) => Promise<QaResponse | { request?: unknown; response: QaResponse | null } | null | undefined>;

// Run the matrix. `runner(endpoint, identity) => Promise<response>` is injected
// so tests can stub it and the page can plug in the real executor. Streams each
// finished cell via opts.onCell(reqId, identityId, cell). Honors opts.signal.
export async function runMatrix(
  state: MatrixState,
  runner: MatrixRunner,
  opts: {
    signal?: AbortSignal | null;
    onCell?: (reqId: string, identityId: string, cell: MatrixCell) => void;
  } = {}
): Promise<MatrixResults> {
  const { signal, onCell } = opts;
  const denySet = state.denySet || DEFAULT_DENY_SET;
  const results: MatrixResults = {};
  for (const ep of state.endpoints) {
    const row: Record<string, MatrixCell> = results[ep.reqId] ?? {};
    results[ep.reqId] = row;
    for (const id of state.identities) {
      if (signal && signal.aborted) return results;
      const expectation =
        ((state.expect || {})[ep.reqId] || {})[id.id] || defaultExpectation(id, ep);
      if (expectation === 'skip') continue;
      let cell: MatrixCell;
      try {
        // The runner may return a bare response, or a { request, response }
        // wrapper when the caller wants the resolved request captured on the cell.
        const out = await runner(ep, id);
        const wrapped = out && typeof out === 'object' && 'response' in out;
        const resp = wrapped ? out.response : out;
        const request = wrapped ? out.request || null : null;
        const status = resp && typeof resp.status === 'number' ? resp.status : null;
        // Body-aware: a 200 that denies in-band (soft 403) must not read as allowed.
        const outcome = classifyResponseOutcome(resp || null, denySet);
        cell = {
          status,
          outcome,
          verdict: verdictFor(expectation, outcome),
          timeMs: (resp && resp.time) || 0,
          request,
          response: resp || null,
          error: null,
        };
      } catch (e: any) {
        cell = {
          status: null,
          outcome: 'other',
          verdict: 'inconclusive',
          timeMs: 0,
          request: null,
          response: null,
          error: String((e && e.message) || e),
        };
      }
      row[id.id] = cell;
      if (onCell) onCell(ep.reqId, id.id, cell);
    }
  }
  return results;
}

// Tally verdicts across a results grid for the summary chips.
export function summarize(results: MatrixResults): {
  total: number;
  pass: number;
  fail: number;
  vuln: number;
  inconclusive: number;
} {
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
export function loadMatrixConfig(): MatrixConfig | null {
  try {
    const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

export function saveMatrixConfig(state: Partial<MatrixState> | null | undefined): void {
  try {
    const {
      identities = [],
      endpoints = [],
      expect = {},
      denySet = DEFAULT_DENY_SET,
      oracleConfig,
      bola,
      rateLimit,
    } = state || {};
    // Persist only stable identity config — drop transient `_`-prefixed fields
    // (e.g. a fetched `_oauthToken`) so live access tokens are never written to
    // disk; the user re-fetches them in the identity editor after a reload.
    const cleanIdentities = identities.map(({ id, name, auth, privileged }) => ({
      id,
      name,
      auth,
      privileged,
    }));
    const payload: {
      identities: Identity[];
      endpoints: Endpoint[];
      expect: ExpectMap;
      denySet: number[];
      oracleConfig?: OracleConfig;
      bola?: BolaConfig;
      rateLimit?: RateLimitConfig;
    } = { identities: cleanIdentities, endpoints, expect, denySet };
    if (oracleConfig) payload.oracleConfig = oracleConfig;
    if (bola) payload.bola = bola;
    if (rateLimit) payload.rateLimit = rateLimit;
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
