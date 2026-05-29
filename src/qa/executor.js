// ── QA Touchstone — request executor ───────────────────────────────────────
// Bridges the redesigned API client to the real Tauri HTTP backend
// (`execute_postman_request`). When the backend is unavailable (browser/dev
// or test), it falls back to the canned responses in data.js so the UI — and
// the send→response hero animation — still works end to end.
import './setup.js';
import api from '../api/index.js';

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};
const statusText = (s) => STATUS_TEXT[s] || (s >= 500 ? 'Server Error' : s >= 400 ? 'Error' : s >= 300 ? 'Redirect' : 'OK');

function byteLength(str) {
  try { return new Blob([str]).size; } catch { return (str || '').length; }
}
function tryParse(text) {
  if (text == null || text === '') return null;
  try { return JSON.parse(text); } catch { return text; }
}
function b64(str) {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
}

// Resolve {{variables}} everywhere using the active variable map.
const sub = (t, map) => window.qaSubstitute(t, map || {});

// Build the Postman-style payload the Rust command expects, with all
// variables already resolved on the client.
function buildPayload(req, env, varMap, opts = {}) {
  const map = varMap || {};
  const headers = [];

  // Explicit headers
  req.headers.filter(h => h.on && h.key).forEach(h =>
    headers.push({ key: sub(h.key, map), value: sub(h.value, map) }));

  // Query params (+ apiKey when placed in the query string)
  const query = req.params.filter(p => p.on && p.key)
    .map(p => `${encodeURIComponent(sub(p.key, map))}=${encodeURIComponent(sub(p.value, map))}`);

  // Auth
  const a = req.auth || { type: 'none' };
  if (a.type === 'bearer') headers.push({ key: 'Authorization', value: 'Bearer ' + sub(a.bearer, map) });
  else if (a.type === 'oauth2' && opts.oauthToken) headers.push({ key: 'Authorization', value: `${opts.oauthToken.type || 'Bearer'} ${opts.oauthToken.token}` });
  else if (a.type === 'basic') headers.push({ key: 'Authorization', value: 'Basic ' + b64(`${sub(a.basic.user, map)}:${sub(a.basic.pass, map)}`) });
  else if (a.type === 'apiKey') {
    if (a.apiKey.placement === 'query') query.push(`${encodeURIComponent(a.apiKey.key)}=${encodeURIComponent(sub(a.apiKey.value, map))}`);
    else headers.push({ key: a.apiKey.key, value: sub(a.apiKey.value, map) });
  }

  // Cookies that match this host
  if (opts.cookies && opts.cookies.length) {
    headers.push({ key: 'Cookie', value: opts.cookies.map(c => `${c.name}=${c.value}`).join('; ') });
  }

  // Body
  let body, contentType;
  if (req.bodyMode === 'json' && req.body) { body = sub(req.body, map); contentType = 'application/json'; }
  else if (req.bodyMode === 'graphql') {
    let variables = {};
    try { variables = JSON.parse(sub(req.gqlVars || '{}', map)); } catch {}
    body = JSON.stringify({ query: sub(req.gqlQuery || '', map), variables });
    contentType = 'application/json';
  } else if (req.bodyMode === 'form' && (req.form || []).length) {
    body = req.form.filter(f => f.on && f.key)
      .map(f => `${encodeURIComponent(sub(f.key, map))}=${encodeURIComponent(sub(f.value, map))}`).join('&');
    contentType = 'application/x-www-form-urlencoded';
  }
  if (contentType && !headers.some(h => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: contentType });
  }

  const base = sub((env.baseUrl || '') + req.url, map);
  const url = base + (query.length ? (base.includes('?') ? '&' : '?') + query.join('&') : '');

  const request = { method: req.method, url, header: headers };
  if (body != null) request.body = { mode: 'raw', raw: body };
  if (a.type === 'aws') {
    request.auth = { type: 'awsv4', awsv4: [
      { key: 'region', value: a.aws.region }, { key: 'service', value: a.aws.service },
    ] };
  }
  return { requestDetails: { request }, params: {}, apiConfigId: null, selectedProfile: null, selectedEnvironment: null, isFileTransferCollection: false };
}

// Canned-response fallback (browser/dev/test), preserving the design's feel.
function cannedResponse(req) {
  const canned = (window.QA.RESPONSES[req.id] || window.QA.RESPONSES['health']);
  return { ...canned };
}

function hasTauri() {
  return typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
}

// Returns a Promise<{ status, statusText, time, size, body, headers }>.
export async function executeRequest(req, env, varMap, opts = {}) {
  if (!hasTauri()) {
    // Simulate latency so the hero animation reads naturally.
    const canned = cannedResponse(req);
    const delay = 620 + Math.min(900, (canned.time || 100) * 1.4);
    await new Promise(r => setTimeout(r, delay));
    return canned;
  }
  const payload = buildPayload(req, env, varMap, opts);
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    const result = await api.executePostmanRequest(payload);
    const time = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (result && result.success) {
      const bodyText = result.body == null ? '' : String(result.body);
      return {
        status: result.status,
        statusText: statusText(result.status),
        time,
        size: byteLength(bodyText),
        body: tryParse(bodyText),
        headers: result.headers || {},
      };
    }
    return {
      status: 0, statusText: 'Request failed', time, size: 0,
      body: { error: (result && result.error) || 'Request failed' }, headers: {},
    };
  } catch (e) {
    const time = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return {
      status: 0, statusText: 'Network error', time, size: 0,
      body: { error: String(e && e.message ? e.message : e) }, headers: {},
    };
  }
}

export default executeRequest;
