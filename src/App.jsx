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
import { cookieMatches } from './qa/cookies.js';
import { MonitorsPage } from './qa/Monitors.jsx';
import { TestGen } from './qa/TestGen.jsx';
import { executeRequest } from './qa/executor.js';
import { buildReq } from './qa/buildReq.js';
import { buildOAuthTokenRequest, exchangeOAuthTokenWithFetch, parseOAuthTokenResponse } from './qa/oauth.js';
import api from './api/index.js';

const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;

// Custom window controls. The window is decoration-less (tauri.conf.json
// `decorations: false`), so close/minimize/maximize are wired here to the Tauri
// bridge. No-ops gracefully in the browser/dev/test.
const tauriReady = () => typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

// Controls follow the host OS: Windows gets right-aligned square
// minimize/maximize/close buttons (close hovers red); every other platform
// keeps the macOS-style colored traffic lights.
const uaPlatform = () => {
  if (typeof navigator === 'undefined') return '';
  return (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
};
const isWindowsOS = () => /windows|win32|win64/i.test(uaPlatform());
const isMacOS = () => /mac/i.test(uaPlatform());

function WindowControls() {
  const act = (fn) => (e) => { e.stopPropagation(); if (tauriReady()) Promise.resolve(fn()).catch(() => {}); };
  if (isWindowsOS()) {
    return (
      <div className="qa-winctl qa-winctl-win">
        <button type="button" className="qa-winctl-wbtn" title="Minimize" aria-label="Minimize window" onClick={act(api.minimizeWindow)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button type="button" className="qa-winctl-wbtn" title="Maximize" aria-label="Maximize window" onClick={act(api.maximizeWindow)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button type="button" className="qa-winctl-wbtn qa-winctl-wclose" title="Close" aria-label="Close window" onClick={act(api.quitApp)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1" fill="none" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div className="qa-winctl">
      <button type="button" className="qa-winctl-btn qa-winctl-close" title="Close" aria-label="Close window" onClick={act(api.quitApp)} />
      <button type="button" className="qa-winctl-btn qa-winctl-min" title="Minimize" aria-label="Minimize window" onClick={act(api.minimizeWindow)} />
      <button type="button" className="qa-winctl-btn qa-winctl-max" title="Maximize" aria-label="Maximize window" onClick={act(api.maximizeWindow)} />
    </div>
  );
}

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
// cookieMatches lives in ./qa/cookies.js so it can be unit-tested.

function App() {
  const rootRef = useRefApp(null);
  const [accent, setAccent] = useStateApp(() => { try { return localStorage.getItem('qa_accent') || 'auto'; } catch { return 'auto'; } });

  const [route, setRoute] = useStateApp('home');
  const [settingsTab, setSettingsTab] = useStateApp('appearance');
  const [env, setEnv] = useStateApp(window.QA.ENVIRONMENTS[0]);
  const [vars, setVars] = useStateApp(() => JSON.parse(JSON.stringify(window.QA.VARIABLES)));
  const [localVars, setLocalVars] = useStateApp({}); // { [reqId]: [{key,value,on}] }
  const [cookies, setCookies] = useStateApp(() => window.QA.COOKIES.map(c => ({ ...c })));
  const [sslVerify, setSslVerify] = useStateApp(true);
  const [tests, setTests] = useStateApp({});
  const [req, setReq] = useStateApp(() => buildReq(null));
  const [respState, setRespState] = useStateApp('empty'); // empty | loading | done
  const [response, setResponse] = useStateApp(null);
  const [history, setHistory] = useStateApp(window.QA.SEED_HISTORY.map(h => ({ ...h })));
  const [dataVersion, setDataVersion] = useStateApp(0); // bumps when collections are imported
  const [cookieToast, setCookieToast] = useStateApp(null); // {name, domain} captured from Set-Cookie
  const [oauthTokens, setOauthTokens] = useStateApp({}); // { [reqId]: { token, type, expiresAt, scope } }
  const [logoFlash, setLogoFlash] = useStateApp(0); // bumps on a successful response to flash the brand mark
  const [perfRunning, setPerfRunning] = useStateApp(false); // true while a performance test is in flight
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
  // Cookie selection: build the URL the request will actually hit so the
  // matcher can apply RFC 6265's domain/path/Secure rules. env.baseUrl is
  // substituted the same way the live executor does it — otherwise a
  // baseUrl like `{{apiHost}}` would never produce a parseable URL and we
  // would silently send no cookies on requests that the executor still
  // delivers successfully.
  const reqUrlForHost = window.qaSubstitute ? window.qaSubstitute(req.url || '', activeMap) : (req.url || '');
  const reqIsAbsolute = /^https?:\/\//i.test(reqUrlForHost);
  const envBaseSub = window.qaSubstitute ? window.qaSubstitute(env.baseUrl || '', activeMap) : (env.baseUrl || '');
  const reqUrlForCookie = reqIsAbsolute ? reqUrlForHost : (envBaseSub + reqUrlForHost);
  const reqHost = hostOf(reqUrlForCookie);
  // RFC 6265 §5.4: cookies with longer paths must precede shorter-path ones
  // in the Cookie header. Many servers read the first occurrence of a name,
  // so without this sort our /admin cookie would lose to / when both match.
  const reqCookies = cookies
    .filter((c) => cookieMatches(c, reqUrlForCookie))
    .sort((a, b) => (b.path || '/').length - (a.path || '/').length);

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
        // Prefer the per-hop `setCookies` array from Rust (each entry carries
        // the URL of the response that actually set it) so a redirect chain
        // across hosts scopes each cookie to the correct host/path. Fall
        // back to the headers['set-cookie'] string when running against the
        // canned-response dev fallback that has no per-hop metadata.
        const perHop = Array.isArray(resp.setCookies) ? resp.setCookies : null;
        const sc = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
        if (perHop && perHop.length) {
          let firstCk = null;
          perHop.forEach(({ url, line }) => {
            if (!line) return;
            let hopHost = '', hopPath = '/';
            try { const u = new URL(url || ''); hopHost = u.hostname; hopPath = u.pathname || '/'; }
            catch { hopHost = hostOf(url || ''); }
            const ck = window.qaParseSetCookie(line, hopHost, hopPath);
            if (!ck) return;
            firstCk = firstCk || ck;
            setCookies((jar) => window.qaMergeCookie(jar, ck));
          });
          if (firstCk) {
            setCookieToast({ name: firstCk.name, domain: firstCk.domain || '' });
            setTimeout(() => setCookieToast(null), 4200);
          }
        } else if (sc) {
          // Legacy / canned-response path: no per-hop metadata, derive a
          // single scope URL the way executor builds the actual request.
          let fullSentUrl = resp.finalUrl || '';
          if (!fullSentUrl) {
            const sentUrlSub = window.qaSubstitute ? window.qaSubstitute(sentReq.url || '', activeMap) : (sentReq.url || '');
            const sentIsAbsolute = /^https?:\/\//i.test(sentUrlSub);
            const envBaseSubCap = window.qaSubstitute ? window.qaSubstitute(env.baseUrl || '', activeMap) : (env.baseUrl || '');
            fullSentUrl = sentIsAbsolute ? sentUrlSub : (envBaseSubCap + sentUrlSub);
          }
          let sentHost = '', sentPath = '/';
          try { const u = new URL(fullSentUrl); sentHost = u.hostname; sentPath = u.pathname || '/'; }
          catch { sentHost = hostOf(fullSentUrl); }
          const scList = Array.isArray(sc) ? sc : String(sc).split('\n').map((s) => s.trim()).filter(Boolean);
          let firstCk = null;
          scList.forEach((line) => {
            const ck = window.qaParseSetCookie(line, sentHost, sentPath);
            if (!ck) return;
            firstCk = firstCk || ck;
            setCookies((jar) => window.qaMergeCookie(jar, ck));
          });
          if (firstCk) {
            setCookieToast({ name: firstCk.name, domain: firstCk.domain || sentHost });
            setTimeout(() => setCookieToast(null), 4200);
          }
        }
      });
  };

  // OAuth 2.0 — obtain a real token from the configured token endpoint. In
  // Tauri, route through the Rust HTTP backend to avoid browser CORS limits;
  // in browser/dev fallback, use fetch directly.
  const fetchOAuthToken = async (targetReq) => {
    const tokenRequest = buildOAuthTokenRequest(targetReq.auth.oauth2 || {}, activeMap);
    let token;
    if (tauriReady()) {
      const resp = await executeRequest(tokenRequest, { label: 'OAuth', baseUrl: '' }, {}, { sslVerify });
      if (!resp || resp.status < 200 || resp.status >= 300) {
        const detail = resp && resp.body && typeof resp.body === 'object'
          ? (resp.body.error_description || resp.body.error || JSON.stringify(resp.body))
          : '';
        throw new Error(`OAuth token endpoint returned HTTP ${resp ? resp.status : 0}${detail ? `: ${detail}` : ''}`);
      }
      token = parseOAuthTokenResponse(resp.body, tokenRequest.oauthContext);
    } else {
      token = await exchangeOAuthTokenWithFetch(tokenRequest);
    }
    setOauthTokens(t => ({ ...t, [targetReq.id]: token }));
    return token;
  };

  return (
    <div className="qa-app" ref={rootRef}>
      <NavRail route={route} setRoute={setRoute} busy={respState === 'loading'} flashAt={logoFlash} active={perfRunning} />

      <div className="qa-main">
        {/* Title bar */}
        <header className="qa-titlebar" data-tauri-drag-region onDoubleClick={() => { if (tauriReady()) Promise.resolve(api.maximizeWindow()).catch(() => {}); }}>
          <div className="qa-titlebar-left" data-tauri-drag-region>
            {isMacOS() && <WindowControls />}
            <span className="qa-titlebar-name" data-tauri-drag-region>QA Touchstone</span>
            <span className="qa-titlebar-sep" data-tauri-drag-region>/</span>
            <span className="qa-titlebar-route" data-tauri-drag-region>{ROUTE_LABEL[route] || 'Home'}</span>
          </div>
          <div className="qa-titlebar-right" data-tauri-drag-region>
            {route === 'api' && (
              <span className="qa-titlebar-env" data-tauri-drag-region><span className="qa-env-dot" /> {env.label}</span>
            )}
            {!isMacOS() && <WindowControls />}
          </div>
        </header>

        <div className="qa-content">
          {route === 'home' && <HomePage setRoute={setRoute} history={history} onOpenRequest={openFromHistory} env={env} />}
          {route === 'settings' && <SettingsPage accent={accent} setAccent={setAccent} initialTab={settingsTab} vars={vars} setVars={setVars} cookies={cookies} setCookies={setCookies} sslVerify={sslVerify} setSslVerify={setSslVerify} />}
          {route === 'perf' && <PerfTest env={env} vars={vars} onRunningChange={setPerfRunning} />}
          {route === 'realtime' && <RealtimePage env={env} />}
          {route === 'runner' && <Runner env={env} vars={vars} tests={tests} cookies={cookies} sslVerify={sslVerify} oauthTokens={oauthTokens} />}
          {route === 'docs' && <DocsPage env={env} onOpenRequest={(id) => { selectRequest(id); setRoute('api'); }} />}
          {route === 'monitors' && <MonitorsPage env={env} setRoute={setRoute} vars={vars} cookies={cookies} sslVerify={sslVerify} tests={tests} oauthTokens={oauthTokens} />}
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
                                oauthToken={oauthTokens[req.id]} onFetchOAuth={() => fetchOAuthToken(req)} />
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
