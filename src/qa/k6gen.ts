// ── QA Touchstone — k6 script generator ────────────────────────────────────
// Pure helper. Given a request (method, url, headers, body), the stages
// array, and the connection settings, returns a k6 script string ready to
// hand to `k6 run`.

export interface K6Header {
  key: string;
  value?: string;
  on?: boolean;
}

export interface K6Request {
  method?: string;
  url?: string;
  headers?: K6Header[] | null;
  body?: string | null;
}

export interface K6Stage {
  /** duration (seconds) */
  d: number;
  /** target VUs */
  t: number;
}

export interface K6ConnOptions {
  keepAlive?: boolean;
  timeout?: number;
  maxConns?: number;
}

function fmtStages(stages: K6Stage[] | null | undefined): string {
  // Caller is responsible for any maxConns capping — PerfTest applies the
  // cap before building the script so the UI / history / exports report
  // the same effective VUs that k6 actually runs.
  return (stages || []).map((s) => {
    const d = Math.max(0, Math.floor(+s.d || 0));
    const t = Math.max(0, Math.floor(+s.t || 0));
    return `{ duration: '${d}s', target: ${t} }`;
  }).join(', ');
}

function fmtHeaders(headers: K6Header[] | null | undefined, hasJsonBody: boolean): Record<string, string> {
  const obj: Record<string, string> = {};
  (headers || []).filter((h) => h && h.on && h.key).forEach((h) => { obj[h.key] = h.value || ''; });
  if (hasJsonBody && !Object.keys(obj).some((k) => k.toLowerCase() === 'content-type')) {
    obj['Content-Type'] = 'application/json';
  }
  return obj;
}

export function buildScript({ method, url, headers, body }: K6Request, stages: K6Stage[], conn: K6ConnOptions = {}): string {
  const m = (method || 'GET').toUpperCase();
  const noBodyMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const hasBody = body != null && body !== '' && !noBodyMethods.has(m);
  const headerObj = fmtHeaders(headers, hasBody);
  const timeoutSec = Math.max(1, Math.floor((+conn.timeout! || 30000) / 1000));
  const bodyExpr = hasBody ? JSON.stringify(body) : 'null';
  // keepAlive=false → tell k6 to open a fresh TCP connection per iteration.
  // The k6 default reuses connections; flipping to noConnectionReuse exposes
  // the realistic cost of TLS handshake / TCP setup on every request.
  const noReuse = conn.keepAlive === false ? 'noConnectionReuse: true,\n  ' : '';
  return `import http from 'k6/http';

export const options = {
  ${noReuse}stages: [${fmtStages(stages)}],
  summaryTrendStats: ['avg','min','med','max','p(80)','p(90)','p(95)','p(99)'],
};

const url = ${JSON.stringify(url || '')};
const params = { headers: ${JSON.stringify(headerObj)}, timeout: '${timeoutSec}s' };
const body = ${bodyExpr};

export default function () {
  http.request(${JSON.stringify(m)}, url, body, params);
}
`;
}
