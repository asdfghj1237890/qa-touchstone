import React from 'react';
import './setup';
import { Icon, MethodBadge, MiniCheck } from './components';
import { useI18n } from './useI18n';
import type { QaRequest } from './buildReq';
import type { QaEnv, QaCookie } from './state/WorkspaceContext';

// ── QA Touchstone — code snippet generator (cURL / Python / JS / HTTPie) ────
const { useState: useStateCG } = React;

/** 解析後的有效 request（codegen 各 generator 的輸入）。 */
export interface QaEffectiveReq {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string | null;
  bodyMode: QaRequest['bodyMode'];
}

// Resolve the request into a concrete shape: absolute URL (+query), the full
// header set (incl. auth + cookies), and a body string. `resolve` toggles
// {{variable}} substitution.
function qaEffectiveRequest(req: QaRequest, env: QaEnv | null | undefined, varMap: Record<string, string> | null | undefined, cookies: QaCookie[] | null | undefined, resolve: boolean): QaEffectiveReq {
  const sub = (s: string) => resolve ? window.qaSubstitute!(s, varMap || {}) : s;
  const reqUrlSub = sub(req.url || '');
  // Absolute imported URLs must NOT get env.baseUrl prepended (mirrors the
  // executor and PerfTest URL build).
  const isAbsolute = /^https?:\/\//i.test(reqUrlSub);
  let url = isAbsolute ? reqUrlSub : (sub((env && env.baseUrl) || '') + reqUrlSub);

  // Query params (+ apiKey-in-query)
  const qp = (req.params || []).filter(p => p.on && p.key).map(p => [sub(p.key), sub(p.value)]);
  if (req.auth && req.auth.type === 'apiKey' && req.auth.apiKey.placement === 'query') {
    qp.push([sub(req.auth.apiKey.key), sub(req.auth.apiKey.value)]);
  }
  if (qp.length) {
    const qs = qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    url += (url.includes('?') ? '&' : '?') + qs;
  }

  // Headers
  const headers: Array<[string, string]> = [];
  (req.headers || []).filter(h => h.on && h.key).forEach(h => headers.push([sub(h.key), sub(h.value)]));
  const a = req.auth || { type: 'none' };
  if (a.type === 'bearer') headers.push(['Authorization', 'Bearer ' + sub(a.bearer)]);
  else if (a.type === 'oauth2') headers.push(['Authorization', 'Bearer ' + (a.oauth2 && a.oauth2.scope ? '<access_token>' : '<access_token>')]);
  else if (a.type === 'basic') headers.push(['Authorization', 'Basic ' + btoa(`${sub(a.basic.user)}:${sub(a.basic.pass)}`)]);
  else if (a.type === 'apiKey' && a.apiKey.placement === 'header') headers.push([sub(a.apiKey.key), sub(a.apiKey.value)]);
  else if (a.type === 'aws') headers.push(['X-Amz-Date', '<computed>'], ['Authorization', 'AWS4-HMAC-SHA256 …<signed by client>']);

  // Body
  let body: string | null = null, ctype: string | null = null;
  if (req.bodyMode === 'json' && req.body) { body = sub(req.body); ctype = 'application/json'; }
  else if (req.bodyMode === 'graphql') {
    body = JSON.stringify({ query: sub(req.gqlQuery || ''), variables: safeJson(sub(req.gqlVars || '')) || {} }, null, 2);
    ctype = 'application/json';
  } else if (req.bodyMode === 'form') {
    const f = (req.form || []).filter(x => x.on && x.key).map(x => [sub(x.key), sub(x.value)]);
    body = f.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    ctype = 'application/x-www-form-urlencoded';
  }
  if (ctype && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', ctype]);

  // Cookies
  if (cookies && cookies.length) {
    const cval = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (cval) headers.push(['Cookie', cval]);
  }
  return { method: req.method, url, headers, body, bodyMode: req.bodyMode };
}
function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }
function qShell(s: unknown): string { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function qPy(s: unknown): string { return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

// ── Generators ─────────────────────────────────────────────────────────────
function genCurl(e: QaEffectiveReq) {
  const lines = [`curl -X ${e.method} ${qShell(e.url)}`];
  e.headers.forEach(([k, v]) => lines.push(`  -H ${qShell(`${k}: ${v}`)}`));
  if (e.body != null) lines.push(`  -d ${qShell(e.body)}`);
  return lines.join(' \\\n');
}
function genPython(e: QaEffectiveReq) {
  const hdr = e.headers.map(([k, v]) => `    ${qPy(k)}: ${qPy(v)},`).join('\n');
  const out = [`import requests`, ``, `url = ${qPy(e.url)}`];
  if (e.headers.length) out.push(`headers = {\n${hdr}\n}`);
  let dataArg = '';
  if (e.body != null) {
    if (e.bodyMode === 'json' || e.bodyMode === 'graphql') { out.push(`payload = ${e.body}`); dataArg = ', json=payload'; }
    else { out.push(`payload = ${qPy(e.body)}`); dataArg = ', data=payload'; }
  }
  out.push(``, `resp = requests.request(${qPy(e.method)}, url${e.headers.length ? ', headers=headers' : ''}${dataArg})`, `print(resp.status_code)`, `print(resp.json())`);
  return out.join('\n');
}
function genFetch(e: QaEffectiveReq) {
  const opts = [`  method: ${JSON.stringify(e.method)},`];
  if (e.headers.length) {
    const hdr = e.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
    opts.push(`  headers: {\n${hdr}\n  },`);
  }
  if (e.body != null) {
    if (e.bodyMode === 'json' || e.bodyMode === 'graphql') opts.push(`  body: JSON.stringify(${e.body}),`);
    else opts.push(`  body: ${JSON.stringify(e.body)},`);
  }
  return `const res = await fetch(${JSON.stringify(e.url)}, {\n${opts.join('\n')}\n});\nconst data = await res.json();\nconsole.log(res.status, data);`;
}
function genHttpie(e: QaEffectiveReq) {
  const parts = [`http ${e.method} ${qShell(e.url)}`];
  e.headers.forEach(([k, v]) => parts.push(`${qShell(`${k}:${v}`)}`));
  if (e.body != null && (e.bodyMode === 'json' || e.bodyMode === 'graphql')) {
    try { const o = JSON.parse(e.body); Object.entries(o).forEach(([k, v]) => parts.push(`${k}:=${qShell(JSON.stringify(v))}`)); }
    catch { parts.push(`<<< ${qShell(e.body)}`); }
  }
  return parts.join(' \\\n  ');
}
const QA_LANGS = [
  { key: 'curl', label: 'cURL', gen: genCurl },
  { key: 'python', label: 'Python', gen: genPython },
  { key: 'js', label: 'JS · fetch', gen: genFetch },
  { key: 'httpie', label: 'HTTPie', gen: genHttpie },
];

export interface CodeModalProps {
  req: QaRequest;
  env: QaEnv;
  varMap?: Record<string, string> | null;
  cookies?: QaCookie[] | null;
  onClose: () => void;
}

function CodeModal({ req, env, varMap, cookies, onClose }: CodeModalProps) {
  const { t } = useI18n();
  const [lang, setLang] = useStateCG('curl');
  const [resolve, setResolve] = useStateCG(true);
  const [copied, setCopied] = useStateCG(false);
  const e = qaEffectiveRequest(req, env, varMap, cookies, resolve);
  const code = (QA_LANGS.find(l => l.key === lang) || QA_LANGS[0]).gen(e);
  const copy = () => { try { navigator.clipboard.writeText(code); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <div className="qa-modal-scrim" onMouseDown={onClose}>
      <div className="qa-modal qa-codegen" onMouseDown={ev => ev.stopPropagation()}>
        <div className="qa-modal-head">
          <span className="qa-modal-title"><Icon name="code" size={15} /> {t('codegen.title')}</span>
          <div className="qa-modal-head-route"><MethodBadge method={req.method} size="sm" /> <span>{e.url}</span></div>
          <button className="qa-iconbtn" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={15} /></button>
        </div>
        <div className="qa-codegen-bar">
          <div className="qa-segs qa-segs--mini">
            {QA_LANGS.map(l => <button key={l.key} data-active={lang === l.key ? '1' : '0'} onClick={() => setLang(l.key)}>{l.label}</button>)}
          </div>
          <label className="qa-codegen-resolve">
            <MiniCheck on={resolve} onClick={() => setResolve(r => !r)} /> {t('codegen.resolveVars')}
          </label>
          <button className="qa-hist-expbtn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('common.copied') : t('common.copy')}</button>
        </div>
        <div className="qa-codegen-body">
          <pre className="qa-codegen-pre">{code}</pre>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { qaEffectiveRequest, CodeModal, QA_LANGS });

export { qaEffectiveRequest, CodeModal, QA_LANGS };
