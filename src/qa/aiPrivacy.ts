// src/qa/aiPrivacy.js
// ── QA Touchstone — AI Privacy Mode (pure, no React/DOM/network) ────────────
// INVARIANTS: redaction never throws (on error, emit a fully-masked token, never
// raw). Structure-preserving body masking is the guarantee; the heuristic/regex
// layer is bonus detection, not the sole defense. AI Privacy Mode governs AI egress
// ONLY — clipboard/export/report redaction is separate (see securityReport.js).
import './setup';
import { snippetAround, headerVal } from './evidence';
import { TRIAGE_CATEGORIES } from './triageConstants';
import { loadJSON, saveJSON } from './storage';

/** AI Privacy Mode 設定（localStorage `qa_ai_privacy`）。 */
export interface PrivacyCfg {
  mode: 'full' | 'redacted' | 'local';
  lockdown: boolean;
  selfManagedAttested: boolean;
  customFieldNames: string[];
  customPatterns: string[];
}

/** classifyDestination 的結果（AI egress 目的地分類）。 */
export interface AiDestination {
  provider: string;
  label: string;
  host: string;
  isCloud: boolean;
  isPrivate: boolean;
  isLoopback: boolean;
}

/** 後端（Tauri）下發的 AI policy；欄位皆可省略。 */
export interface BackendAiPolicy {
  locked?: boolean;
  externalAllowed?: boolean;
  forcedMode?: string;
}

/** resolvePolicy 的結果。 */
export interface ResolvedPolicy {
  effectiveMode: 'full' | 'redacted' | 'local';
  externalAllowed: boolean;
  locked: boolean;
  source: string;
}

/** buildScrubber 產出的遮罩器。 */
export interface Scrubber {
  maskText(str: unknown): string;
}

/** redactBody 的結果：JSON（tree）或非 JSON 描述子（nonJson）。 */
export interface RedactedBody {
  tree?: any;
  truncated?: boolean;
  nonJson?: { contentType: string; byteLength: number };
}

/** AI_KINDS redact 的 ctx。 */
export interface AiKindContext {
  mode: 'full' | 'redacted' | 'local';
  scrubber?: Scrubber | null;
}

/** 一種 AI 用途（redact 負責去識別化，buildPrompt 組 prompt）。 */
export interface AiKind {
  redact(p: any, ctx: AiKindContext): any;
  buildPrompt(r: any): string;
}

export const PRIVACY_DEFAULT_CFG: PrivacyCfg = {
  mode: 'redacted',            // 'full' | 'redacted' | 'local'
  lockdown: false,
  selfManagedAttested: false,
  customFieldNames: [],
  customPatterns: [],
};

export function loadPrivacyCfg(): PrivacyCfg {
  const raw = loadJSON('qa_ai_privacy', {});
  return { ...PRIVACY_DEFAULT_CFG, ...(raw && typeof raw === 'object' ? raw : {}) };
}

export function savePrivacyCfg(cfg: Partial<PrivacyCfg> | null | undefined): void {
  saveJSON('qa_ai_privacy', { ...PRIVACY_DEFAULT_CFG, ...cfg });
}

const CLOUD_HOSTS = /(^|\.)(openai\.com|anthropic\.com|azure\.com|googleapis\.com|cohere\.ai|amazonaws\.com|mistral\.ai)$/i;

export function classifyDestination(cfg: { provider?: string; baseUrl?: string } | null | undefined): AiDestination {
  const provider = (cfg && cfg.provider) || 'builtin';
  if (provider === 'builtin') return { provider, label: 'Claude (built-in)', host: 'anthropic (built-in)', isCloud: true, isPrivate: false, isLoopback: false };
  if (provider === 'openai') return { provider, label: 'OpenAI', host: 'api.openai.com', isCloud: true, isPrivate: false, isLoopback: false };
  let host = '';
  try { host = new URL(cfg!.baseUrl!).hostname.replace(/^\[|\]$/g, ''); } catch { host = ''; }
  const isLoopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  const isPrivate = isLoopback || /\.local$|\.internal$/.test(host)
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const isCloud = !isPrivate && (CLOUD_HOSTS.test(host) || host.length > 0);
  return { provider, label: host || 'custom endpoint', host, isCloud, isPrivate, isLoopback };
}

export class EgressBlockedError extends Error {
  // 注意：不能用 class field 宣告（vite:react-babel 的 class-properties 轉換
  // 會改變欄位初始化順序 / 對 declare 欄位直接報錯），維持 JS 原樣只在
  // constructor 指派，型別以 as any 略過。
  constructor(key: string) { super(key); this.name = 'EgressBlockedError'; (this as any).key = key; }
}

export function resolvePolicy(cfg: Partial<PrivacyCfg> | null | undefined, backendPolicy?: BackendAiPolicy | null): ResolvedPolicy {
  const stored = cfg || PRIVACY_DEFAULT_CFG;
  const bp = backendPolicy || null;
  let mode = stored.mode || 'redacted';
  let locked = false;
  let source = 'user';
  if (stored.lockdown) { mode = 'local'; locked = true; source = 'lockdown-toggle'; }
  if (bp && (bp.locked || bp.externalAllowed === false || bp.forcedMode === 'local')) {
    mode = 'local'; locked = true; source = 'backend';
  }
  return { effectiveMode: mode, externalAllowed: mode !== 'local', locked, source };
}

export function assertEgressAllowed(effectiveMode: string, dest: AiDestination, cfg?: Partial<PrivacyCfg> | null): void {
  if (effectiveMode === 'full' || effectiveMode === 'redacted') return;
  // local: self-managed destinations only
  if (dest.isLoopback || dest.isPrivate) return;
  if (dest.provider === 'custom' && cfg && cfg.selfManagedAttested) return;
  throw new EgressBlockedError('ai.gate.localBlocked');
}

// Heuristic patterns. SECRET_VALUE mirrors evidence.js (kept local to avoid
// importing a non-exported const). Card detection uses Luhn (mirrors oracles.js)
// so random long digit runs (order ids, timestamps) are NOT masked.
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RE_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const RE_IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
const RE_TOKEN_PREFIX = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g;
const RE_SECRET = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b|\b[A-Za-z0-9_-]{40,}\b/g;
const RE_CARDISH = /\b(?:\d[ -]?){13,19}\b/g;
const RE_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const DEFAULT_DENY = ['customerId','customer_id','tenantId','tenant_id','email','userId','user_id','accountId','account_id','ssn','phone','password','authorization','token','secret','apiKey','api_key'];

function luhnValid(s: unknown): boolean {
  const d = String(s).replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// Non-global mirrors of the heuristic patterns, for whole-string secret/PII tests
// on object KEYS. (Reusing the /g regexes above with .test() would carry lastIndex
// state and yield alternating true/false across calls.)
const KEY_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const KEY_JWT = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/;
const KEY_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;
const KEY_OPAQUE = /[A-Za-z0-9_-]{40,}/;
const KEY_SSN = /\b\d{3}-\d{2}-\d{4}\b/;

// True when a string is itself secret/PII-shaped (email, JWT, token prefix, SSN,
// long opaque token, or a Luhn-valid card). Ordinary field names (customerId,
// email, items) are NOT flagged — they lack the secret SHAPE. Used to mask object
// KEYS on the AI-egress path only (evidence.js report scrub deliberately keeps keys).
export function looksSecret(str: unknown): boolean {
  const s = String(str == null ? '' : str);
  if (!s) return false;
  if (KEY_EMAIL.test(s) || KEY_JWT.test(s) || KEY_TOKEN.test(s) || KEY_SSN.test(s) || KEY_OPAQUE.test(s)) return true;
  const digits = s.replace(/[ -]/g, '');
  return /^\d{13,19}$/.test(digits) && luhnValid(digits);
}

const REDACTED_KEY = '<redacted-key>';
// Post-process a masked tree, replacing any object KEY that is itself secret/PII-
// shaped with a placeholder. Array indices and (already-masked) values are left
// untouched. Colliding masked siblings get a numeric suffix so child count — the
// structure-preserving guarantee — is kept. Never throws.
function maskSecretKeys(node: any): any {
  if (Array.isArray(node)) return node.map(maskSecretKeys);
  if (node && typeof node === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(node)) {
      const child = maskSecretKeys(node[k]);
      if (looksSecret(k)) {
        let nk = REDACTED_KEY, n = 2;
        while (Object.prototype.hasOwnProperty.call(out, nk)) nk = `${REDACTED_KEY}-${n++}`;
        out[nk] = child;
      } else {
        out[k] = child;
      }
    }
    return out;
  }
  return node;
}

export function buildScrubber(cfg: Partial<PrivacyCfg> | null | undefined): Scrubber {
  const c = cfg || PRIVACY_DEFAULT_CFG;
  const denyNames = [...DEFAULT_DENY, ...(c.customFieldNames || [])].filter(Boolean);
  const denyRe = new RegExp('\\b(' + denyNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b(\\s*[=:]\\s*)("[^"]*"|\\S+)', 'gi');
  const custom: RegExp[] = [];
  for (const p of (c.customPatterns || [])) { try { custom.push(new RegExp(p, 'g')); } catch { /* invalid regex dropped */ } }
  return {
    maskText(str: unknown): string {
      let out = String(str == null ? '' : str);
      out = out.replace(denyRe, (_m, key, sep) => `${key}${sep}<redacted>`);
      out = out.replace(RE_CARDISH, m => (luhnValid(m) ? '<card>' : m));
      out = out.replace(RE_SSN, '<ssn>');
      out = out.replace(RE_TOKEN_PREFIX, '<token>');
      out = out.replace(RE_SECRET, '<secret>');
      out = out.replace(RE_EMAIL, '<email>');
      out = out.replace(RE_UUID, '<uuid>');
      out = out.replace(RE_IPV4, '<ip>');
      out = out.replace(RE_IPV6, '<ip>');
      for (const re of custom) out = out.replace(re, '<redacted>');
      return out;
    },
  };
}

export function redactText(str: unknown, scrubber?: Scrubber | null): string {
  const s = scrubber || buildScrubber(PRIVACY_DEFAULT_CFG);
  return s.maskText(str);
}

function asJson(body: unknown): { ok: true; value: any } | { ok: false } {
  if (body && typeof body === 'object') return { ok: true, value: body };
  if (typeof body === 'string') { try { return { ok: true, value: JSON.parse(body) }; } catch { return { ok: false }; } }
  return { ok: false };
}

// Structure-preserving body redaction: keys kept, every leaf value -> type token
// (delegated to evidence.js scrub via snippetAround with no finding path). Non-JSON
// bodies never emit bytes — only a descriptor.
export function redactBody(body: unknown, headers?: Record<string, any> | null): RedactedBody {
  const parsed = asJson(body);
  if (parsed.ok) {
    const s = snippetAround(parsed.value, '');
    // snippetAround (shared with the evidence/report artifact) preserves object KEYS
    // verbatim; on the AI path we additionally mask keys that are themselves PII/secrets.
    if (s) return { tree: maskSecretKeys(s.tree), truncated: s.truncated };
  }
  return { nonJson: {
    contentType: String(headerVal(headers || {}, 'content-type') || ''),
    byteLength: typeof body === 'string' ? body.length : 0,
  } };
}

// Drop scheme+host, keep path, collapse id-like segments to {id}, keep query keys
// and mask query values. NOTE: deliberately separate from evidence.redactUrl
// (which preserves host for report artifacts).
const ID_SEG = /^\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A path segment that is itself a secret/identifier (email, JWT, AWS key, GH/opaque token).
const SECRET_SEG = /@|^eyJ[\w-]+\.[\w-]+\.[\w-]+$|^AKIA[0-9A-Z]{16}$|^gh[pousr]_[A-Za-z0-9]{20,}$|^[A-Za-z0-9_-]{40,}$/;
export function redactUrlForAI(url: unknown): string {
  try {
    const s = String(url == null ? '' : url).split('#')[0];
    let pathQuery = s;
    const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i);
    if (m) pathQuery = m[1] || '/';
    const qIdx = pathQuery.indexOf('?');
    const pathPart = qIdx < 0 ? pathQuery : pathQuery.slice(0, qIdx);
    const queryPart = qIdx < 0 ? null : pathQuery.slice(qIdx + 1);
    const segs = pathPart.split('/').map(seg => (seg && (ID_SEG.test(seg) || SECRET_SEG.test(seg)) ? '{id}' : seg)).join('/');
    if (queryPart == null) return segs || '/';
    const q = queryPart.split('&').map(p => {
      const i = p.indexOf('=');
      return i < 0 ? p : p.slice(0, i) + '=<redacted>';
    }).join('&');
    return (segs || '/') + '?' + q;
  } catch { return '<redacted-url>'; }
}

const OPENAPI_STRIP_KEYS = new Set(['example', 'examples', 'default', 'enum']);
function stripSpecValues(node: any): any {
  if (Array.isArray(node)) return node.map(stripSpecValues);
  if (node && typeof node === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(node)) {
      if (k === 'servers') continue;            // drop host(s)
      if (OPENAPI_STRIP_KEYS.has(k)) continue;   // drop concrete sample values at any depth
      out[k] = stripSpecValues(node[k]);
    }
    return out;
  }
  return node;
}

// Replace any scheme://host[:port] with <host>, keeping the path.
function stripUrlHosts(text: unknown): string {
  return String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/"']+/gi, '<host>');
}
// Recursively scrub free-text string VALUES (descriptions, summaries, titles, etc.);
// object KEYS and structure are preserved.
function scrubSpecStrings(node: any, scrubber: Scrubber): any {
  if (typeof node === 'string') return stripUrlHosts(scrubber.maskText(node));
  if (Array.isArray(node)) return node.map(n => scrubSpecStrings(n, scrubber));
  if (node && typeof node === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(node)) out[k] = scrubSpecStrings(node[k], scrubber);
    return out;
  }
  return node;
}

export function redactOpenApi(specText: string): string {
  const scrubber = buildScrubber(PRIVACY_DEFAULT_CFG);
  try {
    const spec = JSON.parse(specText);
    if (!spec || typeof spec !== 'object') throw new Error('not an object');
    return JSON.stringify(scrubSpecStrings(stripSpecValues(spec), scrubber), null, 2);
  } catch {
    return stripUrlHosts(redactText(specText, scrubber));
  }
}

function bodyStrFor(redacted: RedactedBody | null | undefined): string {
  if (redacted == null) return '(no body)';
  if (redacted.nonJson) return `(non-JSON body: ${redacted.nonJson.contentType || 'unknown'}, ${redacted.nonJson.byteLength} bytes)`;
  return JSON.stringify(redacted.tree != null ? redacted.tree : redacted).slice(0, 1500);
}

export const AI_KINDS: Record<string, AiKind> = {
  'response-review': {
    redact(p, ctx) {
      if (ctx.mode === 'full') {
        return { method: p.method, url: p.url, status: p.status, statusText: p.statusText, time: p.time, expected: p.expected || [], bodyText: p.body == null ? '(no body)' : JSON.stringify(p.body).slice(0, 1500) };
      }
      return { method: p.method, url: redactUrlForAI(p.url), status: p.status, statusText: p.statusText, time: p.time, expected: p.expected || [], bodyText: bodyStrFor(redactBody(p.body, p.headers)) };
    },
    buildPrompt(r) {
      return [
        'You are a senior QA engineer reviewing one API response. Be terse (max 4 lines).',
        'Say whether it looks correct, and flag anything suspicious (wrong status, error body, missing fields, security smells).',
        `REQUEST: ${r.method} ${r.url}`,
        r.expected.length ? `EXPECTED (assertions): ${r.expected.join('; ')}` : 'EXPECTED: (none specified)',
        `RESPONSE: ${r.status} ${r.statusText}, ${r.time}ms`,
        `BODY: ${r.bodyText}`,
      ].join('\n');
    },
  },
  'sensitive-scan': {
    redact(p, ctx) {
      if (ctx.mode === 'full') {
        const body = p.body; const text = typeof body === 'string' ? body : JSON.stringify(body || {}, null, 2);
        return { text: text.slice(0, 4000) };
      }
      const rb = redactBody(p.body, p.headers);
      return { text: JSON.stringify(rb.tree != null ? rb.tree : rb, null, 2).slice(0, 4000) };
    },
    buildPrompt(r) {
      return 'You are a security reviewer. Identify sensitive data exposure in this API ' +
        'response body: PII, secrets/tokens, or internal/debug fields a client should ' +
        'not receive. Return ONLY a JSON array of {"path","title","severity"} where ' +
        'severity is one of info,low,medium,high,critical. If nothing, return [].\n\n' +
        'Response body:\n' + r.text;
    },
  },
  'testgen': {
    redact(p, ctx) {
      if (ctx.mode === 'full') return { source: p.source, input: String(p.input).slice(0, 6000) };
      const red = p.source === 'openapi' ? redactOpenApi(p.input) : redactText(p.input, ctx.scrubber);
      return { source: p.source, input: String(red).slice(0, 6000) };
    },
    buildPrompt(r) {
      const kind = r.source === 'bdd' ? 'BDD / Gherkin feature' : r.source === 'openapi' ? 'OpenAPI spec' : 'requirements / PRD text';
      return [
        'You are a senior QA engineer. From the following ' + kind + ', generate API test cases.',
        'Return ONLY a JSON array — no prose, no markdown fences. Each element must be:',
        '{"title":string,"type":"happy"|"edge"|"negative","method":"GET|POST|PUT|PATCH|DELETE","path":string (use "—" if not stated),"status":number,"steps":[Given/When/Then strings, max 2],"assertions":[strings, max 2]}',
        'Cover happy, negative, and edge cases. Maximum 6 cases. Be terse — short titles and steps.',
        '', 'SOURCE:', '"""', r.input, '"""',
      ].join('\n');
    },
  },
  'triage': {
    redact(p, ctx) {
      const sc = ctx.scrubber;
      const input = (p.input || []).map((f: any) => ({
        i: f.i, engine: f.engine, severity: f.severity, oracle: f.oracle,
        title: ctx.mode === 'full' ? f.title : redactText(f.title || '', sc),
        path: ctx.mode === 'full' ? f.path : redactUrlForAI(String(f.path || '')),
        evidence: ctx.mode === 'full' ? f.evidence : redactText(f.evidence || '', sc),
      }));
      return { input };
    },
    buildPrompt(r) {
      return (
        'You are triaging security findings from an automated API scan. ' +
        'Group related findings, surface the few that truly need a human, and flag likely false positives. ' +
        'Categories you may use: ' + TRIAGE_CATEGORIES.join(', ') + '. ' +
        'Return ONLY a JSON object: {"headline": string, "items": [{"title": string, "category": string, ' +
        '"priority": "p1"|"p2"|"p3", "rationale": string, "findingIndexes": number[], "likelyFalsePositive": boolean}]}. ' +
        'Reference findings only by their `i` index. Never invent findings.\n\n' +
        'Findings:\n' + JSON.stringify(r.input, null, 2)
      );
    },
  },
};
