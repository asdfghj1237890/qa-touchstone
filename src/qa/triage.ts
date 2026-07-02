// src/qa/triage.ts
// ── QA Touchstone — batch AI triage (pure logic) ───────────────────────────
// Normalize findings across engines, cap by severity, build/parse a single
// advisory LLM pass. Never mutates the real findings. UI in TriagePanel.jsx.
import './setup';
import { isDefined } from './isDefined';
import { qaAiSend } from './llm';
import { SEVERITY_ORDER } from './oracles';
import { TRIAGE_CATEGORIES } from './triageConstants';
import type {
  AiSendFn,
  Finding,
  TriageFinding,
  TriageInputItem,
  TriageItem,
  TriagePriority,
  TriageResult,
} from './types';

export const TRIAGE_CAP = 150;
export { TRIAGE_CATEGORIES };
const PRIORITIES: TriagePriority[] = ['p1', 'p2', 'p3'];

// Normalize one engine's findings into the flat triage shape with a back-ref.
// refOf(finding, index) -> ref object the panel uses to navigate back.
export function normalizeFindings(
  engine: string,
  findings: Finding[] | null | undefined,
  refOf?: (f: Finding, i: number) => unknown
): TriageFinding[] {
  return (findings || []).map((f, i) => ({
    engine,
    severity: f.severity,
    oracle: f.oracle,
    title: f.title,
    path: f.path,
    evidence: f.evidence || '',
    ref: refOf ? refOf(f, i) : null,
  }));
}

// Cap the union by severity (highest first) and tag each kept finding with a
// stable index `i`. Returns { input (sent to LLM), kept (for back-refs), dropped }.
export function buildTriageInput(
  union: TriageFinding[] | null | undefined,
  cap = TRIAGE_CAP
): { input: TriageInputItem[]; kept: TriageFinding[]; dropped: number } {
  const sorted = (union || [])
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  const kept = sorted.slice(0, cap);
  const input = kept.map((f, i) => ({
    i,
    engine: f.engine,
    severity: f.severity,
    oracle: f.oracle,
    title: f.title,
    path: f.path,
    evidence: f.evidence,
  }));
  return { input, kept, dropped: Math.max(0, sorted.length - kept.length) };
}

// Defensive parse: strip code fences, extract the first balanced JSON object,
// validate items, resolve findingIndexes back to `kept`, drop invalid refs and
// zero-ref items, coerce bad enums. Total failure -> empty triage.
export function parseTriage(raw: unknown, kept: TriageFinding[]): TriageResult {
  let obj;
  try {
    const text = String(raw)
      .replace(/```json/gi, '')
      .replace(/```/g, '');
    // Greedy first-{ to last-} match: after fence stripping this recovers the
    // JSON object from any surrounding prose. Malformed output safely throws -> empty.
    const m = text.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : text);
  } catch {
    return { headline: '', items: [] };
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items))
    return { headline: '', items: [] };
  const items: TriageItem[] = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    const idxs = Array.isArray(it.findingIndexes) ? it.findingIndexes : [];
    // Valid, de-duplicated indexes -> findings. Dedup so a repeated index
    // (e.g. [0,0,0]) can't inflate the finding count shown to the user.
    const seen = new Set<number>();
    const findings: TriageFinding[] = [];
    for (const n of idxs) {
      if (!Number.isInteger(n) || n < 0 || n >= kept.length || seen.has(n)) continue;
      const finding = kept[n];
      if (!isDefined(finding)) continue;
      seen.add(n);
      findings.push(finding);
    }
    if (!findings.length) continue; // drop invented / zero-ref items
    items.push({
      title: String(it.title || findings[0]?.title || 'Finding cluster'),
      category: TRIAGE_CATEGORIES.includes(it.category) ? it.category : 'other',
      priority: PRIORITIES.includes(it.priority) ? it.priority : 'p3',
      rationale: String(it.rationale || ''),
      likelyFalsePositive: it.likelyFalsePositive === true,
      findings,
    });
  }
  return { headline: String(obj.headline || ''), items };
}

// Orchestration. `send` is injectable for tests; defaults to qaAiSend.
// Returns { headline, items, dropped, total }. Empty union -> no LLM call.
export async function runTriage(
  union: TriageFinding[] | null | undefined,
  send: AiSendFn = qaAiSend,
  opts: { cap?: number } = {}
): Promise<TriageResult & { dropped: number; total: number }> {
  const cap = opts.cap || TRIAGE_CAP;
  const { input, kept, dropped } = buildTriageInput(union, cap);
  const total = (union || []).length;
  if (!input.length) return { headline: '', items: [], dropped: 0, total: 0 };
  let raw: unknown;
  try {
    raw = await send({ site: 'triage', kind: 'triage', payload: { input } });
  } catch (e: any) {
    if (e && e.name === 'AiCancelledError') return { headline: '', items: [], dropped, total };
    throw e;
  }
  const parsed = parseTriage(raw, kept);
  return { ...parsed, dropped, total };
}
