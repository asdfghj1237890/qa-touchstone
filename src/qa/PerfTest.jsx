import React from 'react';
import './setup.js';
import { Dropdown, Icon, MethodBadge, MiniCheck } from './components.jsx';

// ── QA Companion — Performance / Load / Stress (SLO · stages · history) ────
const { useState: usePF, useRef: useRefPF } = React;

const PF_FLAT = window.QA.COLLECTIONS.flatMap(c =>
  c.folders.flatMap(f => f.requests.map(r => ({ value: r.id, label: `${r.method}  ${r.path.split('?')[0]}`, method: r.method }))));

const TYPE_META = {
  performance: { label: 'Performance', icon: 'activity', blurb: 'Baseline latency & throughput under expected load.', baseLat: 88, capacity: 9999,
    stages: [{ d: 8, t: 10 }, { d: 30, t: 10 }, { d: 4, t: 0 }], slo: { p80: 120, p90: 160, p95: 200, p99: 300, err: 1 } },
  load:        { label: 'Load', icon: 'users', blurb: 'Sustained peak traffic for a fixed duration.', baseLat: 120, capacity: 200,
    stages: [{ d: 15, t: 120 }, { d: 40, t: 120 }, { d: 8, t: 0 }], slo: { p80: 300, p90: 400, p95: 500, p99: 800, err: 2 } },
  stress:      { label: 'Stress', icon: 'gauge', blurb: 'Ramp beyond limits to find the breaking point.', baseLat: 140, capacity: 220,
    stages: [{ d: 12, t: 100 }, { d: 14, t: 300 }, { d: 14, t: 500 }, { d: 8, t: 0 }], slo: { p80: 800, p90: 1100, p95: 1500, p99: 2500, err: 15 } },
};
const DEFAULT_CONN = { keepAlive: true, timeout: 30000, maxConns: 200 };
const N_POINTS = 56;
const PERF_KEY = 'qa_perf_runs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const vusAt = (el, stages) => {
  let s = 0, prev = 0;
  for (let i = 0; i < stages.length; i++) {
    const d = +stages[i].d || 0, t = +stages[i].t || 0;
    if (el < s + d) { const f = d > 0 ? (el - s) / d : 1; return prev + (t - prev) * f; }
    s += d; prev = t;
  }
  return prev;
};

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sparkPath(series, w, h, pad = 4) {
  const n = series.length; if (n < 2) return '';
  const max = Math.max(1, ...series);
  return series.map((v, i) => `${(pad + i / (n - 1) * (w - 2 * pad)).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`).join(' ');
}

function buildReportHtml(run) {
  const ok = run.dist.ok, c4 = run.dist.c4, c5 = run.dist.c5, tot = ok + c4 + c5 || 1;
  const latP = sparkPath(run.latSeries, 520, 120), rpsP = sparkPath(run.rpsSeries, 520, 120);
  const row = (l, a, lim, p) => `<tr><td>${p ? '✓' : '✗'}</td><td>${l}</td><td><b>${a}</b></td><td>limit ${lim}</td><td class="${p ? 'ok' : 'bad'}">${p ? 'PASS' : 'FAIL'}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Companion — ${run.typeLabel} report</title>
<style>
  body{margin:0;background:#15181c;color:#e6edf3;font-family:'Google Sans Code',ui-monospace,monospace;font-size:13px;line-height:1.5;padding:32px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:18px;margin:0 0 2px}.sub{color:#97a3ae;font-size:12px;margin-bottom:20px}
  .verdict{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:8px 14px;border-radius:8px;margin-bottom:18px}
  .pass{color:#46d27a;background:rgba(70,210,122,.12);border:1px solid rgba(70,210,122,.4)}
  .fail{color:#ef6b6b;background:rgba(239,107,107,.12);border:1px solid rgba(239,107,107,.4)}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
  .card{border:1px solid #272d34;border-radius:8px;padding:12px}.card .l{color:#626d77;font-size:10px;text-transform:uppercase;letter-spacing:.05em}.card .v{font-size:20px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}td{padding:7px 8px;border-bottom:1px solid #272d34;font-size:12px}.ok{color:#46d27a}.bad{color:#ef6b6b}
  .chart{border:1px solid #272d34;border-radius:8px;padding:12px;margin-bottom:12px}.chart h3{margin:0 0 8px;font-size:12px;color:#97a3ae;font-weight:600}
  svg{width:100%;height:120px;display:block}
  .bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#21262d;margin:6px 0}
  .foot{color:#626d77;font-size:11px;margin-top:24px}
</style></head><body><div class="wrap">
  <h1>QA Companion · ${run.typeLabel} test report</h1>
  <div class="sub">Target peak ${run.maxVus} VUs · ${run.dur}s · generated ${run.ts}</div>
  <div class="verdict ${run.pass ? 'pass' : 'fail'}">${run.pass ? '✓ PASS' : '✗ FAIL'} against SLO</div>
  <table>${run.rows.map(r => row(r.label, r.actual + r.unit, r.limit + r.unit, r.pass)).join('')}</table>
  <div class="grid">
    <div class="card"><div class="l">Requests</div><div class="v">${run.m.sent.toLocaleString()}</div></div>
    <div class="card"><div class="l">Peak rps</div><div class="v">${run.m.rps.toLocaleString()}</div></div>
    <div class="card"><div class="l">Avg</div><div class="v">${run.m.avg} ms</div></div>
    <div class="card"><div class="l">p80</div><div class="v">${run.m.p80} ms</div></div>
    <div class="card"><div class="l">p90</div><div class="v">${run.m.p90} ms</div></div>
    <div class="card"><div class="l">p95</div><div class="v">${run.m.p95} ms</div></div>
    <div class="card"><div class="l">p99</div><div class="v">${run.m.p99} ms</div></div>
    <div class="card"><div class="l">Errors</div><div class="v">${run.m.err} %</div></div>
  </div>
  <div class="chart"><h3>Response time (p50) — peak ${Math.round(Math.max(...run.latSeries))} ms</h3><svg viewBox="0 0 520 120" preserveAspectRatio="none"><polyline points="${latP}" fill="none" stroke="#4d9fff" stroke-width="2"/></svg></div>
  <div class="chart"><h3>Requests / sec — peak ${Math.max(...run.rpsSeries)}</h3><svg viewBox="0 0 520 120" preserveAspectRatio="none"><polyline points="${rpsP}" fill="none" stroke="#46d27a" stroke-width="2"/></svg></div>
  <div class="chart"><h3>Status distribution — ${tot.toLocaleString()} responses</h3><div class="bar"><span style="width:${ok / tot * 100}%;background:#46d27a"></span><span style="width:${c4 / tot * 100}%;background:#e0b14d"></span><span style="width:${c5 / tot * 100}%;background:#ef6b6b"></span></div><div style="font-size:11px;color:#97a3ae">2xx ${ok.toLocaleString()} · 4xx ${c4.toLocaleString()} · 5xx ${c5.toLocaleString()}</div></div>
  <div class="foot">Generated by QA Companion. Load figures are from a simulated run.</div>
</div></body></html>`;
}

function exportRun(run, fmt) {
  const base = `qa-perf-${run.type}-${String(run.ts).replace(/[:\s]/g, '')}`;
  if (fmt === 'json') { downloadFile(base + '.json', JSON.stringify(run, null, 2), 'application/json'); return; }
  if (fmt === 'html') { downloadFile(base + '.html', buildReportHtml(run), 'text/html'); return; }
  // csv
  const L = ['metric,value'];
  L.push(`type,${run.typeLabel}`, `peak_vus,${run.maxVus}`, `duration_s,${run.dur}`,
    `requests,${run.m.sent}`, `peak_rps,${run.m.rps}`, `avg_ms,${run.m.avg}`,
    `p80_ms,${run.m.p80}`, `p90_ms,${run.m.p90}`, `p95_ms,${run.m.p95}`, `p99_ms,${run.m.p99}`, `error_rate_pct,${run.m.err}`, `verdict,${run.pass ? 'PASS' : 'FAIL'}`);
  run.rows.forEach(r => L.push(`slo_${r.label.replace(/\s+/g, '_')},${r.actual}${r.unit} (limit ${r.limit}${r.unit}) ${r.pass ? 'PASS' : 'FAIL'}`));
  L.push('', 'point,latency_ms,rps');
  run.latSeries.forEach((l, i) => L.push(`${i + 1},${Math.round(l)},${run.rpsSeries[i]}`));
  downloadFile(base + '.csv', L.join('\n'), 'text/csv');
}

const CMP_ROWS = [
  ['Type', r => r.typeLabel], ['Peak VUs', r => r.maxVus], ['Duration', r => r.dur + 's'],
  ['Verdict', r => r.pass ? 'PASS' : 'FAIL'], ['Requests', r => r.m.sent], ['Peak rps', r => r.m.rps],
  ['Avg', r => r.m.avg + 'ms'], ['p80', r => r.m.p80 + 'ms'], ['p90', r => r.m.p90 + 'ms'],
  ['p95', r => r.m.p95 + 'ms'], ['p99', r => r.m.p99 + 'ms'], ['Errors', r => r.m.err + '%'],
];

function buildMultiReportHtml(list) {
  const th = '<th class="ml">metric</th>' + list.map(r => `<th>${r.typeLabel}<div class="ts">${r.ts}</div></th>`).join('');
  const body = CMP_ROWS.map(([l, fn]) =>
    `<tr><td class="ml">${l}</td>${list.map(r => { const v = fn(r); const cls = l === 'Verdict' ? (r.pass ? 'ok' : 'bad') : ''; return `<td class="${cls}">${v}</td>`; }).join('')}</tr>`).join('');
  const charts = list.map(r => `<div class="ch"><h3>${r.typeLabel} · ${r.ts} — p95 ${r.m.p95}ms · ${r.pass ? 'PASS' : 'FAIL'}</h3><svg viewBox="0 0 560 80" preserveAspectRatio="none"><polyline points="${sparkPath(r.latSeries, 560, 80)}" fill="none" stroke="#4d9fff" stroke-width="2"/></svg></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Companion — consolidated report (${list.length} runs)</title>
<style>
  body{margin:0;background:#15181c;color:#e6edf3;font-family:'Google Sans Code',ui-monospace,monospace;font-size:13px;padding:32px}
  .wrap{max-width:860px;margin:0 auto}h1{font-size:18px;margin:0 0 2px}.sub{color:#97a3ae;font-size:12px;margin-bottom:22px}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}th,td{padding:8px 10px;border-bottom:1px solid #272d34;font-size:12px;text-align:right}
  th{color:#97a3ae;font-weight:600;vertical-align:bottom}.ml{text-align:left;color:#626d77}td.ml{color:#97a3ae}
  th .ts{color:#626d77;font-weight:400;font-size:10px}.ok{color:#46d27a;font-weight:700}.bad{color:#ef6b6b;font-weight:700}
  .ch{border:1px solid #272d34;border-radius:8px;padding:12px;margin-bottom:10px}.ch h3{margin:0 0 8px;font-size:12px;color:#97a3ae;font-weight:600}svg{width:100%;height:80px;display:block}
  .foot{color:#626d77;font-size:11px;margin-top:24px}
</style></head><body><div class="wrap">
  <h1>QA Companion · consolidated report</h1>
  <div class="sub">${list.length} runs · generated ${new Date().toLocaleString()}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  <h2 style="font-size:14px;color:#97a3ae;margin:0 0 12px">Response time (p50) per run</h2>
  ${charts}
  <div class="foot">Generated by QA Companion. Load figures are from simulated runs.</div>
</div></body></html>`;
}

function exportRuns(list, fmt) {
  if (!list.length) return;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const base = `qa-perf-report-${list.length}runs-${stamp}`;
  if (fmt === 'json') { downloadFile(base + '.json', JSON.stringify(list, null, 2), 'application/json'); return; }
  if (fmt === 'html') { downloadFile(base + '.html', buildMultiReportHtml(list), 'text/html'); return; }
  const head = 'metric,' + list.map(r => `"${r.typeLabel} ${r.ts}"`).join(',');
  const lines = [head, ...CMP_ROWS.map(([l, fn]) => `${l},` + list.map(r => fn(r)).join(','))];
  downloadFile(base + '.csv', lines.join('\n'), 'text/csv');
}

function Chart({ pts, max, color, label, unit }) {
  const n = pts.length;
  const coords = pts.map((v, i) => [(i / Math.max(1, N_POINTS - 1)) * 100, 100 - (Math.min(v, max) / max) * 100]);
  const line = coords.map(c => `${c[0].toFixed(2)},${c[1].toFixed(2)}`).join(' ');
  const area = n >= 2 ? `0,100 ${line} ${coords[n - 1][0].toFixed(2)},100` : '';
  return (
    <div className="pf-chart">
      <div className="pf-chart-head"><span>{label}</span><span className="pf-chart-max">{Math.round(max)}{unit}</span></div>
      <div className="pf-chart-box">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pf-chart-svg">
          {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} className="pf-grid" />)}
          {n >= 2 && <polygon points={area} fill={color} opacity="0.12" />}
          {n >= 2 && <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        </svg>
        {n < 2 && <div className="pf-chart-empty">No data yet</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent, delta, better }) {
  let cls = '', arrow = '';
  if (delta != null && delta !== 0) {
    const good = better === 'low' ? delta < 0 : delta > 0;
    cls = good ? 'pf-d-good' : 'pf-d-bad';
    arrow = delta > 0 ? '▲' : '▼';
  }
  return (
    <div className="pf-stat">
      <div className="pf-stat-label">{label}</div>
      <div className="pf-stat-value" style={accent ? { color: 'var(--accent)' } : null}>{value}<em>{unit}</em></div>
      {delta != null && delta !== 0 && <div className={'pf-stat-delta ' + cls}>{arrow} {Math.abs(Math.round(delta)).toLocaleString()}{unit}</div>}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, disabled, width = 110 }) {
  return <input className="pf-num" type="number" value={value} min={min} disabled={disabled} style={{ width }}
                onChange={e => onChange(Math.max(min, +e.target.value || 0))} />;
}

function PerfTest() {
  const [target, setTarget] = usePF('usr-list');
  const [type, setType] = usePF('load');
  const [stages, setStages] = usePF(() => clone(TYPE_META.load.stages));
  const [conn, setConn] = usePF({ ...DEFAULT_CONN });
  const [slo, setSlo] = usePF({ ...TYPE_META.load.slo });
  const [phase, setPhase] = usePF('idle');
  const [progress, setProgress] = usePF(0);
  const [live, setLive] = usePF(null);
  const [runs, setRuns] = usePF(() => { try { return JSON.parse(localStorage.getItem(PERF_KEY) || '[]'); } catch { return []; } });
  const [viewIdx, setViewIdx] = usePF(0);
  const [selected, setSelected] = usePF([]);
  const [hMenu, setHMenu] = usePF(false);
  const timer = useRefPF(null);
  const acc = useRefPF({});

  const pickType = (t) => { setType(t); setStages(clone(TYPE_META[t].stages)); setSlo({ ...TYPE_META[t].slo }); };

  const setStage = (i, k, v) => setStages(s => s.map((st, idx) => idx === i ? { ...st, [k]: Math.max(0, +v || 0) } : st));
  const addStage = () => setStages(s => [...s, { d: 10, t: 50 }]);
  const delStage = (i) => setStages(s => s.length > 1 ? s.filter((_, idx) => idx !== i) : s);

  const toggleSel = (i) => setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);
  const clearHistory = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRuns([]); setSelected([]); setHMenu(false); setLive(null); setPhase('idle');
    try { localStorage.removeItem(PERF_KEY); } catch {}
  };

  const total = stages.reduce((s, st) => s + (+st.d || 0), 0);
  const maxVus = Math.max(0, ...stages.map(st => +st.t || 0));
  const running = phase === 'running';

  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setPhase(p => p === 'running' ? 'done' : p); };

  const run = () => {
    if (running) { stop(); return; }
    if (total <= 0) return;
    const meta = TYPE_META[type];
    acc.current = { i: 0, totReq: 0, totErr: 0, ok: 0, c4: 0, c5: 0, lat: [], rps: [], broke: null };
    setProgress(0); setViewIdx(0); setPhase('running');
    const dt = total / N_POINTS;
    timer.current = setInterval(() => {
      const a = acc.current; a.i += 1;
      const p = a.i / N_POINTS;
      const elapsed = p * total;
      const av = vusAt(elapsed, stages);
      const lf = av / meta.capacity;
      const noise = (x) => 1 + (Math.random() - 0.5) * x;
      let lat = meta.baseLat * (1 + 0.8 * lf + (lf > 1 ? 5 * (lf - 1) * (lf - 1) : 0)) * noise(0.15);
      if (!conn.keepAlive) lat *= 1.15;
      let errPct = (lf > 1 ? Math.min(65, 45 * (lf - 1)) : 0.2 + 0.6 * lf) * noise(0.4);
      if (conn.timeout && lat > conn.timeout) { errPct = Math.max(errPct, 60); lat = conn.timeout; }
      errPct = Math.max(0, errPct);
      const effVus = Math.min(av, conn.maxConns || av);
      const rps = Math.max(1, Math.round(effVus * 1000 / lat));
      const reqTick = Math.round(rps * dt);
      const errReq = Math.round(reqTick * errPct / 100);
      a.totReq += reqTick; a.totErr += errReq;
      a.ok += reqTick - errReq; a.c4 += Math.round(errReq * 0.6); a.c5 += errReq - Math.round(errReq * 0.6);
      a.lat.push(lat); a.rps.push(rps);
      if (!a.broke && errPct > 5) a.broke = Math.round(elapsed);
      const sorted = [...a.lat].sort((x, y) => x - y);
      const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
      const overallErr = a.totReq ? a.totErr / a.totReq * 100 : 0;
      setProgress(p);
      setLive({
        m: { sent: a.totReq, rps, avg: Math.round(a.lat.reduce((s, x) => s + x, 0) / a.lat.length), p80: Math.round(pct(0.80)), p90: Math.round(pct(0.90)), p95: Math.round(pct(0.95)), p99: Math.round(pct(0.99)), err: +overallErr.toFixed(2) },
        latSeries: [...a.lat], rpsSeries: [...a.rps], dist: { ok: a.ok, c4: a.c4, c5: a.c5 }, broke: a.broke, slo: { ...slo },
      });
      if (a.i >= N_POINTS) {
        clearInterval(timer.current); timer.current = null;
        const p80 = Math.round(pct(0.80)), p90 = Math.round(pct(0.90)), p95 = Math.round(pct(0.95)), p99 = Math.round(pct(0.99));
        const avg = Math.round(a.lat.reduce((s, x) => s + x, 0) / a.lat.length);
        const rows = [
          { label: 'p80 response time', actual: p80, unit: 'ms', limit: slo.p80, pass: p80 <= slo.p80 },
          { label: 'p90 response time', actual: p90, unit: 'ms', limit: slo.p90, pass: p90 <= slo.p90 },
          { label: 'p95 response time', actual: p95, unit: 'ms', limit: slo.p95, pass: p95 <= slo.p95 },
          { label: 'p99 response time', actual: p99, unit: 'ms', limit: slo.p99, pass: p99 <= slo.p99 },
          { label: 'Error rate', actual: +overallErr.toFixed(2), unit: '%', limit: slo.err, pass: overallErr <= slo.err },
        ];
        const pass = rows.every(r => r.pass);
        const peakRps = Math.max(...a.rps);
        const summary = {
          ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type, typeLabel: meta.label, maxVus, dur: total,
          m: { sent: a.totReq, rps: peakRps, avg, p80, p90, p95, p99, err: +overallErr.toFixed(2) },
          latSeries: [...a.lat], rpsSeries: [...a.rps], dist: { ok: a.ok, c4: a.c4, c5: a.c5 }, broke: a.broke,
          slo: { ...slo }, rows, pass,
        };
        setRuns(prev => {
          const next = [summary, ...prev].slice(0, 8);
          try { localStorage.setItem(PERF_KEY, JSON.stringify(next)); } catch {}
          return next;
        });
        setViewIdx(0); setPhase('done');
      }
    }, 95);
  };

  const tgt = PF_FLAT.find(r => r.value === target) || PF_FLAT[0];
  const shown = running ? live : (runs[viewIdx] || live);
  const baseline = running ? null : (runs[viewIdx + 1] || null);
  const dist = shown ? shown.dist : { ok: 0, c4: 0, c5: 0 };
  const totalResp = dist.ok + dist.c4 + dist.c5 || 1;
  const maxLat = shown && shown.latSeries.length ? Math.max(200, ...shown.latSeries) * 1.1 : 200;
  const maxRps = shown && shown.rpsSeries.length ? Math.max(50, ...shown.rpsSeries) * 1.1 : 50;
  const d = (k, better) => (baseline && shown && !running) ? shown.m[k] - baseline.m[k] : null;

  return (
    <div className="pf">
      <div className="pf-config">
        <div className="pf-config-head">
          <h2>{TYPE_META[type].label} test</h2>
          <p>{TYPE_META[type].blurb}</p>
        </div>

        <label className="qa-side-label">Test type</label>
        <div className="pf-types">
          {Object.entries(TYPE_META).map(([k, meta]) => (
            <button key={k} className="pf-type" data-active={type === k ? '1' : '0'} onClick={() => !running && pickType(k)} disabled={running}>
              <Icon name={meta.icon} size={17} /><span className="pf-type-name">{meta.label}</span>
            </button>
          ))}
        </div>

        <label className="qa-side-label" style={{ marginTop: 16 }}>Target request</label>
        <Dropdown value={target} options={PF_FLAT} onChange={setTarget} />

        <div className="pf-sec-label"><span>Load stages</span><span className="qa-meta">{total}s · peak {maxVus} VUs</span></div>
        <div className="pf-stages">
          <div className="pf-stage pf-stage--head"><span>Duration (s)</span><span>Target VUs</span><span /></div>
          {stages.map((st, i) => (
            <div className="pf-stage" key={i}>
              <Stepper value={st.d} onChange={v => setStage(i, 'd', v)} min={1} disabled={running} width="100%" />
              <Stepper value={st.t} onChange={v => setStage(i, 't', v)} min={0} disabled={running} width="100%" />
              <button className="pf-stage-del" onClick={() => !running && delStage(i)} disabled={running || stages.length <= 1}><Icon name="x" size={12} /></button>
            </div>
          ))}
          <button className="pf-stage-add" onClick={() => !running && addStage()} disabled={running}><Icon name="plus" size={12} /> Add stage</button>
        </div>

        <div className="pf-sec-label"><span>Pass / fail thresholds</span><span className="qa-meta">SLO · ms</span></div>
        <div className="pf-slo-grid">
          {['p80', 'p90', 'p95', 'p99'].map(k => (
            <div className="pf-slo-cell" key={k}><span>{k} ≤</span><Stepper value={slo[k]} onChange={v => setSlo({ ...slo, [k]: v })} min={1} disabled={running} width="76px" /></div>
          ))}
        </div>
        <div className="pf-params" style={{ marginTop: 10 }}>
          <div className="pf-param"><span>Error rate<em>%</em></span><Stepper value={slo.err} onChange={v => setSlo({ ...slo, err: v })} min={0} disabled={running} /></div>
        </div>

        <div className="pf-sec-label"><span>Connection</span></div>
        <div className="pf-params">
          <div className="pf-param"><span>Keep-alive</span>
            <button className="pf-toggle" data-on={conn.keepAlive ? '1' : '0'} disabled={running} onClick={() => setConn({ ...conn, keepAlive: !conn.keepAlive })}><span /></button>
          </div>
          <div className="pf-param"><span>Timeout<em>ms</em></span><Stepper value={conn.timeout} onChange={v => setConn({ ...conn, timeout: v })} min={1} disabled={running} /></div>
          <div className="pf-param"><span>Max connections</span><Stepper value={conn.maxConns} onChange={v => setConn({ ...conn, maxConns: v })} min={1} disabled={running} /></div>
        </div>

        <button className="pf-run" data-running={running ? '1' : '0'} onClick={run}>
          {running ? <Icon name="stop" size={15} /> : <Icon name="play" size={15} />}
          {running ? 'Stop test' : 'Run test'}
        </button>
        {phase !== 'idle' && (
          <div className="pf-prog">
            <div className="pf-prog-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="pf-prog-meta"><span>{Math.round(progress * total)}s / {total}s</span><span>{running ? 'running' : 'completed'}</span></div>
          </div>
        )}
      </div>

      <div className="pf-results">
        {!shown ? (
          <div className="pf-empty">
            <div className="pf-empty-icon"><Icon name="gauge" size={28} stroke={1.5} /></div>
            <div className="pf-empty-title">Configure & run a test</div>
            <div className="pf-empty-sub"><MethodBadge method={tgt.method} size="sm" /> {tgt.label.split('  ')[1]} · {maxVus} VUs · {total}s</div>
          </div>
        ) : (
          <>
            {!running && shown.rows && (
              <div className="pf-verdict" data-pass={shown.pass ? '1' : '0'}>
                <div className="pf-verdict-head">
                  <Icon name={shown.pass ? 'check' : 'x'} size={16} stroke={3} />
                  <strong>{shown.pass ? 'PASS' : 'FAIL'}</strong><span>against SLO</span>
                  {viewIdx > 0 && <span className="pf-viewing">· viewing run from {shown.ts}</span>}
                </div>
                <div className="pf-vrows">
                  {shown.rows.map((r, i) => (
                    <div key={i} className="pf-vrow" data-pass={r.pass ? '1' : '0'}>
                      <Icon name={r.pass ? 'check' : 'x'} size={12} stroke={3} />
                      <span className="pf-vrow-label">{r.label}</span>
                      <strong>{r.actual}{r.unit}</strong>
                      <span className="qa-meta">limit {r.limit}{r.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {shown.broke && type === 'stress' && (
              <div className="pf-broke"><Icon name="zap" size={15} /> Breaking point at <strong>~{shown.broke}s</strong> — error rate exceeded 5%.</div>
            )}
            {baseline && (
              <div className="pf-cmp"><Icon name="history" size={12} /> vs previous run ({baseline.typeLabel}, {baseline.ts})</div>
            )}

            <div className="pf-stats">
              <Stat label="Requests" value={shown.m.sent.toLocaleString()} unit="" />
              <Stat label="Peak rps" value={shown.m.rps.toLocaleString()} unit="" accent delta={d('rps')} better="high" />
              <Stat label="Avg" value={shown.m.avg} unit=" ms" delta={d('avg')} better="low" />
              <Stat label="p80" value={shown.m.p80} unit=" ms" delta={d('p80')} better="low" />
              <Stat label="p90" value={shown.m.p90} unit=" ms" delta={d('p90')} better="low" />
              <Stat label="p95" value={shown.m.p95} unit=" ms" delta={d('p95')} better="low" />
              <Stat label="p99" value={shown.m.p99} unit=" ms" delta={d('p99')} better="low" />
              <Stat label="Errors" value={shown.m.err} unit=" %" delta={d('err')} better="low" />
            </div>

            <div className="pf-charts">
              <Chart pts={shown.latSeries} max={maxLat} color="var(--accent)" label="Response time (p50)" unit=" ms" />
              <Chart pts={shown.rpsSeries} max={maxRps} color="oklch(0.78 0.15 150)" label="Requests / sec" unit="" />
            </div>

            <div className="pf-dist">
              <div className="pf-dist-head"><span>Status distribution</span><span className="qa-meta">{totalResp.toLocaleString()} responses</span></div>
              <div className="pf-dist-bar">
                <span style={{ width: `${dist.ok / totalResp * 100}%`, background: 'oklch(0.76 0.15 150)' }} />
                <span style={{ width: `${dist.c4 / totalResp * 100}%`, background: 'oklch(0.78 0.15 70)' }} />
                <span style={{ width: `${dist.c5 / totalResp * 100}%`, background: 'oklch(0.68 0.18 18)' }} />
              </div>
              <div className="pf-dist-legend">
                <span><i style={{ background: 'oklch(0.76 0.15 150)' }} /> 2xx · {dist.ok.toLocaleString()}</span>
                <span><i style={{ background: 'oklch(0.78 0.15 70)' }} /> 4xx · {dist.c4.toLocaleString()}</span>
                <span><i style={{ background: 'oklch(0.68 0.18 18)' }} /> 5xx · {dist.c5.toLocaleString()}</span>
              </div>
            </div>

            {runs.length > 0 && (
              <div className="pf-history">
                <div className="pf-history-head">
                  <span><Icon name="history" size={13} /> Run history</span>
                  <div className="pf-history-actions">
                    <span className="qa-meta">{selected.length ? `${selected.length} selected` : `${runs.length} runs`}</span>
                    <div className="pf-export">
                      <button className="pf-hbtn" disabled={!selected.length} onClick={() => setHMenu(m => !m)}>
                        <Icon name="download" size={13} /> Export{selected.length ? ` (${selected.length})` : ''}
                      </button>
                      {hMenu && selected.length > 0 && (
                        <div className="pf-export-menu">
                          {['json', 'csv', 'html'].map(f => (
                            <button key={f} onClick={() => { exportRuns(selected.slice().sort((a, b) => a - b).map(i => runs[i]), f); setHMenu(false); }}>
                              {f.toUpperCase()} report
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="pf-hbtn pf-hbtn--danger" onClick={clearHistory}><Icon name="trash" size={13} /> Clear</button>
                  </div>
                </div>
                {runs.map((r, i) => (
                  <div key={i} className="pf-run-row" data-active={!running && i === viewIdx ? '1' : '0'}>
                    <span className="pf-run-check"><MiniCheck on={selected.includes(i)} onClick={() => toggleSel(i)} /></span>
                    <button className="pf-run-main" onClick={() => !running && setViewIdx(i)}>
                      <span className="pf-run-pass" data-pass={r.pass ? '1' : '0'}>{r.pass ? 'PASS' : 'FAIL'}</span>
                      <span className="pf-run-type">{r.typeLabel}</span>
                      <span className="qa-meta">{r.maxVus} VUs</span>
                      <span className="pf-run-metric">p95 <strong>{r.m.p95}</strong>ms</span>
                      <span className="pf-run-metric">err <strong>{r.m.err}</strong>%</span>
                      <span className="pf-run-ts qa-meta">{r.ts}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { PerfTest });

export { PerfTest };
