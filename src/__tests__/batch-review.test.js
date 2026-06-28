// src/__tests__/batch-review.test.js
import { describe, it, expect } from 'vitest';
import { buildBatchReviewInput, parseBatchReview, runBatchResponseReview } from '../qa/batchReview';

const sources = [
  {
    engine: 'matrix',
    method: 'GET',
    path: '/users/1',
    identity: 'user',
    status: 200,
    verdict: 'pass',
    expected: ['matrix expectation: allow'],
    body: { id: 1 },
    headers: {},
  },
  {
    engine: 'matrix',
    method: 'DELETE',
    path: '/admin/users/1',
    identity: 'user',
    status: 200,
    verdict: 'vuln',
    expected: ['matrix expectation: deny'],
    body: { ok: true },
    headers: {},
  },
];

describe('buildBatchReviewInput', () => {
  it('caps review inputs and assigns stable indexes', () => {
    const { input, kept, dropped } = buildBatchReviewInput(sources, 1);
    expect(input).toMatchObject([{ i: 0, method: 'GET', path: '/users/1' }]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe('parseBatchReview', () => {
  it('maps responseIndexes back to kept responses and drops invented refs', () => {
    const parsed = parseBatchReview(
      JSON.stringify({
        headline: 'One suspicious admin response',
        items: [
          {
            title: 'Non-admin reached admin delete',
            priority: 'p1',
            rationale: 'Deny expectation returned 200.',
            responseIndexes: [1, 99, 1],
            likelyBug: true,
          },
        ],
      }),
      sources
    );
    expect(parsed.headline).toBe('One suspicious admin response');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].responses).toEqual([sources[1]]);
    expect(parsed.items[0].priority).toBe('p1');
    expect(parsed.items[0].likelyBug).toBe(true);
  });

  it('returns an empty review for junk output', () => {
    expect(parseBatchReview('not json', sources)).toEqual({ headline: '', items: [] });
  });
});

describe('runBatchResponseReview', () => {
  it('submits a batch AI request and returns parsed metadata', async () => {
    let seenReq;
    const out = await runBatchResponseReview(
      sources,
      async (req) => {
        seenReq = req;
        return '{"headline":"h","items":[{"title":"t","priority":"p2","rationale":"r","responseIndexes":[0],"likelyBug":false}]}';
      },
      { cap: 10 }
    );
    expect(seenReq.site).toBe('batch-response-review');
    expect(seenReq.kind).toBe('batch-response-review');
    expect(out.items[0].responses[0]).toBe(sources[0]);
    expect(out.total).toBe(2);
    expect(out.dropped).toBe(0);
  });

  it('returns empty review when the user cancels prompt preview', async () => {
    const err = new Error('cancel');
    err.name = 'AiCancelledError';
    const out = await runBatchResponseReview(sources, async () => {
      throw err;
    });
    expect(out).toMatchObject({ headline: '', items: [], total: 2 });
  });
});
