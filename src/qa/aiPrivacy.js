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
