// ── QA Touchstone — object-level authz (BOLA/IDOR) engine (pure logic) ──────
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
