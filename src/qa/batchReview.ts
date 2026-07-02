// ── QA Touchstone — batch AI response review (pure orchestration) ───────────
// Advisory only: reviews captured responses in bulk, maps model indexes back to
// the source responses, and never mutates findings or release gates.
import './setup';
import { qaAiSend } from './llm';

export const RESPONSE_REVIEW_CAP = 80;
export type ReviewPriority = 'p1' | 'p2' | 'p3';

export type ReviewSource = {
  engine: string;
  method: string;
  path: string;
  identity?: string;
  status: number | null;
  statusText?: string;
  time?: number;
  verdict?: string | null;
  expected?: string[];
  body?: unknown;
  headers?: Record<string, unknown> | null;
};

export type ReviewInputItem = {
  i: number;
  engine: string;
  method: string;
  path: string;
  identity: string;
  status: number | null;
  statusText: string;
  time: number;
  verdict: string;
  expected: string[];
  body: unknown;
  headers: Record<string, unknown>;
};

export type BatchReviewItem = {
  title: string;
  priority: ReviewPriority;
  rationale: string;
  likelyBug: boolean;
  responses: ReviewSource[];
};

export type BatchReviewResult = {
  headline: string;
  items: BatchReviewItem[];
};

export type AiSend = (request: {
  site: string;
  kind: string;
  payload: unknown;
}) => Promise<unknown>;

const PRIORITIES: ReviewPriority[] = ['p1', 'p2', 'p3'];

export function buildBatchReviewInput(
  sources: ReviewSource[] | null | undefined,
  cap = RESPONSE_REVIEW_CAP
): { input: ReviewInputItem[]; kept: ReviewSource[]; dropped: number } {
  const kept = (sources || []).filter((s) => s && s.status != null).slice(0, cap);
  return {
    kept,
    dropped: Math.max(0, (sources || []).length - kept.length),
    input: kept.map((s, i) => ({
      i,
      engine: s.engine || '',
      method: s.method || '',
      path: s.path || '',
      identity: s.identity || '',
      status: s.status,
      statusText: s.statusText || '',
      time: s.time || 0,
      verdict: s.verdict || '',
      expected: s.expected || [],
      body: s.body,
      headers: s.headers || {},
    })),
  };
}

export function parseBatchReview(raw: unknown, kept: ReviewSource[]): BatchReviewResult {
  let obj;
  try {
    const text = String(raw)
      .replace(/```json/gi, '')
      .replace(/```/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : text);
  } catch {
    return { headline: '', items: [] };
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items))
    return { headline: '', items: [] };
  const items: BatchReviewItem[] = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    const idxs = Array.isArray(it.responseIndexes) ? it.responseIndexes : [];
    const seen = new Set<number>();
    const responses: ReviewSource[] = [];
    for (const n of idxs) {
      if (!Number.isInteger(n) || n < 0 || n >= kept.length || seen.has(n)) continue;
      const source = kept[n];
      if (!source) continue;
      seen.add(n);
      responses.push(source);
    }
    if (!responses.length) continue;
    const priority = PRIORITIES.includes(it.priority) ? it.priority : 'p3';
    items.push({
      title: String(it.title || responses[0]?.path || 'Response issue'),
      priority,
      rationale: String(it.rationale || ''),
      likelyBug: it.likelyBug === true,
      responses,
    });
  }
  return { headline: String(obj.headline || ''), items };
}

export async function runBatchResponseReview(
  sources: ReviewSource[] | null | undefined,
  send: AiSend = qaAiSend,
  opts: { cap?: number } = {}
): Promise<BatchReviewResult & { dropped: number; total: number }> {
  const cap = opts.cap || RESPONSE_REVIEW_CAP;
  const { input, kept, dropped } = buildBatchReviewInput(sources, cap);
  const total = (sources || []).length;
  if (!input.length) return { headline: '', items: [], dropped: 0, total: 0 };
  let raw: unknown;
  try {
    raw = await send({
      site: 'batch-response-review',
      kind: 'batch-response-review',
      payload: { input },
    });
  } catch (e: any) {
    if (e && e.name === 'AiCancelledError') return { headline: '', items: [], dropped, total };
    throw e;
  }
  return { ...parseBatchReview(raw, kept), dropped, total };
}
