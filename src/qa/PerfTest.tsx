import React from 'react';
import './setup';
import { Dropdown, Icon, MethodBadge, MiniCheck } from './components';
import api from '../api/index';
import { buildScript } from './k6gen';
import type { K6Stage } from './k6gen';
import { makeState, feed, snapshot } from './k6parse';
import type { K6Metrics, K6ParseState, K6Slo, K6Snapshot } from './k6parse';
import { useI18n } from './useI18n';
import { downloadFile } from './download';
import { loadJSON, removeStorageKey, saveJSON } from './storage';
import type { QaEnv } from './state/WorkspaceContext';

// ── QA Touchstone — Performance / Load / Stress (SLO · stages · history) ────
const { useState: usePF, useRef: useRefPF, useEffect: useEffPF } = React;

type PerfType = 'performance' | 'load' | 'stress';
type PerfPhase = 'idle' | 'running' | 'done';

/** 測試型態的預設組（stages/SLO/文案 key）。 */
interface PerfTypeMeta {
  labelKey: string;
  icon: string;
  blurbKey: string;
  stages: K6Stage[];
  slo: K6Slo;
}

/** 目標 request 下拉的一列（type alias：可指派給 DropdownOption）。 */
type PerfTarget = {
  value: string;
  label: string;
  name: string;
  method: string;
  folder: string;
  collection: string;
  url: string;
  urlLabel: string;
  meta: string;
  title: string;
};

/** SLO 驗證表的一列。 */
interface PerfSloRow {
  label: string;
  actual: number;
  unit: string;
  limit: number;
  pass: boolean;
}

/** 歷史 run（持久化到 localStorage）。 */
interface PerfRun extends K6Snapshot {
  ts: string;
  type: PerfType;
  typeLabel: string;
  maxVus: number;
  dur: number;
  rows: PerfSloRow[];
  pass: boolean;
  error: string | null;
}

/** 即時/歷史皆可顯示的結果（live 為 K6Snapshot；歷史 run 多帶欄位）。 */
type PerfView = K6Snapshot & {
  error?: string | null;
  rows?: PerfSloRow[];
  pass?: boolean;
  ts?: string;
  dur?: number;
  typeLabel?: string;
};

/** 一次 k6 session 的執行內部狀態（acc ref 持有）。 */
interface PerfSession {
  state: K6ParseState;
  scriptPath: string;
  buffer: string;
}

// Computed per render (not cached at module load) so imported collections,
// which are pushed into window.QA.COLLECTIONS at runtime, show up here too.
function compactUrlLabel(raw: unknown): string {
  const url = String(raw || '').split('?')[0] ?? '';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

const pfCollectionOptions = (): Array<{ value: string; label: string; title: string }> =>
  window.QA.COLLECTIONS.map((c: any) => ({
    value: c.id,
    label: c.name || 'Collection',
    title: c.name || c.id,
  }));

const pfTargets = (collectionId: string): PerfTarget[] =>
  window.QA.COLLECTIONS.filter((c: any) => !collectionId || c.id === collectionId).flatMap(
    (c: any) =>
      c.folders.flatMap((f: any) =>
        f.requests.map((r: any) => {
          const url = String(r.path || '').split('?')[0];
          const folder = f.name || c.name || 'Collection';
          const name = r.name || compactUrlLabel(url) || r.id;
          const urlLabel = compactUrlLabel(url);
          return {
            value: r.id,
            label: name,
            name,
            method: r.method,
            folder,
            collection: c.name || 'Collection',
            url,
            urlLabel,
            meta: `${folder} · ${urlLabel}`,
            title: `${r.method} ${name}\n${folder}\n${url}`,
          };
        })
      )
  );

function TargetRequestOption({ item }: { item: PerfTarget }) {
  return (
    <span className="pf-target-option">
      <MethodBadge method={item.method} size="sm" />
      <span className="pf-target-copy">
        <span className="pf-target-name">{item.name}</span>
        <span className="pf-target-meta">{item.meta}</span>
      </span>
    </span>
  );
}

// VU defaults intentionally kept low — these run real traffic via k6, so the
// previous synthetic-mode peaks (120/200/500) would hammer public demo APIs.
// Users can crank stages up in the editor for their own infrastructure.
const TYPE_META: Record<PerfType, PerfTypeMeta> = {
  performance: {
    labelKey: 'perf.type.performance',
    icon: 'activity',
    blurbKey: 'perf.blurb.performance',
    stages: [
      { d: 8, t: 5 },
      { d: 30, t: 5 },
      { d: 4, t: 0 },
    ],
    slo: { p80: 200, p90: 300, p95: 400, p99: 600, err: 1 },
  },
  load: {
    labelKey: 'perf.type.load',
    icon: 'users',
    blurbKey: 'perf.blurb.load',
    stages: [
      { d: 15, t: 15 },
      { d: 40, t: 15 },
      { d: 8, t: 0 },
    ],
    slo: { p80: 400, p90: 600, p95: 800, p99: 1200, err: 2 },
  },
  stress: {
    labelKey: 'perf.type.stress',
    icon: 'gauge',
    blurbKey: 'perf.blurb.stress',
    stages: [
      { d: 12, t: 20 },
      { d: 14, t: 30 },
      { d: 14, t: 40 },
      { d: 8, t: 0 },
    ],
    slo: { p80: 800, p90: 1100, p95: 1500, p99: 2500, err: 10 },
  },
};
const DEFAULT_CONN = { keepAlive: true, timeout: 30000, maxConns: 200 };
const N_POINTS = 56;
const PERF_KEY = 'qa_perf_runs';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// Resolve which collection a request id belongs to (kept inline so PerfTest
// stays decoupled from App.jsx — same logic, different file).
function pfCollectionOf(reqId: string): string | null {
  for (const c of window.QA.COLLECTIONS) {
    for (const f of c.folders) {
      if (f.requests.some((r: any) => r.id === reqId)) return c.id;
    }
  }
  return null;
}

function sparkPath(series: number[], w: number, h: number, pad = 4): string {
  const n = series.length;
  if (n < 2) return '';
  const max = Math.max(1, ...series);
  return series
    .map(
      (v, i) =>
        `${(pad + (i / (n - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`
    )
    .join(' ');
}

const CMP_ROWS: Array<[string, (r: PerfRun) => unknown]> = [
  ['Type', (r) => r.typeLabel],
  ['Peak VUs', (r) => r.maxVus],
  ['Duration', (r) => r.dur + 's'],
  ['Verdict', (r) => (r.pass ? 'PASS' : 'FAIL')],
  ['Requests', (r) => r.m.sent],
  ['Peak rps', (r) => r.m.rps],
  ['Avg', (r) => r.m.avg + 'ms'],
  ['p80', (r) => r.m.p80 + 'ms'],
  ['p90', (r) => r.m.p90 + 'ms'],
  ['p95', (r) => r.m.p95 + 'ms'],
  ['p99', (r) => r.m.p99 + 'ms'],
  ['Errors', (r) => r.m.err + '%'],
];

function buildMultiReportHtml(list: PerfRun[]): string {
  const th =
    '<th class="ml">metric</th>' +
    list.map((r) => `<th>${r.typeLabel}<div class="ts">${r.ts}</div></th>`).join('');
  const body = CMP_ROWS.map(
    ([l, fn]) =>
      `<tr><td class="ml">${l}</td>${list
        .map((r) => {
          const v = fn(r);
          const cls = l === 'Verdict' ? (r.pass ? 'ok' : 'bad') : '';
          return `<td class="${cls}">${v}</td>`;
        })
        .join('')}</tr>`
  ).join('');
  const charts = list
    .map(
      (r) =>
        `<div class="ch"><h3>${r.typeLabel} · ${r.ts} — p95 ${r.m.p95}ms · ${r.pass ? 'PASS' : 'FAIL'}</h3><svg viewBox="0 0 560 80" preserveAspectRatio="none"><polyline points="${sparkPath(r.latSeries, 560, 80)}" fill="none" stroke="#4d9fff" stroke-width="2"/></svg></div>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Touchstone — consolidated report (${list.length} runs)</title>
<style>
  body{margin:0;background:#15181c;color:#e6edf3;font-family:'Google Sans Code',ui-monospace,monospace;font-size:13px;padding:32px}
  .wrap{max-width:860px;margin:0 auto}h1{font-size:18px;margin:0 0 2px}.sub{color:#97a3ae;font-size:12px;margin-bottom:22px}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}th,td{padding:8px 10px;border-bottom:1px solid #272d34;font-size:12px;text-align:right}
  th{color:#97a3ae;font-weight:600;vertical-align:bottom}.ml{text-align:left;color:#626d77}td.ml{color:#97a3ae}
  th .ts{color:#626d77;font-weight:400;font-size:10px}.ok{color:#46d27a;font-weight:700}.bad{color:#ef6b6b;font-weight:700}
  .ch{border:1px solid #272d34;border-radius:8px;padding:12px;margin-bottom:10px}.ch h3{margin:0 0 8px;font-size:12px;color:#97a3ae;font-weight:600}svg{width:100%;height:80px;display:block}
  .foot{color:#626d77;font-size:11px;margin-top:24px}
</style></head><body><div class="wrap">
  <h1>QA Touchstone · consolidated report</h1>
  <div class="sub">${list.length} runs · generated ${new Date().toLocaleString()}</div>
  <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  <h2 style="font-size:14px;color:#97a3ae;margin:0 0 12px">Response time (p50) per run</h2>
  ${charts}
  <div class="foot">Generated by QA Touchstone. Load figures are from simulated runs.</div>
</div></body></html>`;
}

function exportRuns(list: PerfRun[], fmt: string): void {
  if (!list.length) return;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
  const base = `qa-perf-report-${list.length}runs-${stamp}`;
  if (fmt === 'json') {
    downloadFile(base + '.json', JSON.stringify(list, null, 2), 'application/json');
    return;
  }
  if (fmt === 'html') {
    downloadFile(base + '.html', buildMultiReportHtml(list), 'text/html');
    return;
  }
  const head = 'metric,' + list.map((r) => `"${r.typeLabel} ${r.ts}"`).join(',');
  const lines = [head, ...CMP_ROWS.map(([l, fn]) => `${l},` + list.map((r) => fn(r)).join(','))];
  downloadFile(base + '.csv', lines.join('\n'), 'text/csv');
}

// Format a seconds value for the time axis: 8 -> "8s", 63 -> "63s".
const fmtSecs = (s: number) => `${Math.round(s)}s`;

interface ChartProps {
  pts: number[];
  max: number;
  color: string;
  label: string;
  unit: string;
  dur: number;
  emptyLabel?: string;
}

function Chart({ pts, max, color, label, unit, dur, emptyLabel = 'No data yet' }: ChartProps) {
  const [hover, setHover] = usePF<{
    i: number;
    leftPct: number;
    topPct: number;
    t: number;
    v: number;
  } | null>(null); // { i, leftPct, topPct, t, v } | null
  const n = pts.length;
  const coords = pts.map((v, i): [number, number] => [
    (i / Math.max(1, N_POINTS - 1)) * 100,
    100 - (Math.min(v, max) / max) * 100,
  ]);
  const line = coords.map((c) => `${c[0].toFixed(2)},${c[1].toFixed(2)}`).join(' ');
  const last = coords[n - 1];
  const area = n >= 2 && last ? `0,100 ${line} ${last[0].toFixed(2)},100` : '';

  // Y-axis tick values, top (max) -> bottom (0), aligned with the 25/50/75 grid.
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
  // X-axis time ticks across the run duration.
  const total = dur || 0;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => total * f);

  // Map a pointer position to the nearest sample bin, then show a guide + tip.
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const i = Math.round(fx * (N_POINTS - 1));
    const v = pts[i] || 0;
    setHover({
      i,
      leftPct: (i / (N_POINTS - 1)) * 100,
      topPct: 100 - (Math.min(v, max) / max) * 100,
      t: (i / (N_POINTS - 1)) * total,
      v,
    });
  };

  return (
    <div className="pf-chart">
      <div className="pf-chart-head">
        <span>{label}</span>
        <span className="pf-chart-max">
          {Math.round(max)}
          {unit}
        </span>
      </div>
      <div className="pf-chart-plot">
        <div className="pf-chart-yaxis">
          {yTicks.map((t, i) => (
            <span key={i}>{t.toLocaleString()}</span>
          ))}
        </div>
        <div className="pf-chart-box" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pf-chart-svg">
            {[25, 50, 75].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} className="pf-grid" />
            ))}
            {n >= 2 && <polygon points={area} fill={color} opacity="0.12" />}
            {n >= 2 && (
              <polyline
                points={line}
                fill="none"
                stroke={color}
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {hover && (
            <>
              <div className="pf-chart-guide" style={{ left: `${hover.leftPct}%` }} />
              <div
                className="pf-chart-dot"
                style={{ left: `${hover.leftPct}%`, top: `${hover.topPct}%`, background: color }}
              />
              <div
                className="pf-chart-tip"
                style={{
                  left: `${Math.min(88, Math.max(12, hover.leftPct))}%`,
                  top: `${hover.topPct}%`,
                }}
              >
                <b>
                  {Math.round(hover.v).toLocaleString()}
                  {unit}
                </b>{' '}
                <em>@ {fmtSecs(hover.t)}</em>
              </div>
            </>
          )}
          {n < 2 && <div className="pf-chart-empty">{emptyLabel}</div>}
        </div>
      </div>
      <div className="pf-chart-xaxis">
        {xTicks.map((t, i) => (
          <span key={i}>{fmtSecs(t)}</span>
        ))}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  unit: string;
  accent?: boolean;
  delta?: number | null;
  better?: 'low' | 'high';
}

function Stat({ label, value, unit, accent, delta, better }: StatProps) {
  let cls = '',
    arrow = '';
  if (delta != null && delta !== 0) {
    const good = better === 'low' ? delta < 0 : delta > 0;
    cls = good ? 'pf-d-good' : 'pf-d-bad';
    arrow = delta > 0 ? '▲' : '▼';
  }
  return (
    <div className="pf-stat">
      <div className="pf-stat-label">{label}</div>
      <div className="pf-stat-value" style={accent ? { color: 'var(--accent)' } : (null as any)}>
        {value}
        <em>{unit}</em>
      </div>
      {delta != null && delta !== 0 && (
        <div className={'pf-stat-delta ' + cls}>
          {arrow} {Math.abs(Math.round(delta)).toLocaleString()}
          {unit}
        </div>
      )}
    </div>
  );
}

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
  width?: number | string;
}

function Stepper({ value, onChange, min = 0, disabled, width = 110 }: StepperProps) {
  return (
    <input
      className="pf-num"
      type="number"
      value={value}
      min={min}
      disabled={disabled}
      style={{ width }}
      onChange={(e) => onChange(Math.max(min, +e.target.value || 0))}
    />
  );
}

export interface PerfTestProps {
  env?: QaEnv;
  vars?: any;
  onRunningChange?: (running: boolean) => void;
}

function PerfTest({ env, vars, onRunningChange }: PerfTestProps) {
  const { t } = useI18n();
  const [targetCollection, setTargetCollection] = usePF<string>(
    () => window.QA.COLLECTIONS[0]?.id || ''
  );
  const [target, setTarget] = usePF('usr-list');
  const [type, setType] = usePF<PerfType>('load');
  const [stages, setStages] = usePF<K6Stage[]>(() => clone(TYPE_META.load.stages));
  const [conn, setConn] = usePF({ ...DEFAULT_CONN });
  const [slo, setSlo] = usePF<K6Slo>({ ...TYPE_META.load.slo });
  const [phase, setPhase] = usePF<PerfPhase>('idle');
  const [progress, setProgress] = usePF(0);
  const [live, setLive] = usePF<PerfView | null>(null);
  const [runs, setRuns] = usePF<PerfRun[]>(() => loadJSON<PerfRun[]>(PERF_KEY, []) as PerfRun[]);
  const [viewIdx, setViewIdx] = usePF(0);
  const [selected, setSelected] = usePF<number[]>([]);
  const [hMenu, setHMenu] = usePF(false);
  const acc = useRefPF<Partial<PerfSession> | null>({});
  const stoppedRef = useRefPF(false);
  // Synchronous guard against fast double-clicks on Start. Phase-based
  // `running` only flips after React commits — between two rapid clicks the
  // second can still pass the gate, await writeTempText, then race the first
  // to set acc.current. This ref is set in the same tick as the gate check.
  const startingRef = useRefPF(false);
  // Tracks whether the component is still mounted across `await` gaps. If we
  // navigate away in the small window before acc.current is assigned, the
  // existing useEffect-cleanup has nothing to stop — we'd still launch k6
  // and setState on an unmounted component.
  const mountedRef = useRefPF(true);
  const collections = pfCollectionOptions();
  const activeCollection = collections.some((c) => c.value === targetCollection)
    ? targetCollection
    : collections[0]?.value || '';
  const flat = pfTargets(activeCollection);
  const targetIds = flat.map((r) => r.value).join('|');

  useEffPF(() => {
    if (activeCollection !== targetCollection) {
      setTargetCollection(activeCollection);
      return;
    }
    const firstFlat = flat[0];
    if (firstFlat && !flat.some((r) => r.value === target)) {
      setTarget(firstFlat.value);
    }
  }, [activeCollection, targetCollection, target, targetIds]);

  const pickType = (t: PerfType) => {
    setType(t);
    setStages(clone(TYPE_META[t].stages));
    setSlo({ ...TYPE_META[t].slo });
  };

  const setStage = (i: number, k: 'd' | 't', v: number) =>
    setStages((s) => s.map((st, idx) => (idx === i ? { ...st, [k]: Math.max(0, +v || 0) } : st)));
  const addStage = () => setStages((s) => [...s, { d: 10, t: 50 }]);
  const delStage = (i: number) =>
    setStages((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));

  const toggleSel = (i: number) =>
    setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  const total = stages.reduce((s, st) => s + (+st.d || 0), 0);
  // Apply the Max-connections cap up front so the script, the chart, the
  // history row, and the CSV/JSON exports all agree on the effective peak.
  // Capping inside k6gen alone would mean "Peak 50 VUs" in the report while
  // k6 actually ran 10.
  const connCap = +conn.maxConns > 0 ? Math.floor(+conn.maxConns) : Infinity;
  const effStages = stages.map((st) => ({
    ...st,
    t: Math.max(0, Math.min(connCap, Math.floor(+st.t || 0))),
  }));
  const maxVus = Math.max(0, ...effStages.map((st) => +st.t || 0));
  const running = phase === 'running';

  // Report run state up so the app shell can react (e.g. the brand mark in the
  // nav rail glows green while a load test is in flight). Reset on unmount so
  // leaving the Performance route clears it.
  useEffPF(() => {
    if (onRunningChange) onRunningChange(running);
    return () => {
      if (onRunningChange) onRunningChange(false);
    };
  }, [running, onRunningChange]);

  // Hand off the load to k6 (must be on PATH). The chart and SLO scoring read
  // real samples streamed back from `k6 run --out json=-`. stop() only flags
  // the session and asks Rust to kill k6 — the run() loop transitions phase
  // when it actually finishes, so a quick re-Start can't race the previous
  // session's finalizer.
  const stop = () => {
    if (acc.current) stoppedRef.current = true;
    try {
      Promise.resolve(api.stopCommand()).catch(() => {});
    } catch {}
  };

  const clearHistory = () => {
    // With rows checked, "Clear" acts on the selection only (mirrors Export):
    // drop the selected runs, keep the rest, and leave any in-flight run alone.
    if (selected.length) {
      const drop = new Set(selected);
      const remaining = runs.filter((_, i) => !drop.has(i));
      setRuns(remaining);
      if (remaining.length) saveJSON(PERF_KEY, remaining);
      else removeStorageKey(PERF_KEY);
      // Keep viewing the same run if it survived; otherwise show the newest.
      setViewIdx((idx) => {
        if (drop.has(idx)) return 0;
        let shift = 0;
        for (const s of selected) if (s < idx) shift += 1;
        return Math.max(0, idx - shift);
      });
      setSelected([]);
      setHMenu(false);
      return;
    }
    // Nothing selected → wipe the whole history. If a run is in flight, ask it
    // to stop but DO NOT race it: let the session finalizer transition phase +
    // clear acc.current itself. Wiping phase to 'idle' here would let the user
    // kick off a new run before the old one resolves (the old finalizer would
    // then clobber UI / state).
    stop();
    setRuns([]);
    setSelected([]);
    setHMenu(false);
    if (!acc.current) {
      setLive(null);
      setPhase('idle');
    }
    removeStorageKey(PERF_KEY);
  };

  // Abort any in-flight k6 process if the user leaves the Performance route.
  // Also flip mountedRef so the run() coroutine can bail after its await
  // points even if acc.current hasn't been assigned yet.
  // The setup MUST restore mountedRef=true: under React.StrictMode the mount
  // runs setup→cleanup→setup, so a cleanup-only effect would leave mountedRef
  // stuck false and make run() bail right after `await writeTempText` (before
  // setPhase('running')) — i.e. the Run button does nothing in dev builds.
  useEffPF(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (acc.current) stoppedRef.current = true;
      try {
        Promise.resolve(api.stopCommand()).catch(() => {});
      } catch {}
    };
  }, []);

  const run = async () => {
    if (running) {
      stop();
      return;
    }
    if (startingRef.current) return;
    if (total <= 0 || !tgt) return;
    startingRef.current = true;
    try {
      const reqEntry = window.QA.COLLECTIONS.flatMap((c: any) =>
        c.folders.flatMap((f: any) => f.requests)
      ).find((r: any) => r.id === tgt.value);
      if (!reqEntry) return;
      const det = window.QA.REQUEST_DETAILS[tgt.value] || {};

      // Active variable map (globals → environment → collection). PerfTest
      // doesn't track per-request locals, so we pass an empty locals map.
      const envObj = env || { label: 'None', baseUrl: '' };
      const varsObj = vars || window.QA.VARIABLES;
      const collectionId = pfCollectionOf(tgt.value);
      const activeMap = window.qaVarMap
        ? window.qaVarMap(varsObj, envObj.label, collectionId, {})
        : {};
      const sub = (t: string | null | undefined) =>
        window.qaSubstitute ? window.qaSubstitute(t || '', activeMap) : t || '';

      // Resolve the URL the same way buildReq + the live executor do: drop the
      // query from the stored path (det.params is the source of truth after
      // import), substitute, classify absolute vs relative, then prepend the
      // env baseUrl for relative URLs and re-append params at the end. Stripping
      // the query first prevents duplicating it when the importer also parsed
      // the same `?name=michael` into det.params.
      const rawPath = (reqEntry.path || '').split('?')[0];
      const rawUrl = sub(rawPath);
      const isAbsolute = /^https?:\/\//i.test(rawUrl);
      let url = isAbsolute ? rawUrl : sub(envObj.baseUrl || '') + rawUrl;
      const qParts = (det.params || [])
        .filter((p: any) => p && p.on && p.key)
        .map(
          (p: any) => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value || ''))}`
        );
      if (qParts.length) url += (url.includes('?') ? '&' : '?') + qParts.join('&');
      if (!isAbsolute && !/^https?:\/\//i.test(url)) {
        // No env baseUrl and a relative path → k6 will fail with bad URL. Surface
        // this up front instead of silently letting k6 produce zero samples.
        setLive({
          m: { sent: 0, rps: 0, avg: 0, p80: 0, p90: 0, p95: 0, p99: 0, err: 0 },
          latSeries: [],
          rpsSeries: [],
          dist: { ok: 0, c4: 0, c5: 0, net: 0 },
          broke: null,
          slo: { ...slo },
          error: `Request URL is relative (${url}) and no environment baseUrl is set.`,
        });
        setPhase('done');
        return;
      }

      const hdrSrc =
        det.headers && det.headers.length
          ? det.headers
          : [{ key: 'Accept', value: 'application/json', on: true }];
      const headers = hdrSrc
        .filter((h: any) => h && h.on && h.key)
        .map((h: any) => ({ key: sub(h.key), value: sub(h.value || ''), on: true }));
      const body = det.body ? sub(det.body) : null;
      const reqShape = { method: tgt.method, url, headers, body };

      let scriptPath: any;
      try {
        scriptPath = await api.writeTempText(buildScript(reqShape, effStages, conn), 'js');
      } catch (e) {
        if (mountedRef.current) {
          setLive({
            m: { sent: 0, rps: 0, avg: 0, p80: 0, p90: 0, p95: 0, p99: 0, err: 0 },
            latSeries: [],
            rpsSeries: [],
            dist: { ok: 0, c4: 0, c5: 0, net: 0 },
            broke: null,
            slo: { ...slo },
            error: 'Failed to write k6 script: ' + String(e),
          });
          setPhase('done');
        }
        return;
      }
      // The user might have navigated away while writeTempText was awaited.
      // Don't launch k6 against a dead component — clean up the temp file
      // we already created and bail out before assigning acc.current.
      if (!mountedRef.current) {
        api.cleanupTempFile(scriptPath).catch(() => {});
        return;
      }

      const dtMs = (total / N_POINTS) * 1000;
      const state = makeState(dtMs, N_POINTS);
      const session: PerfSession = { state, scriptPath, buffer: '' };
      stoppedRef.current = false;
      acc.current = session;
      setProgress(0);
      setViewIdx(0);
      setPhase('running');
      setLive(snapshot(state, slo));

      let lastFlushMs = 0;
      const flush = () => {
        setLive(snapshot(state, slo));
        const lastFilled = state.bins.reduce((lo, b, i) => (b.lat.length > 0 ? i + 1 : lo), 0);
        setProgress(Math.min(1, lastFilled / N_POINTS));
      };
      const onChunk = (chunk: unknown) => {
        if (stoppedRef.current) return;
        session.buffer += String(chunk || '');
        const nl = session.buffer.lastIndexOf('\n');
        if (nl < 0) return;
        const ready = session.buffer.slice(0, nl);
        session.buffer = session.buffer.slice(nl + 1);
        for (const line of ready.split(/\r?\n/)) if (line) feed(state, line);
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - lastFlushMs > 150) {
          lastFlushMs = now;
          flush();
        }
      };

      // k6 v2.0+ replaced --no-summary with --summary-mode disabled.
      // --out json=- streams ndjson Point records to stdout (verified manually).
      // The Tauri bridge only accepts this fixed k6 shape.
      const args = ['run', '--quiet', '--summary-mode', 'disabled', '--out', 'json=-', scriptPath];
      let runErr: any = null;
      let exitCode: any = null;
      try {
        exitCode = await api.runK6WithRealTimeOutput(args, undefined, onChunk);
      } catch (e) {
        runErr = e;
      }
      // Always best-effort: delete the temp script.
      api.cleanupTempFile(scriptPath).catch(() => {});

      if (session.buffer) {
        for (const line of session.buffer.split(/\r?\n/)) if (line) feed(state, line);
      }
      const stoppedByUser = stoppedRef.current;
      // Only release the slot if this session still owns it — guards against a
      // user quickly re-pressing Start before the previous run's finally lands.
      if (acc.current === session) acc.current = null;
      // If the user navigated away while k6 was running, the cleanup effect has
      // already fired — don't push state into an unmounted component.
      if (!mountedRef.current) return;
      if (stoppedByUser) {
        // User aborted — don't record a partial run as if it completed.
        setLive(null);
        setProgress(0);
        setPhase('idle');
        return;
      }
      // run_k6 resolves with the numeric exit code; non-zero is a failure
      // even though the await did not throw.
      if (!runErr && exitCode != null && exitCode !== 0) {
        runErr = `k6 exited with code ${exitCode}`;
      }
      const final = snapshot(state, slo);
      if (runErr && final.m.sent === 0) {
        setLive({ ...final, error: 'k6 produced no metrics. ' + String(runErr) });
        setPhase('done');
        return;
      }
      const { p80, p90, p95, p99, err } = final.m;
      const sentSomething = final.m.sent > 0;
      const rows = [
        {
          label: t('perf.row.p80'),
          actual: p80,
          unit: 'ms',
          limit: slo.p80,
          pass: sentSomething && p80 <= slo.p80,
        },
        {
          label: t('perf.row.p90'),
          actual: p90,
          unit: 'ms',
          limit: slo.p90,
          pass: sentSomething && p90 <= slo.p90,
        },
        {
          label: t('perf.row.p95'),
          actual: p95,
          unit: 'ms',
          limit: slo.p95,
          pass: sentSomething && p95 <= slo.p95,
        },
        {
          label: t('perf.row.p99'),
          actual: p99,
          unit: 'ms',
          limit: slo.p99,
          pass: sentSomething && p99 <= slo.p99,
        },
        {
          label: t('perf.errorRate'),
          actual: err,
          unit: '%',
          limit: slo.err,
          pass: sentSomething && err <= slo.err,
        },
      ];
      const pass = sentSomething && !runErr && rows.every((r) => r.pass);
      const summary: PerfRun = {
        ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type,
        typeLabel: t(TYPE_META[type].labelKey),
        maxVus,
        dur: total,
        m: final.m,
        latSeries: final.latSeries,
        rpsSeries: final.rpsSeries,
        dist: final.dist,
        broke: final.broke,
        slo: { ...slo },
        rows,
        pass,
        error: runErr ? String(runErr) : null,
      };
      setLive(runErr ? { ...final, error: String(runErr) } : final);
      setProgress(1);
      setRuns((prev) => {
        const next = [summary, ...prev].slice(0, 8);
        saveJSON(PERF_KEY, next); // 失敗會 console.error + 發 qa-storage-error 事件
        return next;
      });
      setViewIdx(0);
      setPhase('done');
    } finally {
      // Release the synchronous start guard so a future Start can re-fire.
      startingRef.current = false;
    }
  };

  const tgt = flat.find((r) => r.value === target) || flat[0];
  const shown = running ? live : runs[viewIdx] || live;
  // Duration backing the charts' time axis: the live config total while running,
  // otherwise the viewed historical run's recorded duration (falls back to total).
  const chartDur = !running && shown && shown.dur ? shown.dur : total;
  const baseline = running ? null : runs[viewIdx + 1] || null;
  const dist = shown ? shown.dist : { ok: 0, c4: 0, c5: 0, net: 0 };
  // Historical runs persisted before the `net` bucket existed won't have it;
  // those kept their transport failures folded into c5, so default to 0 here.
  const netCount = dist.net || 0;
  const totalResp = dist.ok + dist.c4 + dist.c5 + netCount || 1;
  const maxLat = shown && shown.latSeries.length ? Math.max(200, ...shown.latSeries) * 1.1 : 200;
  const maxRps = shown && shown.rpsSeries.length ? Math.max(50, ...shown.rpsSeries) * 1.1 : 50;
  const d = (k: keyof K6Metrics) =>
    baseline && shown && !running ? shown.m[k] - baseline.m[k] : null;
  const activeTypeLabel = t(TYPE_META[type].labelKey);

  return (
    <div className="pf">
      <div className="pf-config">
        <div className="pf-config-head">
          <h2>{t('perf.heading', { type: activeTypeLabel })}</h2>
          <p>{t(TYPE_META[type].blurbKey)}</p>
        </div>

        <label className="qa-side-label">{t('perf.testType')}</label>
        <div className="pf-types">
          {Object.entries(TYPE_META).map(([k, meta]) => (
            <button
              key={k}
              className="pf-type"
              data-active={type === k ? '1' : '0'}
              onClick={() => !running && pickType(k as PerfType)}
              disabled={running}
            >
              <Icon name={meta.icon} size={17} />
              <span className="pf-type-name">{t(meta.labelKey)}</span>
            </button>
          ))}
        </div>

        <label className="qa-side-label" style={{ marginTop: 16 }}>
          {t('perf.collection')}
        </label>
        <Dropdown value={activeCollection} options={collections} onChange={setTargetCollection} />

        <label className="qa-side-label" style={{ marginTop: 16 }}>
          {t('perf.targetRequest')}
        </label>
        <Dropdown
          value={target}
          options={flat}
          onChange={setTarget}
          className="pf-target-dd"
          renderValue={(item) => <TargetRequestOption item={item as PerfTarget} />}
          renderOption={(item) => <TargetRequestOption item={item as PerfTarget} />}
        />

        <div className="pf-sec-label">
          <span>{t('perf.loadStages')}</span>
          <span className="qa-meta">{t('perf.stageMeta', { seconds: total, vus: maxVus })}</span>
        </div>
        <div className="pf-stages">
          <div className="pf-stage pf-stage--head">
            <span>{t('perf.duration')}</span>
            <span>{t('perf.targetVus')}</span>
            <span />
          </div>
          {stages.map((st, i) => (
            <div className="pf-stage" key={i}>
              <Stepper
                value={st.d}
                onChange={(v) => setStage(i, 'd', v)}
                min={1}
                disabled={running}
                width="100%"
              />
              <Stepper
                value={st.t}
                onChange={(v) => setStage(i, 't', v)}
                min={0}
                disabled={running}
                width="100%"
              />
              <button
                className="pf-stage-del"
                onClick={() => !running && delStage(i)}
                disabled={running || stages.length <= 1}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <button
            className="pf-stage-add"
            onClick={() => !running && addStage()}
            disabled={running}
          >
            <Icon name="plus" size={12} /> {t('perf.addStage')}
          </button>
        </div>

        <div className="pf-sec-label">
          <span>{t('perf.thresholds')}</span>
          <span className="qa-meta">{t('perf.slo')}</span>
        </div>
        <div className="pf-slo-grid">
          {(['p80', 'p90', 'p95', 'p99'] as const).map((k) => (
            <div className="pf-slo-cell" key={k}>
              <span>{k} ≤</span>
              <Stepper
                value={slo[k]}
                onChange={(v) => setSlo({ ...slo, [k]: v })}
                min={1}
                disabled={running}
                width="76px"
              />
            </div>
          ))}
        </div>
        <div className="pf-params" style={{ marginTop: 10 }}>
          <div className="pf-param">
            <span>
              {t('perf.errorRate')}
              <em>%</em>
            </span>
            <Stepper
              value={slo.err}
              onChange={(v) => setSlo({ ...slo, err: v })}
              min={0}
              disabled={running}
            />
          </div>
        </div>

        <div className="pf-sec-label">
          <span>{t('perf.connection')}</span>
        </div>
        <div className="pf-params">
          <div className="pf-param">
            <span>{t('perf.keepAlive')}</span>
            <button
              className="pf-toggle"
              data-on={conn.keepAlive ? '1' : '0'}
              disabled={running}
              onClick={() => setConn({ ...conn, keepAlive: !conn.keepAlive })}
            >
              <span />
            </button>
          </div>
          <div className="pf-param">
            <span>
              {t('perf.timeout')}
              <em>ms</em>
            </span>
            <Stepper
              value={conn.timeout}
              onChange={(v) => setConn({ ...conn, timeout: v })}
              min={1}
              disabled={running}
            />
          </div>
          <div className="pf-param">
            <span>{t('perf.maxConnections')}</span>
            <Stepper
              value={conn.maxConns}
              onChange={(v) => setConn({ ...conn, maxConns: v })}
              min={1}
              disabled={running}
            />
          </div>
        </div>

        <button className="pf-run" data-running={running ? '1' : '0'} onClick={run}>
          {running ? <Icon name="stop" size={15} /> : <Icon name="play" size={15} />}
          {running ? t('perf.stop') : t('perf.run')}
        </button>
        {phase !== 'idle' && (
          <div className="pf-prog">
            <div className="pf-prog-bar">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="pf-prog-meta">
              <span>
                {Math.round(progress * total)}s / {total}s
              </span>
              <span>{running ? t('perf.running') : t('perf.completed')}</span>
            </div>
          </div>
        )}
      </div>

      <div className="pf-results">
        {!shown ? (
          <div className="pf-empty">
            <div className="pf-empty-icon">
              <Icon name="gauge" size={28} stroke={1.5} />
            </div>
            <div className="pf-empty-title">{t('perf.emptyTitle')}</div>
            <div className="pf-empty-sub">
              {tgt && (
                <>
                  <MethodBadge method={tgt.method} size="sm" /> {tgt.name} · {maxVus} VUs · {total}s
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {!running && shown.rows && (
              <div className="pf-verdict" data-pass={shown.pass ? '1' : '0'}>
                <div className="pf-verdict-head">
                  <Icon name={shown.pass ? 'check' : 'x'} size={16} stroke={3} />
                  <strong>{shown.pass ? t('common.pass') : t('common.fail')}</strong>
                  <span>{t('perf.verdictAgainst')}</span>
                  {viewIdx > 0 && (
                    <span className="pf-viewing">{t('perf.viewing', { time: shown.ts })}</span>
                  )}
                </div>
                <div className="pf-vrows">
                  {shown.rows.map((r, i) => (
                    <div key={i} className="pf-vrow" data-pass={r.pass ? '1' : '0'}>
                      <Icon name={r.pass ? 'check' : 'x'} size={12} stroke={3} />
                      <span className="pf-vrow-label">{r.label}</span>
                      <strong>
                        {r.actual}
                        {r.unit}
                      </strong>
                      <span className="qa-meta">
                        {t('perf.limit', { value: `${r.limit}${r.unit}` })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {shown.broke && type === 'stress' && (
              <div className="pf-broke">
                <Icon name="zap" size={15} /> {t('perf.breaking')} <strong>~{shown.broke}s</strong>{' '}
                {t('perf.breakingTail')}
              </div>
            )}
            {baseline && (
              <div className="pf-cmp">
                <Icon name="history" size={12} />{' '}
                {t('perf.vsPrevious', { type: baseline.typeLabel, time: baseline.ts })}
              </div>
            )}

            <div className="pf-stats">
              <Stat label={t('perf.stat.requests')} value={shown.m.sent.toLocaleString()} unit="" />
              <Stat
                label={t('perf.stat.peakRps')}
                value={shown.m.rps.toLocaleString()}
                unit=""
                accent
                delta={d('rps')}
                better="high"
              />
              <Stat
                label={t('perf.stat.avg')}
                value={shown.m.avg}
                unit=" ms"
                delta={d('avg')}
                better="low"
              />
              <Stat label="p80" value={shown.m.p80} unit=" ms" delta={d('p80')} better="low" />
              <Stat label="p90" value={shown.m.p90} unit=" ms" delta={d('p90')} better="low" />
              <Stat label="p95" value={shown.m.p95} unit=" ms" delta={d('p95')} better="low" />
              <Stat label="p99" value={shown.m.p99} unit=" ms" delta={d('p99')} better="low" />
              <Stat
                label={t('perf.stat.errors')}
                value={shown.m.err}
                unit=" %"
                delta={d('err')}
                better="low"
              />
            </div>

            <div className="pf-charts">
              <Chart
                pts={shown.latSeries}
                max={maxLat}
                color="var(--accent)"
                label={t('perf.chart.latency')}
                unit=" ms"
                dur={chartDur}
                emptyLabel={t('perf.noDataYet')}
              />
              <Chart
                pts={shown.rpsSeries}
                max={maxRps}
                color="oklch(0.78 0.15 150)"
                label={t('perf.chart.rps')}
                unit=""
                dur={chartDur}
                emptyLabel={t('perf.noDataYet')}
              />
            </div>

            <div className="pf-dist">
              <div className="pf-dist-head">
                <span>{t('perf.statusDistribution')}</span>
                <span className="qa-meta">
                  {t('perf.responses', { count: totalResp.toLocaleString() })}
                </span>
              </div>
              <div className="pf-dist-bar">
                <span
                  style={{
                    width: `${(dist.ok / totalResp) * 100}%`,
                    background: 'oklch(0.76 0.15 150)',
                  }}
                />
                <span
                  style={{
                    width: `${(dist.c4 / totalResp) * 100}%`,
                    background: 'oklch(0.78 0.15 70)',
                  }}
                />
                <span
                  style={{
                    width: `${(dist.c5 / totalResp) * 100}%`,
                    background: 'oklch(0.68 0.18 18)',
                  }}
                />
                <span
                  style={{
                    width: `${(netCount / totalResp) * 100}%`,
                    background: 'oklch(0.62 0.02 260)',
                  }}
                />
              </div>
              <div className="pf-dist-legend">
                <span>
                  <i style={{ background: 'oklch(0.76 0.15 150)' }} /> 2xx ·{' '}
                  {dist.ok.toLocaleString()}
                </span>
                <span>
                  <i style={{ background: 'oklch(0.78 0.15 70)' }} /> 4xx ·{' '}
                  {dist.c4.toLocaleString()}
                </span>
                <span>
                  <i style={{ background: 'oklch(0.68 0.18 18)' }} /> 5xx ·{' '}
                  {dist.c5.toLocaleString()}
                </span>
                <span>
                  <i style={{ background: 'oklch(0.62 0.02 260)' }} /> {t('perf.network')} ·{' '}
                  {netCount.toLocaleString()}
                </span>
              </div>
            </div>

            {runs.length > 0 && (
              <div className="pf-history">
                <div className="pf-history-head">
                  <span>
                    <Icon name="history" size={13} /> {t('perf.runHistory')}
                  </span>
                  <div className="pf-history-actions">
                    <span className="qa-meta">
                      {selected.length
                        ? t('perf.selected', { count: selected.length })
                        : t('perf.runs', { count: runs.length })}
                    </span>
                    <div className="pf-export">
                      <button
                        className="pf-hbtn"
                        disabled={!selected.length}
                        onClick={() => setHMenu((m) => !m)}
                      >
                        <Icon name="download" size={13} />{' '}
                        {selected.length
                          ? t('perf.exportSelected', { count: selected.length })
                          : t('perf.export')}
                      </button>
                      {hMenu && selected.length > 0 && (
                        <div className="pf-export-menu">
                          {['json', 'csv', 'html'].map((f) => (
                            <button
                              key={f}
                              onClick={() => {
                                exportRuns(
                                  selected
                                    .slice()
                                    .sort((a, b) => a - b)
                                    .map((i) => runs[i])
                                    .filter((r): r is PerfRun => r != null),
                                  f
                                );
                                setHMenu(false);
                              }}
                            >
                              {t('perf.report', { format: f.toUpperCase() })}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="pf-hbtn pf-hbtn--danger" onClick={clearHistory}>
                      <Icon name="trash" size={13} />{' '}
                      {selected.length
                        ? t('perf.clearSelected', { count: selected.length })
                        : t('perf.clear')}
                    </button>
                  </div>
                </div>
                {runs.map((r, i) => (
                  <div
                    key={i}
                    className="pf-run-row"
                    data-active={!running && i === viewIdx ? '1' : '0'}
                  >
                    <span className="pf-run-check">
                      <MiniCheck on={selected.includes(i)} onClick={() => toggleSel(i)} />
                    </span>
                    <button className="pf-run-main" onClick={() => !running && setViewIdx(i)}>
                      <span className="pf-run-pass" data-pass={r.pass ? '1' : '0'}>
                        {r.pass ? t('common.pass') : t('common.fail')}
                      </span>
                      <span className="pf-run-type">{r.typeLabel}</span>
                      <span className="qa-meta pf-run-vus">{r.maxVus} VUs</span>
                      <span className="pf-run-metric">
                        p95 <strong>{r.m.p95}</strong>ms
                      </span>
                      <span className="pf-run-metric">
                        {t('perf.errShort')} <strong>{r.m.err}</strong>%
                      </span>
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
