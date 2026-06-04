import { describe, it, expect, beforeEach, vi } from 'vitest';
import { qaCallLLM } from '../qa/llm.js';
import { setCachedAiPolicy } from '../qa/aiPolicy.js';

describe('qaCallLLM provider dispatch', () => {
  beforeEach(() => {
    setCachedAiPolicy({ externalAllowed: true, locked: false });
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('hello from builtin') };
  });

  it('uses the built-in Claude provider', async () => {
    const out = await qaCallLLM('hi');
    expect(out).toBe('hello from builtin');
    expect(window.claude.complete).toHaveBeenCalledOnce();
  });

  it('throws when built-in is selected but unavailable', async () => {
    window.claude = undefined;
    await expect(qaCallLLM('hi')).rejects.toThrow(/built-in/i);
  });

  it('posts to the OpenAI endpoint and returns the message content', async () => {
    window.loadLlmCfg = () => ({ provider: 'openai', model: 'gpt-5.4-mini', key: 'sk-test', baseUrl: '' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello from openai' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await qaCallLLM('hi');
    expect(out).toBe('hello from openai');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    vi.unstubAllGlobals();
  });

  it('throws on a non-ok HTTP response from the provider', async () => {
    window.loadLlmCfg = () => ({ provider: 'openai', model: 'gpt-5.4-mini', key: 'sk-test', baseUrl: '' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(qaCallLLM('hi')).rejects.toThrow(/HTTP 503/);
    vi.unstubAllGlobals();
  });
});
