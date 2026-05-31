// ── QA Companion — shared LLM call (built-in Claude / OpenAI / custom) ─────
import './setup.js';

export async function qaCallLLM(prompt) {
  const cfg = window.loadLlmCfg();
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
