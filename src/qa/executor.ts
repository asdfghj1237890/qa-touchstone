// ── QA Touchstone — request executor ───────────────────────────────────────
// Bridges the redesigned API client to the real Tauri HTTP backend
// (`execute_postman_request`). In browser/dev it attempts a real CORS fetch for
// public demo APIs, then falls back to canned responses when the browser blocks
// the request or the network is unavailable. Tests always use the canned path.
import './setup';
import api from '../api/index';
import type { QaRequest } from './buildReq';

/** 執行時環境（只用到 baseUrl；label 供 var map 選層）。 */
export interface QaExecuteEnv {
  label?: string;
  baseUrl?: string;
}

/** executeRequest / buildPayload 的選項。 */
export interface QaExecuteOptions {
  cookies?: Array<{ name: string; value?: string }>;
  sslVerify?: boolean;
  oauthToken?: { token: string; type?: string } | null;
}

/** 送往 Rust `execute_postman_request` 的 Postman-style payload。 */
export interface QaPostmanPayload {
  requestDetails: {
    request: {
      method: string;
      url: string;
      header: Array<{ key: string; value: string }>;
      body?: { mode: 'raw'; raw: string };
      auth?: { type: 'awsv4'; awsv4: Array<{ key: string; value: string }> };
    };
  };
  params: Record<string, never>;
  apiConfigId: null;
  selectedProfile: null;
  selectedEnvironment: null;
  isFileTransferCollection: boolean;
  sslVerify: boolean;
}

/** executeRequest 的回應形狀（canned / browser fetch / Tauri 三路一致）。 */
export interface QaExecResponse {
  status: number;
  statusText: string;
  time: number;
  size: number;
  body: any;
  headers: Record<string, string>;
  finalUrl?: string;
  setCookies?: any[];
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};
const statusText = (s: number): string => STATUS_TEXT[s] || (s >= 500 ? 'Server Error' : s >= 400 ? 'Error' : s >= 300 ? 'Redirect' : 'OK');

function byteLength(str: string): number {
  try { return new Blob([str]).size; } catch { return (str || '').length; }
}
function tryParse(text: string | null | undefined): any {
  if (text == null || text === '') return null;
  try { return JSON.parse(text); } catch { return text; }
}
function b64(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
}

// Resolve {{variables}} everywhere using the active variable map.
const sub = (t: string, map?: Record<string, string> | null): string => window.qaSubstitute!(t, map || {});

// Build the Postman-style payload the Rust command expects, with all
// variables already resolved on the client.
export function buildPayload(req: QaRequest, env: QaExecuteEnv, varMap?: Record<string, string> | null, opts: QaExecuteOptions = {}): QaPostmanPayload {
  const map = varMap || {};
  const headers: Array<{ key: string; value: string }> = [];

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
  let body: string | undefined, contentType: string | undefined;
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

  // Substitute first, then classify: `{{apiHost}}/v1` with apiHost=https://x
  // should be treated as absolute and NOT prefixed with env.baseUrl.
  const reqUrlSub = sub(req.url || '', map);
  const isAbsolute = /^https?:\/\//i.test(reqUrlSub);
  const base = isAbsolute ? reqUrlSub : sub(env.baseUrl || '', map) + reqUrlSub;
  const url = base + (query.length ? (base.includes('?') ? '&' : '?') + query.join('&') : '');

  const request: QaPostmanPayload['requestDetails']['request'] = { method: req.method, url, header: headers };
  if (body != null) request.body = { mode: 'raw', raw: body };
  if (a.type === 'aws') {
    request.auth = { type: 'awsv4', awsv4: [
      { key: 'region', value: a.aws.region }, { key: 'service', value: a.aws.service },
    ] };
  }
  // sslVerify defaults true unless the caller explicitly turns it off — keep
  // the wire shape so a missing opts.sslVerify is treated as the safe default.
  return { requestDetails: { request }, params: {}, apiConfigId: null, selectedProfile: null, selectedEnvironment: null, isFileTransferCollection: false, sslVerify: opts.sslVerify !== false };
}

// Canned-response fallback (browser/dev/test), preserving the design's feel.
function cannedResponse(req: QaRequest): QaExecResponse {
  const canned = (window.QA.RESPONSES[req.id] || window.QA.RESPONSES['health']);
  return { ...canned };
}

function hasTauri() {
  return typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function isTestMode(): boolean {
  return !!(import.meta.env && import.meta.env.MODE === 'test');
}

async function browserFetchResponse(req: QaRequest, env: QaExecuteEnv, varMap?: Record<string, string> | null, opts: QaExecuteOptions = {}): Promise<QaExecResponse> {
  if (typeof fetch !== 'function') throw new Error('Browser fetch unavailable');
  const payload = buildPayload(req, env, varMap, opts);
  const request = payload.requestDetails.request;
  const headers: Record<string, string> = {};
  (request.header || []).forEach(h => {
    const key = String(h.key || '');
    if (!key) return;
    // Browsers reject forbidden headers like Cookie; use the canned fallback
    // for those because the Rust backend is the real path for cookie replay.
    if (key.toLowerCase() === 'cookie') throw new Error('Cookie header requires Tauri backend');
    headers[key] = h.value || '';
  });
  const body = request.body && request.body.raw != null ? String(request.body.raw) : undefined;
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const res = await fetch(request.url, {
    method: request.method,
    headers,
    body: body != null && !/^(GET|HEAD)$/i.test(request.method) ? body : undefined,
    mode: 'cors',
  });
  const bodyText = await res.text();
  const time = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
  const responseHeaders: Record<string, string> = {};
  try { res.headers.forEach((value, key) => { responseHeaders[key] = value; }); } catch {}
  return {
    status: res.status,
    statusText: res.statusText || statusText(res.status),
    time,
    size: byteLength(bodyText),
    body: tryParse(bodyText),
    headers: responseHeaders,
    finalUrl: res.url || request.url,
    setCookies: [],
  };
}

// Returns a Promise<{ status, statusText, time, size, body, headers }>.
export async function executeRequest(req: QaRequest, env: QaExecuteEnv, varMap?: Record<string, string> | null, opts: QaExecuteOptions = {}): Promise<QaExecResponse> {
  if (!hasTauri()) {
    if (!isTestMode()) {
      try { return await browserFetchResponse(req, env, varMap, opts); }
      catch {}
    }
    // Simulate latency so the hero animation reads naturally.
    const canned = cannedResponse(req);
    const delay = 620 + Math.min(900, (canned.time || 100) * 1.4);
    await new Promise(r => setTimeout(r, delay));
    return canned;
  }
  const payload = buildPayload(req, env, varMap, opts);
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    const result: any = await api.executePostmanRequest(payload);
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
        finalUrl: result.finalUrl || '',
        // Per-hop Set-Cookie capture so the renderer can scope each cookie
        // against the URL of the response that actually set it (a redirect
        // chain across hosts otherwise scopes everything to the final URL).
        setCookies: Array.isArray(result.setCookies) ? result.setCookies : [],
      };
    }
    return {
      status: 0, statusText: 'Request failed', time, size: 0,
      body: { error: (result && result.error) || 'Request failed' }, headers: {},
    };
  } catch (e: any) {
    const time = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    return {
      status: 0, statusText: 'Network error', time, size: 0,
      body: { error: String(e && e.message ? e.message : e) }, headers: {},
    };
  }
}

export default executeRequest;
