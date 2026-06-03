import React from 'react';
import './setup.js';
import { Icon, MethodBadge, loadLlmCfg } from './components.jsx';
import { AuthEditor } from './AuthEditor.jsx';
import { useI18n } from './useI18n.js';
import { qaRunSavedRequest } from './sendRequest.js';
import { executeRequest } from './executor.js';
import { requestOAuthToken } from './oauth.js';
import {
  anonIdentity, withDefaults, setColumn, setRow, runMatrix, summarize,
  loadMatrixConfig, saveMatrixConfig, DEFAULT_DENY_SET, endpointPrivileged,
} from './authz.js';
import {
  runOracles, inferContract, summarizeFindings, scanSensitiveLLM, worstSeverity,
  SEVERITY_ORDER, DEFAULT_ORACLE_CONFIG,
} from './oracles.js';
import { BolaPanel } from './BolaPanel.jsx';
import { runBola, applyIdLocation } from './bola.js';
import { RateLimitPanel } from './RateLimitPanel.jsx';
import { runBurst, detectThrottleSignal, classifyRateLimit, rlFindingFor } from './ratelimit.js';
import { TriagePanel } from './TriagePanel.jsx';
import { FindingsPanel } from './FindingsPanel.jsx';
import { SuiteRunBar } from './SuiteRunBar.jsx';
import { runSuite, normalizeMatrix } from './securitySuite.js';
import {
  loadLifecycle, loadSnapshots, saveSnapshots, snapshotOf, scopeHashOf, recordRun, pinBaseline,
} from './findings.js';

const { useState: useS, useEffect: useE, useMemo, useRef, useCallback } = React;
const EXPECTS = ['allow', 'deny', 'skip'];
const VERDICT_LABEL = { pass: 'security.verdict.pass', fail: 'security.verdict.fail', vuln: 'security.verdict.vuln', inconclusive: 'security.verdict.inconclusive' };

// Build the EMPTY auth shape AuthEditor expects (mirrors buildReq.EMPTY_REQ.auth).
function blankAuth() {
  return {
    type: 'none', bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', code: '', redirectUri: '', username: '', password: '' },
  };
}

let idSeq = 1;
function newIdentity() { return { id: `id_${Date.now()}_${idSeq++}`, name: '', auth: blankAuth() }; }

// All saved requests, folder-grouped, for the endpoint picker.
function allRequests() {
  return (window.QA.COLLECTIONS || []).flatMap(c =>
    (c.folders || []).flatMap(f => (f.requests || []).map(r => ({ reqId: r.id, method: r.method, path: r.path, name: r.name, folder: f.name }))));
}

function IdentityEditor({ identity, onChange, onClose, env, vars, sslVerify }) {
  const { t } = useI18n();
  // AuthEditor reads req.auth and calls patch({auth}); adapt to our identity shape.
  const fakeReq = { auth: identity.auth };
  const patch = ({ auth }) => onChange({ ...identity, auth });
  const fetchOAuth = async () => {
    const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label);
    // Shared with the API client: Tauri backend vs fetch. Failures propagate so
    // AuthEditor's OAuth2Editor shows them.
    const token = await requestOAuthToken(identity.auth.oauth2, map, { sslVerify, executeRequest });
    if (token) onChange({ ...identity, _oauthToken: token });
  };
  return (
    <div className="qa-sec-idedit">
      <input className="qa-inp" placeholder={t('security.identityName')} value={identity.name}
             onChange={e => onChange({ ...identity, name: e.target.value })} />
      <label className="qa-sec-privchk">
        <input type="checkbox" checked={!!identity.privileged}
               onChange={e => onChange({ ...identity, privileged: e.target.checked })} />
        {t('security.priv.identity')}
      </label>
      <span className="qa-meta">{t('security.priv.identityHint')}</span>
      <AuthEditor req={fakeReq} patch={patch} oauthToken={identity._oauthToken} onFetchOAuth={fetchOAuth} />
      <button className="qa-link" onClick={onClose}><Icon name="check" size={13} /> {t('common.done') || 'Done'}</button>
    </div>
  );
}

function EndpointPicker({ existing, onAdd, onClose }) {
  const { t } = useI18n();
  const reqs = allRequests();
  const have = new Set(existing.map(e => e.reqId));
  return (
    <div className="qa-sec-picker">
      <div className="qa-sec-picker-head">{t('security.pickEndpoints')}<button className="qa-iconbtn" onClick={onClose}><Icon name="x" size={13} /></button></div>
      <div className="qa-sec-picker-list">
        {reqs.length === 0 && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}
        {reqs.map(r => (
          <button key={r.reqId} className="qa-sec-picker-row" disabled={have.has(r.reqId)}
                  onClick={() => onAdd({ reqId: r.reqId, method: r.method, path: r.path })}>
            <MethodBadge method={r.method} size="sm" /> <code>{r.path}</code>
            {have.has(r.reqId) && <Icon name="check" size={12} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function SecurityPage({ env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
  const { t } = useI18n();
  const [identities, setIdentities] = useS(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.identities && cfg.identities.length) ? cfg.identities : [anonIdentity()];
  });
  const [endpoints, setEndpoints] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.endpoints) || []; });
  const [expect, setExpect] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.expect) || {}; });
  const [denySet, setDenySet] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.denySet) || DEFAULT_DENY_SET; });
  const [results, setResults] = useS({});
  const [running, setRunning] = useS(false);
  const [editId, setEditId] = useS(null);
  const [picking, setPicking] = useS(false);
  const [drawer, setDrawer] = useS(null);   // { reqId, idId }
  const abortRef = useRef(null);
  const baselinesRef = useRef({});   // { [reqId]: contract } — transient, per run
  const [oracleConfig] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.oracleConfig) || DEFAULT_ORACLE_CONFIG; });
  const [aiScan, setAiScan] = useS({ busy: false, error: null });
  const [mode, setMode] = useS('matrix');
  const [bola, setBola] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.bola) || { tests: [] }; });
  const [bolaResults, setBolaResults] = useS({});
  const [rateLimit, setRateLimit] = useS(() => { const cfg = loadMatrixConfig(); return (cfg && cfg.rateLimit) || { tests: [] }; });
  const [rlResults, setRlResults] = useS({});
  const [snapshots, setSnapshots] = useS(() => loadSnapshots());
  const [suite, setSuite] = useS({ running: false, engine: null, done: 0, total: 0, lastRecord: null });
  const suiteAbortRef = useRef(null);

  // Normalize expectations to fill defaults for the current identities×endpoints.
  const state = useMemo(() => withDefaults({ identities, endpoints, expect, denySet: denySet.length ? denySet : DEFAULT_DENY_SET, oracleConfig, bola, rateLimit }), [identities, endpoints, expect, denySet, oracleConfig, bola, rateLimit]);

  // Persist config (not results) whenever it changes.
  useE(() => { saveMatrixConfig(state); }, [state]);

  const summary = useMemo(() => summarize(results), [results]);
  const privCount = useMemo(() => endpoints.filter(e => endpointPrivileged(e).privileged).length, [endpoints]);
  const findSummary = useMemo(() => summarizeFindings(results), [results]);
  const allFindings = useMemo(() => {
    const out = [];
    for (const ep of endpoints) {
      for (const id of identities) {
        const cell = results[ep.reqId] && results[ep.reqId][id.id];
        for (const f of (cell && cell.findings) || []) {
          out.push({ ...f, endpoint: ep.path, method: ep.method, identity: id.id === 'anon' ? t('security.anon') : (id.name || id.id) });
        }
      }
    }
    return out.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  }, [results, endpoints, identities, t]);

  // Cross-engine triage union. Matrix findings are normalized here (with a
  // {reqId, idId} back-ref); BOLA/rate-limit panels report their own normalized
  // lists upward via onFindings. Stable callbacks so the child effects don't loop.
  const [bolaFindings, setBolaFindings] = useS([]);
  const [rlFindings, setRlFindings] = useS([]);
  const onBolaFindings = useCallback((list) => setBolaFindings(list), []);
  const onRlFindings = useCallback((list) => setRlFindings(list), []);
  const matrixNormalized = useMemo(() => normalizeMatrix(results, endpoints, identities), [results, endpoints, identities]);
  const triageUnion = useMemo(() => [...matrixNormalized, ...bolaFindings, ...rlFindings], [matrixNormalized, bolaFindings, rlFindings]);

  const scopeDescriptor = useMemo(() => ({
    endpoints: endpoints.map(e => e.reqId).sort(),
    identities: identities.map(i => i.id).sort(),
    bola: (bola.tests || []).map(x => x.id).sort(),
    rl: (rateLimit.tests || []).map(x => x.id).sort(),
  }), [endpoints, identities, bola, rateLimit]);
  const scopeHash = useMemo(() => scopeHashOf(scopeDescriptor), [scopeDescriptor]);
  const scopeMismatch = !!(snapshots.baseline && snapshots.baseline.scopeHash && snapshots.baseline.scopeHash !== scopeHash);

  const cycleCell = (reqId, idId) => {
    const cur = state.expect[reqId][idId];
    const next = EXPECTS[(EXPECTS.indexOf(cur) + 1) % EXPECTS.length];
    setExpect(e => ({ ...e, [reqId]: { ...(e[reqId] || state.expect[reqId]), [idId]: next } }));
  };
  const bulkCol = (idId, val) => setExpect(setColumn(state, idId, val).expect);
  const bulkRow = (reqId, val) => setExpect(setRow(state, reqId, val).expect);

  const addIdentity = () => { const id = newIdentity(); setIdentities(xs => [...xs, id]); setEditId(id.id); };
  const removeIdentity = (id) => {
    if (id === 'anon') return;
    setIdentities(xs => xs.filter(x => x.id !== id));
    // Drop this identity's cells so the summary chips don't keep counting them.
    setResults(r => Object.fromEntries(Object.entries(r).map(([rid, row]) => {
      const { [id]: _gone, ...rest } = row; return [rid, rest];
    })));
  };
  const removeEndpoint = (reqId) => {
    setEndpoints(xs => xs.filter(x => x.reqId !== reqId));
    setResults(r => { const n = { ...r }; delete n[reqId]; return n; });
  };
  const togglePriv = (reqId, val) => setEndpoints(xs => xs.map(e => e.reqId === reqId ? { ...e, privileged: val } : e));

  const runner = (ep, identity) => qaRunSavedRequest({ id: ep.reqId }, {
    env, vars, cookies, sslVerify, authOverride: identity.auth, oauthToken: identity._oauthToken,
  }).then(response => ({
    // Redacted summary of what was sent — drives the cell drawer (and is ready
    // for a later CI export to serialize) without storing any secret.
    request: { method: ep.method, path: ep.path, identity: identity.id === 'anon' ? 'anon' : (identity.name || identity.id), authType: identity.auth.type },
    response,
  }));

  // Compute a matrix cell's findings using the streaming-baseline + oracles, into `baselines`.
  const matrixCellFindings = (reqId, cell, baselines) => {
    const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
    if (is2xx && cell.response && !baselines[reqId]) baselines[reqId] = inferContract(cell.response.body);
    return runOracles(cell, { baseline: baselines[reqId], config: oracleConfig });
  };

  const run = async (rowReqId = null) => {
    const target = rowReqId ? { ...state, endpoints: state.endpoints.filter(e => e.reqId === rowReqId) } : state;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    const partial = rowReqId ? { ...results } : {};
    setResults(partial);
    if (!rowReqId) baselinesRef.current = {};   // fresh baselines for a full run
    try {
      await runMatrix(target, runner, {
        signal: controller.signal,
        onCell: (reqId, idId, cell) => {
          const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
          if (is2xx && cell.response && !baselinesRef.current[reqId]) {
            baselinesRef.current[reqId] = inferContract(cell.response.body);
          }
          const findings = runOracles(cell, { baseline: baselinesRef.current[reqId], config: oracleConfig });
          setResults(r => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: { ...cell, findings } } }));
        },
      });
    } finally {
      setRunning(false);
    }
  };
  const stop = () => { if (abortRef.current) abortRef.current.abort(); setRunning(false); };

  const editing = identities.find(i => i.id === editId);
  const drawerCell = drawer && results[drawer.reqId] && results[drawer.reqId][drawer.idId];

  const scanWithAI = async () => {
    if (!drawer || !drawerCell || !drawerCell.response) return;
    setAiScan({ busy: true, error: null });
    try {
      const extra = await scanSensitiveLLM(drawerCell.response);
      const { reqId, idId } = drawer;
      // The endpoint/identity may have been removed while the scan was in flight;
      // skip the merge rather than dereferencing a now-missing cell.
      setResults(r => {
        const cell = r[reqId] && r[reqId][idId];
        if (!cell) return r;
        return { ...r, [reqId]: { ...r[reqId], [idId]: { ...cell, findings: [...(cell.findings || []), ...extra] } } };
      });
      setAiScan({ busy: false, error: null });
    } catch (e) {
      setAiScan({ busy: false, error: String((e && e.message) || e) });
    }
  };

  // Is an LLM reachable for the optional AI scan? Mirrors qaCallLLM's preconditions
  // so we can disable the button with a hint instead of failing only on click.
  const cfg = loadLlmCfg();
  const aiReady = cfg.provider === 'builtin'
    ? !!(window.claude && window.claude.complete)
    : cfg.provider === 'openai' ? !!cfg.key : !!cfg.baseUrl;

  // Shared per-request runner for BOLA. The panel's onRun and the later suite
  // adapter use this SAME closure so Security owns the runner for reuse.
  const bolaRunner = (test, identity, idValue) => qaRunSavedRequest({ id: test.reqId }, {
    env, vars, cookies, sslVerify, authOverride: identity.auth, oauthToken: identity._oauthToken,
    mutate: (req) => applyIdLocation(req, test.idLocation, idValue),
  });

  // Run one rate-limit test into the given results setter. `tr` is the i18n t().
  const runRlTest = async (test, runner, signal, setRes, tr) => {
    setRes(r => ({ ...r, [test.id]: { progress: { done: 0, n: test.n }, stats: null, verdict: null } }));
    const { responses, stats } = await runBurst(test, runner, {
      signal, onProgress: (done, n) => setRes(r => ({ ...r, [test.id]: { ...(r[test.id] || {}), progress: { done, n } } })),
    });
    const finding = rlFindingFor(test, responses, stats, tr('rl.findingTitle'));
    const verdict = classifyRateLimit(detectThrottleSignal(responses), responses.filter(x => x.status != null).length);
    setRes(r => ({ ...r, [test.id]: { progress: { done: stats.sent, n: test.n }, stats, verdict, severity: finding ? finding.severity : null, finding } }));
  };

  const runFullSuite = async () => {
    const controller = new AbortController();
    suiteAbortRef.current = controller;
    setSuite({ running: true, engine: null, done: 0, total: 0, lastRecord: null });
    setResults({}); setBolaResults({}); setRlResults({});

    const matrixAdapter = async (cfg, { signal }) => {
      const baselines = {};
      const out = {};
      await runMatrix({ ...state, endpoints: cfg.endpoints, identities: cfg.identities }, runner, {
        signal,
        onCell: (reqId, idId, cell) => {
          const findings = matrixCellFindings(reqId, cell, baselines);
          const withF = { ...cell, findings };
          out[reqId] = { ...(out[reqId] || {}), [idId]: withF };
          setResults(r => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: withF } }));
        },
      });
      return out;
    };
    const bolaAdapter = async (cfg, { signal }) => {
      const out = {};
      await runBola({ identities: cfg.identities, tests: cfg.tests }, bolaRunner, {
        signal, negativeControl: true,
        onControl: (testId, control) => { out[testId] = { ...(out[testId] || { reference: {}, attacks: {} }), control }; setBolaResults({ ...out }); },
        onCell: (testId, attackerId, ownerId, cell) => {
          const tr = out[testId] || { reference: {}, attacks: {} };
          if (attackerId == null) out[testId] = { ...tr, reference: { ...tr.reference, [ownerId]: cell } };
          else out[testId] = { ...tr, attacks: { ...tr.attacks, [attackerId]: { ...(tr.attacks[attackerId] || {}), [ownerId]: cell } } };
          setBolaResults({ ...out });
        },
      });
      return out;
    };
    const ratelimitAdapter = async (cfg, { signal }) => {
      const out = {};
      for (const test of cfg.tests) {
        if (signal && signal.aborted) break;
        const identity = identities.find(x => x.id === test.identityId) || identities[0];
        const reqRunner = () => qaRunSavedRequest({ id: test.reqId }, { env, vars, cookies, sslVerify, authOverride: identity && identity.auth, oauthToken: identity && identity._oauthToken });
        const { responses, stats } = await runBurst(test, reqRunner, { signal });
        const finding = rlFindingFor(test, responses, stats, t('rl.findingTitle'));
        const verdict = classifyRateLimit(detectThrottleSignal(responses), responses.filter(x => x.status != null).length);
        out[test.id] = { progress: { done: stats.sent, n: test.n }, stats, verdict, severity: finding ? finding.severity : null, finding };
        setRlResults({ ...out });
      }
      return out;
    };

    const config = {
      matrix: { endpoints, identities },
      bola: { tests: bola.tests || [], identities },
      rateLimit: { tests: rateLimit.tests || [], identities },
    };
    const rec = await runSuite(config, { matrix: matrixAdapter, bola: bolaAdapter, ratelimit: ratelimitAdapter }, {
      signal: controller.signal,
      onProgress: (engine, done, total) => setSuite(s => ({ ...s, engine, done, total })),
    });

    if (rec.status === 'complete') {
      const scopeHash = scopeHashOf({
        endpoints: endpoints.map(e => e.reqId).sort(), identities: identities.map(i => i.id).sort(),
        bola: (bola.tests || []).map(x => x.id).sort(), rl: (rateLimit.tests || []).map(x => x.id).sort(),
      });
      const items = snapshotOf(rec.union, loadLifecycle(), { runId: rec.finishedAt, createdAt: rec.finishedAt, scopeHash }).items;
      const record = { runId: rec.finishedAt, scopeHash, createdAt: rec.finishedAt,
                       startedAt: rec.startedAt, finishedAt: rec.finishedAt, durationMs: rec.durationMs,
                       status: 'complete', engines: rec.engines, items };
      setSnapshots(prev => { const next = recordRun(prev, record); saveSnapshots(next); return next; });
      setSuite({ running: false, engine: null, done: 0, total: 0, lastRecord: record });
    } else {
      setSuite(s => ({ ...s, running: false, lastRecord: { status: 'aborted', engines: rec.engines } }));
    }
  };
  const stopSuite = () => { if (suiteAbortRef.current) suiteAbortRef.current.abort(); };

  return (
    <div className="qa-sec">
      <SuiteRunBar suite={suite} onRun={runFullSuite} onStop={stopSuite} />
      <TriagePanel union={triageUnion} aiReady={aiReady} onGoToEngine={setMode} />
      <div className="qa-sec-tabs">
        <button className={`qa-seg ${mode === 'matrix' ? 'qa-seg--on' : ''}`} onClick={() => setMode('matrix')}>{t('security.mode.matrix')}</button>
        <button className={`qa-seg ${mode === 'bola' ? 'qa-seg--on' : ''}`} onClick={() => setMode('bola')}>{t('security.mode.bola')}</button>
        <button className={`qa-seg ${mode === 'ratelimit' ? 'qa-seg--on' : ''}`} onClick={() => setMode('ratelimit')}>{t('security.mode.ratelimit')}</button>
        <button className={`qa-seg ${mode === 'findings' ? 'qa-seg--on' : ''}`} onClick={() => setMode('findings')}>{t('findings.tab')}</button>
      </div>

      {mode === 'findings' ? (
        <FindingsPanel
          union={triageUnion}
          snapshots={snapshots}
          scopeMismatch={scopeMismatch}
          onPinBaseline={snapshots.lastRun ? () => {
            setSnapshots(prev => { const next = pinBaseline(prev, prev.lastRun); saveSnapshots(next); return next; });
          } : undefined}
        />
      ) : mode === 'bola' ? (
        <BolaPanel identities={identities} bola={bola} setBola={setBola}
                   results={bolaResults} setResults={setBolaResults}
                   onRun={({ negativeControl, signal }) => runBola({ identities, tests: bola.tests }, bolaRunner, {
                     signal, negativeControl,
                     onControl: (testId, control) => setBolaResults(r => ({ ...r, [testId]: { ...(r[testId] || { reference: {}, attacks: {} }), control } })),
                     onCell: (testId, attackerId, ownerId, cell) => setBolaResults(r => {
                       const tr = r[testId] || { reference: {}, attacks: {} };
                       if (attackerId == null) return { ...r, [testId]: { ...tr, reference: { ...tr.reference, [ownerId]: cell } } };
                       return { ...r, [testId]: { ...tr, attacks: { ...tr.attacks, [attackerId]: { ...(tr.attacks[attackerId] || {}), [ownerId]: cell } } } };
                     }),
                   })}
                   env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} onFindings={onBolaFindings} />
      ) : mode === 'ratelimit' ? (
        <RateLimitPanel identities={identities} rateLimit={rateLimit} setRateLimit={setRateLimit}
                        results={rlResults} setResults={setRlResults}
                        onRunTest={(test, { runner, signal }) => runRlTest(test, runner, signal, setRlResults, t)}
                        env={env} vars={vars} cookies={cookies} sslVerify={sslVerify} onFindings={onRlFindings} />
      ) : (
      <>
      <div className="qa-sec-head">
        <div><h2>{t('security.title')}</h2><p>{t('security.subtitle')}</p></div>
        <div className="qa-sec-actions">
          {running
            ? <button className="qa-btn qa-btn--danger" onClick={stop}><Icon name="stop" size={14} /> {t('security.stop')}</button>
            : <button className="qa-btn qa-btn--primary" onClick={() => run()} disabled={!endpoints.length}><Icon name="play" size={14} /> {t('security.runAll')}</button>}
        </div>
      </div>

      <div className="qa-sec-summary">
        {['total', 'pass', 'fail', 'vuln', 'inconclusive'].map(k => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>{summary[k] || 0} {t('security.summary.' + k)}</span>
        ))}
      </div>

      {findSummary.total > 0 && (
        <div className="qa-sec-findsummary">
          {SEVERITY_ORDER.slice().reverse().filter(s => findSummary.bySeverity[s] > 0).map(s => (
            <span key={s} className={`qa-sec-findchip qa-sev--${s}`}>{findSummary.bySeverity[s]} {t('security.severity.' + s)}</span>
          ))}
        </div>
      )}

      <div className="qa-sec-toolbar">
        <button className="qa-link" onClick={addIdentity}><Icon name="plus" size={13} /> {t('security.addIdentity')}</button>
        <button className="qa-link" onClick={() => setPicking(true)}><Icon name="plus" size={13} /> {t('security.addEndpoints')}</button>
        <label className="qa-sec-deny">
          {t('security.denySet')}:
          <input className="qa-inp qa-inp--mini" value={denySet.join(', ')}
                 onChange={e => setDenySet(e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite))} />
        </label>
        {privCount > 0 && <span className="qa-sec-privcount">{t('security.priv.count', { count: privCount })}</span>}
      </div>

      {!endpoints.length && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}

      {endpoints.length > 0 && (
        <div className="qa-sec-gridwrap">
          <table className="qa-sec-grid">
            <thead>
              <tr>
                <th className="qa-sec-corner">{t('security.endpoints')}</th>
                {identities.map(id => (
                  <th key={id.id} className="qa-sec-colhead">
                    <button className="qa-sec-colname" onClick={() => setEditId(id.id)} title={id.auth.type}>
                      {id.id === 'anon' ? t('security.anon') : (id.name || id.id)} <span className="qa-sec-authtype">{id.auth.type}</span>
                    </button>
                    <div className="qa-sec-bulk">
                      {EXPECTS.map(v => <button key={v} onClick={() => bulkCol(id.id, v)} title={t('security.col.bulk')}>{t('security.expect.' + v)[0]}</button>)}
                      {id.id !== 'anon' && <button className="qa-sec-x" onClick={() => removeIdentity(id.id)} title={t('security.removeIdentity')}><Icon name="x" size={11} /></button>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {endpoints.map(ep => (
                <tr key={ep.reqId}>
                  <th className="qa-sec-rowhead">
                    <span>
                      <MethodBadge method={ep.method} size="sm" /> <code>{ep.path}</code>
                      {(() => {
                        const pv = endpointPrivileged(ep);
                        return (
                          <button type="button"
                                  className={`qa-sec-priv qa-sec-priv--${pv.privileged ? 'on' : 'off'}`}
                                  title={t('security.priv.title')}
                                  onClick={() => togglePriv(ep.reqId, !pv.privileged)}>
                            {pv.privileged ? pv.reasons.map(r => t('security.priv.reason.' + r)).join('·') : t('security.priv.mark')}
                          </button>
                        );
                      })()}
                    </span>
                    <span className="qa-sec-rowtools">
                      <button onClick={() => run(ep.reqId)} disabled={running} title={t('security.runRow')}><Icon name="play" size={11} /></button>
                      {EXPECTS.map(v => <button key={v} onClick={() => bulkRow(ep.reqId, v)} title={t('security.row.bulk')}>{t('security.expect.' + v)[0]}</button>)}
                      <button className="qa-sec-x" onClick={() => removeEndpoint(ep.reqId)} title={t('security.removeEndpoint')}><Icon name="x" size={11} /></button>
                    </span>
                  </th>
                  {identities.map(id => {
                    const exp = state.expect[ep.reqId][id.id];
                    const cell = results[ep.reqId] && results[ep.reqId][id.id];
                    const v = cell && cell.verdict;
                    return (
                      <td key={id.id} className={`qa-sec-cell qa-sec-cell--${v || 'none'}`}
                          data-expect={exp}
                          onClick={() => (cell ? setDrawer({ reqId: ep.reqId, idId: id.id }) : cycleCell(ep.reqId, id.id))}>
                        <span className="qa-sec-exp" onClick={(e) => { e.stopPropagation(); cycleCell(ep.reqId, id.id); }}>{t('security.expect.' + exp)}</span>
                        {cell && <span className="qa-sec-verdict">{cell.status ?? '—'} · {t(VERDICT_LABEL[v] || 'security.cell.notRun')}</span>}
                        {cell && cell.findings && cell.findings.length > 0 && (
                          <span className={`qa-sec-findbadge qa-sev--${worstSeverity(cell.findings)}`}>{cell.findings.length}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel">
          <h3>{t('security.findings.panelTitle')} ({allFindings.length})</h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                <MethodBadge method={f.method} size="sm" /> <code>{f.endpoint}</code>
                <span className="qa-sec-find-id">{f.identity}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="qa-sec-modal" onClick={() => setEditId(null)}>
          <div className="qa-sec-modal-body" onClick={e => e.stopPropagation()}>
            <IdentityEditor identity={editing} env={env} vars={vars} sslVerify={sslVerify}
                            onChange={(nx) => setIdentities(xs => xs.map(x => x.id === nx.id ? nx : x))}
                            onClose={() => setEditId(null)} />
          </div>
        </div>
      )}

      {picking && (
        <div className="qa-sec-modal" onClick={() => setPicking(false)}>
          <div className="qa-sec-modal-body" onClick={e => e.stopPropagation()}>
            <EndpointPicker existing={endpoints} onClose={() => setPicking(false)}
                            onAdd={(ep) => setEndpoints(xs => xs.some(x => x.reqId === ep.reqId) ? xs : [...xs, ep])} />
          </div>
        </div>
      )}

      {drawerCell && (
        <div className="qa-sec-drawer">
          <div className="qa-sec-drawer-head">
            <span>{drawerCell.status ?? '—'} · {t(VERDICT_LABEL[drawerCell.verdict] || 'security.cell.notRun')}</span>
            <button className="qa-iconbtn" onClick={() => setDrawer(null)}><Icon name="x" size={14} /></button>
          </div>
          {drawerCell.request && (
            <>
              <span className="qa-sec-drawer-label">{t('security.cell.request')}</span>
              <div className="qa-sec-drawer-req">
                <div><MethodBadge method={drawerCell.request.method} size="sm" /> <code>{drawerCell.request.path}</code></div>
                <div className="qa-sec-drawer-id">{drawerCell.request.identity} · {drawerCell.request.authType}</div>
              </div>
            </>
          )}
          {drawerCell.error && <div className="qa-sec-drawer-err">{drawerCell.error}</div>}
          {drawerCell.findings && drawerCell.findings.length > 0 && (
            <>
              <span className="qa-sec-drawer-label">{t('security.findings.title')}</span>
              <ul className="qa-sec-findings">
                {drawerCell.findings.slice().sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)).map((f, i) => (
                  <li key={i} className={`qa-sev--${f.severity}`}>
                    <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                    <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                    <code>{f.path}</code>
                    {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {drawerCell.findings && drawerCell.findings.length === 0 && (
            <span className="qa-sec-drawer-label">{t('security.findings.none')}</span>
          )}
          <button className="qa-link" onClick={scanWithAI} disabled={aiScan.busy || !aiReady}
                  title={!aiReady ? t('security.findings.aiUnavailable') : undefined}>
            <Icon name="zap" size={13} /> {aiScan.busy ? t('security.findings.aiScanning') : t('security.findings.scanAI')}
          </button>
          {!aiReady && <span className="qa-sec-drawer-label">{t('security.findings.aiUnavailable')}</span>}
          {aiScan.error && <div className="qa-sec-drawer-err">{aiScan.error}</div>}
          <span className="qa-sec-drawer-label">{t('security.cell.response')}</span>
          <pre className="qa-sec-drawer-body">{JSON.stringify(drawerCell.response && drawerCell.response.body, null, 2)}</pre>
        </div>
      )}
      </>
      )}
    </div>
  );
}

Object.assign(window, { SecurityPage });
export { SecurityPage };
