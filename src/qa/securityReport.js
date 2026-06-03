// src/qa/securityReport.js
// ── QA Touchstone — security report / artifact layer (pure, no React/DOM) ───
// One report model assembled from a recorded RunRecord + baseline + current
// lifecycle, plus serializers to JSON / HTML / JUnit / SARIF. UI in SuiteRunBar.
import './setup.js';
import { SEVERITY_ORDER } from './oracles.js';
import { diffRuns, gateCount } from './findings.js';

export const REPORT_SCHEMA = 'qa-security-report/1';
const PRESENCE_ORDER = { new: 0, carried: 1, resolved: 2 };

// Lifecycle annotations for a fp, with safe defaults.
function annOf(records, fp) {
  const r = records[fp] || {};
  return {
    suppressed: !!r.suppressed, suppressReason: r.suppressReason || '',
    status: r.status || 'open', owner: r.owner || '', note: r.note || '',
  };
}

// Build the normalized report model. `severity` is the recorded effective
// severity (frozen in the run item); annotations join from the CURRENT lifecycle.
export function buildReport(runRecord, baselineRecord, lifecycle, opts = {}) {
  const redaction = opts.redaction === 'strict' ? 'strict' : 'redacted';
  const records = (lifecycle && lifecycle.records) || {};
  const curItems = (runRecord && runRecord.items) || [];
  const baseItems = (baselineRecord && baselineRecord.items) || [];
  const diff = diffRuns(curItems, baseItems);

  const bySeverity = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  let nNew = 0, nCarried = 0;
  const findings = [];

  for (const it of curItems) {
    const presence = diff.get(it.fp) || 'new';
    if (presence === 'new') nNew++; else if (presence === 'carried') nCarried++;
    if (bySeverity[it.effectiveSeverity] !== undefined) bySeverity[it.effectiveSeverity]++;
    const f = {
      fp: it.fp, presence, severity: it.effectiveSeverity, engine: it.engine,
      ruleId: it.ruleId, title: it.title || it.ruleId, location: it.locationLabel || '',
      path: it.path || '', count: it.count || 1, ...annOf(records, it.fp),
    };
    if (redaction !== 'strict' && it.evidence) f.evidence = it.evidence;
    findings.push(f);
  }

  const curFps = new Set(curItems.map(i => i.fp));
  let nResolved = 0;
  for (const it of baseItems) {
    if (curFps.has(it.fp)) continue;
    nResolved++;
    findings.push({
      fp: it.fp, presence: 'resolved', severity: it.effectiveSeverity, engine: it.engine,
      ruleId: it.ruleId, title: it.title || it.ruleId, location: it.locationLabel || '',
      path: it.path || '', count: it.count || 1, ...annOf(records, it.fp),
    });
  }

  findings.sort((a, b) =>
    (PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence]) ||
    (SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)));

  const meta = {
    tool: 'QA Touchstone', schema: REPORT_SCHEMA,
    runId: (runRecord && runRecord.runId) || '', status: (runRecord && runRecord.status) || '',
    startedAt: (runRecord && runRecord.startedAt) || '', finishedAt: (runRecord && runRecord.finishedAt) || '',
    durationMs: (runRecord && runRecord.durationMs) || 0, scopeHash: (runRecord && runRecord.scopeHash) || '',
    baseline: baselineRecord ? { runId: baselineRecord.runId || '', scopeHash: baselineRecord.scopeHash || '' } : null,
    scopeMismatch: !!(baselineRecord && baselineRecord.scopeHash && runRecord && baselineRecord.scopeHash !== runRecord.scopeHash),
    redaction,
  };
  return {
    meta,
    engines: (runRecord && runRecord.engines) || [],
    summary: { total: curItems.length, bySeverity, new: nNew, carried: nCarried, resolved: nResolved,
               newHighCritical: gateCount(curItems, lifecycle, diff) },
    findings,
  };
}
