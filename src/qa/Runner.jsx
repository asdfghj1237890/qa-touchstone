import React from 'react';
import './setup.js';
import { Dropdown, Icon, MethodBadge, MiniCheck } from './components.jsx';
import { qaRunSavedRequest } from './sendRequest.js';

// ── QA Companion — Collection Runner (batch run + data iteration) ─────────
const { useState: useRN, useRef: useRefRN, useEffect: useEffRN } = React;

function Runner({ env, vars, tests, cookies = [], sslVerify = true, oauthTokens = {} }) {
  const COLLECTIONS = window.QA.COLLECTIONS;
  const [colId, setColId] = useRN(COLLECTIONS[0].id);
  const col = COLLECTIONS.find(c => c.id === colId) || COLLECTIONS[0];
  const colReqs = col.folders.flatMap(f => f.requests);
  const [selIds, setSelIds] = useRN(colReqs.map(r => r.id));
  const [iterations, setIterations] = useRN(1);
  const [delay, setDelay] = useRN(0);
  const [dataText, setDataText] = useRN('');
  const [dataName, setDataName] = useRN('');
  const fileRef = useRefRN(null);
  const [phase, setPhase] = useRN('idle');
  const [progress, setProgress] = useRN(0);
  const [results, setResults] = useRN([]);
  const timerRef = useRefRN(null);
  // Synchronous guard so a fast double-click on Run can't spawn a second
  // concurrent async loop that clobbers timerRef and orphans the first.
  const startedRef = useRefRN(false);

  useEffRN(() => { setSelIds((COLLECTIONS.find(c => c.id === colId) || COLLECTIONS[0]).folders.flatMap(f => f.requests).map(r => r.id)); }, [colId]);

  // Cancel any in-flight run when the user navigates away from the Runner
  // route (the component unmounts). Without this the async loop keeps awaiting
  // requests and calling setState on an unmounted component for seconds.
  useEffRN(() => () => { if (timerRef.current && timerRef.current.cancel) timerRef.current.cancel(); }, []);

  const running = phase === 'running';
  const toggleReq = (id) => setSelIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  let dataRows = null, dataErr = '', dataCols = [], dataFmt = null;
  if (dataText.trim()) {
    const parsed = window.qaParseDataFile(dataText, dataName);
    dataRows = parsed.rows; dataErr = parsed.error; dataCols = parsed.columns; dataFmt = parsed.format;
  }
  const iters = dataRows ? dataRows.length : Math.max(1, Math.min(50, iterations));

  const loadFile = (file) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => { setDataText(String(fr.result || '')); setDataName(file.name); };
    fr.readAsText(file);
  };
  const clearData = () => { setDataText(''); setDataName(''); if (fileRef.current) fileRef.current.value = ''; };

  const stop = () => { if (timerRef.current && timerRef.current.cancel) timerRef.current.cancel(); timerRef.current = null; setPhase(p => p === 'running' ? 'done' : p); };

  const run = () => {
    if (running) { stop(); return; }
    if (startedRef.current) return; // a loop is already winding up/down
    const reqs = colReqs.filter(r => selIds.includes(r.id));
    if (!reqs.length) return;
    startedRef.current = true;
    const queue = [];
    for (let i = 0; i < iters; i++) reqs.forEach(r => queue.push({ iter: i + 1, r, data: dataRows ? dataRows[i] : null }));
    setResults([]); setProgress(0); setPhase('running');
    const acc = [];
    let cancelled = false;
    timerRef.current = { cancel: () => { cancelled = true; } };
    (async () => {
      try {
      for (let k = 0; k < queue.length; k++) {
        if (cancelled) break;
        const { iter, r, data } = queue[k];
        const map = window.qaVarMap(vars, env.label, colId, data || undefined);
        let resp;
        try {
          resp = await qaRunSavedRequest(r, { env, vars, cookies, sslVerify, oauthToken: oauthTokens[r.id], collectionId: colId, localVars: data || {} });
        } catch (e) {
          resp = { status: 0, statusText: String(e), time: 0, size: 0, body: null, headers: {} };
        }
        if (cancelled) break;
        const res = window.qaRunAssertions(tests[r.id] || [], resp);
        acc.push({
          iter, name: r.name, method: r.method,
          path: window.qaSubstitute(r.path.split('?')[0], map),
          status: resp.status, time: resp.time,
          passed: res.filter(x => x.pass).length, total: res.length,
        });
        setResults([...acc]); setProgress((k + 1) / queue.length);
        if ((+delay || 0) > 0) await new Promise(res2 => setTimeout(res2, +delay));
      }
      if (!cancelled) setPhase('done');
      } finally { timerRef.current = null; startedRef.current = false; }
    })();
  };

  const total = results.length;
  const aTotal = results.reduce((s, r) => s + r.total, 0);
  const aPass = results.reduce((s, r) => s + r.passed, 0);
  const failed = results.filter(r => (r.total > 0 && r.passed < r.total) || r.status >= 400).length;
  const avg = total ? Math.round(results.reduce((s, r) => s + r.time, 0) / total) : 0;
  let lastIter = 0;

  return (
    <div className="rn">
      <div className="rn-config">
        <div className="rn-config-head"><h2>Collection Runner</h2><p>Run a collection in batch, iterate over data, and check assertions.</p></div>

        <label className="qa-side-label">Collection</label>
        <Dropdown value={colId} options={COLLECTIONS.map(c => ({ value: c.id, label: c.name }))} onChange={setColId} />

        <div className="rn-sec"><span>Requests</span><span className="qa-meta">{selIds.length}/{colReqs.length}</span></div>
        <div className="rn-reqs">
          {colReqs.map(r => (
            <div className="rn-req" key={r.id}>
              <MiniCheck on={selIds.includes(r.id)} onClick={() => !running && toggleReq(r.id)} />
              <MethodBadge method={r.method} size="sm" />
              <span className="rn-req-name">{r.name}</span>
              {(tests[r.id] || []).length > 0 && <span className="rn-req-tests" title="assertions">{(tests[r.id] || []).length}✓</span>}
            </div>
          ))}
        </div>

        <div className="rn-row2">
          <div className="pf-param"><span>Iterations</span><input className="pf-num" type="number" min="1" value={iterations} disabled={running || !!dataRows} onChange={e => setIterations(Math.max(1, +e.target.value || 1))} /></div>
          <div className="pf-param"><span>Delay<em>ms</em></span><input className="pf-num" type="number" min="0" value={delay} disabled={running} onChange={e => setDelay(Math.max(0, +e.target.value || 0))} /></div>
        </div>

        <div className="rn-sec"><span>Data file iteration</span><span className="qa-meta">{dataRows ? `${dataRows.length} rows · ${dataCols.length} cols` : 'optional'}</span></div>
        <div className="rn-data-tools">
          <button className="qa-side-import" disabled={running} onClick={() => fileRef.current && fileRef.current.click()}>
            <Icon name="upload" size={13} /> Upload CSV / JSON
          </button>
          {dataName && <span className="rn-data-file"><Icon name="fileText" size={12} /> {dataName} <button onClick={clearData} aria-label="clear data file"><Icon name="x" size={11} /></button></span>}
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden
                 onChange={e => loadFile(e.target.files[0])} />
        </div>
        {!dataName && (
          <textarea className="rn-data" spellCheck="false" value={dataText} disabled={running}
                    onChange={e => setDataText(e.target.value)}
                    placeholder={'…or paste CSV / JSON here\n\nCSV:\nuserId,role\n7301,admin\n7302,editor\n\nJSON:\n[ { "userId": "7301" } ]'} />
        )}
        {dataErr && <div className="rn-data-err"><Icon name="x" size={12} /> {dataErr}</div>}
        {dataRows && (
          <div className="rn-data-preview">
            <div className="rn-data-ok"><Icon name="check" size={12} /> {dataFmt.toUpperCase()} · {dataRows.length} iterations · columns become variables</div>
            <div className="rn-data-grid" style={{ gridTemplateColumns: `28px repeat(${dataCols.length}, minmax(60px, 1fr))` }}>
              <div className="rn-data-cell rn-data-hcell">#</div>
              {dataCols.map(c => <div key={c} className="rn-data-cell rn-data-hcell"><code>{`{{${c}}}`}</code></div>)}
              {dataRows.slice(0, 5).map((row, i) => (
                <React.Fragment key={i}>
                  <div className="rn-data-cell rn-data-idx">{i + 1}</div>
                  {dataCols.map(c => <div key={c} className="rn-data-cell">{String(row[c] != null ? row[c] : '')}</div>)}
                </React.Fragment>
              ))}
            </div>
            {dataRows.length > 5 && <div className="rn-data-more">+{dataRows.length - 5} more rows</div>}
          </div>
        )}

        <button className="pf-run" data-running={running ? '1' : '0'} onClick={run}>
          {running ? <Icon name="stop" size={15} /> : <Icon name="play" size={15} />}
          {running ? 'Stop' : `Run ${selIds.length * iters} request${selIds.length * iters !== 1 ? 's' : ''}`}
        </button>
        {phase !== 'idle' && (
          <div className="pf-prog"><div className="pf-prog-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="pf-prog-meta"><span>{total} / {selIds.length * iters}</span><span>{running ? 'running' : 'done'}</span></div></div>
        )}
      </div>

      <div className="rn-results">
        {phase === 'idle' ? (
          <div className="pf-empty">
            <div className="pf-empty-icon"><Icon name="play" size={26} stroke={1.5} /></div>
            <div className="pf-empty-title">Run a collection</div>
            <div className="pf-empty-sub">{col.name} · {selIds.length} requests · {iters} iteration{iters !== 1 ? 's' : ''}</div>
          </div>
        ) : (
          <>
            <div className="rn-summary">
              <div className="rn-sum"><span>Requests</span><strong>{total}</strong></div>
              <div className="rn-sum"><span>Assertions</span><strong style={{ color: aPass === aTotal ? 'oklch(0.78 0.14 150)' : 'oklch(0.74 0.16 22)' }}>{aPass}/{aTotal}</strong></div>
              <div className="rn-sum"><span>Failures</span><strong style={{ color: failed ? 'oklch(0.74 0.16 22)' : 'var(--text)' }}>{failed}</strong></div>
              <div className="rn-sum"><span>Avg time</span><strong>{avg}<em> ms</em></strong></div>
            </div>
            <div className="rn-table">
              {results.map((r, i) => {
                const head = r.iter !== lastIter; lastIter = r.iter;
                return (
                  <React.Fragment key={i}>
                    {head && <div className="rn-iter-head">Iteration {r.iter}{dataRows ? ` · ${JSON.stringify(dataRows[r.iter - 1])}` : ''}</div>}
                    <div className="rn-trow qa-fade">
                      <MethodBadge method={r.method} size="sm" />
                      <span className="rn-tpath">{r.path}</span>
                      <span className="rn-tstatus" style={{ color: window.QATheme.statusColor(r.status) }}>{r.status}</span>
                      <span className="rn-ttime">{r.time}ms</span>
                      {r.total > 0
                        ? <span className="rn-ttests" data-pass={r.passed === r.total ? '1' : '0'}><Icon name={r.passed === r.total ? 'check' : 'x'} size={11} stroke={3} /> {r.passed}/{r.total}</span>
                        : <span className="rn-ttests rn-ttests--none">no tests</span>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Runner });

export { Runner };
