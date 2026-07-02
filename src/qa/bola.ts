// ── QA Touchstone — object-level authz (BOLA/IDOR) engine (pure logic) ──────
// Mutate a request's object id, run a reference + attacker×owner attack pass,
// and confirm cross-object access by content. UI lives in BolaPanel.jsx.
import './setup';
import { walkJson } from './oracles';
// Single source of truth lives in the matrix engine; re-exported for callers.
import { MUTATING_METHODS } from './authz';
import { syntheticIdFor } from './bolaSetup';
import type {
  BolaAttackCell,
  BolaControl,
  BolaIdLocation,
  BolaRefCell,
  BolaRequestMeta,
  BolaResults,
  BolaTest,
  BolaTestResult,
  BolaVerdict,
  Finding,
  Identity,
  QaResponse,
  Severity,
} from './types';

export const MATCH_THRESHOLD = 0.6;
export { MUTATING_METHODS };

/** applyIdLocation 操作的最小 request 形狀（buildReq 輸出的子集）。 */
type BolaMutableRequest = {
  url?: string;
  params?: Array<{ key: string; value: string; on?: boolean }>;
  body?: string | null;
  _idApplied?: boolean;
  [k: string]: unknown;
};

// Return a copy of `req` with the object id at `idLocation` overwritten by
// `value`. Never mutates `req`. Sets `_idApplied` to whether it took effect.
export function applyIdLocation(
  req: BolaMutableRequest,
  idLocation: BolaIdLocation | null | undefined,
  value: unknown
): BolaMutableRequest {
  const out: BolaMutableRequest = { ...req, params: (req.params || []).map((p) => ({ ...p })) };
  const v = String(value);
  if (!idLocation) {
    out._idApplied = false;
    return out;
  }
  if (idLocation.kind === 'path') {
    // Expects the RELATIVE built-request URL (as produced by buildReq, which
    // strips the query and does not prepend baseUrl); an absolute
    // `https://host/...` URL would treat the scheme as a path segment.
    const [pathPart = '', queryPart] = String(out.url || '').split('?');
    const segs = pathPart.split('/');
    let seen = -1,
      applied = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '') continue;
      seen++;
      if (seen === idLocation.index) {
        segs[i] = v;
        applied = true;
        break;
      }
    }
    out.url = segs.join('/') + (queryPart ? '?' + queryPart : '');
    out._idApplied = applied;
  } else if (idLocation.kind === 'query') {
    const existing = out.params!.find((p) => p.key === idLocation.key);
    if (existing) {
      existing.value = v;
      existing.on = true;
    } else out.params!.push({ key: idLocation.key, value: v, on: true });
    out._idApplied = true;
  } else if (idLocation.kind === 'body') {
    out._idApplied = false;
    try {
      const obj = JSON.parse(out.body || 'null');
      // Writes the ORIGINAL `value` (preserving JSON number/bool type) rather
      // than the stringified `v` used for path/query segments (URLs are text).
      if (obj && typeof obj === 'object' && setAtPath(obj, idLocation.path, value)) {
        out.body = JSON.stringify(obj);
        out._idApplied = true;
      }
    } catch {
      /* non-JSON body — leave unchanged */
    }
  } else {
    out._idApplied = false;
  }
  return out;
}

// Set value at a dot/bracket path only if every parent exists. Returns success.
function setAtPath(obj: any, path: string, value: unknown): boolean {
  const keys = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (!keys.length) return false;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === undefined || cur == null || typeof cur !== 'object' || !(k in cur)) return false;
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (last === undefined || cur == null || typeof cur !== 'object' || !(last in cur)) return false;
  cur[last] = value;
  return true;
}

function scalarLeaves(body: unknown): Set<string> {
  const set = new Set<string>();
  if (body != null && typeof body === 'object') {
    walkJson(body, (_p, _k, v) => {
      if (v != null && typeof v !== 'object') set.add(String(v));
    });
  } else if (body != null) {
    set.add(String(body));
  }
  return set;
}

// Structural signature: the set of normalized key-paths (array indices collapsed
// to `[]`). Two bodies with the same signature have the same SHAPE regardless of
// values — used by the negative control to decide "same object came back".
function structuralSignature(body: unknown): Set<string> {
  const sig = new Set<string>();
  if (body != null && typeof body === 'object') {
    walkJson(body, (p) => {
      sig.add(p.replace(/\[\d+\]/g, '[]'));
    });
  }
  return sig;
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const IDENTITY_KEYS = new Set([
  'id',
  'uuid',
  'guid',
  'oid',
  'pk',
  'key',
  'ref',
  'owner',
  'ownerid',
  'userid',
  'accountid',
  'customerid',
  'objectid',
]);
// True for keys that name an object identity (id, userId, owner_id, uuid, …). An
// id-echo only confirms cross-object access when the owner id lands at one of
// these — a bare `1` showing up as page/total/count is not evidence of a read.
export function isIdentityKey(key: string | null | undefined): boolean {
  const orig = String(key || '');
  if (!orig) return false;
  if (IDENTITY_KEYS.has(orig.toLowerCase())) return true;
  if (/(^|[_-])id$/i.test(orig)) return true; // _id / -id / trailing id
  if (/[a-z]Id$/.test(orig)) return true; // camelCase userId / orderId
  return false;
}

function idEchoedAtIdentityKey(body: unknown, idv: string): boolean {
  let hit = false;
  walkJson(body, (_p, k, v) => {
    if (hit) return;
    if (k && isIdentityKey(k) && v != null && typeof v !== 'object' && String(v) === idv)
      hit = true;
  });
  return hit;
}

// True when the attacker's response actually reflects the owner's object:
// (a) the owner id value is echoed in the body, or
// (b) scalar-leaf Jaccard overlap with the owner reference >= MATCH_THRESHOLD.
// Tradeoff: this is a heuristic that errs toward OVER-confirmation, which is the
// safe direction for a scanner (a false "vuln" a human dismisses beats a missed
// one). Specifically: (i) id-echo can fire when a low-entropy id value (e.g. `1`)
// incidentally appears in the attacker's own response as a page/count/unrelated
// id, and (ii) Jaccard over a SET of distinct scalar leaves can over-confirm for
// tiny or repetitive bodies. The UI surfaces which rule matched (drawer evidence)
// so a human adjudicates, and an unmatched 2xx stays at the lower `unconfirmed`
// tier rather than being promoted to `vuln`.
export function matchesOwner(
  attackResp: QaResponse | null | undefined,
  ownerRef: QaResponse | null | undefined,
  ownerIdValue: unknown
): boolean {
  const aBody = attackResp && attackResp.body;
  const idv = String(ownerIdValue);
  if (aBody != null && typeof aBody === 'object') {
    // id-echo only counts at an identity-like key, so a low-entropy id (`1`)
    // sitting in the attacker's OWN object as page/total/count is not a match.
    if (idEchoedAtIdentityKey(aBody, idv)) return true;
  } else if (typeof aBody === 'string') {
    if (aBody.includes(idv)) return true;
  }
  const oBody = ownerRef && ownerRef.body;
  if (aBody && typeof aBody === 'object' && oBody && typeof oBody === 'object') {
    const A = scalarLeaves(aBody),
      O = scalarLeaves(oBody);
    if (O.size === 0) return false;
    let inter = 0;
    for (const x of O) if (A.has(x)) inter++;
    const union = A.size + O.size - inter;
    if (union > 0 && inter / union >= MATCH_THRESHOLD) return true;
  }
  return false;
}

export function classifyBola(
  method: string | null | undefined,
  status: number | null | undefined,
  matched: boolean,
  denySet?: number[] | null
): BolaVerdict {
  const deny = denySet || [401, 403, 404];
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'inconclusive';
  if (deny.includes(status)) return 'pass';
  if (status >= 200 && status <= 299) return matched ? 'vuln' : 'unconfirmed';
  return 'inconclusive';
}

// The negative control fails — i.e. the endpoint is NOT object-scoped — when a
// synthetic (nonexistent) id is NOT denied, answered 2xx, AND the response echoes
// the control owner's own object (so the id was effectively ignored). A 2xx that
// does NOT match the owner reference (e.g. a soft-200 empty body for a missing id)
// is left alone — demoting it would hide a genuine finding. Denied / error / other
// statuses never demote ("never invent a gate").
export function negativeControlFailed(
  status: number | null | undefined,
  denySet?: number[] | null,
  matched?: boolean | null
): boolean {
  const deny = denySet || [401, 403, 404];
  if (typeof status !== 'number' || !Number.isFinite(status)) return false;
  if (deny.includes(status)) return false;
  if (!(status >= 200 && status <= 299)) return false;
  return matched === true;
}

// Independent negative-control oracle. Distinct from the attack-pass content
// match (matchesOwner) on purpose — using the same heuristic to both confirm a
// finding AND to validate the control is circular. Here the question is narrow:
// "did a FAKE id return the OWNER's own object?", answered structurally —
//   (1) the control body has the SAME shape as the owner reference,
//   (2) the synthetic id does NOT appear (so the endpoint did not actually use it),
//   (3) the owner's real id value DOES appear (so it really is the owner's object).
// All three ⇒ the endpoint ignores the id ⇒ it is not object-scoped.
export function controlSuggestsIgnoredId(
  controlResp: QaResponse | null | undefined,
  ownerRef: QaResponse | null | undefined,
  ownerIdValue: unknown,
  syntheticId: unknown
): boolean {
  const c = controlResp && controlResp.body;
  const o = ownerRef && ownerRef.body;
  const idv = String(ownerIdValue);
  const synth = String(syntheticId);
  if (typeof c === 'string' && typeof o === 'string') {
    return c === o && c.includes(idv) && !c.includes(synth);
  }
  if (c == null || o == null || typeof c !== 'object' || typeof o !== 'object') return false;
  const oSig = structuralSignature(o);
  if (oSig.size === 0) return false;
  if (!setEqual(structuralSignature(c), oSig)) return false;
  const cLeaves = scalarLeaves(c);
  if (cLeaves.has(synth)) return false;
  return cLeaves.has(idv);
}

export function bolaSeverity(
  method: string | null | undefined,
  verdict: BolaVerdict | string | null | undefined
): Severity | null {
  if (verdict === 'vuln')
    return MUTATING_METHODS.includes(String(method).toUpperCase()) ? 'critical' : 'high';
  if (verdict === 'unconfirmed') return 'medium';
  return null;
}

function respStatus(resp: QaResponse | null | undefined): number | null {
  return resp && typeof resp.status === 'number' ? resp.status : null;
}
function errStr(e: any): string {
  return String((e && e.message) || e);
}
function reqMeta(test: BolaTest, identity: Identity, idValue: unknown): BolaRequestMeta {
  return {
    method: test.method,
    path: test.path,
    identity: identity.name || identity.id,
    idValue: String(idValue),
  };
}

/** runBola 注入的執行器（頁面負責 build + mutate + execute）。 */
export type BolaRunner = (
  test: BolaTest,
  identity: Identity,
  idValue: string | number
) => Promise<QaResponse | null | undefined>;

// Run object-level authz tests. `runner(test, identity, idValue) => Promise<response>`
// is injected (the page builds+mutates+executes). Streams each finished cell via
// opts.onCell(testId, attackerId|null, ownerId, cell). Honors opts.signal.
export async function runBola(
  state: { tests?: BolaTest[]; identities?: Identity[]; denySet?: number[] },
  runner: BolaRunner,
  opts: {
    signal?: AbortSignal | null;
    onCell?: (
      testId: string,
      attackerId: string | null,
      ownerId: string,
      cell: BolaRefCell | BolaAttackCell
    ) => void;
    negativeControl?: boolean;
    onControl?: (testId: string, control: BolaControl) => void;
  } = {}
): Promise<BolaResults> {
  const { signal, onCell } = opts;
  const denySet = state.denySet || [401, 403, 404];
  const results: BolaResults = {};
  for (const test of state.tests || []) {
    if (signal && signal.aborted) return results;
    const idVals = test.idValues || {};
    const owners = (state.identities || []).filter(
      (i) => idVals[i.id] != null && idVals[i.id] !== ''
    );
    const reference: Record<string, BolaRefCell> = {};
    const tr: BolaTestResult = { reference, attacks: {} };
    results[test.id] = tr;

    for (const O of owners) {
      if (signal && signal.aborted) return results;
      let cell: BolaRefCell;
      try {
        const resp = await runner(test, O, idVals[O.id]!);
        cell = {
          phase: 'ref',
          status: respStatus(resp),
          response: resp || null,
          request: reqMeta(test, O, idVals[O.id]),
          error: null,
        };
      } catch (e) {
        cell = { phase: 'ref', status: null, response: null, request: null, error: errStr(e) };
      }
      reference[O.id] = cell;
      if (onCell) onCell(test.id, null, O.id, cell);
    }

    if (signal && signal.aborted) return results;
    // Negative control (opt-in): one synthetic-id probe per test. If a fake id
    // is answered 2xx, the endpoint isn't object-scoped, so every attack verdict
    // for this test is unreliable and gets demoted to inconclusive below.
    let controlFailed = false;
    const controlOwner = owners[0];
    if (opts.negativeControl && controlOwner) {
      const sampleVal = idVals[controlOwner.id];
      const synthetic = syntheticIdFor(test.idLocation, sampleVal);
      let control: BolaControl;
      try {
        const resp = await runner(test, controlOwner, synthetic);
        // Does requesting a FAKE id return the owner's OWN object? If so the id is
        // ignored → endpoint not object-scoped. Compare to the owner's reference
        // using the same content oracle as the attack pass (real owner id value).
        const ref = reference[controlOwner.id];
        const refOk =
          ref && typeof ref.status === 'number' && ref.status >= 200 && ref.status <= 299;
        // Independent structural oracle (NOT the attack-pass matchesOwner) to break
        // the circularity of confirming and validating with the same heuristic.
        const matched = refOk
          ? controlSuggestsIgnoredId(resp, ref.response, sampleVal, synthetic)
          : false;
        control = {
          status: respStatus(resp),
          matched,
          response: resp || null,
          syntheticId: synthetic,
          error: null,
        };
      } catch (e) {
        control = {
          status: null,
          matched: false,
          response: null,
          syntheticId: synthetic,
          error: errStr(e),
        };
      }
      controlFailed = negativeControlFailed(control.status, denySet, control.matched);
      control.failed = controlFailed;
      tr.control = control;
      if (opts.onControl) opts.onControl(test.id, control);
    }

    for (const A of owners) {
      const aRow: Record<string, BolaAttackCell> = {};
      tr.attacks[A.id] = aRow;
      for (const O of owners) {
        if (A.id === O.id) continue;
        if (signal && signal.aborted) return results;
        let cell: BolaAttackCell;
        try {
          const resp = await runner(test, A, idVals[O.id]!);
          const status = respStatus(resp);
          const ref = reference[O.id];
          const refOk =
            ref && typeof ref.status === 'number' && ref.status >= 200 && ref.status <= 299;
          const matched = refOk ? matchesOwner(resp, ref.response, idVals[O.id]) : false;
          let verdict = classifyBola(test.method, status, matched, denySet);
          let severity = bolaSeverity(test.method, verdict);
          let finding: Finding | null = severity
            ? {
                oracle: 'object-authz',
                severity,
                title:
                  verdict === 'vuln'
                    ? 'Cross-object access confirmed'
                    : 'Cross-object access (unconfirmed)',
                path: `${test.method} ${test.path}`,
                evidence: `as ${A.name || A.id} → ${O.name || O.id}'s id`,
                source: 'rule',
              }
            : null;
          if (controlFailed) {
            verdict = 'inconclusive';
            severity = null;
            finding = null;
          }
          cell = {
            phase: 'attack',
            status,
            matched,
            verdict,
            severity,
            finding,
            controlFailed,
            response: resp || null,
            request: reqMeta(test, A, idVals[O.id]),
            error: null,
          };
        } catch (e) {
          cell = {
            phase: 'attack',
            status: null,
            matched: false,
            verdict: 'inconclusive',
            severity: null,
            finding: null,
            controlFailed: false,
            response: null,
            request: null,
            error: errStr(e),
          };
        }
        aRow[O.id] = cell;
        if (onCell) onCell(test.id, A.id, O.id, cell);
      }
    }
  }
  return results;
}

// Tally attack-cell verdicts across all tests (reference cells excluded).
export function summarizeBola(results: BolaResults): {
  total: number;
  vuln: number;
  unconfirmed: number;
  pass: number;
  inconclusive: number;
} {
  const s = { total: 0, vuln: 0, unconfirmed: 0, pass: 0, inconclusive: 0 };
  for (const tid in results) {
    const atk = (results[tid] && results[tid].attacks) || {};
    for (const a in atk) {
      for (const o in atk[a]) {
        const v = atk[a][o] && atk[a][o].verdict;
        if (!v) continue;
        s.total++;
        if (s[v] !== undefined) s[v]++;
      }
    }
  }
  return s;
}
