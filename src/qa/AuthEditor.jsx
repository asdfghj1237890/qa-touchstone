import React from 'react';
import './setup';
import { Dropdown, Icon, Spinner, FieldRow, SecretInput } from './components';
import { useI18n } from './useI18n';

const { useState: useStateAE } = React;

// ── QA Touchstone — shared auth UI (extracted from RequestBuilder) ──────────

const AUTH_TYPES = [
  { key: 'none',   labelKey: 'request.auth.none' },
  { key: 'bearer', labelKey: 'request.auth.bearer' },
  { key: 'oauth2', labelKey: 'request.auth.oauth2' },
  { key: 'apiKey', labelKey: 'request.auth.apiKey' },
  { key: 'basic',  labelKey: 'request.auth.basic' },
  { key: 'aws',    labelKey: 'request.auth.aws' },
];

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
  const [busy, setBusy] = useStateAE(false);
  const [error, setError] = useStateAE('');
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

Object.assign(window, { AuthEditor, OAuth2Editor });
export { AuthEditor, OAuth2Editor, AUTH_TYPES, OAUTH_GRANTS };
