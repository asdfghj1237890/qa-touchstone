import React from 'react';
import './setup.js';
import { Dropdown, Icon, Spinner } from './components.jsx';
import { FieldRow } from './RequestBuilder.jsx';
import { qaRunSavedRequest } from './sendRequest.js';

// ── QA Companion — Monitors: scheduled collection runs ────────────────────
const { useState: useStateMON, useRef: useRefMON, useEffect: useEffMON } = React;

const CADENCES = ['Every 5 minutes', 'Every 15 minutes', 'Every hour', 'Every 6 hours', 'Daily at 02:00', 'Weekly'];
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

// Sparkline bar of recent run outcomes.
function RunSparks({ runs }) {
  return (
    <div className="mon-sparks">
      {runs.slice(0, 12).reverse().map((r, i) => (
        <span key={i} className="mon-spark" data-status={r.status}
              title={`${r.at} · ${r.passed}/${r.passed + r.failed} passed · ${r.ms}ms`}
              style={{ height: 6 + Math.min(28, r.ms / 45) }} />
      ))}
    </div>
  );
}

function MonitorCard({ mon, onToggle, onRun, running, collectionName }) {
  const last = mon.runs[0];
  const total = mon.runs.length;
  const fails = mon.runs.filter(r => r.status === 'fail').length;
  const uptime = total ? Math.round(((total - fails) / total) * 100) : 100;
  return (
    <div className="mon-card" data-enabled={mon.enabled ? '1' : '0'}>
      <div className="mon-card-head">
        <div className="mon-card-title">
          <span className="mon-dot" data-status={last ? last.status : 'idle'} />
          <div>
            <strong>{mon.name}</strong>
            <div className="mon-meta">{collectionName} · {mon.env} · {mon.region}</div>
          </div>
        </div>
        <button className="pf-toggle" data-on={mon.enabled ? '1' : '0'} onClick={() => onToggle(mon.id)} aria-label="toggle monitor"><span /></button>
      </div>

      <div className="mon-card-stats">
        <div className="mon-stat"><span className="mon-stat-v">{mon.cadence}</span><span className="mon-stat-l">Schedule</span></div>
        <div className="mon-stat"><span className="mon-stat-v" data-good={uptime >= 95 ? '1' : '0'}>{uptime}%</span><span className="mon-stat-l">Uptime</span></div>
        <div className="mon-stat"><span className="mon-stat-v">{mon.enabled ? mon.nextRun : 'paused'}</span><span className="mon-stat-l">Next run</span></div>
      </div>

      <RunSparks runs={mon.runs} />

      <div className="mon-runs">
        {mon.runs.slice(0, 5).map((r, i) => (
          <div className="mon-run" key={i}>
            <span className="mon-run-status" data-status={r.status}>{r.status === 'pass' ? '✓' : '✕'}</span>
            <span className="mon-run-at">{r.at}</span>
            <span className="mon-run-res">{r.passed}/{r.passed + r.failed} passed</span>
            <span className="mon-run-ms">{r.ms}ms</span>
          </div>
        ))}
      </div>

      <div className="mon-card-foot">
        <button className="qa-hist-expbtn" onClick={() => onRun(mon.id)} disabled={running}>
          {running ? <Spinner size={12} /> : <Icon name="play" size={12} />} {running ? 'Running…' : 'Run now'}
        </button>
      </div>
    </div>
  );
}

function MonitorsPage({ env, setRoute, vars, cookies = [], sslVerify = true, tests = {}, oauthTokens = {} }) {
  const [monitors, setMonitors] = useStateMON(() => window.QA.MONITORS.map(m => ({ ...m, runs: m.runs.slice() })));
  const [running, setRunning] = useStateMON(null);
  const [creating, setCreating] = useStateMON(false);
  const mountedRef = useRefMON(true);
  useEffMON(() => () => { mountedRef.current = false; }, []);
  const colName = (id) => (window.QA.COLLECTIONS.find(c => c.id === id) || {}).name || id;

  const toggle = (id) => setMonitors(ms => ms.map(m => m.id === id ? { ...m, enabled: !m.enabled, nextRun: !m.enabled ? 'in 5 min' : 'paused' } : m));

  const runNow = (id) => {
    setRunning(id);
    const mon = monitors.find(m => m.id === id);
    const col = window.QA.COLLECTIONS.find(c => c.id === (mon && mon.collectionId));
    if (!col) {
      setRunning(null);
      return;
    }
    const reqs = col.folders.flatMap(f => f.requests);
    (async () => {
      let passed = 0, failed = 0, totalMs = 0;
      for (const r of reqs) {
        let resp;
        try {
          resp = await qaRunSavedRequest(r, { env, vars, cookies, sslVerify, oauthToken: oauthTokens[r.id], collectionId: col.id });
        } catch (e) {
          resp = { status: 0, time: 0 };
        }
        totalMs += resp.time || 0;
        const asserts = window.qaRunAssertions(tests[r.id] || [], resp);
        // A request with no assertions counts as pass iff status < 400.
        const ok = asserts.length ? asserts.every(a => a.pass) : (resp.status >= 200 && resp.status < 400);
        if (ok) passed += 1; else failed += 1;
      }
      if (!mountedRef.current) return;
      const now = new Date();
      const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const run = { at, status: failed ? 'fail' : 'pass', passed, failed, ms: totalMs };
      setMonitors(ms2 => ms2.map(m => m.id === id ? { ...m, runs: [run, ...m.runs].slice(0, 20) } : m));
      setRunning(null);
    })();
  };

  const activeCount = monitors.filter(m => m.enabled).length;
  const failingCount = monitors.filter(m => m.enabled && m.runs[0] && m.runs[0].status === 'fail').length;

  return (
    <div className="qa-monitors">
      <div className="mon-top">
        <div>
          <h2>Monitors</h2>
          <p className="mon-top-sub">Scheduled collection runs that alert when assertions fail.</p>
        </div>
        <div className="mon-top-stats">
          <div className="mon-top-stat"><strong>{activeCount}</strong><span>active</span></div>
          <div className="mon-top-stat" data-alert={failingCount ? '1' : '0'}><strong>{failingCount}</strong><span>failing</span></div>
          <button className="qa-send mon-new" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> New monitor</button>
        </div>
      </div>

      <div className="mon-grid">
        {monitors.map(m => (
          <MonitorCard key={m.id} mon={m} onToggle={toggle} onRun={runNow} running={running === m.id} collectionName={colName(m.collectionId)} />
        ))}
        {!monitors.length && (
          <div className="qa-auth-note" style={{ gridColumn: '1 / -1' }}>
            <Icon name="clock" size={13} />
            <span>No monitors yet. Create one to schedule a collection run on a cadence and watch for assertion failures.</span>
          </div>
        )}
      </div>

      {creating && <NewMonitorModal env={env} onClose={() => setCreating(false)}
        onCreate={(m) => { setMonitors(ms => [{ ...m, id: 'mon-' + Date.now().toString(36), runs: [], nextRun: 'in 5 min', enabled: true }, ...ms]); setCreating(false); }} />}
    </div>
  );
}

function NewMonitorModal({ env, onClose, onCreate }) {
  const cols = window.QA.COLLECTIONS;
  // Real environments only (filter the placeholder `None` out); fall back to
  // the currently active env label if the user hasn't added any from Settings.
  const realEnvs = window.QA.ENVIRONMENTS.filter(e => e.label !== 'None').map(e => e.label);
  const envs = realEnvs.length ? realEnvs : [env.label];
  const [name, setName] = useStateMON('');
  const [collectionId, setCollectionId] = useStateMON(cols[0] ? cols[0].id : '');
  const [cadence, setCadence] = useStateMON(CADENCES[1]);
  const [region, setRegion] = useStateMON(REGIONS[0]);
  const [menv, setMenv] = useStateMON(env.label !== 'None' ? env.label : (realEnvs[0] || env.label));
  return (
    <div className="qa-modal-scrim" onMouseDown={onClose}>
      <div className="qa-modal qa-monnew" onMouseDown={e => e.stopPropagation()}>
        <div className="qa-modal-head">
          <span className="qa-modal-title"><Icon name="clock" size={15} /> New monitor</span>
          <button className="qa-iconbtn" onClick={onClose} aria-label="close"><Icon name="x" size={15} /></button>
        </div>
        <div className="qa-monnew-body">
          <FieldRow label="Monitor name"><input className="qa-inp" value={name} placeholder="User Service · smoke" onChange={e => setName(e.target.value)} /></FieldRow>
          <FieldRow label="Collection"><Dropdown value={collectionId} options={cols.map(c => ({ value: c.id, label: c.name }))} onChange={setCollectionId} /></FieldRow>
          <div className="qa-field-grid">
            <FieldRow label="Environment"><Dropdown value={menv} options={envs} onChange={setMenv} /></FieldRow>
            <FieldRow label="Region"><Dropdown value={region} options={REGIONS} onChange={setRegion} /></FieldRow>
          </div>
          <FieldRow label="Schedule"><Dropdown value={cadence} options={CADENCES} onChange={setCadence} /></FieldRow>
          <div className="qa-auth-note"><Icon name="clock" size={13} /> The collection's assertions run on this cadence; failures surface here and can trigger alerts.</div>
        </div>
        <div className="qa-modal-foot">
          <button className="qa-pathbtn" onClick={onClose}>Cancel</button>
          <button className="qa-send" disabled={!name.trim()} onClick={() => onCreate({ name: name.trim() || 'Untitled monitor', collectionId, env: menv, region, cadence })}>
            <Icon name="clock" size={14} /> Create monitor
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MonitorsPage });

export { MonitorsPage };
