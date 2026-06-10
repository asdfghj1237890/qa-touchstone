// src/qa/securityReport.ts
// ── QA Touchstone — security report / artifact layer (pure, no React/DOM) ───
// One report model assembled from a recorded RunRecord + baseline + current
// lifecycle, plus serializers to JSON / HTML / JUnit / SARIF. UI in SuiteRunBar.
import './setup';
import { SEVERITY_ORDER } from './oracles';
import { diffRuns, gateCount } from './findings';
import type {
  EvidenceArtifact, LifecycleLike, LifecycleRecord, Presence, ReportFinding, ReportMeta,
  ReportModel, Severity, Snapshot, SnapshotItem,
} from './types';

export const REPORT_SCHEMA = 'qa-security-report/1';
const PRESENCE_ORDER: Record<Presence, number> = { new: 0, carried: 1, resolved: 2 };

// Lifecycle annotations for a fp, with safe defaults.
function annOf(records: Record<string, Partial<LifecycleRecord>>, fp: string): { suppressed: boolean; suppressReason: string; status: string; owner: string; note: string } {
  const r = records[fp] || {};
  return {
    suppressed: !!r.suppressed, suppressReason: r.suppressReason || '',
    status: r.status || 'open', owner: r.owner || '', note: r.note || '',
  };
}

// Build the normalized report model. `severity` is the recorded effective
// severity (frozen in the run item); annotations join from the CURRENT lifecycle.
export function buildReport(
  runRecord: Snapshot | null | undefined,
  baselineRecord: Snapshot | null | undefined,
  lifecycle: LifecycleLike,
  opts: { redaction?: string; evidence?: Map<string, EvidenceArtifact> | null } = {},
): ReportModel {
  const redaction = opts.redaction === 'strict' ? 'strict'
    : (opts.redaction === 'evidence' ? 'evidence' : 'redacted');
  const evidenceSrc = opts.evidence;
  const records = (lifecycle && lifecycle.records) || {};
  const curItems: SnapshotItem[] = (runRecord && runRecord.items) || [];
  const baseItems: SnapshotItem[] = (baselineRecord && baselineRecord.items) || [];
  const diff = diffRuns(curItems, baseItems);

  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  let nNew = 0, nCarried = 0;
  const findings: ReportFinding[] = [];

  for (const it of curItems) {
    const presence = diff.get(it.fp) || 'new';
    if (presence === 'new') nNew++; else if (presence === 'carried') nCarried++;
    if (bySeverity[it.effectiveSeverity] !== undefined) bySeverity[it.effectiveSeverity]++;
    const f: ReportFinding = {
      fp: it.fp, presence, severity: it.effectiveSeverity, engine: it.engine,
      ruleId: it.ruleId, title: it.title || it.ruleId, location: it.locationLabel || '',
      path: it.path || '', count: it.count || 1, ...annOf(records, it.fp),
    };
    if (redaction !== 'strict' && it.evidence) f.evidence = it.evidence;
    if (redaction === 'evidence') {
      const art = (evidenceSrc && evidenceSrc.get && evidenceSrc.get(it.fp)) || it.evidenceArtifact || null;
      if (art) f.evidenceArtifact = art;
    }
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

  const meta: ReportMeta = {
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

export function reportToJson(model: ReportModel): string { return JSON.stringify(model, null, 2); }

export function htmlEscape(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export function xmlEscape(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as Record<string, string>)[c]);
}

// A finding fails the gate iff it is NEW, effective severity high/critical, not suppressed.
function isGateFailure(f: ReportFinding): boolean {
  return f.presence === 'new' && (f.severity === 'high' || f.severity === 'critical') && !f.suppressed;
}

export function reportToJUnit(model: ReportModel): string {
  const current = model.findings.filter(f => f.presence !== 'resolved');
  const failures = current.filter(isGateFailure).length;
  const skipped = current.filter(f => f.suppressed).length;
  const byEngine: Record<string, ReportFinding[]> = {};
  for (const f of current) (byEngine[f.engine] = byEngine[f.engine] || []).push(f);
  const suites = Object.keys(byEngine).map(engine => {
    const fs = byEngine[engine];
    const cases = fs.map(f => {
      const name = xmlEscape(`${f.ruleId} @ ${f.location}`);
      const cls = xmlEscape(engine);
      if (isGateFailure(f)) {
        const body = `${f.location}${f.evidence ? '\n' + f.evidence : ''}${f.note ? '\n' + f.note : ''}`.replace(/]]>/g, ']]]]><![CDATA[>');
        return `    <testcase name="${name}" classname="${cls}"><failure message="${xmlEscape(f.title + ' (' + f.severity + ')')}"><![CDATA[${body}]]></failure></testcase>`;
      }
      if (f.suppressed) return `    <testcase name="${name}" classname="${cls}"><skipped message="${xmlEscape('suppressed: ' + f.suppressReason)}"/></testcase>`;
      return `    <testcase name="${name}" classname="${cls}"/>`;
    }).join('\n');
    const sFail = fs.filter(isGateFailure).length;
    const sSkip = fs.filter(f => f.suppressed).length;
    return `  <testsuite name="${xmlEscape(engine)}" tests="${fs.length}" failures="${sFail}" skipped="${sSkip}">\n${cases}\n  </testsuite>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="QA Touchstone Security" tests="${current.length}" failures="${failures}" skipped="${skipped}" time="${((model.meta.durationMs || 0) / 1000).toFixed(3)}">\n${suites}\n</testsuites>\n`;
}

export function sevToSarifLevel(sev: string | null | undefined): 'error' | 'warning' | 'note' {
  if (sev === 'critical' || sev === 'high') return 'error';
  if (sev === 'medium') return 'warning';
  return 'note';
}
export function sarifBaselineState(presence: string | null | undefined): 'unchanged' | 'new' { return presence === 'carried' ? 'unchanged' : 'new'; }

/** SARIF 2.1.0 result（最小子集）。 */
type SarifResult = {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: Array<{ logicalLocations: Array<{ fullyQualifiedName: string; kind: string }> }>;
  partialFingerprints: { qaFingerprint: string };
  baselineState: string;
  properties: Record<string, unknown>;
  suppressions?: Array<{ kind: string; justification: string }>;
};

export function reportToSarif(model: ReportModel): string {
  const current = model.findings.filter(f => f.presence !== 'resolved');
  const rules = [...new Set(current.map(f => f.ruleId))].map(id => ({ id }));
  const results = current.map(f => {
    const r: SarifResult = {
      ruleId: f.ruleId, level: sevToSarifLevel(f.severity),
      message: { text: `${f.title}${f.evidence ? ' — ' + f.evidence : ''} at ${f.location}` },
      locations: [{ logicalLocations: [{ fullyQualifiedName: f.location, kind: 'member' }] }],
      partialFingerprints: { qaFingerprint: f.fp },
      baselineState: sarifBaselineState(f.presence),
      properties: { engine: f.engine, severity: f.severity, owner: f.owner, status: f.status, count: f.count },
    };
    if (f.suppressed) r.suppressions = [{ kind: 'external', justification: f.suppressReason || '' }];
    return r;
  });
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: 'QA Touchstone', informationUri: 'https://github.com/asdfghj1237890/qa-touchstone', rules } }, results }],
  }, null, 2);
}

// Render a finding's evidence cell: an expandable <details> when an artifact is
// present, else the plain masked string. Everything is htmlEscape-d.
export function evidenceCellHtml(f: ReportFinding): string {
  const h = htmlEscape;
  const plain = f.evidence ? '<code>' + h(f.evidence) + '</code>' : '';
  const a = f.evidenceArtifact;
  if (!a) return plain;
  const req = a.request || {};
  const reqLine = h(`${req.method || ''} ${req.url || ''}`.trim());
  const hdr = (obj: Record<string, string> | null | undefined) => Object.keys(obj || {}).map(k => `${h(k)}: ${h(obj![k])}`).join('\n');
  let resp = '';
  if (a.response) {
    const r = a.response;
    const snip = r.snippet != null
      ? JSON.stringify(r.snippet, null, 2)
      : (r.nonJson ? `(${r.nonJson.contentType || 'non-JSON'}, ${r.nonJson.length} bytes — body omitted)` : '');
    resp = `<div>status ${h(String(r.status))}${r.truncated ? ' · truncated' : ''}</div>`
      + (Object.keys(r.headers || {}).length ? `<pre>${hdr(r.headers)}</pre>` : '')
      + (snip ? `<pre>${h(snip)}</pre>` : '');
  } else if (a.stats) {
    resp = `<div>${h(String(a.stats.sent))} sent · throttle seen: ${a.stats.throttleSeen ? 'yes' : 'no'}</div>`;
  }
  return `<details><summary>${plain || 'evidence'}</summary>`
    + `<pre>${reqLine}</pre>`
    + (Object.keys(req.headers || {}).length ? `<pre>${hdr(req.headers)}</pre>` : '')
    + resp + '</details>';
}

export function reportToHtml(model: ReportModel): string {
  const m = model.meta, s = model.summary, h = htmlEscape;
  const sevChips = SEVERITY_ORDER.slice().reverse()
    .filter(sev => s.bySeverity[sev]).map(sev => `<span class="chip sev-${sev}">${s.bySeverity[sev]} ${sev}</span>`).join('');
  const engRows = model.engines.map(e =>
    `<tr><td>${h(e.engine)}</td><td>${e.ran ? e.findingCount : h(e.skipped || 'skipped')}</td><td>${Math.round((e.durationMs || 0) / 1000)}s</td><td>${h(e.error || '')}</td></tr>`).join('');
  const findRows = model.findings.map(f =>
    `<tr class="p-${f.presence}${f.suppressed ? ' suppressed' : ''}"><td>${f.presence}</td><td class="sev-${f.severity}">${f.severity}</td><td>${h(f.engine)}</td><td>${h(f.title)}${f.count > 1 ? ' ×' + f.count : ''}</td><td><code>${h(f.location)}</code></td><td>${h(f.owner)}</td><td>${h(f.status)}${f.suppressed ? ' (suppressed)' : ''}</td><td>${evidenceCellHtml(f)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Touchstone — Security report</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}.gate{font-size:20px;font-weight:700}.chip{display:inline-block;padding:2px 8px;margin:2px;border-radius:10px;background:#eee}.sev-critical,.sev-high{color:#b91c1c}.sev-medium{color:#b45309}.suppressed,.p-resolved{opacity:.55}</style>
</head><body>
<h1>QA Touchstone — Security report</h1>
<p>Run ${h(m.runId)} · ${h(m.status)} · ${Math.round((m.durationMs || 0) / 1000)}s · ${h(m.finishedAt)}${m.scopeMismatch ? ' · <strong>baseline scope differs</strong>' : ''}</p>
<p class="gate">${s.newHighCritical} new high/critical</p>
<p>${s.total} findings — ${s.new} new · ${s.carried} carried · ${s.resolved} resolved</p>
<div>${sevChips}</div>
<h2>Engines</h2><table><thead><tr><th>Engine</th><th>Findings</th><th>Duration</th><th>Error</th></tr></thead><tbody>${engRows}</tbody></table>
<h2>Findings</h2><table><thead><tr><th>State</th><th>Severity</th><th>Engine</th><th>Rule</th><th>Location</th><th>Owner</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${findRows}</tbody></table>
</body></html>`;
}
