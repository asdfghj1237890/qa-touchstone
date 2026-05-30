// ── QA Companion — variable resolver + assertion engine (plain JS) ─────────

function qaDynamic(name) {
  switch (name) {
    case '$timestamp': return Math.floor(Date.now() / 1000);
    case '$isoTimestamp': return new Date().toISOString();
    case '$randomInt': return Math.floor(Math.random() * 1000);
    case '$guid': return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
    case '$randomEmail': return 'user' + Math.floor(Math.random() * 9999) + '@acme.dev';
    default: return null;
  }
}
const QA_DYNAMICS = ['$timestamp', '$isoTimestamp', '$randomInt', '$guid', '$randomEmail'];

// Build the active variable map across four scopes, lowest → highest precedence:
//   Global  <  Collection  <  Environment  <  Local (extra, e.g. iteration data)
// Signature is back-compat: the 3rd arg may be a collectionId (string) OR the
// `extra`/local object — older callers passed (vars, env, extra).
function qaVarMap(vars, envLabel, collectionIdOrExtra, extra) {
  let collectionId = null, local = extra;
  if (typeof collectionIdOrExtra === 'string') collectionId = collectionIdOrExtra;
  else if (collectionIdOrExtra && typeof collectionIdOrExtra === 'object') local = collectionIdOrExtra;

  const map = {};
  (vars.globals || []).forEach(v => { if (v.on && v.key) map[v.key] = v.value; });
  if (collectionId) ((vars.collections || {})[collectionId] || []).forEach(v => { if (v.on && v.key) map[v.key] = v.value; });
  ((vars.environments || {})[envLabel] || []).forEach(v => { if (v.on && v.key) map[v.key] = v.value; });
  if (local) Object.entries(local).forEach(([k, v]) => { map[k] = v; });
  return map;
}

// Like qaVarMap, but records which scope each key's winning value came from.
const QA_SCOPES = ['global', 'collection', 'environment', 'local'];
function qaVarSources(vars, envLabel, collectionId, local) {
  const src = {};
  (vars.globals || []).forEach(v => { if (v.on && v.key) src[v.key] = 'global'; });
  if (collectionId) ((vars.collections || {})[collectionId] || []).forEach(v => { if (v.on && v.key) src[v.key] = 'collection'; });
  ((vars.environments || {})[envLabel] || []).forEach(v => { if (v.on && v.key) src[v.key] = 'environment'; });
  if (local) Object.keys(local).forEach(k => { src[k] = 'local'; });
  return src;
}
function qaSubstitute(text, map) {
  if (text == null) return text;
  return String(text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
    if (name[0] === '$') { const d = qaDynamic(name); return d == null ? m : String(d); }
    return (map && name in map) ? map[name] : m;
  });
}
function qaHasVars(text) { return /\{\{[^}]+\}\}/.test(String(text == null ? '' : text)); }
function qaUnknownVars(text, map) {
  const out = [];
  String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
    if (name[0] !== '$' && !(map && name in map)) out.push(name);
    return m;
  });
  return out;
}

// ── Assertions ────────────────────────────────────────────────────────────
function qaGetPath(obj, path) {
  return String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
}
function qaAssertLabel(a) {
  switch (a.type) {
    case 'status': return `Status ${({ eq: '=', neq: '≠', lt: '<', gt: '>' }[a.op] || '=')} ${a.value}`;
    case 'time': return `Response time ${a.op === 'gt' ? '>' : '<'} ${a.value} ms`;
    case 'bodyHas': return `Body has "${a.path}"`;
    case 'bodyEq': return `Body "${a.path}" = ${a.value}`;
    case 'bodyArray': return `Body is an array`;
    case 'header': return `Header "${a.name}" ${a.op === 'exists' ? 'exists' : a.op === 'contains' ? 'contains ' + a.value : '= ' + a.value}`;
    default: return a.text || 'check';
  }
}
function qaEval(a, resp) {
  const body = resp.body;
  let pass = false, actual = '';
  switch (a.type) {
    case 'status': {
      const s = resp.status; actual = String(s);
      pass = a.op === 'neq' ? s !== a.value : a.op === 'lt' ? s < a.value : a.op === 'gt' ? s > a.value : s === a.value;
      break;
    }
    case 'time': { actual = resp.time + ' ms'; pass = a.op === 'gt' ? resp.time > a.value : resp.time < a.value; break; }
    case 'bodyHas': { const v = qaGetPath(body, a.path); actual = v === undefined ? 'missing' : 'present'; pass = v !== undefined; break; }
    case 'bodyEq': { const v = qaGetPath(body, a.path); actual = JSON.stringify(v); pass = String(v) === String(a.value); break; }
    case 'bodyArray': { const arr = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : null); actual = arr ? `array(${arr.length})` : typeof body; pass = !!arr; break; }
    case 'header': { const h = (resp.headers || {}); const key = Object.keys(h).find(k => k.toLowerCase() === String(a.name).toLowerCase()); const val = key ? h[key] : undefined; actual = val === undefined ? 'missing' : String(val); pass = a.op === 'exists' ? val !== undefined : a.op === 'contains' ? String(val || '').includes(a.value) : String(val) === String(a.value); break; }
    default: { actual = '—'; pass = true; }
  }
  return { ...a, pass, actual };
}
function qaRunAssertions(list, resp) { return (list || []).filter(a => a.on !== false).map(a => qaEval(a, resp)); }

// Parse a generated-case assertion string into a structured assertion.
function qaParseAssertion(str) {
  const s = String(str).trim();
  let m;
  if (m = s.match(/status\s*(==|=|!=|<=|>=|<|>)?\s*(\d{3})/i)) {
    const op = { '!=': 'neq', '<': 'lt', '<=': 'lt', '>': 'gt', '>=': 'gt' }[m[1]] || 'eq';
    return { type: 'status', op, value: +m[2], on: true };
  }
  if (/is\s+(an?\s+)?array/i.test(s)) return { type: 'bodyArray', on: true };
  if (m = s.match(/(?:has|includes?|contains?)\s*"([^"]+)"/i)) return { type: 'bodyHas', path: m[1], on: true };
  if (m = s.match(/time\s*(<=|<)\s*(\d+)/i)) return { type: 'time', op: 'lt', value: +m[2], on: true };
  if (m = s.match(/header\s*"([^"]+)"/i)) return { type: 'header', name: m[1], op: 'exists', on: true };
  return { type: 'info', text: s, on: true };
}

// Parse a Set-Cookie header value into a cookie jar entry. Returns null if empty.
// Monotonic suffix so cookies captured in the same millisecond get distinct
// ids. The Settings UI uses cookie.id as a React key and edit/delete target;
// without this, two Set-Cookie lines for the same name in one response could
// collide and confuse the jar editor.
let qaCookieSeq = 0;

// Common 2-label public suffixes that should be refused as cookie Domain
// attributes — a response from foo.co.uk must NOT be able to set a cookie
// scoped to `co.uk` and poison every other foo.co.uk-style site. This is a
// best-effort short list; a full Public Suffix List is the proper long-term
// fix, but covering the most-likely attack vectors here gets >90% of the way
// without shipping a ~1MB PSL.
const QA_PUBLIC_SUFFIX_2 = new Set([
  // UK / EU
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'nhs.uk', 'sch.uk',
  // JP / KR / CN / TW
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr', 'mil.kr',
  'com.cn', 'net.cn', 'org.cn', 'edu.cn', 'gov.cn', 'mil.cn', 'ac.cn',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw', 'idv.tw', 'mil.tw', 'game.tw',
  // AU / NZ / Americas
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz',
  'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br',
  'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve',
  // ZA / SG / ID
  'co.za', 'org.za', 'gov.za',
  'com.sg', 'edu.sg', 'gov.sg',
  'co.id', 'or.id', 'go.id', 'ac.id',
  // Common SaaS host suffixes (treat like public suffixes for cookie scope)
  'github.io', 'gitlab.io', 'pages.dev', 'web.app', 'firebaseapp.com',
  'vercel.app', 'netlify.app', 'r2.dev', 'workers.dev', 'cloudfront.net',
]);

// RFC 6265 §5.1.4 default-path: the longest prefix of the request path that
// ends with `/`, or `/` if the path has no `/` segments to draw from.
function qaCookieDefaultPath(requestPath) {
  if (!requestPath || requestPath[0] !== '/') return '/';
  const last = requestPath.lastIndexOf('/');
  return last <= 0 ? '/' : requestPath.slice(0, last);
}

function qaParseSetCookie(headerValue, fallbackHost, fallbackPath) {
  if (!headerValue) return null;
  const parts = headerValue.split(';').map(s => s.trim());
  const [nameVal, ...attrs] = parts;
  const eq = nameVal.indexOf('=');
  if (eq < 0) return null;
  const name = nameVal.slice(0, eq).trim();
  const value = nameVal.slice(eq + 1).trim();
  // hostOnly defaults true; flipped false when a valid Domain attr is parsed.
  // path defaults to RFC 6265's default-path derived from the request path.
  const ck = { id: 'ck-' + name + '-' + Date.now().toString(36) + '-' + (qaCookieSeq++).toString(36), name, value, domain: fallbackHost || '', path: qaCookieDefaultPath(fallbackPath || '/'), expires: '', httpOnly: false, secure: false, sameSite: 'Lax', hostOnly: true, on: true };
  for (const a of attrs) {
    const [k, v] = a.split('=');
    const key = k.toLowerCase();
    if (key === 'domain') {
      const dom = (v || '').replace(/^\./, '').toLowerCase();
      if (!dom) continue;
      // Reject single-label (public-suffix-ish) Domain attrs like `com` —
      // without a Public Suffix List this is the practical guard against
      // poisoning every .com host. Browsers reject these outright.
      if (!dom.includes('.')) return null;
      // Reject common 2-label public suffixes (co.uk, github.io, …). Not a
      // complete PSL but covers the realistic attack vectors.
      if (QA_PUBLIC_SUFFIX_2.has(dom)) return null;
      // RFC 6265 §5.3 step 6: reject the entire cookie if the Domain
      // attribute does not domain-match the response host. Otherwise a
      // response from evil.test could seed a cookie scoped to staging.api…
      if (!fallbackHost || !(fallbackHost === dom || fallbackHost.endsWith('.' + dom))) {
        return null;
      }
      ck.domain = dom;
      ck.hostOnly = false;
    }
    else if (key === 'path') ck.path = v || '/';
    else if (key === 'secure') ck.secure = true;
    else if (key === 'httponly') ck.httpOnly = true;
    else if (key === 'samesite') ck.sameSite = v || 'Lax';
    // Keep the full ISO datetime. Truncating to YYYY-MM-DD meant a cookie
    // with Max-Age=3600 set at noon became "expired" at midnight UTC.
    else if (key === 'max-age' && v) { const d = new Date(Date.now() + (+v) * 1000); ck.expires = d.toISOString(); }
    else if (key === 'expires' && v) { const d = new Date(v); if (!isNaN(d)) ck.expires = d.toISOString(); }
  }
  return ck;
}

// Merge a newly-captured cookie into an existing jar. The identity key is
// name+domain+path per RFC 6265 — without path, a cookie scoped to `/admin`
// would silently overwrite the `/`-scoped cookie of the same name.
function qaMergeCookie(jar, ck) {
  if (!ck) return jar;
  const i = jar.findIndex(c => c.name === ck.name && c.domain === ck.domain && (c.path || '/') === (ck.path || '/'));
  if (i >= 0) { const next = jar.slice(); next[i] = { ...next[i], value: ck.value, expires: ck.expires || next[i].expires, secure: ck.secure, httpOnly: ck.httpOnly, sameSite: ck.sameSite, hostOnly: ck.hostOnly, on: true }; return next; }
  return [...jar, ck];
}

// Parse a data file (CSV or JSON array) into an array of row objects for the
// Collection Runner. Returns { rows, columns, error, format }.
function qaParseDataFile(text, filename) {
  const t = (text || '').trim();
  if (!t) return { rows: null, columns: [], error: '', format: null };
  const isJson = /\.json$/i.test(filename || '') || t[0] === '[' || t[0] === '{';
  if (isJson) {
    try {
      const d = JSON.parse(t);
      const arr = Array.isArray(d) ? d : [d];
      if (!arr.length) return { rows: null, columns: [], error: 'Empty JSON array', format: 'json' };
      const cols = [...new Set(arr.flatMap(o => Object.keys(o || {})))];
      return { rows: arr, columns: cols, error: '', format: 'json' };
    } catch { return { rows: null, columns: [], error: 'Invalid JSON', format: 'json' }; }
  }
  // CSV: first row is header. Handles quoted fields and embedded commas.
  const lines = t.split(/\r?\n/).filter(l => l.length);
  if (lines.length < 2) return { rows: null, columns: [], error: 'CSV needs a header row + at least one data row', format: 'csv' };
  const parseLine = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  };
  const cols = parseLine(lines[0]).map(c => c.trim());
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line);
    const o = {}; cols.forEach((c, i) => { o[c] = (vals[i] != null ? vals[i] : '').trim(); });
    return o;
  });
  return { rows, columns: cols, error: '', format: 'csv' };
}

Object.assign(window, { qaDynamic, QA_DYNAMICS, qaVarMap, qaVarSources, QA_SCOPES, qaSubstitute, qaHasVars, qaUnknownVars, qaGetPath, qaAssertLabel, qaEval, qaRunAssertions, qaParseAssertion, qaParseSetCookie, qaMergeCookie, qaParseDataFile });

export { qaParseSetCookie, qaMergeCookie, qaCookieDefaultPath };
