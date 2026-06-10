// ── QA Touchstone — shared LLM call + privacy chokepoint ────────────────────
// INVARIANTS: qaCallLLM (transport) is reachable only through qaAiSend. No
// streaming, no auto-retry that re-sends without a fresh approval. Never log or
// persist the raw prompt or response.
import './setup.js';
import { loadPrivacyCfg, resolvePolicy, classifyDestination, assertEgressAllowed, buildScrubber, AI_KINDS } from './aiPrivacy.js';
import { ensureAiPolicy } from './aiPolicy.js';
import { requestPromptApproval } from './PromptPreview.jsx';
import { loadJSON } from './storage.js';

const LLM_CFG_DEFAULTS = { provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' };
function _loadLlmCfg() {
  if (typeof window !== 'undefined' && typeof window.loadLlmCfg === 'function') return window.loadLlmCfg();
  const raw = loadJSON('qa_llm_cfg', {});
  return { ...LLM_CFG_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
}

// Low-level transport. NOT for direct use by feature code — go through qaAiSend.
// Re-checks the egress gate as defense-in-depth so a regression still fails closed.
export async function qaCallLLM(prompt) {
  const cfg = _loadLlmCfg();
  const policy = resolvePolicy(loadPrivacyCfg(), await ensureAiPolicy());
  assertEgressAllowed(policy.effectiveMode, classifyDestination(cfg), loadPrivacyCfg());
  if (cfg.provider === 'builtin') {
    if (!(window.claude && window.claude.complete)) throw new Error('built-in Claude unavailable');
    return await window.claude.complete({ messages: [{ role: 'user', content: prompt }] });
  }
  const url = cfg.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : cfg.baseUrl;
  if (!url) throw new Error('No custom provider endpoint configured (Settings → AI / LLM)');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from provider');
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}

// THE ONLY egress entry point for feature code.
// request = { site, kind, payload }
export async function qaAiSend(request, opts = {}) {
  const llmCfg = opts.llmCfg || _loadLlmCfg();
  const privacyCfg = opts.privacyCfg || loadPrivacyCfg();
  const backendPolicy = 'backendPolicy' in opts ? opts.backendPolicy : await ensureAiPolicy(opts.api);
  const callLLM = opts.callLLM || qaCallLLM;
  const approve = opts.approve || requestPromptApproval;

  const policy = resolvePolicy(privacyCfg, backendPolicy);
  const dest = classifyDestination(llmCfg);
  assertEgressAllowed(policy.effectiveMode, dest, privacyCfg);   // throws EgressBlockedError

  const def = AI_KINDS[request.kind];
  if (!def) throw new Error('Unknown AI request kind: ' + request.kind);
  const scrubber = buildScrubber(privacyCfg);
  const redacted = def.redact(request.payload, { scrubber, mode: policy.effectiveMode });
  const prompt = def.buildPrompt(redacted);

  const ok = await approve(prompt, { site: request.site, kind: request.kind, mode: policy.effectiveMode, destination: dest });
  if (!ok) { const e = new Error('AI send cancelled by user'); e.name = 'AiCancelledError'; throw e; }
  return await callLLM(prompt);
}
