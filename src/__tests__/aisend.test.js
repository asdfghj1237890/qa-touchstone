import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qaAiSend } from '../qa/llm.js';
import { setCachedAiPolicy } from '../qa/aiPolicy.js';

const ALLOW_AI = { externalAllowed: true, locked: false };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('qa_llm_cfg', JSON.stringify({ provider: 'openai', model: 'm', key: 'k', baseUrl: '' }));
  setCachedAiPolicy(ALLOW_AI);
});

const req = { site: 'response-review', kind: 'response-review', payload: { method: 'GET', url: 'https://api.acme.com/users/7?token=abc', status: 200, statusText: 'OK', time: 1, expected: [], body: { email: 'a@b.com' }, headers: {} } };

describe('qaAiSend', () => {
  it('redacts before the prompt reaches the transport', async () => {
    const callLLM = vi.fn().mockResolvedValue('ok');
    await qaAiSend(req, { callLLM, approve: () => Promise.resolve(true) });
    const sent = callLLM.mock.calls[0][0];
    expect(sent).not.toContain('api.acme.com');
    expect(sent).not.toContain('a@b.com');
  });
  it('cancel from approval prevents any transport call', async () => {
    const callLLM = vi.fn().mockResolvedValue('ok');
    await expect(qaAiSend(req, { callLLM, approve: () => Promise.resolve(false) })).rejects.toThrow(/cancel/i);
    expect(callLLM).not.toHaveBeenCalled();
  });
  it('local mode blocks a cloud provider before sending', async () => {
    localStorage.setItem('qa_ai_privacy', JSON.stringify({ mode: 'local' }));
    const callLLM = vi.fn().mockResolvedValue('ok');
    await expect(qaAiSend(req, { callLLM, approve: () => Promise.resolve(true) })).rejects.toThrow();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('loads missing backend policy before approval or transport and fails closed when denied', async () => {
    setCachedAiPolicy(null);
    const callLLM = vi.fn().mockResolvedValue('ok');
    const approve = vi.fn(() => Promise.resolve(true));
    const api = { getAiPolicy: vi.fn().mockResolvedValue({ externalAllowed: false, locked: true }) };

    await expect(qaAiSend(req, { callLLM, approve, api })).rejects.toThrow();

    expect(api.getAiPolicy).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
  });
});
