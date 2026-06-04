// src/qa/aiPrivacy.js
// ── QA Touchstone — AI Privacy Mode (pure, no React/DOM/network) ────────────
import './setup.js';

export const PRIVACY_DEFAULT_CFG = {
  mode: 'redacted',            // 'full' | 'redacted' | 'local'
  lockdown: false,
  selfManagedAttested: false,
  customFieldNames: [],
  customPatterns: [],
};

export function loadPrivacyCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem('qa_ai_privacy') || '{}');
    return { ...PRIVACY_DEFAULT_CFG, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch { return { ...PRIVACY_DEFAULT_CFG }; }
}

export function savePrivacyCfg(cfg) {
  try { localStorage.setItem('qa_ai_privacy', JSON.stringify({ ...PRIVACY_DEFAULT_CFG, ...cfg })); } catch {}
}

const CLOUD_HOSTS = /(^|\.)(openai\.com|anthropic\.com|azure\.com|googleapis\.com|cohere\.ai|amazonaws\.com|mistral\.ai)$/i;

export function classifyDestination(cfg) {
  const provider = (cfg && cfg.provider) || 'builtin';
  if (provider === 'builtin') return { provider, label: 'Claude (built-in)', host: 'anthropic (built-in)', isCloud: true, isPrivate: false, isLoopback: false };
  if (provider === 'openai') return { provider, label: 'OpenAI', host: 'api.openai.com', isCloud: true, isPrivate: false, isLoopback: false };
  let host = '';
  try { host = new URL(cfg.baseUrl).hostname.replace(/^\[|\]$/g, ''); } catch { host = ''; }
  const isLoopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
  const isPrivate = isLoopback || /\.local$|\.internal$/.test(host)
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const isCloud = !isPrivate && (CLOUD_HOSTS.test(host) || host.length > 0);
  return { provider, label: host || 'custom endpoint', host, isCloud, isPrivate, isLoopback };
}

export class EgressBlockedError extends Error {
  constructor(key) { super(key); this.name = 'EgressBlockedError'; this.key = key; }
}

export function resolvePolicy(cfg, backendPolicy) {
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

export function assertEgressAllowed(effectiveMode, dest, cfg) {
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
const DEFAULT_DENY = ['customerId','customer_id','tenantId','tenant_id','email','userId','user_id','accountId','account_id','ssn','phone','password','authorization','token','secret','apiKey','api_key'];

function luhnValid(s) {
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

export function buildScrubber(cfg) {
  const c = cfg || PRIVACY_DEFAULT_CFG;
  const denyNames = [...DEFAULT_DENY, ...(c.customFieldNames || [])].filter(Boolean);
  const denyRe = new RegExp('\\b(' + denyNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b(\\s*[=:]\\s*)("[^"]*"|\\S+)', 'gi');
  const custom = [];
  for (const p of (c.customPatterns || [])) { try { custom.push(new RegExp(p, 'g')); } catch { /* invalid regex dropped */ } }
  return {
    maskText(str) {
      let out = String(str == null ? '' : str);
      out = out.replace(denyRe, (_m, key, sep) => `${key}${sep}<redacted>`);
      out = out.replace(RE_CARDISH, m => (luhnValid(m) ? '<card>' : m));
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

export function redactText(str, scrubber) {
  const s = scrubber || buildScrubber(PRIVACY_DEFAULT_CFG);
  return s.maskText(str);
}
