// ── QA Touchstone — app shell, routing, send flow ──────────────────────────
// Ported from the Claude Design redesign. The send flow is wired to the real
// Tauri HTTP backend via executeRequest (with a canned-response fallback).
import React from 'react';
import './qa/setup.js';
import { Icon } from './qa/components.jsx';
import { NavRail, CollectionsPanel } from './qa/Sidebar.jsx';
import { RequestBuilder } from './qa/RequestBuilder.jsx';
import { ResponsePanel } from './qa/ResponsePanel.jsx';
import { HomePage } from './qa/HomePage.jsx';
import { SettingsPage } from './qa/SettingsPage.jsx';
import { PerfTest } from './qa/PerfTest.jsx';
import { RealtimePage } from './qa/Realtime.jsx';
import { Runner } from './qa/Runner.jsx';
import { DocsPage } from './qa/Docs.jsx';
import { MonitorsPage } from './qa/Monitors.jsx';
import { TestGen } from './qa/TestGen.jsx';
import { executeRequest } from './qa/executor.js';

const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;

const DEFAULT_HEADERS = [{ key: 'Accept', value: 'application/json', on: true }];

const ROUTE_LABEL = { home: 'Home', api: 'API Client', realtime: 'Realtime', runner: 'Runner', perf: 'Performance', testgen: 'Test Gen', docs: 'API Docs', monitors: 'Monitors', settings: 'Settings' };

// Which collection owns a given request id (for collection-scoped variables).
function collectionOf(reqId) {
  for (const c of window.QA.COLLECTIONS) {
    for (const f of c.folders) if (f.requests.some(r => r.id === reqId)) return c.id;
  }
  return null;
}
// Best-effort host from an env base URL, for matching cookies to a request.
function hostOf(url) {
  try { return new URL(url).hostname; } catch { return (url || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0]; }
}
function cookieMatches(ck, host) {
  if (!ck.on || !host) return false;
  return host === ck.domain || host.endsWith('.' + ck.domain) || ck.domain.endsWith('.' + host) || ck.domain === host;
}

function buildReq(id) {
  const { COLLECTIONS, REQUEST_DETAILS } = window.QA;
  const all = COLLECTIONS.flatMap(c => c.folders.flatMap(f => f.requests));
  const meta = all.find(r => r.id === id) || all[0];
  const det = REQUEST_DETAILS[meta.id] || {};
  const isGql = !!det.graphql;
  return {
    id: meta.id,
    method: meta.method,
    url: meta.path.split('?')[0],
    params: (det.params || []).map(p => ({ ...p })),
    headers: DEFAULT_HEADERS.map(h => ({ ...h })),
    bodyMode: isGql ? 'graphql' : (det.body ? 'json' : 'none'),
    body: det.body || '',
    gqlQuery: isGql ? det.graphql.query : '',
    gqlVars: isGql ? det.graphql.variables : '',
    form: [],
    auth: {
      type: det.auth || 'none',
      bearer: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3MzAxIn0.demo',
      apiKey: { key: 'x-api-key', value: 'sk_live_4f8a91c2e7', placement: 'header' },
      basic: { user: 'qa-runner', pass: 'correct horse battery' },
      aws: { profile: 'acme-staging', service: 'execute-api', region: 'us-east-1' },
      oauth2: { grant: 'client_credentials', authUrl: 'https://auth.acme.dev/authorize', tokenUrl: 'https://auth.acme.dev/oauth/token', clientId: '{{clientId}}', clientSecret: '', scope: 'read write' },
    },
  };
}

function App() {
  const rootRef = useRefApp(null);
  const [accent, setAccent] = useStateApp(() => { try { return localStorage.getItem('qa_accent') || 'auto'; } catch { return 'auto'; } });

  const [route, setRoute] = useStateApp('home');
  const [settingsTab, setSettingsTab] = useStateApp('appearance');
  const [env, setEnv] = useStateApp(window.QA.ENVIRONMENTS[2]); // Staging
  const [vars, setVars] = useStateApp(() => JSON.parse(JSON.stringify(window.QA.VARIABLES)));
  const [localVars, setLocalVars] = useStateApp({}); // { [reqId]: [{key,value,on}] }
  const [cookies, setCookies] = useStateApp(() => window.QA.COOKIES.map(c => ({ ...c })));
  const [sslVerify, setSslVerify] = useStateApp(true);
  const [tests, setTests] = useStateApp({});
  const [req, setReq] = useStateApp(() => buildReq('usr-list'));
  const [respState, setRespState] = useStateApp('empty'); // empty | loading | done
  const [response, setResponse] = useStateApp(null);
  const [history, setHistory] = useStateApp(window.QA.SEED_HISTORY.map(h => ({ ...h })));
  const [dataVersion, setDataVersion] = useStateApp(0); // bumps when collections are imported
  const [cookieToast, setCookieToast] = useStateApp(null); // {name, domain} captured from Set-Cookie
  const [oauthTokens, setOauthTokens] = useStateApp({}); // { [reqId]: { token, type, expiresAt, scope } }
  const [logoFlash, setLogoFlash] = useStateApp(0); // bumps on a successful response to flash the brand mark
  const sendSeq = useRefApp(0);

  // Apply theme whenever the accent changes; persist it.
  useEffectApp(() => {
    window.QATheme.applyTheme(rootRef.current, { direction: 'graphite', accent, density: 'comfortable', uiFont: 'mono' });
    try { localStorage.setItem('qa_accent', accent); } catch {}
  }, [accent]);

  const openSettings = (tab = 'appearance') => { setSettingsTab(tab); setRoute('settings'); };

  const collectionId = collectionOf(req.id);
  const localList = localVars[req.id] || [];
  const localObj = {};
  localList.forEach(v => { if (v.on !== false && v.key) localObj[v.key] = v.value; });
  const activeMap = window.qaVarMap(vars, env.label, collectionId, localObj);
  const setLocalForReq = (list) => setLocalVars(m => ({ ...m, [req.id]: list }));
  const reqHost = hostOf(env.baseUrl || req.url);
  const reqCookies = cookies.filter(c => cookieMatches(c, reqHost));

  // Merge generated/structured assertions into a request's tests, matched by method+path.
  const addTestsForCase = (method, path, assertions) => {
    const all = window.QA.COLLECTIONS.flatMap(c => c.folders.flatMap(f => f.requests));
    const base = (path || '').split('?')[0];
    const match = all.find(r => r.method === method && r.path.split('?')[0] === base);
    if (!match) return false;
    setTests(t => ({ ...t, [match.id]: [...(t[match.id] || []), ...assertions] }));
    return true;
  };

  const patch = (delta) => setReq(r => ({ ...r, ...delta }));

  const selectRequest = (id) => {
    setReq(buildReq(id));
    setRespState('empty');
    setResponse(null);
    sendSeq.current++; // invalidate any in-flight send
  };

  const openFromHistory = (h) => {
    selectRequest(h.id);
    setRoute('api');
  };

  // Merge an imported Postman/OpenAPI collection into the live data set.
  const importCollection = ({ collection, details, responses }) => {
    Object.assign(window.QA.REQUEST_DETAILS, details);
    Object.assign(window.QA.RESPONSES, responses);
    window.QA.COLLECTIONS.push(collection);
    setDataVersion(v => v + 1);
    const first = collection.folders.flatMap(f => f.requests)[0];
    if (first) { selectRequest(first.id); setRoute('api'); }
  };

  const send = () => {
    if (respState === 'loading') return;
    const seq = ++sendSeq.current;
    const sentReq = req;
    setRespState('loading');
    setResponse(null);
    executeRequest(sentReq, env, activeMap, { cookies: reqCookies, sslVerify, oauthToken: oauthTokens[sentReq.id] })
      .then((resp) => {
        if (seq !== sendSeq.current) return; // a newer send / selection superseded this
        setResponse(resp);
        setRespState('done');
        const now = new Date();
        const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const pathWithParams = sentReq.url + (sentReq.params.filter(p => p.on && p.key).length
          ? '?' + sentReq.params.filter(p => p.on && p.key).map(p => `${p.key}=${p.value}`).join('&') : '');
        setHistory(h => [{ id: sentReq.id, method: sentReq.method, path: pathWithParams, status: resp.status, time: resp.time, at }, ...h].slice(0, 12));
        if (resp.status >= 200 && resp.status < 400) setLogoFlash(Date.now());

        // Capture Set-Cookie into the jar (auto-managed, like a browser).
        const sc = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
        if (sc) {
          const host = hostOf(env.baseUrl || sentReq.url);
          const ck = window.qaParseSetCookie(sc, host);
          if (ck) {
            setCookies(jar => window.qaMergeCookie(jar, ck));
            setCookieToast({ name: ck.name, domain: ck.domain || host });
            setTimeout(() => setCookieToast(null), 4200);
          }
        }
      });
  };

  // OAuth 2.0 — obtain a token from the configured token endpoint.
  // Falls back to a simulated token when no real backend / endpoint is reachable.
  const fetchOAuthToken = (reqId) => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.' + Math.random().toString(36).slice(2, 10) + '.demo';
    setOauthTokens(t => ({ ...t, [reqId]: {
      token, type: 'Bearer', scope: 'read write',
      expiresAt: Date.now() + 3600 * 1000, obtainedAt: Date.now(),
    } }));
  };

  return (
    <div className="qa-app" ref={rootRef}>
      <NavRail route={route} setRoute={setRoute} busy={respState === 'loading'} flashAt={logoFlash} />

      <div className="qa-main">
        {/* Title bar */}
        <header className="qa-titlebar">
          <div className="qa-titlebar-left">
            <span className="qa-titlebar-name">QA Touchstone</span>
            <span className="qa-titlebar-sep">/</span>
            <span className="qa-titlebar-route">{ROUTE_LABEL[route] || 'Home'}</span>
          </div>
          <div className="qa-titlebar-right">
            {route === 'api' && (
              <span className="qa-titlebar-env"><span className="qa-env-dot" /> {env.label}</span>
            )}
            <div className="qa-winctl"><span /><span /><span /></div>
          </div>
        </header>

        <div className="qa-content">
          {route === 'home' && <HomePage setRoute={setRoute} history={history} onOpenRequest={openFromHistory} env={env} />}
          {route === 'settings' && <SettingsPage accent={accent} setAccent={setAccent} initialTab={settingsTab} vars={vars} setVars={setVars} cookies={cookies} setCookies={setCookies} sslVerify={sslVerify} setSslVerify={setSslVerify} />}
          {route === 'perf' && <PerfTest />}
          {route === 'realtime' && <RealtimePage env={env} />}
          {route === 'runner' && <Runner env={env} vars={vars} tests={tests} />}
          {route === 'docs' && <DocsPage env={env} onOpenRequest={(id) => { selectRequest(id); setRoute('api'); }} />}
          {route === 'monitors' && <MonitorsPage env={env} setRoute={setRoute} />}
          {route === 'testgen' && <TestGen openSettings={openSettings} onAddTests={addTestsForCase} />}
          {route === 'api' && (
            <div className="qa-api">
              <CollectionsPanel selectedReq={req.id} onSelectRequest={selectRequest}
                                env={env} setEnv={setEnv} history={history} onSelectHistory={openFromHistory}
                                onImport={importCollection} dataVersion={dataVersion} />
              <div className="qa-api-work">
                <RequestBuilder req={req} patch={patch} onSend={send} isLoading={respState === 'loading'} env={env}
                                varMap={activeMap} tests={tests[req.id] || []}
                                setTests={(list) => setTests(t => ({ ...t, [req.id]: list }))}
                                collectionId={collectionId} localVars={localList} setLocalVars={setLocalForReq}
                                cookies={reqCookies} sslVerify={sslVerify} setSslVerify={setSslVerify}
                                onOpenSettings={openSettings}
                                oauthToken={oauthTokens[req.id]} onFetchOAuth={() => fetchOAuthToken(req.id)} />
                <div className="qa-split" />
                <ResponsePanel state={respState} response={response} req={req} env={env}
                               varMap={activeMap} testList={tests[req.id] || []} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Set-Cookie capture toast */}
      {cookieToast && (
        <div className="qa-toast" onClick={() => { setCookieToast(null); openSettings('cookies'); }}>
          <Icon name="globe" size={15} />
          <div className="qa-toast-text">
            <strong>Cookie stored</strong>
            <span><code>{cookieToast.name}</code> saved to jar for {cookieToast.domain}</span>
          </div>
          <span className="qa-toast-cta">View jar</span>
        </div>
      )}
    </div>
  );
}

export default App;
