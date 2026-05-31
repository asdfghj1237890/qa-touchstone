// ── QA Touchstone — Postman v2.1 / OpenAPI parser ──────────────────────────
// Pure parser. No React, no DOM, no setup.js side effects. Lives apart from
// ImportData.jsx so setup.js can auto-load the bundled demo collection at
// boot without dragging the import-modal UI (and React) into the side-effect
// import graph.

let qaImportSeq = 0;
function qaUid(prefix) { return `${prefix}-${(qaImportSeq++).toString(36)}-${Date.now().toString(36).slice(-4)}`; }

export function qaDetectFormat(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.info && (obj.item || obj.info._postman_id || /v2\.[01]/.test(obj.info.schema || ''))) return 'postman';
  if (obj.openapi || obj.swagger || (obj.paths && typeof obj.paths === 'object')) return 'openapi';
  return null;
}

function pmUrlToPath(url) {
  if (!url) return '/';
  if (typeof url === 'string') {
    if (/^https?:\/\//i.test(url)) return url;
    return url.replace(/^https?:\/\/[^/]+/, '') || url;
  }
  if (url.raw && /^https?:\/\//i.test(url.raw)) return url.raw;
  let path = Array.isArray(url.path) ? '/' + url.path.join('/') : (url.path || '');
  if (!path && url.raw) { try { path = new URL(url.raw).pathname; } catch { path = url.raw; } }
  const q = Array.isArray(url.query) ? url.query.filter(x => !x.disabled && x.key).map(x => `${x.key}=${x.value || ''}`).join('&') : '';
  return path + (q ? '?' + q : '');
}

function synthResponse(method) {
  const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  return {
    status, statusText: status === 201 ? 'Created' : status === 204 ? 'No Content' : 'OK',
    time: 60 + Math.floor(Math.random() * 180), size: status === 204 ? 0 : 180,
    body: status === 204 ? null : { ok: true, note: 'Synthetic response for imported request' },
    headers: { 'content-type': 'application/json; charset=utf-8' },
  };
}

function parsePostman(obj) {
  const collId = qaUid('imp');
  const folders = [];
  const details = {}, responses = {};
  const rootReqs = [];
  const walk = (items, bucket) => {
    (items || []).forEach(it => {
      if (it.item) { const fr = []; walk(it.item, fr); if (fr.length) folders.push({ name: it.name || 'Folder', requests: fr }); }
      else if (it.request) {
        const r = it.request;
        const urlSpec = typeof r === 'string' ? r : r.url;
        const method = (typeof r === 'string' ? 'GET' : r.method) || 'GET';
        const path = pmUrlToPath(urlSpec);
        const id = qaUid('req');
        const headers = (r.header || []).filter(h => !h.disabled).map(h => ({ key: h.key, value: h.value || '', on: true }));
        let query;
        if (typeof urlSpec === 'string') {
          const qIdx = urlSpec.indexOf('?');
          const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
          query = qIdx < 0 ? [] : urlSpec.slice(qIdx + 1).split('&').filter(Boolean).map((kv) => {
            const eq = kv.indexOf('=');
            return eq < 0 ? { key: dec(kv), value: '', on: true } : { key: dec(kv.slice(0, eq)), value: dec(kv.slice(eq + 1)), on: true };
          });
        } else {
          query = (urlSpec && Array.isArray(urlSpec.query)) ? urlSpec.query.filter(q => !q.disabled && q.key).map(q => ({ key: q.key, value: q.value || '', on: true })) : [];
        }
        let body = null;
        if (r.body && r.body.mode === 'raw' && r.body.raw) body = r.body.raw;
        details[id] = { params: query, headers, body, auth: r.auth ? r.auth.type : 'none' };
        responses[id] = synthResponse(method);
        bucket.push({ id, method, name: it.name || `${method} ${path}`, path });
      }
    });
  };
  walk(obj.item, rootReqs);
  if (rootReqs.length) folders.unshift({ name: obj.info.name || 'Requests', requests: rootReqs });
  const all = folders.flatMap(f => f.requests);
  return { collection: { id: collId, name: (obj.info && obj.info.name) || 'Imported collection', count: all.length, folders, source: 'postman' }, details, responses };
}

function oasBase(obj) {
  if (Array.isArray(obj.servers) && obj.servers[0]) return obj.servers[0].url || '';
  if (obj.host) return (obj.schemes && obj.schemes[0] ? obj.schemes[0] : 'https') + '://' + obj.host + (obj.basePath || '');
  return '';
}
const OAS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
function schemaStub(s) {
  if (!s) return {};
  if (s.example) return s.example;
  if (s.type === 'object' && s.properties) {
    const o = {};
    Object.entries(s.properties).slice(0, 12).forEach(([k, v]) => { o[k] = v.example != null ? v.example : (v.type === 'integer' || v.type === 'number' ? 0 : v.type === 'boolean' ? false : v.type === 'array' ? [] : ''); });
    return o;
  }
  return {};
}
function parseOpenApi(obj) {
  const collId = qaUid('imp');
  const byTag = {};
  const details = {}, responses = {};
  Object.entries(obj.paths || {}).forEach(([path, ops]) => {
    OAS_METHODS.forEach(m => {
      const op = ops[m];
      if (!op) return;
      const method = m.toUpperCase();
      const id = qaUid('req');
      const params = (op.parameters || []).filter(p => p.in === 'query').map(p => ({ key: p.name, value: p.example != null ? String(p.example) : '', on: !!p.required }));
      const headers = (op.parameters || []).filter(p => p.in === 'header').map(p => ({ key: p.name, value: '', on: false }));
      let body = null;
      const rb = op.requestBody && op.requestBody.content;
      const ex = rb && (rb['application/json'] || {}).example;
      if (ex) body = JSON.stringify(ex, null, 2);
      else if (rb && (rb['application/json'] || {}).schema) body = JSON.stringify(schemaStub((rb['application/json']).schema), null, 2);
      details[id] = { params, headers, body, auth: op.security ? 'bearer' : 'none' };
      responses[id] = synthResponse(method);
      const tag = (op.tags && op.tags[0]) || 'default';
      (byTag[tag] = byTag[tag] || []).push({ id, method, name: op.summary || op.operationId || `${method} ${path}`, path });
    });
  });
  const folders = Object.entries(byTag).map(([name, requests]) => ({ name, requests }));
  const all = folders.flatMap(f => f.requests);
  const title = (obj.info && obj.info.title) || 'OpenAPI';
  return { collection: { id: collId, name: title, count: all.length, folders, source: 'openapi', baseUrl: oasBase(obj) }, details, responses };
}

export function qaParseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { error: 'Not valid JSON. (YAML specs must be converted to JSON first.)' }; }
  const fmt = qaDetectFormat(obj);
  if (fmt === 'postman') return { ...parsePostman(obj), format: 'Postman v2.1' };
  if (fmt === 'openapi') return { ...parseOpenApi(obj), format: obj.openapi ? `OpenAPI ${obj.openapi}` : obj.swagger ? `Swagger ${obj.swagger}` : 'OpenAPI' };
  return { error: 'Unrecognized format — expected a Postman v2.1 collection or an OpenAPI/Swagger spec.' };
}
