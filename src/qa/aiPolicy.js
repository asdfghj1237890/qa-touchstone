// src/qa/aiPolicy.js — renderer-side AI policy cache (authoritative source = Rust)
import './setup.js';

let _cached = null;
export function getCachedAiPolicy() { return _cached; }
export function setCachedAiPolicy(p) { _cached = p; }

// Reads the backend-resolved policy via the Tauri command; falls back to the
// build-time VITE flag in web/dev. Default when neither is present: external AI
// OFF unless explicitly allowed (CI-safe). Caches the result.
export async function loadAiPolicy(apiMod) {
  try {
    const api = apiMod || (await import('../api/index.js')).default;
    if (api && api.getAiPolicy) { _cached = await api.getAiPolicy(); return _cached; }
  } catch { /* not in Tauri / command unavailable */ }
  const viteFlag = (import.meta && import.meta.env && import.meta.env.VITE_QA_ALLOW_EXTERNAL_AI);
  const allowed = viteFlag === 'true' || viteFlag === '1';
  _cached = { externalAllowed: allowed, forcedMode: undefined, locked: false };
  return _cached;
}
