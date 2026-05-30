// ── QA Touchstone — k6 ndjson metrics parser ───────────────────────────────
// Pure helper. Consumes k6's `--out json=-` ndjson stream line by line and
// produces the live/run state shape the chart and SLO grid already consume.

export function makeState(dtMs, nPoints) {
  return {
    dtMs, nPoints,
    runStartMs: null,
    bins: Array.from({ length: nPoints }, () => ({ count: 0, latSum: 0 })),
    allLat: [],
    ok: 0, c4: 0, c5: 0, netErr: 0,
  };
}

export function feed(state, line) {
  if (!line || typeof line !== 'string') return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (!obj || obj.type !== 'Point' || obj.metric !== 'http_req_duration') return;
  const data = obj.data || {};
  const value = +data.value;
  if (!isFinite(value)) return;
  const ts = Date.parse(data.time);
  if (!isFinite(ts)) return;
  if (state.runStartMs == null) state.runStartMs = ts;
  const binIdx = Math.min(state.nPoints - 1, Math.max(0, Math.floor((ts - state.runStartMs) / state.dtMs)));
  state.bins[binIdx].count += 1;
  state.bins[binIdx].latSum += value;
  state.allLat.push(value);
  const status = parseInt((data.tags && data.tags.status) || '0', 10);
  if (status >= 200 && status < 300) state.ok += 1;
  else if (status >= 400 && status < 500) state.c4 += 1;
  else if (status >= 500) state.c5 += 1;
  else state.netErr += 1;
}

export function snapshot(state, slo) {
  const dtSec = state.dtMs / 1000;
  const latSeries = state.bins.map((b) => (b.count > 0 ? Math.round(b.latSum / b.count) : 0));
  const rpsSeries = state.bins.map((b) => Math.round(b.count / dtSec));
  const sorted = [...state.allLat].sort((a, b) => a - b);
  // Linear interpolation between order statistics — matches k6's trend
  // percentile (k6 v0.45+) and Postman/Grafana convention. Diverges from a
  // naive floor(n*q) on small N (e.g. p80 of 10 samples = 82, not 90).
  const pct = (q) => {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(sorted.length - 1, lo + 1);
    const frac = pos - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  };
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
    dist: { ok: state.ok, c4: state.c4, c5: state.c5 + state.netErr },
    broke: null,
    slo: { ...slo },
  };
}
