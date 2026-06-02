// ── QA Touchstone — OAuth 2.0 token exchange helpers ────────────────────────
// Pure request/response shaping shared by the app shell and tests. The actual
// HTTP transport is injected so Tauri can use the Rust backend while browser
// fallback can use fetch directly.

const DEFAULT_AUTH = {
  type: 'none',
  bearer: '',
  apiKey: { key: '', value: '', placement: 'header' },
  basic: { user: '', pass: '' },
  aws: { profile: '', service: '', region: '' },
  oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', code: '', redirectUri: '', username: '', password: '' },
};

function sub(value, map) {
  const text = String(value == null ? '' : value);
  if (typeof window !== 'undefined' && window.qaSubstitute) return window.qaSubstitute(text, map || {});
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => (map && name in map) ? map[name] : m);
}

function required(value, label) {
  if (!String(value || '').trim()) throw new Error(`${label} is required`);
}

function tokenType(value) {
  const t = String(value || 'Bearer');
  return /^bearer$/i.test(t) ? 'Bearer' : t;
}

export function buildOAuthTokenRequest(oauth2 = {}, varMap = {}) {
  const grant = sub(oauth2.grant || 'client_credentials', varMap).trim().toLowerCase();
  const tokenUrl = sub(oauth2.tokenUrl || '', varMap).trim();
  required(tokenUrl, 'OAuth token URL');
  if (!/^https?:\/\//i.test(tokenUrl)) throw new Error('OAuth token URL must be an absolute HTTP(S) URL');

  const clientId = sub(oauth2.clientId || '', varMap).trim();
  const clientSecret = sub(oauth2.clientSecret || '', varMap);
  const scope = sub(oauth2.scope || '', varMap).trim();
  const form = [{ key: 'grant_type', value: grant, on: true }];

  if (clientId) form.push({ key: 'client_id', value: clientId, on: true });
  if (clientSecret) form.push({ key: 'client_secret', value: clientSecret, on: true });
  if (scope) form.push({ key: 'scope', value: scope, on: true });

  if (grant === 'authorization_code') {
    const code = sub(oauth2.code || '', varMap).trim();
    const redirectUri = sub(oauth2.redirectUri || '', varMap).trim();
    required(code, 'Authorization code');
    form.push({ key: 'code', value: code, on: true });
    if (redirectUri) form.push({ key: 'redirect_uri', value: redirectUri, on: true });
  } else if (grant === 'password') {
    const username = sub(oauth2.username || '', varMap).trim();
    const password = sub(oauth2.password || '', varMap);
    required(username, 'OAuth username');
    required(password, 'OAuth password');
    form.push({ key: 'username', value: username, on: true });
    form.push({ key: 'password', value: password, on: true });
  } else if (grant !== 'client_credentials') {
    throw new Error(`Unsupported OAuth grant type: ${grant}`);
  }

  return {
    id: 'oauth-token',
    method: 'POST',
    url: tokenUrl,
    params: [],
    headers: [
      { key: 'Accept', value: 'application/json', on: true },
      { key: 'Content-Type', value: 'application/x-www-form-urlencoded', on: true },
    ],
    bodyMode: 'form',
    body: '',
    gqlQuery: '',
    gqlVars: '',
    form,
    auth: { ...DEFAULT_AUTH, oauth2: { ...DEFAULT_AUTH.oauth2 } },
    oauthContext: { grant, scope },
  };
}

export function parseOAuthTokenResponse(body, context = {}) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  if (!data || typeof data !== 'object') throw new Error('OAuth token response was not JSON');
  const token = data.access_token;
  if (!token) throw new Error('OAuth token response did not include access_token');
  const obtainedAt = Date.now();
  const expiresIn = Number(data.expires_in);
  return {
    token: String(token),
    type: tokenType(data.token_type),
    scope: String(data.scope || context.scope || ''),
    expiresAt: obtainedAt + (Number.isFinite(expiresIn) ? Math.max(0, expiresIn) : 3600) * 1000,
    obtainedAt,
  };
}

export async function exchangeOAuthTokenWithFetch(tokenRequest) {
  const body = new URLSearchParams(
    tokenRequest.form.filter(f => f.on !== false && f.key).map(f => [f.key, f.value || ''])
  );
  const headers = tokenRequest.headers
    .filter(h => h.on !== false && h.key)
    .reduce((out, h) => ({ ...out, [h.key]: h.value || '' }), {});
  const res = await fetch(tokenRequest.url, { method: 'POST', headers, body });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { data = raw; }
  if (!res.ok) {
    const detail = data && typeof data === 'object'
      ? (data.error_description || data.error || JSON.stringify(data))
      : String(data || '');
    throw new Error(`OAuth token endpoint returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return parseOAuthTokenResponse(data, tokenRequest.oauthContext);
}

// Obtain a token end-to-end: build the token request, then exchange it. Inside
// Tauri the transport is injected (`executeRequest`) so the exchange goes
// through the Rust backend and avoids browser CORS; otherwise it falls back to
// `fetch`. Rejections propagate to the caller. Shared by the API client shell
// and the Security page so the behavior stays identical.
export async function requestOAuthToken(oauth2Config, varMap, opts = {}) {
  const { sslVerify = true, executeRequest } = opts;
  const tokenRequest = buildOAuthTokenRequest(oauth2Config || {}, varMap);
  const tauri = typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (tauri && executeRequest) {
    const resp = await executeRequest(tokenRequest, { label: 'OAuth', baseUrl: '' }, {}, { sslVerify });
    if (!resp || resp.status < 200 || resp.status >= 300) {
      const detail = resp && resp.body && typeof resp.body === 'object'
        ? (resp.body.error_description || resp.body.error || JSON.stringify(resp.body))
        : '';
      throw new Error(`OAuth token endpoint returned HTTP ${resp ? resp.status : 0}${detail ? `: ${detail}` : ''}`);
    }
    return parseOAuthTokenResponse(resp.body, tokenRequest.oauthContext);
  }
  return exchangeOAuthTokenWithFetch(tokenRequest);
}
