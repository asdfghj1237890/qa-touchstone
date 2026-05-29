import React from 'react';
import './setup.js';
import { Icon } from './components.jsx';

// ── QA Companion — import Postman v2.1 collections & OpenAPI/Swagger specs ─
const { useState: useStateIM, useRef: useRefIM } = React;

let qaImportSeq = 0;
function qaUid(prefix) { return `${prefix}-${(qaImportSeq++).toString(36)}-${Date.now().toString(36).slice(-4)}`; }

// Detect which format a parsed JSON object is.
function qaDetectFormat(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.info && (obj.item || obj.info._postman_id || /v2\.[01]/.test(obj.info.schema || ''))) return 'postman';
  if (obj.openapi || obj.swagger || (obj.paths && typeof obj.paths === 'object')) return 'openapi';
  return null;
}

// ── Postman v2.1 → internal shape ──────────────────────────────────────────
function pmUrlToPath(url) {
  if (!url) return '/';
  if (typeof url === 'string') { try { return new URL(url).pathname + (new URL(url).search || ''); } catch { return url.replace(/^https?:\/\/[^/]+/, '') || url; } }
  let path = Array.isArray(url.path) ? '/' + url.path.join('/') : (url.path || '');
  if (!path && url.raw) { try { path = new URL(url.raw).pathname; } catch { path = url.raw; } }
  const q = Array.isArray(url.query) ? url.query.filter(x => !x.disabled && x.key).map(x => `${x.key}=${x.value || ''}`).join('&') : '';
  return path + (q ? '?' + q : '');
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
        const method = (typeof r === 'string' ? 'GET' : r.method) || 'GET';
        const path = pmUrlToPath(typeof r === 'string' ? r : r.url);
        const id = qaUid('req');
        const headers = (r.header || []).filter(h => !h.disabled).map(h => ({ key: h.key, value: h.value || '', on: true }));
        const query = (r.url && Array.isArray(r.url.query)) ? r.url.query.filter(q => !q.disabled && q.key).map(q => ({ key: q.key, value: q.value || '', on: true })) : [];
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

// ── OpenAPI 3 / Swagger 2 → internal shape ─────────────────────────────────
function oasBase(obj) {
  if (Array.isArray(obj.servers) && obj.servers[0]) return obj.servers[0].url || '';
  if (obj.host) return (obj.schemes && obj.schemes[0] ? obj.schemes[0] : 'https') + '://' + obj.host + (obj.basePath || '');
  return '';
}
const OAS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
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
function synthResponse(method) {
  const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  return {
    status, statusText: status === 201 ? 'Created' : status === 204 ? 'No Content' : 'OK',
    time: 60 + Math.floor(Math.random() * 180), size: status === 204 ? 0 : 180,
    body: status === 204 ? null : { ok: true, note: 'Synthetic response for imported request' },
    headers: { 'content-type': 'application/json; charset=utf-8' },
  };
}

function qaParseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { error: 'Not valid JSON. (YAML specs must be converted to JSON first.)' }; }
  const fmt = qaDetectFormat(obj);
  if (fmt === 'postman') return { ...parsePostman(obj), format: 'Postman v2.1' };
  if (fmt === 'openapi') return { ...parseOpenApi(obj), format: obj.openapi ? `OpenAPI ${obj.openapi}` : obj.swagger ? `Swagger ${obj.swagger}` : 'OpenAPI' };
  return { error: 'Unrecognized format — expected a Postman v2.1 collection or an OpenAPI/Swagger spec.' };
}

function ImportModal({ onClose, onImport }) {
  const [text, setText] = useStateIM('');
  const [drag, setDrag] = useStateIM(false);
  const fileRef = useRefIM(null);
  const parsed = text.trim() ? qaParseImport(text) : null;
  const ok = parsed && !parsed.error;

  const readFile = (file) => { const fr = new FileReader(); fr.onload = () => setText(String(fr.result || '')); fr.readAsText(file); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); };

  return (
    <div className="qa-modal-scrim" onMouseDown={onClose}>
      <div className="qa-modal qa-import" onMouseDown={ev => ev.stopPropagation()}>
        <div className="qa-modal-head">
          <span className="qa-modal-title"><Icon name="download" size={15} /> Import collection</span>
          <button className="qa-iconbtn" onClick={onClose} aria-label="close"><Icon name="x" size={15} /></button>
        </div>
        <div className="qa-import-body">
          <div className={'qa-import-drop' + (drag ? ' is-drag' : '')}
               onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
               onClick={() => fileRef.current && fileRef.current.click()}>
            <Icon name="upload" size={22} stroke={1.6} />
            <strong>Drop a file or click to browse</strong>
            <em>Postman v2.1 collection (.json) · OpenAPI / Swagger (.json)</em>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                   onChange={e => { const f = e.target.files[0]; if (f) readFile(f); }} />
          </div>
          <div className="qa-import-or">or paste below</div>
          <textarea className="qa-code-input qa-import-text" spellCheck="false" placeholder='{ "info": { … }, "item": [ … ] }'
                    value={text} onChange={e => setText(e.target.value)} />
          {parsed && parsed.error && <div className="rn-data-err"><Icon name="x" size={12} /> {parsed.error}</div>}
          {ok && (
            <div className="qa-import-preview">
              <div className="qa-import-preview-head">
                <span className="qa-cred-type" data-type={parsed.collection.source === 'postman' ? 'bearer' : 'basic'}>{parsed.format}</span>
                <strong>{parsed.collection.name}</strong>
                <span className="qa-meta">{parsed.collection.count} request{parsed.collection.count !== 1 ? 's' : ''} · {parsed.collection.folders.length} folder{parsed.collection.folders.length !== 1 ? 's' : ''}</span>
              </div>
              {parsed.collection.baseUrl && <div className="qa-env-url">{parsed.collection.baseUrl}</div>}
            </div>
          )}
        </div>
        <div className="qa-modal-foot">
          <button className="qa-pathbtn" onClick={onClose}>Cancel</button>
          <button className="qa-send" disabled={!ok} onClick={() => { onImport(parsed); onClose(); }}>
            <Icon name="download" size={14} /> Import {ok ? `${parsed.collection.count} request${parsed.collection.count !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { qaParseImport, ImportModal });

export { qaParseImport, ImportModal };
