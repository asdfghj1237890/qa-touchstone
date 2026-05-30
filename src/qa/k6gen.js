// ── QA Touchstone — k6 script generator ────────────────────────────────────
// Pure helper. Given a request (method, url, headers, body), the stages
// array, and the connection settings, returns a k6 script string ready to
// hand to `k6 run`.

function fmtStages(stages) {
  return (stages || []).map((s) => {
    const d = Math.max(0, Math.floor(+s.d || 0));
    const t = Math.max(0, Math.floor(+s.t || 0));
    return `{ duration: '${d}s', target: ${t} }`;
  }).join(', ');
}

function fmtHeaders(headers, hasJsonBody) {
  const obj = {};
  (headers || []).filter((h) => h && h.on && h.key).forEach((h) => { obj[h.key] = h.value || ''; });
  if (hasJsonBody && !Object.keys(obj).some((k) => k.toLowerCase() === 'content-type')) {
    obj['Content-Type'] = 'application/json';
  }
  return obj;
}

export function buildScript({ method, url, headers, body }, stages, conn = {}) {
  const m = (method || 'GET').toUpperCase();
  const noBodyMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const hasBody = body != null && body !== '' && !noBodyMethods.has(m);
  const headerObj = fmtHeaders(headers, hasBody);
  const timeoutSec = Math.max(1, Math.floor((+conn.timeout || 30000) / 1000));
  const bodyExpr = hasBody ? JSON.stringify(body) : 'null';
  return `import http from 'k6/http';

export const options = {
  stages: [${fmtStages(stages)}],
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
