// QA Touchstone — rate-limit / abuse testing UI + page-side runner.
// Renders the per-test config (identity / N / concurrency / sensitivity), gates
// every burst behind a confirm-before-run modal, fires the bounded burst via the
// injected runner, and shows the stats card + verdict + findings. Pure engine
// (detect/classify/severity/burst/summarize) lives in ratelimit.js.
import React from 'react';
import './setup';
import { Icon, MethodBadge } from './components';
import { useI18n } from './useI18n';
import { qaRunSavedRequest } from './sendRequest';
import {
  runBurst, detectThrottleSignal, classifyRateLimit,
  rlFindingFor, summarizeRateLimit, MAX_N, MAX_CONCURRENCY,
} from './ratelimit';
import { normalizeRateLimit } from './securitySuite';

const { useState: useS, useEffect: useE, useMemo, useRef } = React;
const VLABEL = { pass: 'rl.verdict.pass', vuln: 'rl.verdict.vuln', inconclusive: 'rl.verdict.inconclusive' };

function allRequests() {
  return (window.QA.COLLECTIONS || []).flatMap(c =>
    (c.folders || []).flatMap(f => (f.requests || []).map(r => ({ reqId: r.id, method: r.method, path: r.path }))));
}

let rlSeq = 1;

function RateLimitPanel({ identities, rateLimit, setRateLimit, onFindings, results: resultsProp, setResults: setResultsProp, onRunTest,
                          env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true }) {
  const { t } = useI18n();
  const tests = rateLimit.tests || [];
  const [localResults, setLocalResults] = useS({});
  const controlled = !!setResultsProp;
  const results = controlled ? (resultsProp || {}) : localResults;
  const setResults = controlled ? setResultsProp : setLocalResults;
  const [running, setRunning] = useS(null);   // testId currently bursting
  const [confirming, setConfirming] = useS(null);   // test pending confirmation
  const abortRef = useRef(null);

  const setTests = (updater) => setRateLimit(s => ({ ...s, tests: typeof updater === 'function' ? updater(s.tests || []) : updater }));
  const addTest = (r) => setTests(ts => ts.some(x => x.reqId === r.reqId)
    ? ts
    : [...ts, { id: `rl_${Date.now()}_${rlSeq++}`, reqId: r.reqId, method: r.method, path: r.path, identityId: (identities[0] || {}).id, n: 30, concurrency: 5, sensitivity: 'sensitive' }]);
  const removeTest = (id) => setTests(ts => ts.filter(x => x.id !== id));
  const patchTest = (id, patch) => setTests(ts => ts.map(x => x.id === id ? { ...x, ...patch } : x));

  const idName = (id) => { const i = identities.find(x => x.id === id); return i ? (i.name || i.id) : id; };

  const doRun = async (test) => {
    const identity = identities.find(x => x.id === test.identityId) || identities[0];
    const runner = () => qaRunSavedRequest({ id: test.reqId }, {
      env, vars, cookies, sslVerify, authOverride: identity && identity.auth, oauthToken: identity && identity._oauthToken,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(test.id);
    if (onRunTest) { try { await onRunTest(test, { runner, signal: controller.signal }); } finally { setRunning(null); } return; }
    setResults(r => ({ ...r, [test.id]: { progress: { done: 0, n: test.n }, stats: null, verdict: null } }));
    try {
      const { responses, stats } = await runBurst(test, runner, {
        signal: controller.signal,
        onProgress: (done, n) => setResults(r => ({ ...r, [test.id]: { ...(r[test.id] || {}), progress: { done, n } } })),
      });
      const finding = rlFindingFor(test, responses, stats, t('rl.findingTitle'));
      const verdict = classifyRateLimit(detectThrottleSignal(responses), responses.filter(x => x.status != null).length);
      setResults(r => ({ ...r, [test.id]: { progress: { done: stats.sent, n: test.n }, stats, verdict, severity: finding ? finding.severity : null, finding } }));
    } finally { setRunning(null); }
  };
  const stop = () => { if (abortRef.current) abortRef.current.abort(); setRunning(null); };

  const summary = useMemo(() => summarizeRateLimit(results), [results]);
  const allFindings = useMemo(() => tests.map(t0 => results[t0.id] && results[t0.id].finding).filter(Boolean), [results, tests]);

  // Report normalized findings upward for cross-engine AI triage (advisory).
  useE(() => {
    if (!onFindings) return;
    const out = normalizeRateLimit(results, tests);
    onFindings(out);
  }, [results, tests, onFindings]);

  const reqs = allRequests();

  return (
    <div className="qa-rl">
      <div className="qa-sec-head">
        <div><h2>{t('security.mode.ratelimit')}</h2><p>{t('rl.subtitle')}</p></div>
      </div>

      <div className="qa-sec-summary">
        {['total', 'vuln', 'pass', 'inconclusive'].map(k => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>{summary[k] || 0} {k === 'total' ? t('rl.summary.total') : t('rl.verdict.' + k)}</span>
        ))}
      </div>

      <div className="qa-sec-toolbar">
        <select className="qa-inp qa-inp--mini" value="" onChange={e => { const r = reqs.find(x => x.reqId === e.target.value); if (r) addTest(r); }}>
          <option value="">{t('rl.addTest')}…</option>
          {reqs.map(r => <option key={r.reqId} value={r.reqId}>{r.method} {r.path}</option>)}
        </select>
      </div>

      {!tests.length && <div className="qa-sec-empty">{t('rl.noTests')}</div>}

      {tests.map(test => {
        const res = results[test.id];
        const isRunning = running === test.id;
        return (
          <div key={test.id} className="qa-rl-test">
            <div className="qa-rl-test-head">
              <MethodBadge method={test.method} size="sm" /> <code>{test.path}</code>
              <button className="qa-sec-x" onClick={() => removeTest(test.id)}><Icon name="x" size={11} /></button>
            </div>

            <div className="qa-rl-cfg">
              <label>{t('rl.identity')}:
                <select className="qa-inp qa-inp--mini" value={test.identityId} onChange={e => patchTest(test.id, { identityId: e.target.value })}>
                  {identities.map(i => <option key={i.id} value={i.id}>{i.name || i.id}</option>)}
                </select>
              </label>
              <label>{t('rl.count')}:
                <input className="qa-inp qa-inp--mini" type="number" min="1" max={MAX_N} value={test.n}
                       onChange={e => patchTest(test.id, { n: Math.max(1, Math.min(MAX_N, parseInt(e.target.value, 10) || 1)) })} />
              </label>
              <label>{t('rl.concurrency')}:
                <input className="qa-inp qa-inp--mini" type="number" min="1" max={MAX_CONCURRENCY} value={test.concurrency}
                       onChange={e => patchTest(test.id, { concurrency: Math.max(1, Math.min(MAX_CONCURRENCY, parseInt(e.target.value, 10) || 1)) })} />
              </label>
              <label>{t('rl.sensitivity')}:
                <select className="qa-inp qa-inp--mini" value={test.sensitivity} onChange={e => patchTest(test.id, { sensitivity: e.target.value })}>
                  <option value="sensitive">{t('rl.sensitive')}</option>
                  <option value="normal">{t('rl.normal')}</option>
                </select>
              </label>
              {isRunning
                ? <button className="qa-btn qa-btn--danger qa-btn--sm" onClick={stop}><Icon name="stop" size={12} /> {t('security.stop')}</button>
                : <button className="qa-btn qa-btn--primary qa-btn--sm" onClick={() => setConfirming(test)}><Icon name="play" size={12} /> {t('rl.run')}</button>}
            </div>

            {res && res.progress && isRunning && (
              <div className="qa-rl-progress"><div className="qa-rl-progress-bar" style={{ width: `${Math.round((res.progress.done / res.progress.n) * 100)}%` }} /></div>
            )}

            {res && res.stats && (
              <div className="qa-rl-result">
                <span className={`qa-rl-verdict qa-rl-verdict--${res.verdict}`}>{t(VLABEL[res.verdict] || 'rl.verdict.inconclusive')}</span>
                <span className="qa-rl-stat">{res.stats.sent} {t('rl.stat.sent')}</span>
                <span className="qa-rl-stat">{res.stats.ok2xx} {t('rl.stat.ok')}</span>
                <span className="qa-rl-stat">{res.stats.c429} {t('rl.stat.c429')}</span>
                <span className="qa-rl-stat">{res.stats.headerHit ? '✓' : '—'} {t('rl.stat.throttleHdr')}</span>
                <span className="qa-rl-stat">{res.stats.net} {t('rl.stat.err')}</span>
                <span className="qa-rl-stat">{res.stats.avgMs} {t('rl.stat.avg')}</span>
                <span className="qa-rl-stat">{res.stats.maxMs} {t('rl.stat.max')}</span>
              </div>
            )}
          </div>
        );
      })}

      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel qa-rl-findpanel">
          <h3>{t('security.findings.panelTitle')} ({allFindings.length})</h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="qa-sec-modal" onClick={() => setConfirming(null)}>
          <div className="qa-sec-modal-body qa-rl-confirm" onClick={e => e.stopPropagation()}>
            <h3>{t('rl.confirmTitle')}</h3>
            <p>{t('rl.confirmBody', { n: confirming.n, concurrency: confirming.concurrency, target: `${confirming.method} ${confirming.path}`, identity: idName(confirming.identityId) })}</p>
            <div className="qa-rl-confirm-actions">
              <button className="qa-link" onClick={() => setConfirming(null)}>{t('rl.cancel')}</button>
              <button className="qa-btn qa-btn--danger" onClick={() => { const test = confirming; setConfirming(null); doRun(test); }}>{t('rl.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { RateLimitPanel });
export { RateLimitPanel };
