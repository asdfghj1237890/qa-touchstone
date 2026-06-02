import React from 'react';
import './setup.js';
import { Dropdown, Icon, MiniCheck, Spinner } from './components.jsx';
import { CodeModal } from './CodeGen.jsx';
import { GraphQLEditor } from './GraphQL.jsx';
import { useI18n } from './useI18n.js';

// ── QA Companion — request builder ────────────────────────────────────────
const { useState: useStateRB } = React;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES = [
  { key: 'none',   labelKey: 'request.auth.none' },
  { key: 'bearer', labelKey: 'request.auth.bearer' },
  { key: 'oauth2', labelKey: 'request.auth.oauth2' },
  { key: 'apiKey', labelKey: 'request.auth.apiKey' },
  { key: 'basic',  labelKey: 'request.auth.basic' },
  { key: 'aws',    labelKey: 'request.auth.aws' },
];

function KVTable({ rows, onChange, keyPh = 'Key', valPh = 'Value', varMap }) {
  const { t } = useI18n();
  const update = (i, field, val) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
    onChange(next);
  };
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: '', value: '', on: true }]);
  const addLabel = t('common.addNamed', { name: String(keyPh).toLowerCase() });
  return (
    <div className="qa-kv">
      <div className="qa-kv-head"><span /><span>{keyPh}</span><span>{valPh}</span><span /></div>
      {rows.map((r, i) => (
        <div className="qa-kv-rowwrap" key={i}>
          <div className="qa-kv-row">
            <MiniCheck on={r.on} onClick={() => update(i, 'on', !r.on)} />
            <input value={r.key} placeholder={keyPh} onChange={e => update(i, 'key', e.target.value)} />
            <input value={r.value} placeholder={valPh} onChange={e => update(i, 'value', e.target.value)} />
            <button className="qa-kv-del" onClick={() => remove(i)} aria-label={t('common.removeRow')}><Icon name="x" size={12} /></button>
          </div>
          {varMap && r.on && window.qaHasVars(r.value) && <VarHint text={r.value} varMap={varMap} />}
        </div>
      ))}
      <button className="qa-kv-add" onClick={add}><Icon name="plus" size={13} /> {addLabel}</button>
    </div>
  );
}

// Inline preview of a value once {{variables}} are resolved; flags unknowns.
function VarHint({ text, varMap }) {
  const { t } = useI18n();
  const unknown = window.qaUnknownVars(text, varMap);
  const resolved = window.qaSubstitute(text, varMap);
  return (
    <div className="qa-varhint" data-warn={unknown.length ? '1' : '0'}>
      <Icon name={unknown.length ? 'x' : 'link'} size={11} />
      {unknown.length
        ? <span>{t('request.var.unresolved', { vars: unknown.map(u => `{{${u}}}`).join(', ') })}</span>
        : <span>{resolved}</span>}
    </div>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div className="qa-field">
      <label className="qa-field-label">{label}</label>
      <div className="qa-field-control">{children}</div>
      {hint && <div className="qa-field-hint">{hint}</div>}
    </div>
  );
}

function SecretInput({ value, onChange, placeholder }) {
  const { t } = useI18n();
  const [show, setShow] = useStateRB(false);
  return (
    <div className="qa-secret">
      <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
             onChange={e => onChange(e.target.value)} />
      <button onClick={() => setShow(s => !s)} aria-label={t('common.toggleVisibility')}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={14} />
      </button>
    </div>
  );
}

// OAuth 2.0 token configuration + token-endpoint exchange.
const OAUTH_GRANTS = [
  { value: 'authorization_code', labelKey: 'request.oauth.grant.authorization_code' },
  { value: 'client_credentials', labelKey: 'request.oauth.grant.client_credentials' },
  { value: 'password', labelKey: 'request.oauth.grant.password' },
];
function OAuth2Editor({ a, set, token, onFetch }) {
  const { t } = useI18n();
  const o = a.oauth2 || {};
  const setO = (field, val) => set('oauth2', { ...o, [field]: val });
  const [busy, setBusy] = useStateRB(false);
  const [error, setError] = useStateRB('');
  const grant = o.grant || 'client_credentials';
  const expIn = token ? Math.max(0, Math.round((token.expiresAt - Date.now()) / 1000)) : 0;
  const expired = token && expIn <= 0;
  const run = async () => {
    if (!onFetch) return;
    setBusy(true); setError('');
    try { await onFetch(); }
    catch (e) { setError(String(e && e.message ? e.message : e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="qa-oauth">
      <FieldRow label={t('request.oauth.grantType')}>
        <Dropdown value={grant} options={OAUTH_GRANTS.map(g => ({ value: g.value, label: t(g.labelKey) }))} onChange={v => setO('grant', v)} />
      </FieldRow>
      {grant === 'authorization_code' && (
        <>
          <FieldRow label={t('request.oauth.authUrl')}><input className="qa-inp" value={o.authUrl || ''} placeholder="https://auth.acme.dev/authorize"
            onChange={e => setO('authUrl', e.target.value)} /></FieldRow>
          <FieldRow label={t('request.oauth.authorizationCode')}><SecretInput value={o.code || ''} placeholder="code from callback"
            onChange={v => setO('code', v)} /></FieldRow>
          <FieldRow label={t('request.oauth.redirectUri')}><input className="qa-inp" value={o.redirectUri || ''} placeholder="https://app.example/callback"
            onChange={e => setO('redirectUri', e.target.value)} /></FieldRow>
        </>
      )}
      <FieldRow label={t('request.oauth.accessTokenUrl')}><input className="qa-inp" value={o.tokenUrl || ''} placeholder="https://auth.acme.dev/oauth/token"
        onChange={e => setO('tokenUrl', e.target.value)} /></FieldRow>
      <div className="qa-field-grid">
        <FieldRow label={t('request.oauth.clientId')}><input className="qa-inp" value={o.clientId || ''} placeholder="{{clientId}}"
          onChange={e => setO('clientId', e.target.value)} /></FieldRow>
        <FieldRow label={t('request.oauth.clientSecret')}><SecretInput value={o.clientSecret || ''} placeholder="••••••••"
          onChange={v => setO('clientSecret', v)} /></FieldRow>
      </div>
      <FieldRow label={t('request.oauth.scope')}><input className="qa-inp" value={o.scope || ''} placeholder="read write"
        onChange={e => setO('scope', e.target.value)} /></FieldRow>
      {grant === 'password' && (
        <div className="qa-field-grid">
          <FieldRow label={t('request.auth.username')}><input className="qa-inp" value={o.username || ''} placeholder="user@example.com"
            onChange={e => setO('username', e.target.value)} /></FieldRow>
          <FieldRow label={t('request.auth.password')}><SecretInput value={o.password || ''} placeholder="password"
            onChange={v => setO('password', v)} /></FieldRow>
        </div>
      )}

      {token ? (
        <div className="qa-oauth-token" data-expired={expired ? '1' : '0'}>
          <div className="qa-oauth-token-head">
            <span className="qa-cred-type" data-type="bearer">{token.type}</span>
            <strong>{t('request.oauth.currentToken')}</strong>
            <span className="qa-oauth-exp">{expired ? t('request.oauth.expired') : t('request.oauth.expiresIn', { minutes: Math.floor(expIn / 60), seconds: expIn % 60 })}</span>
          </div>
          <code className="qa-oauth-token-val">{token.token}</code>
          <div className="qa-oauth-token-foot">
            <span className="qa-meta">{t('request.oauth.scopeLabel', { scope: token.scope })}</span>
            <button className="qa-link" onClick={run} disabled={busy}>{t('common.refresh')}</button>
          </div>
        </div>
      ) : (
        <div className="qa-auth-note"><Icon name="key" size={13} /> {t('request.oauth.noToken')}</div>
      )}
      <button className="qa-oauth-btn" onClick={run} disabled={busy}>
        {busy ? <Spinner size={13} /> : <Icon name="key" size={14} />}
        {busy ? t('request.oauth.requesting') : token ? t('request.oauth.getNew') : t('request.oauth.get')}
      </button>
      {error && <div className="rn-data-err"><Icon name="x" size={12} /> {error}</div>}
    </div>
  );
}

function AuthEditor({ req, patch, oauthToken, onFetchOAuth }) {
  const { t } = useI18n();
  const a = req.auth;
  const set = (field, val) => patch({ auth: { ...a, [field]: val } });
  return (
    <div className="qa-auth">
      <div className="qa-auth-type">
        <label className="qa-side-label" style={{ marginBottom: 8 }}><Icon name="key" size={12} /> {t('request.auth.type')}</label>
        <div className="qa-segs">
          {AUTH_TYPES.map(type => (
            <button key={type.key} data-active={a.type === type.key ? '1' : '0'} onClick={() => set('type', type.key)}>
              {t(type.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="qa-auth-body">
        {a.type === 'none' && (
          <div className="qa-auth-none"><Icon name="shield" size={18} /> {t('request.auth.noAuthNote')}</div>
        )}
        {a.type === 'bearer' && (
          <FieldRow label={t('request.auth.token')} hint={t('request.auth.tokenHint')}>
            <SecretInput value={a.bearer} onChange={v => set('bearer', v)} placeholder="eyJhbGciOiJIUzI1NiI..." />
          </FieldRow>
        )}
        {a.type === 'oauth2' && <OAuth2Editor a={a} set={set} token={oauthToken} onFetch={onFetchOAuth} />}
        {a.type === 'apiKey' && (
          <>
            <FieldRow label={t('common.key')}><input className="qa-inp" value={a.apiKey.key}
              onChange={e => set('apiKey', { ...a.apiKey, key: e.target.value })} placeholder="x-api-key" /></FieldRow>
            <FieldRow label={t('common.value')}><SecretInput value={a.apiKey.value}
              onChange={v => set('apiKey', { ...a.apiKey, value: v })} placeholder="sk_live_..." /></FieldRow>
            <FieldRow label={t('request.auth.addTo')}>
              <div className="qa-segs qa-segs--mini">
                {['header', 'query'].map(p => (
                  <button key={p} data-active={a.apiKey.placement === p ? '1' : '0'}
                          onClick={() => set('apiKey', { ...a.apiKey, placement: p })}>
                    {p === 'header' ? t('common.header') : t('request.auth.queryParam')}
                  </button>
                ))}
              </div>
            </FieldRow>
          </>
        )}
        {a.type === 'basic' && (
          <>
            <FieldRow label={t('request.auth.username')}><input className="qa-inp" value={a.basic.user}
              onChange={e => set('basic', { ...a.basic, user: e.target.value })} placeholder="username" /></FieldRow>
            <FieldRow label={t('request.auth.password')}><SecretInput value={a.basic.pass}
              onChange={v => set('basic', { ...a.basic, pass: v })} placeholder="password" /></FieldRow>
          </>
        )}
        {a.type === 'aws' && (
          <>
            <FieldRow label={t('request.auth.credentialProfile')}>
              <Dropdown value={a.aws.profile}
                        options={window.QA.CRED_PROFILES.filter(p => p.type === 'aws').map(p => p.name)}
                        onChange={(v) => set('aws', { ...a.aws, profile: v })} />
            </FieldRow>
            <div className="qa-field-grid">
              <FieldRow label={t('request.auth.service')}><input className="qa-inp" value={a.aws.service}
                onChange={e => set('aws', { ...a.aws, service: e.target.value })} /></FieldRow>
              <FieldRow label={t('request.auth.region')}><input className="qa-inp" value={a.aws.region}
                onChange={e => set('aws', { ...a.aws, region: e.target.value })} /></FieldRow>
            </div>
            <div className="qa-auth-note"><Icon name="shield" size={13} /> {t('request.auth.awsNote')}</div>
          </>
        )}
      </div>
    </div>
  );
}

const ASSERT_TYPES = [
  { value: 'status', labelKey: 'request.assert.status' },
  { value: 'time', labelKey: 'request.assert.time' },
  { value: 'bodyHas', labelKey: 'request.assert.bodyHas' },
  { value: 'bodyArray', labelKey: 'request.assert.bodyArray' },
  { value: 'header', labelKey: 'request.assert.header' },
];
function newAssert(type) {
  switch (type) {
    case 'time': return { type, op: 'lt', value: 500, on: true };
    case 'bodyHas': return { type, path: 'data', on: true };
    case 'bodyArray': return { type, on: true };
    case 'header': return { type, name: 'content-type', op: 'exists', value: '', on: true };
    default: return { type: 'status', op: 'eq', value: 200, on: true };
  }
}
function AssertionsEditor({ rows, onChange }) {
  const { t } = useI18n();
  const upd = (i, d) => onChange(rows.map((r, idx) => idx === i ? { ...r, ...d } : r));
  const del = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const assertOptions = ASSERT_TYPES.map(a => ({ value: a.value, label: t(a.labelKey) }));
  return (
    <div className="qa-asserts-ed">
      <div className="qa-asserts-hint"><Icon name="check" size={12} /> {t('request.assert.hint')}</div>
      {rows.length === 0 && <div className="qa-auth-none"><Icon name="check" size={16} /> {t('request.assert.empty')}</div>}
      {rows.map((a, i) => (
        <div className="qa-assert-row" key={i}>
          <MiniCheck on={a.on !== false} onClick={() => upd(i, { on: a.on === false })} />
          <div className="qa-assert-fields">
            <Dropdown value={a.type} options={assertOptions} onChange={nextType => onChange(rows.map((r, idx) => idx === i ? newAssert(nextType) : r))} />
            {a.type === 'status' && <>
              <Dropdown value={a.op} options={[{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }, { value: 'lt', label: '<' }, { value: 'gt', label: '>' }]} onChange={op => upd(i, { op })} />
              <input className="qa-inp qa-assert-v" type="number" value={a.value} onChange={e => upd(i, { value: +e.target.value || 0 })} />
            </>}
            {a.type === 'time' && <>
              <Dropdown value={a.op} options={[{ value: 'lt', label: '<' }, { value: 'gt', label: '>' }]} onChange={op => upd(i, { op })} />
              <input className="qa-inp qa-assert-v" type="number" value={a.value} onChange={e => upd(i, { value: +e.target.value || 0 })} />
              <span className="qa-assert-unit">ms</span>
            </>}
            {a.type === 'bodyHas' && <input className="qa-inp" value={a.path} placeholder="data.0.id" onChange={e => upd(i, { path: e.target.value })} />}
            {a.type === 'header' && <>
              <input className="qa-inp" value={a.name} placeholder="header" onChange={e => upd(i, { name: e.target.value })} />
              <Dropdown value={a.op} options={[{ value: 'exists', label: t('request.assert.exists') }, { value: 'eq', label: '=' }, { value: 'contains', label: t('request.assert.contains') }]} onChange={op => upd(i, { op })} />
              {a.op !== 'exists' && <input className="qa-inp qa-assert-v" value={a.value} onChange={e => upd(i, { value: e.target.value })} />}
            </>}
          </div>
          <button className="qa-kv-del" onClick={() => del(i)} aria-label={t('common.removeRow')}><Icon name="x" size={12} /></button>
        </div>
      ))}
      <button className="qa-kv-add" onClick={() => onChange([...rows, newAssert('status')])}><Icon name="plus" size={13} /> {t('request.assert.add')}</button>
    </div>
  );
}

// Per-request Options: SSL verification, local-scope variables, and which
// stored cookies will be replayed on this request.
function cookieHostLabel(env, varMap, t) {
  const raw = env && env.baseUrl ? String(env.baseUrl) : '';
  if (!raw) return t('request.options.host.this');
  const resolved = window.qaSubstitute ? window.qaSubstitute(raw, varMap || {}) : raw;
  try { return new URL(resolved).hostname; }
  catch {
    try { return new URL(raw).hostname; }
    catch { return t('request.options.host.configured'); }
  }
}

function OptionsEditor({ req, env, sslVerify, setSslVerify, localVars, setLocalVars, varMap, cookies, collectionId, onOpenSettings }) {
  const { t } = useI18n();
  const hostLabel = cookieHostLabel(env, varMap, t);
  return (
    <div className="qa-opts">
      {/* SSL */}
      <div className="qa-opt-block">
        <div className="qa-opt-row">
          <div className="qa-opt-text">
            <strong><Icon name="shield" size={13} /> {t('request.options.ssl')}</strong>
            <em>{t('request.options.sslHint')}</em>
          </div>
          <button className="pf-toggle" data-on={sslVerify ? '1' : '0'} onClick={() => setSslVerify(!sslVerify)} aria-label={t('request.options.sslToggle')}><span /></button>
        </div>
        {!sslVerify && <div className="qa-opt-warn"><Icon name="shield" size={13} /> {t('request.options.sslWarn')}</div>}
      </div>

      {/* Local variables */}
      <div className="qa-opt-block">
        <div className="qa-opt-head"><span><Icon name="code" size={13} /> {t('request.options.localVars')}</span><span className="qa-scope-tag" data-scope="local">{t('request.options.highestPrecedence')}</span></div>
        <p className="qa-opt-sub">{t('request.options.localVarsHint')} <code>{'{{name}}'}</code>.</p>
        <KVTable rows={localVars || []} onChange={setLocalVars} keyPh={t('common.variable')} valPh={t('common.value')} varMap={varMap} />
      </div>

      {/* Cookies sent */}
      <div className="qa-opt-block">
        <div className="qa-opt-head"><span><Icon name="globe" size={13} /> {t('request.options.cookiesFor', { host: hostLabel })}</span>
          <button className="qa-link" onClick={() => onOpenSettings && onOpenSettings('cookies')}>{t('request.options.manageJar')}</button></div>
        {cookies && cookies.length ? (
          <div className="qa-ckmini">
            {cookies.map(c => (
              <div className="qa-ckmini-row" key={c.id}>
                <span className="qa-ckmini-name">{c.name}</span>
                <span className="qa-ckmini-val">{c.value}</span>
                <span className="qa-ckmini-flags">{c.secure ? 'Secure ' : ''}{c.httpOnly ? 'HttpOnly' : ''}</span>
              </div>
            ))}
            <div className="qa-opt-sub" style={{ marginTop: 4 }}>{t('request.options.cookieSent')}</div>
          </div>
        ) : <div className="qa-auth-none"><Icon name="globe" size={16} /> {t('request.options.noCookies')}</div>}
      </div>
    </div>
  );
}

function RequestBuilder({ req, patch, onSend, isLoading, env, varMap, tests, setTests,
                          collectionId, localVars, setLocalVars, cookies, sslVerify, setSslVerify, onOpenSettings,
                          oauthToken, onFetchOAuth }) {
  const { t } = useI18n();
  const [tab, setTab] = useStateRB('params');
  const [methodOpen, setMethodOpen] = useStateRB(false);
  const [codeOpen, setCodeOpen] = useStateRB(false);
  // Imported absolute URLs already carry their host; don't prepend env.baseUrl
  // (mirrors the executor + CodeGen + report URL build).
  const fullUrl = /^https?:\/\//i.test(req.url || '') ? req.url : ((env.baseUrl || '') + req.url);
  const resolvedUrl = window.qaSubstitute(fullUrl, varMap || {});
  const showResolved = window.qaHasVars(fullUrl);

  const counts = {
    params: req.params.filter(p => p.on && p.key).length,
    headers: req.headers.filter(h => h.on && h.key).length,
    auth: req.auth.type !== 'none' ? '•' : 0,
    body: req.bodyMode !== 'none' ? '•' : 0,
    tests: (tests || []).length,
    options: ((localVars || []).filter(v => v.on !== false && v.key).length) + (sslVerify ? 0 : 1) || ((cookies || []).length ? '•' : 0),
  };
  const tabs = [
    { key: 'params', label: t('request.tab.params') },
    { key: 'auth', label: t('request.tab.auth') },
    { key: 'headers', label: t('request.tab.headers') },
    { key: 'body', label: t('request.tab.body') },
    { key: 'tests', label: t('request.tab.tests') },
    { key: 'options', label: t('request.tab.options') },
  ];

  return (
    <section className="qa-builder">
      {/* URL bar */}
      <div className="qa-urlbar">
        <div className="qa-method">
          <button className="qa-method-btn" onClick={() => setMethodOpen(o => !o)}
                  style={{ color: window.QATheme.methodColor(req.method) }}>
            {req.method}<Icon name="chevron" size={13} className="qa-method-chev" data-open={methodOpen ? '1' : '0'} />
          </button>
          {methodOpen && (
            <div className="qa-method-menu">
              {METHODS.map(m => (
                <button key={m} onClick={() => { patch({ method: m }); setMethodOpen(false); }}
                        style={{ color: window.QATheme.methodColor(m) }} data-active={m === req.method ? '1' : '0'}>{m}</button>
              ))}
            </div>
          )}
        </div>
        <div className="qa-urlinput">
          {env.baseUrl && <span className="qa-url-base">{env.baseUrl}</span>}
          <input value={req.url} onChange={e => patch({ url: e.target.value })}
                 placeholder="/v1/resource" spellCheck="false" />
        </div>
        <button className="qa-send" onClick={onSend} disabled={isLoading}>
          {isLoading ? <Spinner size={14} /> : <Icon name="send" size={15} />}
          <span>{isLoading ? t('common.sending') : t('common.send')}</span>
        </button>
        <button className="qa-iconbtn" title={t('request.action.code')} onClick={() => setCodeOpen(true)}><Icon name="code" size={15} /></button>
        {!sslVerify && <button className="qa-iconbtn qa-ssl-off" title={t('request.action.sslOff')} onClick={() => setTab('options')}><Icon name="shield" size={15} /></button>}
        <button className="qa-iconbtn" title={t('request.action.save')}><Icon name="save" size={15} /></button>
      </div>
      {codeOpen && <CodeModal req={req} env={env} varMap={varMap} cookies={cookies} onClose={() => setCodeOpen(false)} />}

      {showResolved && (
        <div className="qa-url-resolved" title={t('request.resolvedTitle')}>
          <Icon name="link" size={12} /> <span>{resolvedUrl}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="qa-tabs">
        {tabs.map(t => (
          <button key={t.key} data-active={tab === t.key ? '1' : '0'} onClick={() => setTab(t.key)}>
            {t.label}
            {!!counts[t.key] && <span className="qa-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="qa-tabbody">
        {tab === 'params' && <KVTable rows={req.params} onChange={p => patch({ params: p })} keyPh={t('common.key')} valPh={t('common.value')} varMap={varMap} />}
        {tab === 'headers' && <KVTable rows={req.headers} onChange={h => patch({ headers: h })} keyPh={t('common.header')} valPh={t('common.value')} varMap={varMap} />}
        {tab === 'auth' && <AuthEditor req={req} patch={patch} oauthToken={oauthToken} onFetchOAuth={onFetchOAuth} />}
        {tab === 'body' && (
          <div className="qa-body">
            <div className="qa-segs qa-segs--mini qa-body-modes">
              {['none', 'json', 'graphql', 'form'].map(m => (
                <button key={m} data-active={req.bodyMode === m ? '1' : '0'} onClick={() => patch(m === 'graphql' ? { bodyMode: m, method: req.method === 'GET' ? 'POST' : req.method } : { bodyMode: m })}>
                  {m === 'none' ? t('common.none') : m === 'json' ? t('common.json') : m === 'graphql' ? t('common.graphql') : t('common.form')}
                </button>
              ))}
            </div>
            {req.bodyMode === 'none' && <div className="qa-auth-none"><Icon name="code" size={16} /> {t('request.body.none')}</div>}
            {req.bodyMode === 'graphql' && <GraphQLEditor req={req} patch={patch} />}
            {req.bodyMode === 'json' && (
              <>
                <textarea className="qa-code-input" spellCheck="false" value={req.body}
                          onChange={e => patch({ body: e.target.value })} placeholder='{\n  "key": "value"\n}' />
                {window.qaHasVars(req.body) && (
                  window.qaUnknownVars(req.body, varMap).length
                    ? <div className="qa-varhint" data-warn="1"><Icon name="x" size={11} /> <span>{t('request.var.unresolved', { vars: [...new Set(window.qaUnknownVars(req.body, varMap))].map(u => `{{${u}}}`).join(', ') })}</span></div>
                    : <div className="qa-varhint"><Icon name="link" size={11} /> <span>{t('request.var.resolved', { vars: [...new Set((req.body.match(/\{\{[^}]+\}\}/g) || []))].join(', ') })}</span></div>
                )}
              </>
            )}
            {req.bodyMode === 'form' && <KVTable rows={req.form || []} onChange={f => patch({ form: f })} keyPh={t('common.field')} valPh={t('common.value')} />}
          </div>
        )}
        {tab === 'tests' && <AssertionsEditor rows={tests || []} onChange={setTests} />}
        {tab === 'options' && <OptionsEditor req={req} env={env} sslVerify={sslVerify} setSslVerify={setSslVerify}
          localVars={localVars} setLocalVars={setLocalVars} varMap={varMap} cookies={cookies}
          collectionId={collectionId} onOpenSettings={onOpenSettings} />}
      </div>
    </section>
  );
}

Object.assign(window, { RequestBuilder, FieldRow, SecretInput, KVTable, VarHint, OptionsEditor });

export { RequestBuilder, FieldRow, SecretInput, KVTable, VarHint, OptionsEditor };
