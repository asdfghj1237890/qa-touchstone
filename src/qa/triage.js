// src/qa/triage.js
// ── QA Companion — batch AI triage (pure logic) ───────────────────────────
// Normalize findings across engines, cap by severity, build/parse a single
// advisory LLM pass. Never mutates the real findings. UI in TriagePanel.jsx.
import './setup.js';
import { qaCallLLM } from './llm.js';
import { SEVERITY_ORDER } from './oracles.js';

export const TRIAGE_CAP = 150;
export const TRIAGE_CATEGORIES = ['object-authz', 'schema-drift', 'sensitive-exposure', 'rate-limit', 'auth-matrix', 'false-positive', 'other'];
const PRIORITIES = ['p1', 'p2', 'p3'];

// Normalize one engine's findings into the flat triage shape with a back-ref.
// refOf(finding, index) -> ref object the panel uses to navigate back.
export function normalizeFindings(engine, findings, refOf) {
  return (findings || []).map((f, i) => ({
    engine, severity: f.severity, oracle: f.oracle, title: f.title,
    path: f.path, evidence: f.evidence || '', ref: refOf ? refOf(f, i) : null,
  }));
}

// Cap the union by severity (highest first) and tag each kept finding with a
// stable index `i`. Returns { input (sent to LLM), kept (for back-refs), dropped }.
export function buildTriageInput(union, cap = TRIAGE_CAP) {
  const sorted = (union || []).slice().sort(
    (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  const kept = sorted.slice(0, cap);
  const input = kept.map((f, i) => ({
    i, engine: f.engine, severity: f.severity, oracle: f.oracle, title: f.title, path: f.path, evidence: f.evidence,
  }));
  return { input, kept, dropped: Math.max(0, sorted.length - kept.length) };
}

export function buildTriagePrompt(input) {
  return (
    'You are triaging security findings from an automated API scan. ' +
    'Group related findings, surface the few that truly need a human, and flag likely false positives. ' +
    'Categories you may use: ' + TRIAGE_CATEGORIES.join(', ') + '. ' +
    'Return ONLY a JSON object: {"headline": string, "items": [{"title": string, "category": string, ' +
    '"priority": "p1"|"p2"|"p3", "rationale": string, "findingIndexes": number[], "likelyFalsePositive": boolean}]}. ' +
    'Reference findings only by their `i` index. Never invent findings.\n\n' +
    'Findings:\n' + JSON.stringify(input, null, 2)
  );
}

// Defensive parse: strip code fences, extract the first balanced JSON object,
// validate items, resolve findingIndexes back to `kept`, drop invalid refs and
// zero-ref items, coerce bad enums. Total failure -> empty triage.
export function parseTriage(raw, kept) {
  let obj;
  try {
    const text = String(raw).replace(/```json/gi, '').replace(/```/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : text);
  } catch { return { headline: '', items: [] }; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items)) return { headline: '', items: [] };
  const items = [];
  for (const it of obj.items) {
    if (!it || typeof it !== 'object') continue;
    const idxs = Array.isArray(it.findingIndexes) ? it.findingIndexes : [];
    const findings = idxs.filter(n => Number.isInteger(n) && n >= 0 && n < kept.length).map(n => kept[n]);
    if (!findings.length) continue;   // drop invented / zero-ref items
    items.push({
      title: String(it.title || findings[0].title || 'Finding cluster'),
      category: TRIAGE_CATEGORIES.includes(it.category) ? it.category : 'other',
      priority: PRIORITIES.includes(it.priority) ? it.priority : 'p3',
      rationale: String(it.rationale || ''),
      likelyFalsePositive: it.likelyFalsePositive === true,
      findings,
    });
  }
  return { headline: String(obj.headline || ''), items };
}
