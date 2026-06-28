import { describe, it, expect, vi, beforeEach } from 'vitest';
import { qaAiSend } from '../qa/llm';
import { setCachedAiPolicy } from '../qa/aiPolicy';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'qa_llm_cfg',
    JSON.stringify({ provider: 'openai', model: 'm', key: 'k', baseUrl: '' })
  );
  setCachedAiPolicy({ externalAllowed: true, locked: false });
});

describe('testgen kind redaction', () => {
  it('openapi source is host-stripped when sent', async () => {
    const callLLM = vi.fn().mockResolvedValue('[]');
    await qaAiSend(
      {
        site: 'testgen',
        kind: 'testgen',
        payload: {
          source: 'openapi',
          input: JSON.stringify({ servers: [{ url: 'https://prod.acme.com' }], paths: {} }),
        },
      },
      { callLLM, approve: () => Promise.resolve(true) }
    );
    expect(callLLM.mock.calls[0][0]).not.toContain('prod.acme.com');
  });
});
