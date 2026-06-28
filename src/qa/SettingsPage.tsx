import React from 'react';
import './setup';
import { Dropdown, Icon, MiniCheck } from './components';
import { FieldRow, KVTable, SecretInput } from './RequestBuilder';
import { useI18n } from './useI18n';
import { LOCALES } from './i18nOptions';
import { loadPrivacyCfg, savePrivacyCfg, resolvePolicy, classifyDestination } from './aiPrivacy';
import type { PrivacyCfg } from './aiPrivacy';
import { getCachedAiPolicy } from './aiPolicy';
import type { QaCookie } from './state/WorkspaceContext';

// ── QA Touchstone — Settings (Environment + API credentials) ───────────────
const { useState: useStateST } = React;

function PathRow({ title, path }: { title: string; path: string }) {
  const { t } = useI18n();
  return (
    <div className="qa-pathrow">
      <button className="qa-pathbtn">
        <Icon name="folder" size={14} /> {title}
      </button>
      <span className="qa-pathval" data-empty={path ? '0' : '1'}>
        {path || t('settings.env.noPath')}
      </span>
      <button className="qa-iconbtn" title={t('settings.browse')}>
        <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}

interface EnvSettingsProps {
  vars: any;
  setVars: (v: any) => void;
  sslVerify: boolean;
  setSslVerify: (v: boolean) => void;
}

function EnvSettings({ vars, setVars, sslVerify, setSslVerify }: EnvSettingsProps) {
  const { t } = useI18n();
  const paths = [
    { title: t('settings.env.path.platformTools'), path: '/Users/qa/tools/platform' },
    { title: t('settings.env.path.certificates'), path: '/Users/qa/certs/device' },
    { title: t('settings.env.path.postmanCollections'), path: '/Users/qa/collections' },
  ];
  const envNames = Object.keys(vars.environments || {});
  const [envEdit, setEnvEdit] = useStateST(envNames[0] || 'None');
  const colList = window.QA.COLLECTIONS;
  const [colEdit, setColEdit] = useStateST<string>(colList[0] ? colList[0].id : '');
  const colVars = (vars.collections || {})[colEdit] || [];
  return (
    <>
      <div className="qa-set-grid">
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="folder" size={14} /> {t('settings.env.paths')}
            </span>
          </div>
          <div className="qa-set-body">
            {paths.map((p) => (
              <PathRow key={p.title} {...p} />
            ))}
          </div>
        </section>
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="globe" size={14} /> {t('settings.env.apiEnvironments')}
            </span>
            <button className="qa-link">{t('settings.env.add')}</button>
          </div>
          <div className="qa-set-body">
            {window.QA.ENVIRONMENTS.filter((e: any) => e.label !== 'None').map((e: any) => (
              <div className="qa-envrow" key={e.label}>
                <span className="qa-envrow-dot" />
                <span className="qa-envrow-name">{e.label}</span>
                <span className="qa-envrow-url" data-empty={e.baseUrl ? '0' : '1'}>
                  {e.baseUrl || t('settings.env.noBaseUrl')}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Variable scope precedence explainer */}
      <div className="qa-scope-bar">
        <span className="qa-scope-bar-label">{t('settings.env.resolutionOrder')}</span>
        <span className="qa-scope-chip" data-scope="global">
          {t('settings.env.scope.global')}
        </span>
        <Icon name="chevron" size={12} />
        <span className="qa-scope-chip" data-scope="collection">
          {t('settings.env.scope.collection')}
        </span>
        <Icon name="chevron" size={12} />
        <span className="qa-scope-chip" data-scope="environment">
          {t('settings.env.scope.environment')}
        </span>
        <Icon name="chevron" size={12} />
        <span className="qa-scope-chip" data-scope="local">
          {t('settings.env.scope.local')}
        </span>
        <span className="qa-scope-bar-note">{t('settings.env.scope.note')}</span>
      </div>

      <div className="qa-set-grid" style={{ marginTop: 14 }}>
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="code" size={14} /> {t('settings.env.globalVars')}
            </span>
            <span className="qa-scope-tag" data-scope="global">
              {t('settings.env.allRequests')}
            </span>
          </div>
          <div className="qa-set-body">
            <KVTable
              rows={vars.globals}
              onChange={(g: any) => setVars({ ...vars, globals: g })}
              keyPh={t('settings.env.variable')}
              valPh={t('settings.env.value')}
            />
            <div className="qa-auth-note">
              <Icon name="zap" size={13} />
              <span>
                {t('settings.env.referenceAs')} <code>{'{{name}}'}</code> ·{' '}
                {t('settings.env.dynamic')}: <code>{'{{$timestamp}}'}</code>{' '}
                <code>{'{{$guid}}'}</code> <code>{'{{$randomInt}}'}</code>
              </span>
            </div>
          </div>
        </section>
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="layers" size={14} /> {t('settings.env.collectionVars')}
            </span>
            <div style={{ width: 168 }}>
              <Dropdown
                value={colEdit}
                options={colList.map((c: any) => ({ value: c.id, label: c.name }))}
                onChange={setColEdit}
              />
            </div>
          </div>
          <div className="qa-set-body">
            <KVTable
              rows={colVars}
              onChange={(list: any) =>
                setVars({ ...vars, collections: { ...vars.collections, [colEdit]: list } })
              }
              keyPh={t('settings.env.variable')}
              valPh={t('settings.env.value')}
            />
          </div>
        </section>
      </div>

      <div className="qa-set-grid" style={{ marginTop: 18 }}>
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="globe" size={14} /> {t('settings.env.environmentVars')}
            </span>
            <div style={{ width: 150 }}>
              <Dropdown
                value={envEdit}
                options={Object.keys(vars.environments)}
                onChange={setEnvEdit}
              />
            </div>
          </div>
          <div className="qa-set-body">
            <KVTable
              rows={vars.environments[envEdit] || []}
              onChange={(list: any) =>
                setVars({ ...vars, environments: { ...vars.environments, [envEdit]: list } })
              }
              keyPh={t('settings.env.variable')}
              valPh={t('settings.env.value')}
            />
          </div>
        </section>
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="shield" size={14} /> {t('settings.env.networkTls')}
            </span>
          </div>
          <div className="qa-set-body">
            <div className="qa-opt-row">
              <div className="qa-opt-text">
                <strong>{t('settings.env.ssl')}</strong>
                <em>{t('settings.env.sslHint')}</em>
              </div>
              <button
                className="pf-toggle"
                data-on={sslVerify ? '1' : '0'}
                onClick={() => setSslVerify(!sslVerify)}
                aria-label={t('request.options.sslToggle')}
              >
                <span />
              </button>
            </div>
            {!sslVerify && (
              <div className="qa-opt-warn">
                <Icon name="shield" size={13} /> {t('settings.env.sslWarn')}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// ── Cookie Jar ────────────────────────────────────────────────────────────
/** Cookie jar 的一筆 UI cookie（QaCookie + jar 欄位）。 */
export interface JarCookie extends QaCookie {
  id?: string;
  on?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  expires?: string;
  sameSite?: string;
}

interface CookieSettingsProps {
  cookies: JarCookie[];
  setCookies: (cookies: JarCookie[]) => void;
}

function CookieSettings({ cookies, setCookies }: CookieSettingsProps) {
  const { t } = useI18n();
  const blank = (): JarCookie => ({
    id: 'ck' + Date.now().toString(36),
    name: '',
    value: '',
    domain: '',
    path: '/',
    expires: '',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
    on: true,
  });
  const upd = (id: string | undefined, d: Partial<JarCookie>) =>
    setCookies(cookies.map((c) => (c.id === id ? { ...c, ...d } : c)));
  const del = (id: string | undefined) => setCookies(cookies.filter((c) => c.id !== id));
  const add = () => setCookies([...cookies, blank()]);
  const domains = [...new Set(cookies.map((c) => c.domain).filter(Boolean))];
  return (
    <div className="qa-set-grid" style={{ gridTemplateColumns: '1fr' }}>
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="globe" size={14} /> {t('settings.cookies.title')}
          </span>
          <span className="qa-meta">
            {t('settings.cookies.activeSummary', {
              active: cookies.filter((c) => c.on).length,
              domains: domains.length,
              domainLabel: t(
                domains.length === 1 ? 'settings.cookies.domainOne' : 'settings.cookies.domainMany'
              ),
            })}
          </span>
        </div>
        <div className="qa-set-body">
          <div className="qa-ckjar-head">
            <span />
            <span>{t('settings.cookies.name')}</span>
            <span>{t('settings.cookies.value')}</span>
            <span>{t('settings.cookies.domain')}</span>
            <span>{t('settings.cookies.path')}</span>
            <span>{t('settings.cookies.expires')}</span>
            <span>{t('settings.cookies.flags')}</span>
            <span />
          </div>
          {cookies.map((c) => (
            <div className="qa-ckjar-row" key={c.id} data-off={c.on ? '0' : '1'}>
              <MiniCheck on={c.on} onClick={() => upd(c.id, { on: !c.on })} />
              <input
                className="qa-ckjar-in"
                value={c.name}
                placeholder={t('settings.cookies.placeholder.name')}
                onChange={(e) => upd(c.id, { name: e.target.value })}
              />
              <input
                className="qa-ckjar-in"
                value={c.value}
                placeholder={t('settings.cookies.placeholder.value')}
                onChange={(e) => upd(c.id, { value: e.target.value })}
              />
              <input
                className="qa-ckjar-in"
                value={c.domain}
                placeholder={t('settings.cookies.placeholder.domain')}
                onChange={(e) => upd(c.id, { domain: e.target.value })}
              />
              <input
                className="qa-ckjar-in qa-ckjar-sm"
                value={c.path}
                placeholder="/"
                onChange={(e) => upd(c.id, { path: e.target.value })}
              />
              <input
                className="qa-ckjar-in qa-ckjar-sm"
                value={c.expires}
                placeholder="—"
                onChange={(e) => upd(c.id, { expires: e.target.value })}
              />
              <div className="qa-ckjar-flags">
                <button
                  className="qa-ckflag"
                  data-on={c.secure ? '1' : '0'}
                  onClick={() => upd(c.id, { secure: !c.secure })}
                  title="Secure"
                >
                  S
                </button>
                <button
                  className="qa-ckflag"
                  data-on={c.httpOnly ? '1' : '0'}
                  onClick={() => upd(c.id, { httpOnly: !c.httpOnly })}
                  title="HttpOnly"
                >
                  H
                </button>
              </div>
              <button
                className="qa-kv-del"
                onClick={() => del(c.id)}
                aria-label={t('settings.cookies.delete')}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          <button className="qa-kv-add" onClick={add}>
            <Icon name="plus" size={13} /> {t('settings.cookies.add')}
          </button>
          <div className="qa-auth-note">
            <Icon name="shield" size={13} />
            <span>{t('settings.cookies.note')}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function ApiSettings() {
  const { t } = useI18n();
  const profiles = window.QA.CRED_PROFILES;
  const [sel, setSel] = useStateST<string>(profiles[0] ? profiles[0].id : '');
  const typeLabel: Record<string, string> = {
    aws: t('settings.api.type.aws'),
    bearer: t('settings.api.type.bearer'),
    basic: t('settings.api.type.basic'),
  };

  if (!profiles.length) {
    return (
      <div className="qa-set-grid qa-set-grid--api">
        <section className="qa-panel">
          <div className="qa-panel-head">
            <span>
              <Icon name="key" size={14} /> {t('settings.api.credentials')}
            </span>
            <button className="qa-link">{t('settings.api.new')}</button>
          </div>
          <div className="qa-set-body">
            <div className="qa-auth-note">
              <Icon name="key" size={13} />
              <span>{t('settings.api.empty')}</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const p = profiles.find((x: any) => x.id === sel) || profiles[0];

  return (
    <div className="qa-set-grid qa-set-grid--api">
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="key" size={14} /> {t('settings.api.credentials')}
          </span>
          <button className="qa-link">{t('settings.api.new')}</button>
        </div>
        <div className="qa-set-body qa-creds">
          {profiles.map((c: any) => (
            <button
              key={c.id}
              className="qa-cred"
              data-active={c.id === sel ? '1' : '0'}
              onClick={() => setSel(c.id)}
            >
              <Icon
                name={c.type === 'aws' ? 'zap' : c.type === 'bearer' ? 'key' : 'shield'}
                size={15}
              />
              <span className="qa-cred-name">{c.name}</span>
              <span className="qa-cred-type" data-type={c.type}>
                {typeLabel[c.type]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="settings" size={14} /> {p.name}
          </span>
          <span className="qa-cred-type" data-type={p.type}>
            {typeLabel[p.type]}
          </span>
        </div>
        <div className="qa-set-body">
          {p.type === 'aws' && (
            <>
              <FieldRow label={t('settings.api.awsProfile')}>
                <Dropdown
                  value={p.name}
                  options={profiles.filter((x: any) => x.type === 'aws').map((x: any) => x.name)}
                  onChange={() => {}}
                />
              </FieldRow>
              <FieldRow label={t('settings.api.accessKey')}>
                <input className="qa-inp" defaultValue="AKIA●●●●●●●●●●●●7QD2" readOnly />
              </FieldRow>
              <FieldRow label={t('settings.api.secretKey')}>
                <SecretInput value={'wJalr●●●●●●●●●●●●●●●●●●●●EXAMPLEKEY'} onChange={() => {}} />
              </FieldRow>
              <div className="qa-field-grid">
                <FieldRow label={t('settings.api.region')}>
                  <input className="qa-inp" defaultValue={p.region} readOnly />
                </FieldRow>
                <FieldRow label={t('settings.api.service')}>
                  <input className="qa-inp" defaultValue="execute-api" readOnly />
                </FieldRow>
              </div>
              <div className="qa-auth-note">
                <Icon name="shield" size={13} /> {t('settings.api.storedLocal')}
              </div>
            </>
          )}
          {p.type === 'bearer' && (
            <FieldRow label={t('settings.api.token')} hint={t('settings.api.tokenHint')}>
              <SecretInput value={'eyJhbGciOiJIUzI1●●●●●●●●●●●●'} onChange={() => {}} />
            </FieldRow>
          )}
          {p.type === 'basic' && (
            <>
              <FieldRow label={t('settings.api.username')}>
                <input className="qa-inp" defaultValue="qa-runner" readOnly />
              </FieldRow>
              <FieldRow label={t('settings.api.password')}>
                <SecretInput value={'●●●●●●●●●●●●'} onChange={() => {}} />
              </FieldRow>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

interface AppearanceSettingsProps {
  accent: string;
  setAccent: (accent: string) => void;
}

function AppearanceSettings({ accent, setAccent }: AppearanceSettingsProps) {
  const { locale, setLocale, t } = useI18n();
  const ACC = window.QATheme.ACCENTS;
  return (
    <div className="qa-set-grid">
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="zap" size={14} /> {t('settings.appearance.accentColor')}
          </span>
        </div>
        <div className="qa-set-body">
          <FieldRow label={t('settings.appearance.accent')}>
            <div className="tw-accents">
              <button
                className="tw-acc tw-acc--auto"
                data-active={accent === 'auto' ? '1' : '0'}
                onClick={() => setAccent('auto')}
                title={t('settings.appearance.default')}
              >
                A
              </button>
              {Object.entries(ACC).map(([name, hex]) => (
                <button
                  key={name}
                  className="tw-acc"
                  data-active={accent === hex ? '1' : '0'}
                  style={{ background: hex as string }}
                  onClick={() => setAccent(hex as string)}
                  title={name}
                />
              ))}
            </div>
          </FieldRow>
          <div className="qa-auth-note">
            <Icon name="shield" size={13} /> {t('settings.appearance.note')}
          </div>
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="globe" size={14} /> {t('settings.appearance.language')}
          </span>
        </div>
        <div className="qa-set-body">
          <FieldRow label={t('settings.appearance.languageLabel')}>
            <Dropdown value={locale} options={LOCALES} onChange={setLocale} />
          </FieldRow>
          <div className="qa-auth-note">
            <Icon name="shield" size={13} /> {t('settings.appearance.languageNote')}
          </div>
        </div>
      </section>
    </div>
  );
}

function LlmSettings() {
  const { t } = useI18n();
  const [cfg, setCfg] = useStateST(() => window.loadLlmCfg!());
  const MODELS = {
    openai: [
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'gpt-5.5-codex',
    ],
  };
  const DEF_MODEL: Record<string, string> = {
    builtin: 'claude-haiku-4-5',
    openai: 'gpt-5.4-mini',
    custom: '',
  };
  const save = (d: Partial<ReturnType<NonNullable<Window['loadLlmCfg']>>>) => {
    const n = { ...cfg, ...d };
    setCfg(n);
    window.saveLlmCfg!(n);
  };
  const setProvider = (v: string) => save({ provider: v, model: DEF_MODEL[v] });
  const claudeOk = !!(window.claude && window.claude.complete);
  // 內建 Claude 需 window.claude（僅 claude.ai Artifacts 沙箱注入）；桌面版偵測
  // 不到就不在下拉顯示它，避免提供一個必然失敗的選項。
  const providerOptions = window.LLM_PROVIDERS.filter(
    (p: any) => p.value !== 'builtin' || claudeOk
  ).map((p: any) => ({ ...p, label: t(`settings.llm.provider.${p.value}`) }));
  // 若設定恰好停在已隱藏的 builtin，介面改顯示第一個可用 provider（使用者實際
  // 選取時才寫入；未選前其餘流程沿用既有的 heuristic fallback）。
  const shownProvider = providerOptions.some((o: any) => o.value === cfg.provider)
    ? cfg.provider
    : (providerOptions[0]?.value ?? cfg.provider);
  const builtin = shownProvider === 'builtin';
  return (
    <div className="qa-set-grid qa-set-grid--api">
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="sparkle" size={14} /> {t('settings.llm.provider')}
          </span>
        </div>
        <div className="qa-set-body">
          <FieldRow label={t('settings.llm.providerLabel')}>
            <Dropdown value={shownProvider} options={providerOptions} onChange={setProvider} />
          </FieldRow>
          {!builtin && (
            <>
              <FieldRow label={t('settings.llm.model')}>
                {cfg.provider === 'openai' ? (
                  <Dropdown
                    value={cfg.model || 'gpt-5.4-mini'}
                    options={MODELS.openai}
                    onChange={(m: string) => save({ model: m })}
                  />
                ) : (
                  <input
                    className="qa-inp"
                    value={cfg.model}
                    onChange={(e) => save({ model: e.target.value })}
                    placeholder="model id, e.g. llama-3.1-70b"
                  />
                )}
              </FieldRow>
              <FieldRow label={t('settings.llm.apiKey')}>
                <SecretInput
                  value={cfg.key}
                  onChange={(v: string) => save({ key: v })}
                  placeholder="sk-…"
                />
              </FieldRow>
              {cfg.provider === 'custom' && (
                <FieldRow label={t('settings.llm.endpoint')}>
                  <input
                    className="qa-inp"
                    value={cfg.baseUrl}
                    onChange={(e) => save({ baseUrl: e.target.value })}
                    placeholder="https://…/v1/chat/completions"
                  />
                </FieldRow>
              )}
              <div className="qa-auth-note">
                <Icon name="shield" size={13} /> {t('settings.llm.keyNote')}
              </div>
            </>
          )}
          {builtin && (
            <div className="qa-auth-note">
              <Icon name="zap" size={13} />{' '}
              {claudeOk ? t('settings.llm.builtinOk') : t('settings.llm.builtinUnavailable')}
            </div>
          )}
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="fileText" size={14} /> {t('settings.llm.used')}
          </span>
        </div>
        <div className="qa-set-body">
          <p className="qa-set-copy">{t('settings.llm.copy')}</p>
        </div>
      </section>
    </div>
  );
}

export function PrivacySettings() {
  const { t } = useI18n();
  const [cfg, setCfg] = useStateST(() => loadPrivacyCfg());
  const save = (d: Partial<PrivacyCfg>) => {
    const n = { ...cfg, ...d };
    setCfg(n);
    savePrivacyCfg(n);
  };
  const policy = resolvePolicy(cfg, getCachedAiPolicy());
  const dest = classifyDestination(window.loadLlmCfg!());
  const MODES: Array<PrivacyCfg['mode']> = ['full', 'redacted', 'local'];
  const visibleModes: Array<PrivacyCfg['mode']> = policy.locked ? ['local'] : MODES;
  return (
    <div className="qa-set-grid qa-set-grid--api">
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="shield" size={14} /> {t('settings.privacy.mode')}
          </span>
        </div>
        <div className="qa-set-body">
          {policy.locked && (
            <div className="qa-auth-note">
              <Icon name="shield" size={13} /> {t('settings.privacy.lockedBy.' + policy.source)}
            </div>
          )}
          <div className="qa-seg">
            {visibleModes.map((m) => (
              <button
                key={m}
                data-testid={`privacy-mode-${m}`}
                data-active={cfg.mode === m ? '1' : '0'}
                disabled={policy.locked}
                onClick={() => save({ mode: m })}
              >
                {t('settings.privacy.mode.' + m)}
              </button>
            ))}
          </div>
          <p className="qa-set-copy">
            {t('settings.privacy.mode.' + policy.effectiveMode + '.desc')}
          </p>
          <FieldRow label={t('settings.privacy.lockdown')}>
            <MiniCheck checked={cfg.lockdown} onChange={(v: boolean) => save({ lockdown: v })} />
          </FieldRow>
          {policy.effectiveMode === 'local' && dest.provider === 'custom' && dest.isCloud && (
            <>
              <FieldRow label={t('settings.privacy.attest')}>
                <MiniCheck
                  checked={cfg.selfManagedAttested}
                  onChange={(v: boolean) => save({ selfManagedAttested: v })}
                />
              </FieldRow>
              {cfg.selfManagedAttested && (
                <div className="qa-auth-note qa-auth-warn">
                  <Icon name="zap" size={13} /> {t('settings.privacy.attestWarn')}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head">
          <span>
            <Icon name="filter" size={14} /> {t('settings.privacy.custom')}
          </span>
        </div>
        <div className="qa-set-body">
          <FieldRow label={t('settings.privacy.customFields')}>
            <input
              className="qa-inp"
              value={(cfg.customFieldNames || []).join(', ')}
              onChange={(e) =>
                save({
                  customFieldNames: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="customerRef, internalId"
            />
          </FieldRow>
          <FieldRow label={t('settings.privacy.customPatterns')}>
            <input
              className="qa-inp"
              value={(cfg.customPatterns || []).join(' | ')}
              onChange={(e) =>
                save({
                  customPatterns: e.target.value
                    .split('|')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="PRJ-\\d+ | ACME-[A-Z]+"
            />
          </FieldRow>
          <div className="qa-auth-note">
            <Icon name="shield" size={13} /> {t('settings.privacy.customNote')}
          </div>
        </div>
      </section>
    </div>
  );
}

export interface SettingsPageProps {
  accent: string;
  setAccent: (accent: string) => void;
  initialTab?: string | null;
  vars: any;
  setVars: (v: any) => void;
  cookies: JarCookie[];
  setCookies: (cookies: JarCookie[]) => void;
  sslVerify: boolean;
  setSslVerify: (v: boolean) => void;
}

function SettingsPage({
  accent,
  setAccent,
  initialTab,
  vars,
  setVars,
  cookies,
  setCookies,
  sslVerify,
  setSslVerify,
}: SettingsPageProps) {
  const { t } = useI18n();
  const [tab, setTab] = useStateST(initialTab || 'appearance');
  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, setTab]);
  const tabs: Array<[string, string]> = [
    ['appearance', t('settings.tab.appearance')],
    ['env', t('settings.tab.env')],
    ['cookies', t('settings.tab.cookies')],
    ['api', t('settings.tab.api')],
    ['llm', t('settings.tab.llm')],
    ['privacy', t('settings.tab.privacy')],
  ];
  return (
    <div className="qa-settings">
      <div className="qa-settings-head">
        <h2>{t('settings.title')}</h2>
        <div className="qa-segs qa-segs--mini">
          {tabs.map(([k, l]) => (
            <button key={k} data-active={tab === k ? '1' : '0'} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="qa-settings-body">
        {tab === 'appearance' && <AppearanceSettings accent={accent} setAccent={setAccent} />}
        {tab === 'env' && (
          <EnvSettings
            vars={vars}
            setVars={setVars}
            sslVerify={sslVerify}
            setSslVerify={setSslVerify}
          />
        )}
        {tab === 'cookies' && <CookieSettings cookies={cookies} setCookies={setCookies} />}
        {tab === 'api' && <ApiSettings />}
        {tab === 'llm' && <LlmSettings />}
        {tab === 'privacy' && <PrivacySettings />}
      </div>
    </div>
  );
}

Object.assign(window, { SettingsPage });

export { SettingsPage };
