import React from 'react';
import './setup.js';
import { Dropdown, Icon, LLM_PROVIDERS, MiniCheck, loadLlmCfg, saveLlmCfg } from './components.jsx';
import { FieldRow, KVTable, SecretInput } from './RequestBuilder.jsx';

// ── QA Touchstone — Settings (Environment + API credentials) ───────────────
const { useState: useStateST } = React;

function PathRow({ title, path }) {
  return (
    <div className="qa-pathrow">
      <button className="qa-pathbtn"><Icon name="folder" size={14} /> {title}</button>
      <span className="qa-pathval" data-empty={path ? '0' : '1'}>{path || 'No path selected'}</span>
      <button className="qa-iconbtn" title="Browse"><Icon name="chevron" size={14} /></button>
    </div>
  );
}

function EnvSettings({ vars, setVars, sslVerify, setSslVerify }) {
  const paths = [
    { title: 'Platform Tools', path: '/Users/qa/tools/platform' },
    { title: 'Certificates', path: '/Users/qa/certs/device' },
    { title: 'Postman Collections', path: '/Users/qa/collections' },
  ];
  const [envEdit, setEnvEdit] = useStateST('Staging');
  const colList = window.QA.COLLECTIONS;
  const [colEdit, setColEdit] = useStateST(colList[0].id);
  const colVars = (vars.collections || {})[colEdit] || [];
  return (
    <>
    <div className="qa-set-grid">
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="folder" size={14} /> Environment paths</span></div>
        <div className="qa-set-body">
          {paths.map(p => <PathRow key={p.title} {...p} />)}
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="globe" size={14} /> API environments</span><button className="qa-link">+ Add</button></div>
        <div className="qa-set-body">
          {window.QA.ENVIRONMENTS.filter(e => e.label !== 'None').map(e => (
            <div className="qa-envrow" key={e.label}>
              <span className="qa-envrow-dot" />
              <span className="qa-envrow-name">{e.label}</span>
              <span className="qa-envrow-url" data-empty={e.baseUrl ? '0' : '1'}>{e.baseUrl || 'No base URL'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>

    {/* Variable scope precedence explainer */}
    <div className="qa-scope-bar">
      <span className="qa-scope-bar-label">Resolution order</span>
      <span className="qa-scope-chip" data-scope="global">Global</span>
      <Icon name="chevron" size={12} />
      <span className="qa-scope-chip" data-scope="collection">Collection</span>
      <Icon name="chevron" size={12} />
      <span className="qa-scope-chip" data-scope="environment">Environment</span>
      <Icon name="chevron" size={12} />
      <span className="qa-scope-chip" data-scope="local">Local</span>
      <span className="qa-scope-bar-note">later scopes win on conflict · Local vars live in the request's Options tab</span>
    </div>

    <div className="qa-set-grid" style={{ marginTop: 14 }}>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="code" size={14} /> Global variables</span><span className="qa-scope-tag" data-scope="global">all requests</span></div>
        <div className="qa-set-body">
          <KVTable rows={vars.globals} onChange={g => setVars({ ...vars, globals: g })} keyPh="Variable" valPh="Value" />
          <div className="qa-auth-note"><Icon name="zap" size={13} /><span>Reference as <code>{'{{name}}'}</code> · dynamic: <code>{'{{$timestamp}}'}</code> <code>{'{{$guid}}'}</code> <code>{'{{$randomInt}}'}</code></span></div>
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="layers" size={14} /> Collection variables</span>
          <div style={{ width: 168 }}><Dropdown value={colEdit} options={colList.map(c => ({ value: c.id, label: c.name }))} onChange={setColEdit} /></div>
        </div>
        <div className="qa-set-body">
          <KVTable rows={colVars} onChange={list => setVars({ ...vars, collections: { ...vars.collections, [colEdit]: list } })} keyPh="Variable" valPh="Value" />
        </div>
      </section>
    </div>

    <div className="qa-set-grid" style={{ marginTop: 18 }}>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="globe" size={14} /> Environment variables</span>
          <div style={{ width: 150 }}><Dropdown value={envEdit} options={Object.keys(vars.environments)} onChange={setEnvEdit} /></div>
        </div>
        <div className="qa-set-body">
          <KVTable rows={vars.environments[envEdit] || []} onChange={list => setVars({ ...vars, environments: { ...vars.environments, [envEdit]: list } })} keyPh="Variable" valPh="Value" />
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="shield" size={14} /> Network &amp; TLS</span></div>
        <div className="qa-set-body">
          <div className="qa-opt-row">
            <div className="qa-opt-text">
              <strong>SSL certificate verification</strong>
              <em>Default for all requests. Disable to accept self-signed certificates in test environments.</em>
            </div>
            <button className="pf-toggle" data-on={sslVerify ? '1' : '0'} onClick={() => setSslVerify(!sslVerify)} aria-label="toggle ssl"><span /></button>
          </div>
          {!sslVerify && <div className="qa-opt-warn"><Icon name="shield" size={13} /> Verification is OFF globally — untrusted certificates will be accepted.</div>}
        </div>
      </section>
    </div>
    </>
  );
}

// ── Cookie Jar ────────────────────────────────────────────────────────────
function CookieSettings({ cookies, setCookies }) {
  const blank = () => ({ id: 'ck' + Date.now().toString(36), name: '', value: '', domain: '', path: '/', expires: '', httpOnly: false, secure: true, sameSite: 'Lax', on: true });
  const upd = (id, d) => setCookies(cookies.map(c => c.id === id ? { ...c, ...d } : c));
  const del = (id) => setCookies(cookies.filter(c => c.id !== id));
  const add = () => setCookies([...cookies, blank()]);
  const domains = [...new Set(cookies.map(c => c.domain).filter(Boolean))];
  return (
    <div className="qa-set-grid" style={{ gridTemplateColumns: '1fr' }}>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="globe" size={14} /> Cookie Jar</span>
          <span className="qa-meta">{`${cookies.filter(c => c.on).length} active · ${domains.length} domain${domains.length !== 1 ? 's' : ''}`}</span></div>
        <div className="qa-set-body">
          <div className="qa-ckjar-head">
            <span />
            <span>Name</span><span>Value</span><span>Domain</span><span>Path</span><span>Expires</span><span>Flags</span><span />
          </div>
          {cookies.map(c => (
            <div className="qa-ckjar-row" key={c.id} data-off={c.on ? '0' : '1'}>
              <MiniCheck on={c.on} onClick={() => upd(c.id, { on: !c.on })} />
              <input className="qa-ckjar-in" value={c.name} placeholder="name" onChange={e => upd(c.id, { name: e.target.value })} />
              <input className="qa-ckjar-in" value={c.value} placeholder="value" onChange={e => upd(c.id, { value: e.target.value })} />
              <input className="qa-ckjar-in" value={c.domain} placeholder="domain" onChange={e => upd(c.id, { domain: e.target.value })} />
              <input className="qa-ckjar-in qa-ckjar-sm" value={c.path} placeholder="/" onChange={e => upd(c.id, { path: e.target.value })} />
              <input className="qa-ckjar-in qa-ckjar-sm" value={c.expires} placeholder="—" onChange={e => upd(c.id, { expires: e.target.value })} />
              <div className="qa-ckjar-flags">
                <button className="qa-ckflag" data-on={c.secure ? '1' : '0'} onClick={() => upd(c.id, { secure: !c.secure })} title="Secure">S</button>
                <button className="qa-ckflag" data-on={c.httpOnly ? '1' : '0'} onClick={() => upd(c.id, { httpOnly: !c.httpOnly })} title="HttpOnly">H</button>
              </div>
              <button className="qa-kv-del" onClick={() => del(c.id)} aria-label="delete cookie"><Icon name="trash" size={13} /></button>
            </div>
          ))}
          <button className="qa-kv-add" onClick={add}><Icon name="plus" size={13} /> Add cookie</button>
          <div className="qa-auth-note"><Icon name="shield" size={13} /><span>Cookies are replayed as a <code>Cookie:</code> header on requests whose host matches the domain. <code>S</code> = Secure, <code>H</code> = HttpOnly.</span></div>
        </div>
      </section>
    </div>
  );
}

function ApiSettings() {
  const profiles = window.QA.CRED_PROFILES;
  const [sel, setSel] = useStateST(profiles[0].id);
  const p = profiles.find(x => x.id === sel);
  const typeLabel = { aws: 'AWS SigV4', bearer: 'Bearer', basic: 'Basic' };

  return (
    <div className="qa-set-grid qa-set-grid--api">
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="key" size={14} /> Credential profiles</span><button className="qa-link">+ New</button></div>
        <div className="qa-set-body qa-creds">
          {profiles.map(c => (
            <button key={c.id} className="qa-cred" data-active={c.id === sel ? '1' : '0'} onClick={() => setSel(c.id)}>
              <Icon name={c.type === 'aws' ? 'zap' : c.type === 'bearer' ? 'key' : 'shield'} size={15} />
              <span className="qa-cred-name">{c.name}</span>
              <span className="qa-cred-type" data-type={c.type}>{typeLabel[c.type]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="settings" size={14} /> {p.name}</span><span className="qa-cred-type" data-type={p.type}>{typeLabel[p.type]}</span></div>
        <div className="qa-set-body">
          {p.type === 'aws' && (
            <>
              <FieldRow label="AWS profile">
                <Dropdown value={p.name} options={profiles.filter(x => x.type === 'aws').map(x => x.name)} onChange={() => {}} />
              </FieldRow>
              <FieldRow label="Access Key ID"><input className="qa-inp" defaultValue="AKIA●●●●●●●●●●●●7QD2" readOnly /></FieldRow>
              <FieldRow label="Secret Access Key"><SecretInput value={'wJalr●●●●●●●●●●●●●●●●●●●●EXAMPLEKEY'} onChange={() => {}} /></FieldRow>
              <div className="qa-field-grid">
                <FieldRow label="Region"><input className="qa-inp" defaultValue={p.region} readOnly /></FieldRow>
                <FieldRow label="Service"><input className="qa-inp" defaultValue="execute-api" readOnly /></FieldRow>
              </div>
              <div className="qa-auth-note"><Icon name="shield" size={13} /> Stored locally. Used to sign requests with Signature V4.</div>
            </>
          )}
          {p.type === 'bearer' && (
            <FieldRow label="Token" hint="Sent as Authorization: Bearer <token>">
              <SecretInput value={'eyJhbGciOiJIUzI1●●●●●●●●●●●●'} onChange={() => {}} />
            </FieldRow>
          )}
          {p.type === 'basic' && (
            <>
              <FieldRow label="Username"><input className="qa-inp" defaultValue="qa-runner" readOnly /></FieldRow>
              <FieldRow label="Password"><SecretInput value={'●●●●●●●●●●●●'} onChange={() => {}} /></FieldRow>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function AppearanceSettings({ accent, setAccent }) {
  const ACC = window.QATheme.ACCENTS;
  return (
    <div className="qa-set-grid">
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="zap" size={14} /> Accent color</span></div>
        <div className="qa-set-body">
          <FieldRow label="Accent">
            <div className="tw-accents">
              <button className="tw-acc tw-acc--auto" data-active={accent === 'auto' ? '1' : '0'} onClick={() => setAccent('auto')} title="Default">A</button>
              {Object.entries(ACC).map(([name, hex]) => (
                <button key={name} className="tw-acc" data-active={accent === hex ? '1' : '0'} style={{ background: hex }} onClick={() => setAccent(hex)} title={name} />
              ))}
            </div>
          </FieldRow>
          <div className="qa-auth-note"><Icon name="shield" size={13} /> Applies across the whole app and is saved on this machine.</div>
        </div>
      </section>
    </div>
  );
}

function LlmSettings() {
  const [cfg, setCfg] = useStateST(() => window.loadLlmCfg());
  const MODELS = { openai: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2', 'gpt-5.5-codex'] };
  const DEF_MODEL = { builtin: 'claude-haiku-4-5', openai: 'gpt-5.4-mini', custom: '' };
  const save = (d) => { const n = { ...cfg, ...d }; setCfg(n); window.saveLlmCfg(n); };
  const setProvider = (v) => save({ provider: v, model: DEF_MODEL[v] });
  const builtin = cfg.provider === 'builtin';
  const claudeOk = !!(window.claude && window.claude.complete);
  return (
    <div className="qa-set-grid qa-set-grid--api">
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="sparkle" size={14} /> Generation provider</span></div>
        <div className="qa-set-body">
          <FieldRow label="Provider"><Dropdown value={cfg.provider} options={window.LLM_PROVIDERS} onChange={setProvider} /></FieldRow>
          {!builtin && (
            <>
              <FieldRow label="Model">
                {cfg.provider === 'openai'
                  ? <Dropdown value={cfg.model || 'gpt-5.4-mini'} options={MODELS.openai} onChange={(m) => save({ model: m })} />
                  : <input className="qa-inp" value={cfg.model} onChange={e => save({ model: e.target.value })} placeholder="model id, e.g. llama-3.1-70b" />}
              </FieldRow>
              <FieldRow label="API key"><SecretInput value={cfg.key} onChange={(v) => save({ key: v })} placeholder="sk-…" /></FieldRow>
              {cfg.provider === 'custom' && (
                <FieldRow label="Endpoint (OpenAI-compatible)"><input className="qa-inp" value={cfg.baseUrl} onChange={e => save({ baseUrl: e.target.value })} placeholder="https://…/v1/chat/completions" /></FieldRow>
              )}
              <div className="qa-auth-note"><Icon name="shield" size={13} /> Key is stored only in this browser (localStorage) and sent directly to your provider.</div>
            </>
          )}
          {builtin && <div className="qa-auth-note"><Icon name="zap" size={13} /> {claudeOk ? 'Uses the built-in Claude model — no key required.' : 'Built-in Claude is unavailable here — pick a provider and add a key.'}</div>}
        </div>
      </section>
      <section className="qa-panel">
        <div className="qa-panel-head"><span><Icon name="fileText" size={14} /> How it’s used</span></div>
        <div className="qa-set-body">
          <p className="qa-set-copy">Test Gen turns specs, BDD features, PRDs and PDFs into classified test cases. The <strong>AI</strong> engine uses the provider set here; the <strong>Heuristic</strong> engine runs fully offline as a fallback.</p>
        </div>
      </section>
    </div>
  );
}

function SettingsPage({ accent, setAccent, initialTab, vars, setVars, cookies, setCookies, sslVerify, setSslVerify }) {
  const [tab, setTab] = useStateST(initialTab || 'appearance');
  React.useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const tabs = [['appearance', 'Appearance'], ['env', 'Environment'], ['cookies', 'Cookies'], ['api', 'API & Credentials'], ['llm', 'AI / LLM']];
  return (
    <div className="qa-settings">
      <div className="qa-settings-head">
        <h2>Settings</h2>
        <div className="qa-segs qa-segs--mini">
          {tabs.map(([k, l]) => <button key={k} data-active={tab === k ? '1' : '0'} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      <div className="qa-settings-body">
        {tab === 'appearance' && <AppearanceSettings accent={accent} setAccent={setAccent} />}
        {tab === 'env' && <EnvSettings vars={vars} setVars={setVars} sslVerify={sslVerify} setSslVerify={setSslVerify} />}
        {tab === 'cookies' && <CookieSettings cookies={cookies} setCookies={setCookies} />}
        {tab === 'api' && <ApiSettings />}
        {tab === 'llm' && <LlmSettings />}
      </div>
    </div>
  );
}

Object.assign(window, { SettingsPage });

export { SettingsPage };
