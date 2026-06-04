import { describe, it, expect, beforeEach } from 'vitest';
import { requestPromptApproval, __registerHost, __addSessionSkip, __resetPreviewState } from '../qa/PromptPreview.jsx';

const meta = { site: 'testgen', mode: 'redacted', destination: { provider: 'openai' } };

describe('preview bridge', () => {
  beforeEach(() => __resetPreviewState());
  it('denies when no host is mounted (non-interactive safety)', async () => {
    await expect(requestPromptApproval('p', meta)).resolves.toBe(false);
  });
  it('auto-approves when a scoped session skip is set', async () => {
    __addSessionSkip(meta);
    await expect(requestPromptApproval('p', meta)).resolves.toBe(true);
  });
  it('session skip does NOT leak across modes', async () => {
    __addSessionSkip({ ...meta, mode: 'redacted' });
    await expect(requestPromptApproval('p', { ...meta, mode: 'full' })).resolves.toBe(false);
  });
  it('a mounted host receives the request and can resolve it', async () => {
    let captured;
    const unsub = __registerHost((reqObj) => { captured = reqObj; });
    const p = requestPromptApproval('hello', meta);
    captured.resolve(true);
    await expect(p).resolves.toBe(true);
    unsub();
  });
});
