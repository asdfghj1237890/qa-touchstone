import { describe, it, expect, beforeEach, vi } from 'vitest';
import { qaCallLLM } from '../qa/llm.js';

describe('qaCallLLM provider dispatch', () => {
  beforeEach(() => {
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
});
