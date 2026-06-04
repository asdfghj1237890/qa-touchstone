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
