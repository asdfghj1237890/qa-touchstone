// ── QA Touchstone — Postman v2.1 / OpenAPI parser ──────────────────────────
// Pure parser. No React, no DOM, no setup.js side effects. Lives apart from
// ImportData.jsx so setup.js can auto-load the bundled demo collection at
// boot without dragging the import-modal UI (and React) into the side-effect
// import graph.

/** 匯入後的單一 request 條目（collection sidebar 用的 meta）。 */
export interface QaImportRequestMeta {
  id: string;
  method: string;
  name: string;
  path: string;
}

/** 匯入後的資料夾（tag / Postman folder）。 */
export interface QaImportFolder {
  name: string;
  requests: QaImportRequestMeta[];
}

/** 匯入後的 collection（baseUrl 僅 OpenAPI 來源有）。 */
export interface QaImportCollection {
  id: string;
  name: string;
  count: number;
  folders: QaImportFolder[];
  source: 'postman' | 'openapi';
  baseUrl?: string;
}

/** 每個 request 的細節（params/headers/body/auth）。 */
export interface QaImportDetail {
  params: Array<{ key: string; value: string; on: boolean }>;
  headers: Array<{ key: string; value: string; on: boolean }>;
  body: string | null;
  auth: string;
}

/** 匯入請求的合成回應（canned fallback 用）。 */
export interface QaImportSynthResponse {
  status: number;
  statusText: string;
  time: number;
  size: number;
  body: { ok: boolean; note: string } | null;
  headers: Record<string, string>;
}

/** parsePostman / parseOpenApi 的共同回傳。 */
export interface QaImportParsed {
  collection: QaImportCollection;
  details: Record<string, QaImportDetail>;
  responses: Record<string, QaImportSynthResponse>;
}

/** qaParseImport 的回傳：成功（含 format 標籤）或錯誤訊息。 */
export type QaImportResult = (QaImportParsed & { format: string }) | { error: string };

let qaImportSeq = 0;
function qaUid(prefix: string): string { return `${prefix}-${(qaImportSeq++).toString(36)}-${Date.now().toString(36).slice(-4)}`; }

export function qaDetectFormat(obj: any): 'postman' | 'openapi' | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.info && (obj.item || obj.info._postman_id || /v2\.[01]/.test(obj.info.schema || ''))) return 'postman';
  if (obj.openapi || obj.swagger || (obj.paths && typeof obj.paths === 'object')) return 'openapi';
  return null;
}

function pmUrlToPath(url: any): string {
  if (!url) return '/';
  if (typeof url === 'string') {
    if (/^https?:\/\//i.test(url)) return url;
    return url.replace(/^https?:\/\/[^/]+/, '') || url;
  }
  if (url.raw && /^https?:\/\//i.test(url.raw)) return url.raw;
  let path = Array.isArray(url.path) ? '/' + url.path.join('/') : (url.path || '');
  if (!path && url.raw) { try { path = new URL(url.raw).pathname; } catch { path = url.raw; } }
  const q = Array.isArray(url.query) ? url.query.filter((x: any) => !x.disabled && x.key).map((x: any) => `${x.key}=${x.value || ''}`).join('&') : '';
  return path + (q ? '?' + q : '');
}

function synthResponse(method: string): QaImportSynthResponse {
  const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  return {
    status, statusText: status === 201 ? 'Created' : status === 204 ? 'No Content' : 'OK',
    time: 60 + Math.floor(Math.random() * 180), size: status === 204 ? 0 : 180,
    body: status === 204 ? null : { ok: true, note: 'Synthetic response for imported request' },
    headers: { 'content-type': 'application/json; charset=utf-8' },
  };
}

function parsePostman(obj: any): QaImportParsed {
  const collId = qaUid('imp');
  const folders: QaImportFolder[] = [];
  const details: Record<string, QaImportDetail> = {}, responses: Record<string, QaImportSynthResponse> = {};
  const rootReqs: QaImportRequestMeta[] = [];
  const walk = (items: any, bucket: QaImportRequestMeta[]) => {
    (items || []).forEach((it: any) => {
      if (it.item) { const fr: QaImportRequestMeta[] = []; walk(it.item, fr); if (fr.length) folders.push({ name: it.name || 'Folder', requests: fr }); }
      else if (it.request) {
        const r = it.request;
        const urlSpec = typeof r === 'string' ? r : r.url;
        const method = (typeof r === 'string' ? 'GET' : r.method) || 'GET';
        const path = pmUrlToPath(urlSpec);
        const id = qaUid('req');
        const headers = (r.header || []).filter((h: any) => !h.disabled).map((h: any) => ({ key: h.key, value: h.value || '', on: true }));
        let query;
        if (typeof urlSpec === 'string') {
          const qIdx = urlSpec.indexOf('?');
          const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
          query = qIdx < 0 ? [] : urlSpec.slice(qIdx + 1).split('&').filter(Boolean).map((kv) => {
            const eq = kv.indexOf('=');
            return eq < 0 ? { key: dec(kv), value: '', on: true } : { key: dec(kv.slice(0, eq)), value: dec(kv.slice(eq + 1)), on: true };
          });
        } else {
          query = (urlSpec && Array.isArray(urlSpec.query)) ? urlSpec.query.filter((q: any) => !q.disabled && q.key).map((q: any) => ({ key: q.key, value: q.value || '', on: true })) : [];
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

function oasBase(obj: any): string {
  if (Array.isArray(obj.servers) && obj.servers[0]) return obj.servers[0].url || '';
  if (obj.host) return (obj.schemes && obj.schemes[0] ? obj.schemes[0] : 'https') + '://' + obj.host + (obj.basePath || '');
  return '';
}
const OAS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
function schemaStub(s: any): any {
  if (!s) return {};
  if (s.example) return s.example;
  if (s.type === 'object' && s.properties) {
    const o: Record<string, any> = {};
    Object.entries(s.properties).slice(0, 12).forEach(([k, v]: [string, any]) => { o[k] = v.example != null ? v.example : (v.type === 'integer' || v.type === 'number' ? 0 : v.type === 'boolean' ? false : v.type === 'array' ? [] : ''); });
    return o;
  }
  return {};
}
function parseOpenApi(obj: any): QaImportParsed {
  const collId = qaUid('imp');
  const byTag: Record<string, QaImportRequestMeta[]> = {};
  const details: Record<string, QaImportDetail> = {}, responses: Record<string, QaImportSynthResponse> = {};
  Object.entries(obj.paths || {}).forEach(([path, ops]: [string, any]) => {
    OAS_METHODS.forEach(m => {
      const op = ops[m];
      if (!op) return;
      const method = m.toUpperCase();
      const id = qaUid('req');
      const params = (op.parameters || []).filter((p: any) => p.in === 'query').map((p: any) => ({ key: p.name, value: p.example != null ? String(p.example) : '', on: !!p.required }));
      const headers = (op.parameters || []).filter((p: any) => p.in === 'header').map((p: any) => ({ key: p.name, value: '', on: false }));
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

export function qaParseImport(text: string): QaImportResult {
  let obj;
  try { obj = JSON.parse(text); } catch { return { error: 'Not valid JSON. (YAML specs must be converted to JSON first.)' }; }
  const fmt = qaDetectFormat(obj);
  if (fmt === 'postman') return { ...parsePostman(obj), format: 'Postman v2.1' };
  if (fmt === 'openapi') return { ...parseOpenApi(obj), format: obj.openapi ? `OpenAPI ${obj.openapi}` : obj.swagger ? `Swagger ${obj.swagger}` : 'OpenAPI' };
  return { error: 'Unrecognized format — expected a Postman v2.1 collection or an OpenAPI/Swagger spec.' };
}
