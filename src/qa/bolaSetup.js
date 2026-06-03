// src/qa/bolaSetup.js
// ── QA Touchstone — BOLA setup automation (pure logic) ─────────────────────
// Detect where an object id lives in a request, surface candidate id values,
// apply reusable cross-tenant presets, and mint shape-matched synthetic ids
// for the negative control. No network. UI in BolaPanel.jsx; engine in bola.js.
import './setup.js';
import { walkJson } from './oracles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24_RE = /^[0-9a-f]{24}$/i;
const NUM_RE = /^\d+$/;
const ID_DENYLIST = new Set(['count', 'page', 'limit', 'size', 'offset', 'total', 'per_page', 'perpage', 'page_size', 'pagesize']);

function isIdKey(key) {
  const k = String(key);
  if (ID_DENYLIST.has(k.toLowerCase())) return false;
  return k.toLowerCase() === 'id' || /_id$/i.test(k) || /[a-z]Id$/.test(k) || /(^|_)(uuid|tenant|account|org)(_|$)/i.test(k);
}

function shapeScore(v) {
  if (UUID_RE.test(v)) return { score: 90, shape: 'uuid' };
  if (HEX24_RE.test(v)) return { score: 88, shape: 'hex24' };
  if (NUM_RE.test(v)) return { score: 55, shape: 'numeric' };
  return null;
}

// Return ranked id-location candidates for a built request (from buildReq):
//   [{ idLocation, value, confidence: 'high'|'medium'|'low', why }]
export function detectIdLocation(req) {
  const cands = [];
  const pathPart = String((req && req.url) || '').split('?')[0];
  const segs = pathPart.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const sh = shapeScore(segs[i]);
    if (!sh) continue;
    const prev = i > 0 ? segs[i - 1] : '';
    const plural = /^[a-z].*(s|es)$/i.test(prev);
    let score = sh.score;
    if (plural) score += sh.shape === 'numeric' ? 25 : 5;   // numeric needs the plural-noun boost to reach 'high'
    cands.push({ idLocation: { kind: 'path', index: i }, value: segs[i], score,
                 why: `path segment ${i} (${sh.shape}${plural ? ', after /' + prev : ''})` });
  }
  for (const p of (req && req.params) || []) {
    if (p && p.key && isIdKey(p.key)) {
      const v = String(p.value == null ? '' : p.value);
      const strong = UUID_RE.test(v) || HEX24_RE.test(v);
      cands.push({ idLocation: { kind: 'query', key: p.key }, value: v, score: strong ? 78 : 55, why: `query key ${p.key}` });
    }
  }
  try {
    const body = JSON.parse((req && req.body) || 'null');
    if (body && typeof body === 'object') {
      walkJson(body, (path, key, val) => {
        if (val != null && typeof val !== 'object' && isIdKey(key)) {
          const v = String(val);
          const strong = UUID_RE.test(v) || HEX24_RE.test(v);
          cands.push({ idLocation: { kind: 'body', path }, value: v, score: strong ? 72 : 50, why: `body field ${path}` });
        }
      });
    }
  } catch { /* non-JSON body — skip */ }
  cands.sort((a, b) => b.score - a.score);
  return cands.map(c => ({
    idLocation: c.idLocation, value: c.value,
    confidence: c.score >= 75 ? 'high' : c.score >= 50 ? 'medium' : 'low', why: c.why,
  }));
}
