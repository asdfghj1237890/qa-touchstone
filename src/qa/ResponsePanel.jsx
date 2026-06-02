import React from 'react';
import './setup.js';
import { Icon, Spinner, StatusPill, highlightJson } from './components.jsx';
import { qaCallLLM } from './llm.js';
import { useI18n } from './useI18n.js';

// ── QA Companion — response panel (hero: send → response animates in) ─────
const { useState: useStateRP, useEffect: useEffectRP, useRef: useRefRP } = React;

function syntaxHighlight(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let cls = 'qa-j-num';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'qa-j-key' : 'qa-j-str';
      else if (/true|false/.test(m)) cls = 'qa-j-bool';
      else if (/null/.test(m)) cls = 'qa-j-null';
      return `<span class="${cls}">${m}</span>`;
    }
  );
}

function useCountUp(target, run, ms = 520) {
  const [val, setVal] = useStateRP(0);
  useEffectRP(() => {
    if (!run) { setVal(0); return; }
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(() => setVal(target), ms + 80); // land even if RAF is throttled
    return () => { cancelAnimationFrame(raf); clearTimeout(safety); };
  }, [target, run]);
  return val;
}

function CodeBlock({ text }) {
  const lines = syntaxHighlight(text).split('\n');
  return (
    <div className="qa-code">
      <div className="qa-code-gutter">
        {lines.map((_, i) => <span key={i}>{i + 1}</span>)}
      </div>
      <pre className="qa-code-pre">
        {lines.map((ln, i) => (
          <div key={i} className="qa-code-line" dangerouslySetInnerHTML={{ __html: ln || ' ' }} />
        ))}
      </pre>
    </div>
  );
}

function rpDownload(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function reqReportObj(req, env, response) {
  const headers = req.headers.filter(h => h.on && h.key).reduce((o, h) => (o[h.key] = h.value, o), {});
  const params = req.params.filter(p => p.on && p.key).reduce((o, p) => (o[p.key] = p.value, o), {});
  const mask = (s) => s ? String(s).slice(0, 4) + '••••(masked)' : '';
  const auth = {
    none: { type: 'none' },
    bearer: { type: 'bearer', token: mask(req.auth.bearer) },
    apiKey: { type: 'apiKey', key: req.auth.apiKey.key, value: mask(req.auth.apiKey.value), in: req.auth.apiKey.placement },
    basic: { type: 'basic', username: req.auth.basic.user, password: '••••(masked)' },
    aws: { type: 'aws-sigv4', profile: req.auth.aws.profile, service: req.auth.aws.service, region: req.auth.aws.region },
  }[req.auth.type];
  return {
    generatedAt: new Date().toISOString(),
    request: {
      method: req.method, url: (/^https?:\/\//i.test(req.url || '') ? req.url : ((env.baseUrl || '') + req.url)), environment: env.label,
      params, headers, auth,
      body: req.bodyMode === 'json' && req.body ? safeParse(req.body) : (req.bodyMode === 'none' ? null : req.body),
    },
    response: {
      status: response.status, statusText: response.statusText, timeMs: response.time, sizeBytes: response.size,
      headers: response.headers, body: response.body,
    },
  };
}

// HTML-escape attacker-influenced strings before interpolating into the
// generated report. highlightJson already escapes the JSON pre blocks, but
// raw response headers / URL / env label etc. are user-or-server-controlled
// and must be escaped here.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reqReportHtml(req, env, response, t) {
  const o = reqReportObj(req, env, response);
  const sc = window.QATheme.statusColor(response.status);
  const hl = (obj) => window.highlightJson(JSON.stringify(obj, null, 2));
  const hrows = (h) => Object.entries(h || {}).map(([k, v]) => `<tr><td class="k">${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('') || `<tr><td colspan="2" class="muted">${escHtml(t('common.none'))}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Companion — ${escHtml(req.method)} ${escHtml(o.request.url)}</title>
<style>
  body{margin:0;background:#15181c;color:#e6edf3;font-family:'Google Sans Code',ui-monospace,monospace;font-size:13px;padding:32px}
  .wrap{max-width:820px;margin:0 auto}h1{font-size:16px;margin:0 0 16px;word-break:break-all}
  .meth{color:#4d9fff;font-weight:700;margin-right:8px}
  .status{display:inline-flex;align-items:center;gap:7px;font-weight:700;margin:0 0 18px}.dot{width:8px;height:8px;border-radius:50%}
  .meta{color:#97a3ae;font-size:12px;margin-bottom:18px}.meta b{color:#e6edf3}
  h2{font-size:12px;color:#97a3ae;text-transform:uppercase;letter-spacing:.05em;margin:22px 0 8px}
  table{width:100%;border-collapse:collapse;margin-bottom:6px}td{padding:6px 8px;border-bottom:1px solid #272d34;font-size:12px;vertical-align:top;word-break:break-all}.k{color:#97a3ae;width:34%}.muted{color:#626d77}
  pre{background:#1a1e23;border:1px solid #272d34;border-radius:8px;padding:14px;overflow:auto;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
  .qa-j-key{color:#a9c7f2}.qa-j-str{color:#8fd6a6}.qa-j-num{color:#e6c07a}.qa-j-bool{color:#c2a6ef}.qa-j-null{color:#626d77;font-style:italic}
  .foot{color:#626d77;font-size:11px;margin-top:26px}
</style></head><body><div class="wrap">
  <h1><span class="meth">${escHtml(req.method)}</span>${escHtml(o.request.url)}</h1>
  <div class="status" style="color:${sc}"><span class="dot" style="background:${sc}"></span>${escHtml(response.status)} ${escHtml(response.statusText)}</div>
  <div class="meta">${escHtml(t('response.report.environment'))} <b>${escHtml(env.label)}</b> · ${escHtml(response.time)} ms · ${escHtml(fmtBytes(response.size))} · ${escHtml(t('response.report.auth'))} <b>${escHtml(o.request.auth.type)}</b></div>
  <h2>${escHtml(t('response.report.requestHeaders'))}</h2><table>${hrows(o.request.headers)}</table>
  ${Object.keys(o.request.params).length ? `<h2>${escHtml(t('response.report.queryParams'))}</h2><table>${hrows(o.request.params)}</table>` : ''}
  ${o.request.body != null ? `<h2>${escHtml(t('response.report.requestBody'))}</h2><pre>${hl(o.request.body)}</pre>` : ''}
  <h2>${escHtml(t('response.report.responseHeaders'))}</h2><table>${hrows(o.response.headers)}</table>
  <h2>${escHtml(t('response.report.responseBody'))}</h2>${o.response.body != null ? `<pre>${hl(o.response.body)}</pre>` : `<div class="muted">${escHtml(t('response.report.noBody'))}</div>`}
  <div class="foot">${escHtml(t('response.report.generated'))}</div>
</div></body></html>`;
}

function ResponsePanel({ state, response, req, env, varMap, testList }) {
  const { t } = useI18n();
  // state: 'empty' | 'loading' | 'done'
  const [tab, setTab] = useStateRP('body');
  const [copied, setCopied] = useStateRP(false);
  const [menu, setMenu] = useStateRP(false);
  const [aiState, setAiState] = useStateRP('idle'); // idle | loading | done | error
  const [aiText, setAiText] = useStateRP('');
  const aiMountedRef = useRefRP(true);
  // Setup MUST restore true: under React.StrictMode the mount runs
  // setup→cleanup→setup, so a cleanup-only effect would leave this stuck false
  // and make reviewWithAI's post-await guard skip setAiState (stuck "Reviewing…").
  useEffectRP(() => { aiMountedRef.current = true; return () => { aiMountedRef.current = false; }; }, []);
  // Clear any prior AI verdict whenever a new response arrives, so an old
  // review can't linger under a freshly sent request and mislead the user.
  useEffectRP(() => { setAiState('idle'); setAiText(''); }, [response]);
  const reviewWithAI = async () => {
    if (!response) return;
    setAiState('loading'); setAiText('');
    const expected = (testList || []).map(t => window.qaAssertLabel ? window.qaAssertLabel(t) : JSON.stringify(t));
    const bodyStr = response.body == null ? t('response.prompt.noBody') : JSON.stringify(response.body).slice(0, 1500);
    const prompt = [
      'You are a senior QA engineer reviewing one API response. Be terse (max 4 lines).',
      'Say whether it looks correct, and flag anything suspicious (wrong status, error body, missing fields, security smells).',
      `REQUEST: ${req.method} ${req.url}`,
      expected.length ? `EXPECTED (assertions): ${expected.join('; ')}` : 'EXPECTED: (none specified)',
      `RESPONSE: ${response.status} ${response.statusText}, ${response.time}ms`,
      `BODY: ${bodyStr}`,
    ].join('\n');
    try {
      const out = await qaCallLLM(prompt);
      if (!aiMountedRef.current) return;
      setAiText(String(out || '').trim() || t('response.ai.empty')); setAiState('done');
    } catch (e) {
      if (!aiMountedRef.current) return;
      setAiText(t('response.ai.error', { message: String(e && e.message || e) })); setAiState('error');
    }
  };
  const run = state === 'done';
  const time = useCountUp(response ? response.time : 0, run);
  const size = useCountUp(response ? response.size : 0, run);

  useEffectRP(() => { if (state !== 'done') setTab('body'); }, [state]);

  if (state === 'empty') {
    return (
      <section className="qa-resp qa-resp--empty">
        <div className="qa-resp-empty">
          <div className="qa-resp-empty-icon"><Icon name="send" size={26} stroke={1.6} /></div>
          <div className="qa-resp-empty-title">{t('response.empty.title')}</div>
          <div className="qa-resp-empty-sub">{t('response.empty.subBefore')} <kbd>{t('common.send')}</kbd> {t('response.empty.subAfter')}</div>
        </div>
      </section>
    );
  }

  const bodyText = response && response.body !== null
    ? JSON.stringify(response.body, null, 2)
    : '';
  const headerEntries = response ? Object.entries(response.headers) : [];
  const testResults = response ? window.qaRunAssertions(testList || [], response) : [];
  const testsPassed = testResults.filter(r => r.pass).length;

  const doCopy = () => {
    try { navigator.clipboard.writeText(bodyText || ''); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };
  const doExport = (fmt) => {
    setMenu(false);
    const base = `qa-${req.method}-${(req.url.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'request')}`;
    if (fmt === 'json') rpDownload(base + '.json', JSON.stringify(reqReportObj(req, env, response), null, 2), 'application/json');
    else if (fmt === 'html') rpDownload(base + '.html', reqReportHtml(req, env, response, t), 'text/html');
    else rpDownload(base + '-body.json', bodyText || '', 'application/json');
  };

  const reqPreview = {
    method: req.method,
    url: /^https?:\/\//i.test(req.url || '') ? req.url : ((env.baseUrl || '') + req.url),
    auth: req.auth.type,
    headers: req.headers.filter(h => h.on && h.key).reduce((o, h) => (o[h.key] = h.value, o), {}),
    body: req.bodyMode === 'json' && req.body ? safeParse(req.body) : undefined,
  };

  return (
    <section className="qa-resp">
      {/* Status bar */}
      <div className="qa-resp-bar" data-loading={state === 'loading' ? '1' : '0'}>
        {state === 'loading' ? (
          <div className="qa-resp-loading"><Spinner size={14} /> {t('response.loading')}</div>
        ) : (
          <div className="qa-resp-stats">
            <StatusPill code={response.status} text={response.statusText} big />
            <span className="qa-resp-stat"><Icon name="clock" size={13} /> {Math.round(time)} <em>ms</em></span>
            <span className="qa-resp-stat"><Icon name="download" size={13} /> {fmtBytes(size)}</span>
            <div className="qa-resp-actions">
              <button className="qa-iconbtn" title={t('response.copyBody')} onClick={doCopy}>
                <Icon name={copied ? 'check' : 'copy'} size={14} />
              </button>
              <div className="rp-export">
                <button className="qa-iconbtn" title={t('response.exportReport')} onClick={() => setMenu(m => !m)}><Icon name="download" size={14} /></button>
                {menu && (
                  <div className="rp-export-menu">
                    <button onClick={() => doExport('html')}>{t('response.export.html')}</button>
                    <button onClick={() => doExport('json')}>{t('response.export.json')}</button>
                    <button onClick={() => doExport('body')}>{t('response.export.body')}</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {state === 'loading' && <div className="qa-progress"><span /></div>}
      </div>

      {/* Tabs */}
      {state === 'done' && (
        <>
          <div className="qa-tabs qa-tabs--resp">
            {[
              { key: 'body', label: t('response.tab.body'), icon: 'code' },
              { key: 'headers', label: t('response.tab.headers'), icon: 'request', count: headerEntries.length },
              { key: 'tests', label: t('response.tab.tests'), icon: 'check', count: (testList || []).length ? `${testsPassed}/${testResults.length}` : 0 },
              { key: 'request', label: t('response.tab.request'), icon: 'send' },
            ].map(t => (
              <button key={t.key} data-active={tab === t.key ? '1' : '0'} onClick={() => setTab(t.key)}>
                <Icon name={t.icon} size={13} /> {t.label}
                {!!t.count && <span className="qa-tab-count">{t.count}</span>}
              </button>
            ))}
            {tab === 'body' && bodyText && <span className="qa-resp-lang">JSON</span>}
          </div>

          <div className="qa-resp-body qa-anim-in" key={response.status + '-' + tab}>
            {tab === 'body' && (bodyText
              ? <CodeBlock text={bodyText} />
              : <div className="qa-resp-empty-body"><Icon name="check" size={18} /> {t('response.noBody', { status: response.status, statusText: response.statusText })}</div>)}
            {tab === 'headers' && (
              <div className="qa-hdrs">
                {headerEntries.map(([k, v]) => (
                  <div className="qa-hdr-row" key={k}>
                    <span className="qa-hdr-k">{k}</span>
                    <span className="qa-hdr-v">{v}</span>
                  </div>
                ))}
              </div>
            )}
            {tab === 'request' && <CodeBlock text={JSON.stringify(reqPreview, null, 2)} />}
            {tab === 'tests' && (
              (testList || []).length === 0
                ? <div className="qa-resp-empty-body"><Icon name="check" size={16} /> {t('response.noTests')}</div>
                : <div className="qa-test-results">
                    <div className="qa-test-summary" data-pass={testsPassed === testResults.length ? '1' : '0'}>
                      <Icon name={testsPassed === testResults.length ? 'check' : 'x'} size={14} stroke={3} />
                      {t('response.testSummary', { passed: testsPassed, total: testResults.length })}
                    </div>
                    {testResults.map((r, i) => (
                      <div className="qa-test-row" data-pass={r.pass ? '1' : '0'} key={i}>
                        <Icon name={r.pass ? 'check' : 'x'} size={13} stroke={3} />
                        <span className="qa-test-label">{window.qaAssertLabel(r)}</span>
                        <span className="qa-test-actual">{t('common.got', { actual: r.actual })}</span>
                      </div>
                    ))}
                  </div>
            )}
          </div>

          <div className="qa-resp-ai">
            <button className="qa-hist-expbtn" onClick={reviewWithAI} disabled={aiState === 'loading'}>
              <Icon name="sparkle" size={13} /> {aiState === 'loading' ? t('response.ai.reviewing') : t('response.ai.review')}
            </button>
            {aiState !== 'idle' && aiState !== 'loading' && (
              <div className="qa-resp-ai-out" data-err={aiState === 'error' ? '1' : '0'}>{aiText}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }
function fmtBytes(b) {
  b = Math.round(b);
  if (b <= 0) return '0 B';
  if (b < 1024) return b + ' B';
  return (b / 1024).toFixed(1) + ' KB';
}

Object.assign(window, { ResponsePanel });

export { ResponsePanel };
