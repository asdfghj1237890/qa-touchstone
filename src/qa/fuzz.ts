// ── QA Touchstone — input fuzzing engine (pure logic, no React) ──────────────
// Mutate a request's inputs with boundary + injection payloads, fire them through
// an injected runner, and flag responses that reveal a problem: a 5xx the input
// caused, a leaked stack trace / SQL error, or a dangerous payload reflected back
// verbatim. The UI builds + executes; this module decides what is a finding.
import './setup';
import type { Finding, QaResponse, Severity } from './types';

/** A boundary or injection payload. `dangerous` tags ones whose reflection matters. */
export interface FuzzPayload {
  id: string;
  value: string;
  dangerous?: 'sqli' | 'xss' | 'traversal' | 'format' | 'overflow';
}

// A real NUL / RTL-override are built via fromCharCode so the source stays clean
// ASCII text (a literal control byte would make the file read as binary).
const NUL = String.fromCharCode(0);
const RTL_OVERRIDE = String.fromCharCode(0x202e);

export const FUZZ_PAYLOADS: FuzzPayload[] = [
  { id: 'empty', value: '' },
  { id: 'space', value: '   ' },
  { id: 'long', value: 'A'.repeat(8192) },
  { id: 'null-byte', value: 'x' + NUL + 'y' },
  { id: 'neg', value: '-1' },
  { id: 'big-int', value: '999999999999999999999999', dangerous: 'overflow' },
  { id: 'sqli', value: "' OR '1'='1", dangerous: 'sqli' },
  { id: 'sqli-comment', value: '1;--', dangerous: 'sqli' },
  { id: 'xss', value: '<script>alert(1)</script>', dangerous: 'xss' },
  { id: 'path-traversal', value: '../../../../etc/passwd', dangerous: 'traversal' },
  { id: 'format-string', value: '%s%n%x%x', dangerous: 'format' },
  { id: 'unicode-rtl', value: RTL_OVERRIDE + 'abc' },
];

/** A single fuzz case: one payload bound to one seed input location. */
export interface FuzzCase {
  seedName: string;
  location: unknown;
  payload: FuzzPayload;
}

export interface FuzzSeed {
  name: string;
  location: unknown;
  value?: string;
}
export interface FuzzPlan {
  method: string;
  path: string;
  seeds: FuzzSeed[];
}

export type FuzzSignal = 'server-error' | 'error-leak' | 'reflected' | 'ok';
export interface FuzzVerdict {
  signal: FuzzSignal;
  severity: Severity | null;
}

// Stack-trace / SQL-error / framework-error signatures. A response that echoes one
// of these is leaking internals (and usually means the payload reached a sink).
const ERROR_SIGNATURES: RegExp[] = [
  /\bat [\w$.]+\([^)]*:\d+(?::\d+)?\)/, // JS / Java "at fn (file:line)"
  /Traceback \(most recent call last\)/, // Python
  /\b(?:SQL syntax|SQLSTATE|SQLException|ORA-\d{5}|PG::\w+|near ".+": syntax error)\b/i, // SQL
  /\bjava\.lang\.\w+(?:Exception|Error)\b/, // JVM
  /\bSystem\.\w+Exception\b/, // .NET
  /<b>(?:Warning|Fatal error|Notice|Parse error)<\/b>:/, // PHP
  /goroutine \d+ \[/, // Go panic
  /\bUnhandledPromiseRejection\b|\bECONNREFUSED\b/, // Node-ish
];

function bodyToString(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

// Expand one seed into a case per payload.
export function fuzzCasesFor(seed: FuzzSeed): FuzzCase[] {
  return FUZZ_PAYLOADS.map((payload) => ({
    seedName: seed.name,
    location: seed.location,
    payload,
  }));
}

// Classify a fuzzed response. Priority: a server error is the strongest signal,
// then an internals leak, then a dangerous payload reflected verbatim.
export function classifyFuzzResponse(
  payload: FuzzPayload | null | undefined,
  resp: QaResponse | null | undefined
): FuzzVerdict {
  const status = resp && typeof resp.status === 'number' ? resp.status : null;
  if (status != null && status >= 500) return { signal: 'server-error', severity: 'high' };

  const body = bodyToString(resp && resp.body);
  if (ERROR_SIGNATURES.some((re) => re.test(body)))
    return { signal: 'error-leak', severity: 'high' };

  if (payload && payload.dangerous && payload.value && body.includes(payload.value)) {
    return { signal: 'reflected', severity: payload.dangerous === 'xss' ? 'high' : 'medium' };
  }
  return { signal: 'ok', severity: null };
}

const SIGNAL_TITLE: Record<Exclude<FuzzSignal, 'ok'>, string> = {
  'server-error': 'Fuzz input caused a server error (5xx)',
  'error-leak': 'Fuzz input leaked an internal error / stack trace',
  reflected: 'Fuzz input reflected unescaped in the response',
};

// Build a finding for a fuzz case, or null when the response was handled cleanly.
export function fuzzFinding(
  meta: { method: string; path: string },
  fuzzCase: FuzzCase,
  resp: QaResponse | null | undefined
): Finding | null {
  const verdict = classifyFuzzResponse(fuzzCase.payload, resp);
  if (verdict.signal === 'ok' || !verdict.severity) return null;
  return {
    oracle: 'fuzz',
    ruleId: `fuzz:${verdict.signal}`,
    severity: verdict.severity,
    title: SIGNAL_TITLE[verdict.signal],
    path: `${meta.method} ${meta.path}`,
    evidence: `payload "${fuzzCase.payload.id}" on ${fuzzCase.seedName}`,
    source: 'rule',
  };
}

/** runFuzz 注入的執行器：runner(seed, payload) => Promise<resp>。 */
export type FuzzRunner = (
  seed: FuzzSeed,
  payload: FuzzPayload
) => Promise<QaResponse | null | undefined>;

// Fire every (seed × payload) case through the runner, collecting findings. Never
// throws out of the loop; a thrown case is recorded and skipped. Honors opts.signal.
export async function runFuzz(
  plan: FuzzPlan,
  runner: FuzzRunner,
  opts: { signal?: AbortSignal | null; onCase?: (c: FuzzCase, verdict: FuzzVerdict) => void } = {}
): Promise<{ findings: Finding[]; ran: number }> {
  const { signal, onCase } = opts;
  const findings: Finding[] = [];
  let ran = 0;
  for (const seed of plan.seeds || []) {
    for (const fuzzCase of fuzzCasesFor(seed)) {
      if (signal && signal.aborted) return { findings, ran };
      let resp: QaResponse | null | undefined = null;
      try {
        resp = await runner(seed, fuzzCase.payload);
      } catch {
        resp = null; // transport failure on a fuzz case is not itself a finding
      }
      ran++;
      const verdict = classifyFuzzResponse(fuzzCase.payload, resp);
      if (onCase) onCase(fuzzCase, verdict);
      const f = fuzzFinding(plan, fuzzCase, resp);
      if (f) findings.push(f);
    }
  }
  return { findings, ran };
}
