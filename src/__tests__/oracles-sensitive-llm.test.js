import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanSensitiveLLM } from '../qa/oracles.js';

beforeEach(() => { localStorage.clear(); localStorage.setItem('qa_llm_cfg', JSON.stringify({ provider: 'openai', model: 'm', key: 'k', baseUrl: '' })); });

describe('scanSensitiveLLM via qaAiSend', () => {
  it('submits a sensitive-scan AiRequest and parses the verdict', async () => {
    let req = null;
    const send = vi.fn(async (r) => { req = r; return '[{"path":"ssn","title":"SSN","severity":"high"}]'; });
    const out = await scanSensitiveLLM({ body: { ssn: '123-45-6789' }, headers: {} }, send);
    expect(req.kind).toBe('sensitive-scan');
    expect(req.payload.body).toEqual({ ssn: '123-45-6789' });
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('ssn');
    expect(out[0].oracle).toBe('sensitive-data');
    expect(out[0].source).toBe('llm');
  });
  it('returns [] when the user cancels (AiCancelledError)', async () => {
    const send = vi.fn(async () => { const e = new Error('cancelled'); e.name = 'AiCancelledError'; throw e; });
    const out = await scanSensitiveLLM({ body: {}, headers: {} }, send);
    expect(out).toEqual([]);
  });
});
