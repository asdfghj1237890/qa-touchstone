import { describe, it, expect } from 'vitest';
import { buildScript } from '../qa/k6gen.js';
import { makeState, feed, snapshot } from '../qa/k6parse.js';

describe('k6gen.buildScript', () => {
  const stages = [{ d: 8, t: 10 }, { d: 30, t: 10 }, { d: 4, t: 0 }];

  it('emits a GET script with no body and Accept header', () => {
    const s = buildScript(
      { method: 'GET', url: 'https://catfact.ninja/fact', headers: [{ key: 'Accept', value: 'application/json', on: true }], body: null },
      stages, { timeout: 30000 }
    );
    expect(s).toContain(`http.request("GET", url, body, params);`);
    expect(s).toContain(`const url = "https://catfact.ninja/fact";`);
    expect(s).toContain(`"Accept":"application/json"`);
    expect(s).toContain(`const body = null;`);
    expect(s).toContain(`{ duration: '8s', target: 10 }`);
    expect(s).toContain(`{ duration: '30s', target: 10 }`);
    expect(s).toContain(`{ duration: '4s', target: 0 }`);
    expect(s).toContain(`timeout: '30s'`);
  });

  it('emits a POST script with a JSON body and auto Content-Type', () => {
    const body = '{ "name": "QA Touchstone", "id": 42 }';
    const s = buildScript(
      { method: 'POST', url: 'https://httpbin.org/post', headers: [], body },
      [{ d: 5, t: 3 }], { timeout: 10000 }
    );
    expect(s).toContain(`http.request("POST", url, body, params);`);
    expect(s).toContain(`"Content-Type":"application/json"`);
    expect(s).toContain(`const body = ${JSON.stringify(body)};`);
    expect(s).toContain(`timeout: '10s'`);
  });

  it('does not send a body for GET/HEAD/OPTIONS even if one is provided', () => {
    const s = buildScript(
      { method: 'GET', url: 'https://x/y', headers: [], body: '{"a":1}' },
      [{ d: 1, t: 1 }], {}
    );
    expect(s).toContain(`const body = null;`);
    expect(s).not.toContain(`"Content-Type":"application/json"`);
  });

  it('skips headers with on=false', () => {
    const s = buildScript(
      { method: 'GET', url: 'https://x', headers: [{ key: 'X-Skip', value: 'no', on: false }, { key: 'X-Keep', value: 'yes', on: true }], body: null },
      [{ d: 1, t: 1 }], {}
    );
    expect(s).toContain(`"X-Keep":"yes"`);
    expect(s).not.toContain('X-Skip');
  });

  it('honours conn.keepAlive=false by emitting noConnectionReuse', () => {
    const off = buildScript({ method: 'GET', url: 'https://x', headers: [], body: null }, [{ d: 1, t: 1 }], { keepAlive: false });
    expect(off).toContain('noConnectionReuse: true');
    const on = buildScript({ method: 'GET', url: 'https://x', headers: [], body: null }, [{ d: 1, t: 1 }], { keepAlive: true });
    expect(on).not.toContain('noConnectionReuse');
  });

  it('emits per-stage targets verbatim — capping is the caller\'s job', () => {
    // buildScript no longer applies conn.maxConns; PerfTest caps stages
    // before calling so the UI / history / exports stay aligned with what
    // k6 actually runs.
    const s = buildScript({ method: 'GET', url: 'https://x', headers: [], body: null }, [{ d: 5, t: 50 }, { d: 10, t: 5 }], { maxConns: 10 });
    expect(s).toContain(`{ duration: '5s', target: 50 }`);
    expect(s).toContain(`{ duration: '10s', target: 5 }`);
  });
});

describe('k6parse.feed + snapshot', () => {
  const slo = { p80: 200, p90: 300, p95: 400, p99: 500, err: 1 };
  // bin width 1000 ms, 4 bins → total 4 s
  const mkLine = (t, value, status) => JSON.stringify({
    type: 'Point', metric: 'http_req_duration',
    data: { time: t, value, tags: { status: String(status) } },
  });

  it('bins latencies by time and counts statuses', () => {
    const st = makeState(1000, 4);
    feed(st, mkLine('2026-05-30T00:00:00.000Z', 100, 200));
    feed(st, mkLine('2026-05-30T00:00:00.500Z', 200, 200));
    feed(st, mkLine('2026-05-30T00:00:01.200Z', 300, 404));
    feed(st, mkLine('2026-05-30T00:00:03.900Z', 500, 500));
    const snap = snapshot(st, slo);
    expect(snap.latSeries).toEqual([150, 300, 0, 500]); // avg per bin
    expect(snap.rpsSeries).toEqual([2, 1, 0, 1]);
    expect(snap.dist).toEqual({ ok: 2, c4: 1, c5: 1 });
    expect(snap.m.sent).toBe(4);
    // err% = 2/4 = 50%
    expect(snap.m.err).toBe(50);
  });

  it('ignores non-Point lines and bad JSON', () => {
    const st = makeState(1000, 2);
    feed(st, 'not json');
    feed(st, JSON.stringify({ type: 'Metric', metric: 'http_req_duration', data: {} }));
    feed(st, JSON.stringify({ type: 'Point', metric: 'vus', data: { time: '2026-05-30T00:00:00Z', value: 5 } }));
    feed(st, mkLine('2026-05-30T00:00:00.000Z', 80, 200));
    const snap = snapshot(st, slo);
    expect(snap.m.sent).toBe(1);
    expect(snap.latSeries[0]).toBe(80);
  });

  it('computes percentiles via k6-style linear interpolation', () => {
    const st = makeState(1000, 1);
    // 10 samples: 10,20,30,...,100. With interpolation:
    //   pos(0.80) = 0.8*(10-1) = 7.2 → 80 + 0.2*(90-80) = 82
    //   pos(0.90) = 0.9*(10-1) = 8.1 → 90 + 0.1*(100-90) = 91
    //   pos(0.99) = 0.99*(10-1) = 8.91 → 90 + 0.91*(100-90) = 99.1 → round 99
    for (let i = 1; i <= 10; i++) feed(st, mkLine(`2026-05-30T00:00:00.00${i}Z`, i * 10, 200));
    const snap = snapshot(st, slo);
    expect(snap.m.p80).toBe(82);
    expect(snap.m.p90).toBe(91);
    expect(snap.m.p99).toBe(99);
    expect(snap.m.sent).toBe(10);
    expect(snap.m.err).toBe(0);
  });

  it('counts a status of 0 as a network error and rolls into c5', () => {
    const st = makeState(1000, 1);
    feed(st, mkLine('2026-05-30T00:00:00.000Z', 99, 0));
    const snap = snapshot(st, slo);
    expect(snap.dist).toEqual({ ok: 0, c4: 0, c5: 1 });
    expect(snap.m.err).toBe(100);
  });
});
