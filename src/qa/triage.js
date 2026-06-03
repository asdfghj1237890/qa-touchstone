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
