// ── QA Touchstone — app shell + routing ─────────────────────────────────────
// 重構後的薄殼：workspace（env/vars/cookies/...）、request/send 流程、
// monitors 排程、toast 都已抽到 src/qa/state/ 的型別化 provider。
// AppShell 只剩 UI 殼層狀態：route、settings 分頁、accent、perf 執行旗標。
// 有「直接渲染測試」鎖定 props 介面的元件（SecurityPage / PerfTest /
// MonitorsPage / ResponsePanel / RateLimitPanel 等）仍由這裡以 props 餵值。
import React from 'react';
import './qa/setup';
import { NavRail, CollectionsPanel } from './qa/Sidebar';
import { RequestBuilder } from './qa/RequestBuilder';
import { ResponsePanel } from './qa/ResponsePanel';
import { HomePage } from './qa/HomePage';
import { SettingsPage } from './qa/SettingsPage';
import { PerfTest } from './qa/PerfTest';
import { RealtimePage } from './qa/Realtime';
import { Runner } from './qa/Runner';
import { SecurityPage } from './qa/Security';
import { DocsPage } from './qa/Docs';
import { MonitorsPage } from './qa/Monitors';
import { TestGen } from './qa/TestGen';
import { I18nProvider } from './qa/i18n';
import { useI18n } from './qa/useI18n';
import { PromptPreviewHost } from './qa/PromptPreview';
import api from './api/index';
import { loadAiPolicy } from './qa/aiPolicy';
import { loadString, saveString } from './qa/storage';
import { ErrorBoundary } from './qa/ErrorBoundary';
import { WorkspaceProvider, useWorkspace } from './qa/state/WorkspaceContext';
import { RequestProvider, useRequest } from './qa/state/RequestContext';
import { MonitorsProvider, useMonitors } from './qa/state/MonitorsContext';
import { ToastHost } from './qa/state/ToastHost';

const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp } = React;

// Custom window controls. The window is decoration-less (tauri.conf.json
// `decorations: false`), so close/minimize/maximize are wired here to the Tauri
// bridge. No-ops gracefully in the browser/dev/test.
const tauriReady = () => typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

// Controls follow the host OS: Windows gets right-aligned square
// minimize/maximize/close buttons (close hovers red); every other platform
// keeps the macOS-style colored traffic lights.
const uaPlatform = (): string => {
  if (typeof navigator === 'undefined') return '';
  // userAgentData 尚未進 TS DOM lib（Chromium-only API）
  const uaData = (navigator as any).userAgentData;
  return (uaData && uaData.platform) || navigator.platform || navigator.userAgent || '';
};
const isWindowsOS = () => /windows|win32|win64/i.test(uaPlatform());
const isMacOS = () => /mac/i.test(uaPlatform());

function WindowControls() {
  const { t } = useI18n();
  const act = (fn: () => unknown) => (e: React.MouseEvent) => { e.stopPropagation(); if (tauriReady()) Promise.resolve(fn()).catch(() => {}); };
  if (isWindowsOS()) {
    return (
      <div className="qa-winctl qa-winctl-win">
        <button type="button" className="qa-winctl-wbtn" title={t('window.minimize')} aria-label={t('window.minimize')} onClick={act(api.minimizeWindow)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button type="button" className="qa-winctl-wbtn" title={t('window.maximize')} aria-label={t('window.maximize')} onClick={act(api.maximizeWindow)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button type="button" className="qa-winctl-wbtn qa-winctl-wclose" title={t('window.close')} aria-label={t('window.close')} onClick={act(api.quitApp)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1" fill="none" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div className="qa-winctl">
      <button type="button" className="qa-winctl-btn qa-winctl-close" title={t('window.close')} aria-label={t('window.close')} onClick={act(api.quitApp)} />
      <button type="button" className="qa-winctl-btn qa-winctl-min" title={t('window.minimize')} aria-label={t('window.minimize')} onClick={act(api.minimizeWindow)} />
      <button type="button" className="qa-winctl-btn qa-winctl-max" title={t('window.maximize')} aria-label={t('window.maximize')} onClick={act(api.maximizeWindow)} />
    </div>
  );
}

const ROUTE_KEYS: Record<string, string> = { home: 'route.home', api: 'route.api', realtime: 'route.realtime', runner: 'route.runner', perf: 'route.perf', testgen: 'route.testgen', docs: 'route.docs', monitors: 'route.monitors', settings: 'route.settings', security: 'route.security' };

function AppShell() {
  const { t } = useI18n();
  const rootRef = useRefApp(null);
  const [accent, setAccent] = useStateApp(() => loadString('qa_accent', 'auto') || 'auto');
  const [route, setRoute] = useStateApp('home');
  const [settingsTab, setSettingsTab] = useStateApp('appearance');
  const [perfRunning, setPerfRunning] = useStateApp(false); // true while a performance test is in flight

  const { env, vars, setVars, cookies, setCookies, sslVerify, setSslVerify, tests, oauthTokens } = useWorkspace();
  const {
    req, respState, response, history, logoFlash,
    selectRequest, importCollection, addTestsForCase,
  } = useRequest();
  const { monitors, setMonitors, monitorRunning, runMonitorById, toggleMonitor, createMonitor } = useMonitors();

  // Resolve backend AI policy once at boot; failures are harmless (web/dev fallback).
  useEffectApp(() => { loadAiPolicy().catch(() => {}); }, []);

  // Apply theme whenever the accent changes; persist it.
  useEffectApp(() => {
    window.QATheme.applyTheme(rootRef.current, { direction: 'graphite', accent, density: 'comfortable', uiFont: 'mono' });
    saveString('qa_accent', accent);
  }, [accent]);

  const openSettings = (tab = 'appearance') => { setSettingsTab(tab); setRoute('settings'); };
  const openFromHistory = (h: { id: string }) => { selectRequest(h.id); setRoute('api'); };
  const onImportCollection = (payload: { collection: any; details: any; responses: any }) => {
    const first = importCollection(payload);
    if (first) setRoute('api');
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
            <span className="qa-titlebar-route" data-tauri-drag-region>{t(ROUTE_KEYS[route] || 'route.home')}</span>
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
          {route === 'security' && <SecurityPage env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} />}
          {route === 'docs' && <DocsPage env={env} onOpenRequest={(id) => { selectRequest(id); setRoute('api'); }} />}
          {route === 'monitors' && <MonitorsPage env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} tests={tests} oauthTokens={oauthTokens}
                                                  monitors={monitors} setMonitors={setMonitors} running={monitorRunning}
                                                  onRunMonitor={(id) => runMonitorById(id, 'manual')}
                                                  onToggleMonitor={toggleMonitor} onCreateMonitor={createMonitor} />}
          {route === 'testgen' && <TestGen openSettings={openSettings} onAddTests={addTestsForCase} />}
          {route === 'api' && (
            <div className="qa-api">
              <CollectionsPanel onSelectHistory={openFromHistory} onImport={onImportCollection} />
              <div className="qa-api-work">
                <RequestBuilder onOpenSettings={openSettings} />
                <div className="qa-split" />
                <ResponsePanel state={respState} response={response} req={req} env={env}
                               testList={tests[req.id] || []} />
              </div>
            </div>
          )}
        </div>
      </div>

      <ToastHost onOpenCookieJar={() => openSettings('cookies')} />
      <PromptPreviewHost />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <WorkspaceProvider>
          <RequestProvider>
            <MonitorsProvider>
              <AppShell />
            </MonitorsProvider>
          </RequestProvider>
        </WorkspaceProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}

export default App;
