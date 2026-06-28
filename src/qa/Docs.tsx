import React from 'react';
import './setup';
import { Dropdown, Icon } from './components';
import { downloadFile } from './download';
import { useI18n } from './useI18n';
import type { I18nValue } from './i18nContext';
import type { QaEnv } from './state/WorkspaceContext';

// ── QA Touchstone — auto-generated API documentation from a collection ─────
const { useState: useStateDOC } = React;

function docMethodColor(m: string): string {
  return window.QATheme.methodColor(m);
}

// One request entry in the docs.
interface DocRequestProps {
  /** 集合內的單一 request（window.QA canned 形狀，型別從寬）。 */
  r: any;
  env: QaEnv;
  onOpenRequest: (id: string) => void;
}

function DocRequest({ r, env, onOpenRequest }: DocRequestProps) {
  const { t } = useI18n();
  const det = window.QA.REQUEST_DETAILS[r.id] || {};
  const resp = window.QA.RESPONSES[r.id];
  const params = (det.params || []).filter((p: any) => p.key);
  return (
    <div className="doc-req" id={'doc-' + r.id}>
      <div className="doc-req-head">
        <span className="doc-method" style={{ color: docMethodColor(r.method) }}>
          {r.method}
        </span>
        <code className="doc-path">
          {/^https?:\/\//i.test(r.path || '') ? r.path : (env.baseUrl || '') + r.path}
        </code>
        <button className="qa-link doc-open" onClick={() => onOpenRequest(r.id)}>
          {t('docs.openClient')}
        </button>
      </div>
      <div className="doc-req-name">{r.name}</div>

      <div className="doc-req-grid">
        <div className="doc-col">
          {!!params.length && (
            <div className="doc-section">
              <div className="doc-section-t">{t('docs.queryParams')}</div>
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>{t('docs.name')}</th>
                    <th>{t('docs.example')}</th>
                    <th>{t('docs.required')}</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p: any, i: number) => (
                    <tr key={i}>
                      <td>
                        <code>{p.key}</code>
                      </td>
                      <td>{p.value || <span className="doc-muted">—</span>}</td>
                      <td>
                        {p.on === false ? (
                          <span className="doc-muted">{t('common.optional')}</span>
                        ) : (
                          t('common.yes')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="doc-section">
            <div className="doc-section-t">{t('docs.authentication')}</div>
            <div className="doc-auth">
              <Icon name="key" size={12} /> {docAuthLabel(det.auth, t)}
            </div>
          </div>
          {det.body && (
            <div className="doc-section">
              <div className="doc-section-t">
                {t('docs.requestBody')} <span className="doc-ctype">application/json</span>
              </div>
              <pre
                className="doc-pre"
                dangerouslySetInnerHTML={{ __html: window.highlightJson!(det.body) }}
              />
            </div>
          )}
          {det.graphql && (
            <div className="doc-section">
              <div className="doc-section-t">{t('docs.graphqlQuery')}</div>
              <pre className="doc-pre">{det.graphql.query}</pre>
            </div>
          )}
        </div>
        <div className="doc-col">
          <div className="doc-section">
            <div className="doc-section-t">
              {t('docs.exampleResponse')}
              {resp && (
                <span
                  className="doc-status"
                  style={{ color: window.QATheme.statusColor(resp.status) }}
                >
                  {resp.status} {resp.statusText}
                </span>
              )}
            </div>
            {resp && resp.body != null ? (
              <pre
                className="doc-pre"
                dangerouslySetInnerHTML={{
                  __html: window.highlightJson!(JSON.stringify(resp.body, null, 2)),
                }}
              />
            ) : (
              <div className="doc-muted doc-nobody">{t('docs.noResponseBody')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
function docAuthLabel(authType: string, t: I18nValue['t']): string {
  return (
    (
      {
        bearer: t('docs.auth.bearer'),
        oauth2: t('docs.auth.oauth2'),
        apiKey: t('docs.auth.apiKey'),
        basic: t('docs.auth.basic'),
        aws: t('docs.auth.aws'),
        none: t('docs.auth.none'),
      } as Record<string, string>
    )[authType] || t('docs.auth.fallback')
  );
}

export interface DocsPageProps {
  env: QaEnv;
  onOpenRequest: (id: string) => void;
}

function DocsPage({ env, onOpenRequest }: DocsPageProps) {
  const { t } = useI18n();
  const cols = window.QA.COLLECTIONS;
  const [colId, setColId] = useStateDOC(cols[0].id);
  const col = cols.find((c: any) => c.id === colId) || cols[0];
  const allReqs = col.folders.flatMap((f: any) => f.requests);

  const exportHtml = () => {
    const html = buildDocsHtml(col, env, t);
    const name = `${col.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-docs.html`;
    downloadFile(name, html, 'text/html');
  };

  return (
    <div className="qa-docs">
      <aside className="doc-nav">
        <div className="doc-nav-head">
          <label className="qa-side-label">
            <Icon name="fileText" size={12} /> {t('docs.documentation')}
          </label>
          <Dropdown
            value={colId}
            options={cols.map((c: any) => ({ value: c.id, label: c.name }))}
            onChange={setColId}
          />
        </div>
        <div className="doc-nav-scroll">
          {col.folders.map((f: any) => (
            <div key={f.name} className="doc-nav-group">
              <div className="doc-nav-folder">{f.name}</div>
              {f.requests.map((r: any) => (
                <a
                  key={r.id}
                  className="doc-nav-link"
                  href={'#doc-' + r.id}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById('doc-' + r.id);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <span className="doc-nav-m" style={{ color: docMethodColor(r.method) }}>
                    {r.method}
                  </span>
                  <span className="doc-nav-name">{r.name}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="doc-main">
        <div className="doc-hero">
          <div>
            <h1>{col.name}</h1>
            <p className="doc-sub">
              {t('docs.heroSub', {
                count: allReqs.length,
                baseUrl: env.baseUrl || t('common.notSet'),
              })}
            </p>
          </div>
          <button className="qa-hist-expbtn" onClick={exportHtml}>
            <Icon name="download" size={13} /> {t('docs.exportHtml')}
          </button>
        </div>
        <div className="doc-body">
          {allReqs.map((r: any) => (
            <DocRequest key={r.id} r={r} env={env} onOpenRequest={onOpenRequest} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Standalone HTML export of the docs.
function buildDocsHtml(col: any, env: QaEnv, t: I18nValue['t'] = (key) => key): string {
  const sc = window.QATheme.statusColor,
    mc = window.QATheme.methodColor;
  const reqs = col.folders.flatMap((f: any) =>
    f.requests.map((r: any) => ({ ...r, folder: f.name }))
  );
  const esc = (s: unknown) =>
    String(s).replace(
      /[&<>]/g,
      (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }) as Record<string, string>)[c]
    );
  const sections = reqs
    .map((r: any) => {
      const det = window.QA.REQUEST_DETAILS[r.id] || {};
      const resp = window.QA.RESPONSES[r.id];
      const params = (det.params || []).filter((p: any) => p.key);
      const pTable = params.length
        ? `<table><tr><th>${esc(t('docs.name'))}</th><th>${esc(t('docs.example'))}</th><th>${esc(t('docs.required'))}</th></tr>${params.map((p: any) => `<tr><td><code>${esc(p.key)}</code></td><td>${esc(p.value || '—')}</td><td>${p.on === false ? esc(t('common.optional')) : esc(t('common.yes'))}</td></tr>`).join('')}</table>`
        : '';
      const body = det.body
        ? `<h4>${esc(t('docs.requestBody'))}</h4><pre>${esc(det.body)}</pre>`
        : '';
      const respHtml =
        resp && resp.body != null
          ? `<h4>${esc(t('docs.exampleResponse'))} <b style="color:${sc(resp.status)}">${resp.status} ${esc(resp.statusText)}</b></h4><pre>${esc(JSON.stringify(resp.body, null, 2))}</pre>`
          : '';
      const fullUrl = /^https?:\/\//i.test(r.path || '') ? r.path : (env.baseUrl || '') + r.path;
      return `<section><div class="rh"><span class="m" style="color:${mc(r.method)}">${esc(r.method)}</span> <code>${esc(fullUrl)}</code></div><div class="rn">${esc(r.name)}</div><div class="auth">${esc(t('docs.report.auth'))}: ${esc(docAuthLabel(det.auth, t))}</div>${pTable}${body}${respHtml}</section>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(col.name)} — API docs</title><style>
  body{margin:0;background:#15181c;color:#e6edf3;font-family:'Google Sans Code',ui-monospace,monospace;font-size:13px;padding:40px}
  .wrap{max-width:840px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:#97a3ae;margin-bottom:32px}
  section{border:1px solid #272d34;border-radius:10px;padding:18px 20px;margin-bottom:16px}
  .rh{font-size:13px;margin-bottom:6px;word-break:break-all}.m{font-weight:700;margin-right:8px}
  .rn{font-size:15px;font-weight:600;margin-bottom:10px}.auth{color:#97a3ae;font-size:12px;margin-bottom:12px}
  h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#97a3ae;margin:14px 0 6px}
  table{width:100%;border-collapse:collapse;margin-bottom:6px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #272d34;font-size:12px}th{color:#97a3ae;font-weight:600}
  pre{background:#1a1e23;border:1px solid #272d34;border-radius:8px;padding:12px;overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap;margin:0}code{color:#a9c7f2}
  .foot{color:#626d77;font-size:11px;margin-top:24px}</style></head><body><div class="wrap">
  <h1>${esc(col.name)}</h1><div class="sub">${esc(t('docs.exportSub', { count: reqs.length, baseUrl: env.baseUrl || t('common.notSet'), date: new Date().toLocaleString() }))}</div>
  ${sections}<div class="foot">${esc(t('response.report.generated'))}</div></div></body></html>`;
}

Object.assign(window, { DocsPage, buildDocsHtml });

export { DocsPage, buildDocsHtml };
