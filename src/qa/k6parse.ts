// ── QA Touchstone — k6 ndjson metrics parser ───────────────────────────────
// Pure helper. Consumes k6's `--out json=-` ndjson stream line by line and
// produces the live/run state shape the chart and SLO grid already consume.
//
// 折線圖時間序列的兩個設計，一起消除「末端假尖刺」：
//   1. 以「請求開始時間」分桶（見 feed）：避免 ramp-down 尾段才完成的慢請求
//      全被 clamp 進最後一桶。這是末端尖刺的主因。
//   2. 每桶取「中位數」而非平均（見 snapshot）：對桶內慢請求離群值穩健，且
//      與圖表「p50」標籤名實相符。
// 每桶因此保留個別延遲值（非僅總和）。全域百分位/狀態統計仍逐筆計入。

export interface K6Bin {
  lat: number[];
}

export interface K6ParseState {
  dtMs: number;
  nPoints: number;
  runStartMs: number | null;
  bins: K6Bin[];
  allLat: number[];
  ok: number;
  c4: number;
  c5: number;
  netErr: number;
}

export interface K6Slo {
  p80: number;
  p90: number;
  p95: number;
  p99: number;
  err: number;
}

export interface K6Metrics {
  sent: number;
  rps: number;
  avg: number;
  p80: number;
  p90: number;
  p95: number;
  p99: number;
  err: number;
}

export interface K6Distribution {
  ok: number;
  c4: number;
  c5: number;
  net: number;
}

export interface K6Snapshot {
  m: K6Metrics;
  latSeries: number[];
  rpsSeries: number[];
  dist: K6Distribution;
  broke: number | null;
  slo: K6Slo;
}

export function makeState(dtMs: number, nPoints: number): K6ParseState {
  return {
    dtMs, nPoints,
    runStartMs: null,
    bins: Array.from({ length: nPoints }, () => ({ lat: [] as number[] })),
    allLat: [],
    ok: 0, c4: 0, c5: 0, netErr: 0,
  };
}

// k6-style 線性內插分位數（v0.45+ / Postman / Grafana 慣例）。sorted 須已排序。
// 小 N 下與 floor(n*q) 不同（例如 10 筆的 p80 = 82，不是 90）。
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

export function feed(state: K6ParseState, line: string): void {
  if (!line || typeof line !== 'string') return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (!obj || obj.type !== 'Point' || obj.metric !== 'http_req_duration') return;
  const data = obj.data || {};
  const value = +data.value;
  if (!isFinite(value)) return;
  const ts = Date.parse(data.time);
  if (!isFinite(ts)) return;
  // 以「請求開始時間」分桶 = 完成時間(ts) − 持續時間(value)。k6 的
  // http_req_duration 以「完成時間」記錄；若照完成時間分桶，ramp-down 尾段
  // 在峰值下發出、於名目結尾後才完成的慢請求，會全 clamp 進最後一桶，畫出
  // 末端假尖刺（中位數也救不了，因為那一桶被慢請求灌滿）。改以開始時間歸位，
  // 把延遲歸到「負載實際施加」的時點；落在視窗外的（target=0 後不再有新請求，
  // 理論上極少）直接從折線丟棄，但仍計入下方全域百分位/狀態統計。
  const startMs = ts - value;
  if (state.runStartMs == null) state.runStartMs = startMs;
  const rawIdx = Math.floor((startMs - state.runStartMs) / state.dtMs);
  const binIdx = rawIdx < 0 ? 0 : rawIdx;
  if (binIdx < state.nPoints) state.bins[binIdx].lat.push(value);
  state.allLat.push(value);
  const status = parseInt((data.tags && data.tags.status) || '0', 10);
  if (status >= 200 && status < 300) state.ok += 1;
  else if (status >= 400 && status < 500) state.c4 += 1;
  else if (status >= 500) state.c5 += 1;
  else state.netErr += 1;
}

export function snapshot(state: K6ParseState, slo: K6Slo): K6Snapshot {
  const dtSec = state.dtMs / 1000;
  // 每桶取「中位數」而非平均：對 ramp-down 尾段稀疏桶內的慢請求離群值穩健，
  // 不會把一兩筆 7s 尾巴畫成假尖刺。
  const latSeries = state.bins.map((b) =>
    b.lat.length ? Math.round(quantile([...b.lat].sort((x, y) => x - y), 0.5)) : 0
  );
  const rpsSeries = state.bins.map((b) => Math.round(b.lat.length / dtSec));
  const sorted = [...state.allLat].sort((a, b) => a - b);
  const pct = (q: number): number => quantile(sorted, q);
  const sent = state.ok + state.c4 + state.c5 + state.netErr;
  const errCount = state.c4 + state.c5 + state.netErr;
  const err = sent ? (errCount / sent) * 100 : 0;
  const avg = state.allLat.length ? Math.round(state.allLat.reduce((s, x) => s + x, 0) / state.allLat.length) : 0;
  const peakRps = rpsSeries.length ? Math.max(0, ...rpsSeries) : 0;
  return {
    m: {
      sent, rps: peakRps, avg,
      p80: Math.round(pct(0.80)),
      p90: Math.round(pct(0.90)),
      p95: Math.round(pct(0.95)),
      p99: Math.round(pct(0.99)),
      err: +err.toFixed(2),
    },
    latSeries, rpsSeries,
    // Keep transport failures (status 0: timeout, connection refused, DNS,
    // TLS) in their own `net` bucket instead of folding them into c5. Folding
    // made an unreachable host read as "100% 5xx" — a server error it never
    // was. `net` still counts toward errCount / err% above.
    dist: { ok: state.ok, c4: state.c4, c5: state.c5, net: state.netErr },
    broke: null,
    slo: { ...slo },
  };
}
