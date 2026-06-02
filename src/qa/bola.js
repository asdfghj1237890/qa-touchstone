// ── QA Companion — object-level authz (BOLA/IDOR) engine (pure logic) ──────
// Mutate a request's object id, run a reference + attacker×owner attack pass,
// and confirm cross-object access by content. UI lives in BolaPanel.jsx.
import './setup.js';
import { walkJson } from './oracles.js';

export const MATCH_THRESHOLD = 0.6;
export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Return a copy of `req` with the object id at `idLocation` overwritten by
// `value`. Never mutates `req`. Sets `_idApplied` to whether it took effect.
export function applyIdLocation(req, idLocation, value) {
  const out = { ...req, params: (req.params || []).map(p => ({ ...p })) };
  const v = String(value);
  if (!idLocation) { out._idApplied = false; return out; }
  if (idLocation.kind === 'path') {
    const [pathPart, queryPart] = String(out.url || '').split('?');
    const segs = pathPart.split('/');
    let seen = -1, applied = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '') continue;
      seen++;
      if (seen === idLocation.index) { segs[i] = v; applied = true; break; }
    }
    out.url = segs.join('/') + (queryPart ? '?' + queryPart : '');
    out._idApplied = applied;
  } else if (idLocation.kind === 'query') {
    const existing = out.params.find(p => p.key === idLocation.key);
    if (existing) { existing.value = v; existing.on = true; }
    else out.params.push({ key: idLocation.key, value: v, on: true });
    out._idApplied = true;
  } else if (idLocation.kind === 'body') {
    out._idApplied = false;
    try {
      const obj = JSON.parse(out.body || 'null');
      if (obj && typeof obj === 'object' && setAtPath(obj, idLocation.path, value)) {
        out.body = JSON.stringify(obj);
        out._idApplied = true;
      }
    } catch { /* non-JSON body — leave unchanged */ }
  } else {
    out._idApplied = false;
  }
  return out;
}

// Set value at a dot/bracket path only if every parent exists. Returns success.
function setAtPath(obj, path, value) {
  const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  if (!keys.length) return false;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null || typeof cur !== 'object' || !(keys[i] in cur)) return false;
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (cur == null || typeof cur !== 'object' || !(last in cur)) return false;
  cur[last] = value;
  return true;
}

function scalarLeaves(body) {
  const set = new Set();
  if (body != null && typeof body === 'object') {
    walkJson(body, (_p, _k, v) => { if (v != null && typeof v !== 'object') set.add(String(v)); });
  } else if (body != null) {
    set.add(String(body));
  }
  return set;
}

// True when the attacker's response actually reflects the owner's object:
// (a) the owner id value is echoed in the body, or
// (b) scalar-leaf Jaccard overlap with the owner reference >= MATCH_THRESHOLD.
export function matchesOwner(attackResp, ownerRef, ownerIdValue) {
  const aBody = attackResp && attackResp.body;
  const idv = String(ownerIdValue);
  if (aBody != null && typeof aBody === 'object') {
    if (scalarLeaves(aBody).has(idv)) return true;
  } else if (typeof aBody === 'string') {
    if (aBody.includes(idv)) return true;
  }
  const oBody = ownerRef && ownerRef.body;
  if (aBody && typeof aBody === 'object' && oBody && typeof oBody === 'object') {
    const A = scalarLeaves(aBody), O = scalarLeaves(oBody);
    if (O.size === 0) return false;
    let inter = 0;
    for (const x of O) if (A.has(x)) inter++;
    const union = A.size + O.size - inter;
    if (union > 0 && inter / union >= MATCH_THRESHOLD) return true;
  }
  return false;
}

export function classifyBola(method, status, matched, denySet) {
  const deny = denySet || [401, 403, 404];
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'inconclusive';
  if (deny.includes(status)) return 'pass';
  if (status >= 200 && status <= 299) return matched ? 'vuln' : 'unconfirmed';
  return 'inconclusive';
}

export function bolaSeverity(method, verdict) {
  if (verdict === 'vuln') return MUTATING_METHODS.includes(String(method).toUpperCase()) ? 'critical' : 'high';
  if (verdict === 'unconfirmed') return 'medium';
  return null;
}

function respStatus(resp) { return resp && typeof resp.status === 'number' ? resp.status : null; }
function errStr(e) { return String((e && e.message) || e); }
function reqMeta(test, identity, idValue) {
  return { method: test.method, path: test.path, identity: identity.name || identity.id, idValue: String(idValue) };
}

// Run object-level authz tests. `runner(test, identity, idValue) => Promise<response>`
// is injected (the page builds+mutates+executes). Streams each finished cell via
// opts.onCell(testId, attackerId|null, ownerId, cell). Honors opts.signal.
export async function runBola(state, runner, opts = {}) {
  const { signal, onCell } = opts;
  const denySet = state.denySet || [401, 403, 404];
  const results = {};
  for (const test of state.tests || []) {
    if (signal && signal.aborted) return results;
    const idVals = test.idValues || {};
    const owners = (state.identities || []).filter(i => idVals[i.id] != null && idVals[i.id] !== '');
    const reference = {};
    results[test.id] = { reference, attacks: {} };

    for (const O of owners) {
      if (signal && signal.aborted) return results;
      let cell;
      try {
        const resp = await runner(test, O, idVals[O.id]);
        cell = { phase: 'ref', status: respStatus(resp), response: resp || null, request: reqMeta(test, O, idVals[O.id]), error: null };
      } catch (e) {
        cell = { phase: 'ref', status: null, response: null, request: null, error: errStr(e) };
      }
      reference[O.id] = cell;
      if (onCell) onCell(test.id, null, O.id, cell);
    }

    for (const A of owners) {
      results[test.id].attacks[A.id] = {};
      for (const O of owners) {
        if (A.id === O.id) continue;
        if (signal && signal.aborted) return results;
        let cell;
        try {
          const resp = await runner(test, A, idVals[O.id]);
          const status = respStatus(resp);
          const ref = reference[O.id];
          const refOk = ref && typeof ref.status === 'number' && ref.status >= 200 && ref.status <= 299;
          const matched = refOk ? matchesOwner(resp, ref.response, idVals[O.id]) : false;
          const verdict = classifyBola(test.method, status, matched, denySet);
          const severity = bolaSeverity(test.method, verdict);
          const finding = severity ? {
            oracle: 'object-authz', severity,
            title: verdict === 'vuln' ? 'Cross-object access confirmed' : 'Cross-object access (unconfirmed)',
            path: `${test.method} ${test.path}`,
            evidence: `as ${A.name || A.id} → ${O.name || O.id}'s id`, source: 'rule',
          } : null;
          cell = { phase: 'attack', status, matched, verdict, severity, finding, response: resp || null, request: reqMeta(test, A, idVals[O.id]), error: null };
        } catch (e) {
          cell = { phase: 'attack', status: null, matched: false, verdict: 'inconclusive', severity: null, finding: null, response: null, request: null, error: errStr(e) };
        }
        results[test.id].attacks[A.id][O.id] = cell;
        if (onCell) onCell(test.id, A.id, O.id, cell);
      }
    }
  }
  return results;
}

// Tally attack-cell verdicts across all tests (reference cells excluded).
export function summarizeBola(results) {
  const s = { total: 0, vuln: 0, unconfirmed: 0, pass: 0, inconclusive: 0 };
  for (const tid in results) {
    const atk = (results[tid] && results[tid].attacks) || {};
    for (const a in atk) {
      for (const o in atk[a]) {
        const v = atk[a][o] && atk[a][o].verdict;
        if (!v) continue;
        s.total++; if (s[v] !== undefined) s[v]++;
      }
    }
  }
  return s;
}
