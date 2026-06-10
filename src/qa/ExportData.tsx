import './setup';

// ── QA Touchstone — export a collection to Postman v2.1 collection JSON ─────

/** Postman v2.1 url 物件（export 專用的 wire 形狀）。 */
interface PmUrlObject {
  raw: string;
  path: string[];
  protocol?: string;
  host?: string[];
  query?: Array<{ key?: string; value: string; disabled: boolean }>;
}

/** 內部 request detail 的 params/headers 列（key/value/on 皆可缺漏）。 */
type PmKVRowLike = { key?: string; value?: string; on?: boolean };

// Turn a path like "/v1/users?limit=5" + base URL into a Postman url object.
function pmUrlObject(baseUrl: string, path: string, params: PmKVRowLike[] | null | undefined): PmUrlObject {
  // Imported absolute URLs already carry their host; don't prepend baseUrl
  // (mirrors the executor / PerfTest URL build).
  const isAbsolute = /^https?:\/\//i.test(path || '');
  const raw = isAbsolute ? (path || '') : ((baseUrl || '') + path);
  let host: string[] = [], segs: string[] = [], protocol = 'https';
  try {
    const u = new URL(raw.includes('://') ? raw : 'https://placeholder' + (path.startsWith('/') ? path : '/' + path));
    protocol = u.protocol.replace(':', '');
    host = u.hostname === 'placeholder' ? [] : u.hostname.split('.');
    segs = u.pathname.split('/').filter(Boolean);
  } catch {
    segs = path.split('?')[0].split('/').filter(Boolean);
  }
  const query = (params || []).filter(p => p.key).map(p => ({ key: p.key, value: p.value || '', disabled: p.on === false }));
  const obj: PmUrlObject = { raw, path: segs };
  if (host.length) { obj.protocol = protocol; obj.host = host; }
  if (query.length) obj.query = query;
  return obj;
}

function pmAuth(authType: string | undefined, _det: any) {
  switch (authType) {
    case 'bearer': return { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
    case 'basic': return { type: 'basic', basic: [{ key: 'username', value: '{{username}}' }, { key: 'password', value: '{{password}}' }] };
    case 'apiKey': return { type: 'apikey', apikey: [{ key: 'key', value: 'x-api-key' }, { key: 'value', value: '{{apiKey}}' }, { key: 'in', value: 'header' }] };
    case 'oauth2': return { type: 'oauth2', oauth2: [{ key: 'accessToken', value: '{{accessToken}}' }, { key: 'tokenType', value: 'Bearer' }] };
    case 'aws': return { type: 'awsv4', awsv4: [{ key: 'service', value: 'execute-api' }] };
    default: return undefined;
  }
}

// Build a Postman v2.1 collection object from one of our internal collections.
// col / env / 回傳值都是 canned 資料形狀（window.QA），過渡期以 any 表示。
function buildPostmanCollection(col: any, env: any) {
  const { REQUEST_DETAILS } = window.QA;
  const baseUrl = (col.baseUrl) || (env && env.baseUrl) || '';
  const toItem = (r: any) => {
    const det = REQUEST_DETAILS[r.id] || {};
    const headers = (det.headers || []).map((h: any) => ({ key: h.key, value: h.value || '', disabled: h.on === false }));
    const item: any = {
      name: r.name,
      request: {
        method: r.method,
        header: headers,
        url: pmUrlObject(baseUrl, r.path, det.params),
      },
    };
    const auth = pmAuth(det.auth, det);
    if (auth) item.request.auth = auth;
    if (det.graphql) {
      item.request.body = { mode: 'graphql', graphql: { query: det.graphql.query, variables: det.graphql.variables } };
    } else if (det.body) {
      item.request.body = { mode: 'raw', raw: det.body, options: { raw: { language: 'json' } } };
    }
    return item;
  };
  return {
    info: {
      _postman_id: 'qa-' + (col.id || 'export') + '-' + Date.now().toString(36),
      name: col.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _exporter_id: 'QA Touchstone',
    },
    item: col.folders.map((f: any) => ({ name: f.name, item: f.requests.map(toItem) })),
  };
}

function exportCollection(col: any, env: any) {
  const obj = buildPostmanCollection(col, env);
  const name = `${col.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.postman_collection.json`;
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

Object.assign(window, { buildPostmanCollection, exportCollection });

export { buildPostmanCollection, exportCollection };
