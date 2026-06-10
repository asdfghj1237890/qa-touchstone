// src/qa/aiPolicy.ts — renderer-side AI policy cache (authoritative source = Rust)
import './setup';

export interface AiPolicy {
  externalAllowed: boolean;
  forcedMode?: 'local';
  locked: boolean;
}

/** Optional api-module override（測試注入 / llm.js 傳 opts.api）。 */
export interface AiPolicyApi {
  getAiPolicy?: () => Promise<unknown> | unknown;
}

export const AI_POLICY_DENY: Readonly<AiPolicy> = Object.freeze({ externalAllowed: false, forcedMode: 'local', locked: true });

let _cached: AiPolicy | null = null;
let _loading: Promise<AiPolicy> | null = null;
export function getCachedAiPolicy(): AiPolicy | null { return _cached; }
export function setCachedAiPolicy(p: AiPolicy | null): void { _cached = p; _loading = null; }

function normalizePolicy(p: any): AiPolicy {
  if (!p || typeof p !== 'object') return AI_POLICY_DENY;
  const externalAllowed = p.externalAllowed === true;
  const forcedMode = p.forcedMode === 'local' ? 'local' : undefined;
  const locked = !!p.locked || !externalAllowed || forcedMode === 'local';
  return { externalAllowed, forcedMode, locked };
}

// Reads the backend-resolved policy via the Tauri command; falls back to the
// build-time VITE flag in web/dev. Default when neither is present: external AI
// OFF unless explicitly allowed (CI-safe). Caches the result.
export async function loadAiPolicy(apiMod?: AiPolicyApi | null): Promise<AiPolicy> {
  try {
    const api = apiMod || (await import('../api/index')).default;
    if (api && api.getAiPolicy) { _cached = normalizePolicy(await api.getAiPolicy()); return _cached; }
  } catch { /* not in Tauri / command unavailable */ }
  const viteFlag = (import.meta && import.meta.env && import.meta.env.VITE_QA_ALLOW_EXTERNAL_AI);
  const allowed = viteFlag === 'true' || viteFlag === '1';
  _cached = allowed ? { externalAllowed: true, forcedMode: undefined, locked: false } : AI_POLICY_DENY;
  return _cached;
}

export async function ensureAiPolicy(apiMod?: AiPolicyApi | null): Promise<AiPolicy> {
  if (_cached) return _cached;
  if (!_loading) {
    _loading = loadAiPolicy(apiMod).finally(() => { _loading = null; });
  }
  try {
    return await _loading;
  } catch {
    _cached = AI_POLICY_DENY;
    return _cached;
  }
}
