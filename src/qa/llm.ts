// ── QA Touchstone — shared LLM call + privacy chokepoint ────────────────────
// INVARIANTS: qaCallLLM (transport) is reachable only through qaAiSend. No
// streaming, no auto-retry that re-sends without a fresh approval. Never log or
// persist the raw prompt or response.
import './setup';
import {
  loadPrivacyCfg,
  resolvePolicy,
  classifyDestination,
  assertEgressAllowed,
  buildScrubber,
  AI_KINDS,
} from './aiPrivacy';
import { ensureAiPolicy } from './aiPolicy';
import { requestPromptApproval } from './PromptPreview';
import { loadJSON } from './storage';
import type { AiDestination, BackendAiPolicy, PrivacyCfg } from './aiPrivacy';
import type { AiPolicyApi } from './aiPolicy';

/** LLM provider 設定（Settings → AI / LLM；localStorage `qa_llm_cfg`）。 */
export interface LlmCfg {
  provider: string;
  model: string;
  key: string;
  baseUrl: string;
}

/** qaAiSend 的 request：site/kind 供 approval UI 顯示，payload 交給 AI_KINDS.redact。 */
export interface AiSendRequest {
  site: string;
  kind: string;
  payload: any;
}

/** qaAiSend 的 opts（測試注入點；省略時走真實載入 / transport / approval）。 */
export interface AiSendOptions {
  llmCfg?: Partial<LlmCfg> | null;
  privacyCfg?: Partial<PrivacyCfg> | null;
  backendPolicy?: BackendAiPolicy | null;
  api?: AiPolicyApi | null;
  callLLM?: (prompt: string) => Promise<any>;
  approve?: (
    prompt: string,
    meta: { site: string; kind: string; mode: string; destination: AiDestination }
  ) => Promise<any> | boolean;
}

const LLM_CFG_DEFAULTS: LlmCfg = {
  provider: 'builtin',
  model: 'claude-haiku-4-5',
  key: '',
  baseUrl: '',
};
function _loadLlmCfg(): LlmCfg {
  if (typeof window !== 'undefined' && typeof window.loadLlmCfg === 'function')
    return window.loadLlmCfg();
  const raw = loadJSON('qa_llm_cfg', {});
  return { ...LLM_CFG_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

// Low-level transport. NOT for direct use by feature code — go through qaAiSend.
// Re-checks the egress gate as defense-in-depth so a regression still fails closed.
export async function qaCallLLM(prompt: string): Promise<string> {
  const cfg = _loadLlmCfg();
  const policy = resolvePolicy(loadPrivacyCfg(), await ensureAiPolicy());
  assertEgressAllowed(policy.effectiveMode, classifyDestination(cfg), loadPrivacyCfg());
  if (cfg.provider === 'builtin') {
    if (!(window.claude && window.claude.complete)) throw new Error('built-in Claude unavailable');
    return await window.claude.complete({ messages: [{ role: 'user', content: prompt }] });
  }
  const url =
    cfg.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : cfg.baseUrl;
  if (!url) throw new Error('No custom provider endpoint configured (Settings → AI / LLM)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from provider');
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}

// THE ONLY egress entry point for feature code.
// request = { site, kind, payload }
export async function qaAiSend(request: AiSendRequest, opts: AiSendOptions = {}): Promise<any> {
  const llmCfg = opts.llmCfg || _loadLlmCfg();
  const privacyCfg = opts.privacyCfg || loadPrivacyCfg();
  const backendPolicy =
    'backendPolicy' in opts ? opts.backendPolicy : await ensureAiPolicy(opts.api);
  const callLLM = opts.callLLM || qaCallLLM;
  const approve = opts.approve || requestPromptApproval;

  const policy = resolvePolicy(privacyCfg, backendPolicy);
  const dest = classifyDestination(llmCfg);
  assertEgressAllowed(policy.effectiveMode, dest, privacyCfg); // throws EgressBlockedError

  const def = AI_KINDS[request.kind];
  if (!def) throw new Error('Unknown AI request kind: ' + request.kind);
  const scrubber = buildScrubber(privacyCfg);
  const redacted = def.redact(request.payload, { scrubber, mode: policy.effectiveMode });
  const prompt = def.buildPrompt(redacted);

  const ok = await approve(prompt, {
    site: request.site,
    kind: request.kind,
    mode: policy.effectiveMode,
    destination: dest,
  });
  if (!ok) {
    const e = new Error('AI send cancelled by user');
    e.name = 'AiCancelledError';
    throw e;
  }
  return await callLLM(prompt);
}
