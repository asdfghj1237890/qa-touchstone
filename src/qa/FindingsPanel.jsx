// src/qa/FindingsPanel.jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge } from './components.jsx';
import { useI18n } from './useI18n.js';
import { SEVERITY_ORDER } from './oracles.js';
import {
  fingerprint, ruleIdOf, locationLabel, effectiveSeverity, snapshotOf, diffRuns, gateCount,
  loadLifecycle, loadSnapshots,
} from './findings.js';

const { useState: useS, useMemo } = React;
const PRESENCE_ORDER = { new: 0, carried: 1, resolved: 2 };

// Build display rows: one per fingerprint, with effective severity, presence,
// and the lifecycle record. Same-fp occurrences are grouped (count).
function buildRows(union, lifecycle, diff) {
  const records = (lifecycle && lifecycle.records) || {};
  const byFp = new Map();
  for (const f of (union || [])) {
    const { fp } = fingerprint(f);
    const rec = records[fp];
    const existing = byFp.get(fp);
    if (existing) { existing.count += 1; continue; }
    byFp.set(fp, {
      fp, count: 1, engine: f.engine, ruleId: ruleIdOf(f), title: f.title,
      method: f.method, endpoint: f.endpoint, locationLabel: locationLabel(f),
      severity: f.severity, effectiveSeverity: effectiveSeverity(f, rec),
      presence: diff.get(fp) || 'new', record: rec || null,
    });
  }
  return [...byFp.values()].sort((a, b) =>
    (PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence]) ||
    (SEVERITY_ORDER.indexOf(b.effectiveSeverity) - SEVERITY_ORDER.indexOf(a.effectiveSeverity)));
}

function FindingsPanel({ union = [], snapshots: snapshotsProp, lifecycle: lifecycleProp, onPinBaseline }) {
  const { t } = useI18n();
  // Props win (Security.jsx owns the live state); otherwise read storage directly.
  const lifecycle = lifecycleProp || loadLifecycle();
  const snapshots = snapshotsProp || loadSnapshots();
  const [showSuppressed, setShowSuppressed] = useS(false);

  const current = useMemo(() => snapshotOf(union, lifecycle, {}), [union, lifecycle]);
  const baselineItems = (snapshots.baseline && snapshots.baseline.items) || [];
  const diff = useMemo(() => diffRuns(current.items, baselineItems), [current, baselineItems]);
  const rows = useMemo(() => buildRows(union, lifecycle, diff), [union, lifecycle, diff]);
  const gate = useMemo(() => gateCount(current.items, lifecycle, diff), [current, lifecycle, diff]);

  const visible = rows.filter(r => showSuppressed || !(r.record && r.record.suppressed));

  return (
    <div className="qa-find">
      <div className="qa-find-head">
        <span className="qa-find-counter">{t('findings.counter', { count: gate })}</span>
        {onPinBaseline && (
          <button className="qa-btn" onClick={onPinBaseline}><Icon name="save" size={13} /> {t('findings.pinBaseline')}</button>
        )}
        <span className="qa-find-baseline">
          {snapshots.baseline
            ? t('findings.baseline.set', { count: baselineItems.length })
            : t('findings.baseline.none')}
        </span>
        <label className="qa-find-filter">
          <input type="checkbox" checked={showSuppressed} onChange={e => setShowSuppressed(e.target.checked)} />
          {t('findings.filter.suppressed')}
        </label>
      </div>

      {lifecycle.legacy && (
        <div className="qa-find-legacy">{t('findings.legacy.notice')}</div>
      )}

      {visible.length === 0 ? (
        <div className="qa-sec-empty">{t('findings.empty')}</div>
      ) : (
        <table className="qa-find-table">
          <thead><tr>
            <th>{t('findings.col.presence')}</th><th>{t('findings.col.severity')}</th>
            <th>{t('findings.col.engine')}</th><th>{t('findings.col.rule')}</th>
            <th>{t('findings.col.location')}</th>
          </tr></thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.fp} className={`qa-find-row qa-presence--${r.presence}`}>
                <td><span className={`qa-find-presence qa-presence--${r.presence}`}>{t('findings.presence.' + r.presence)}</span></td>
                <td>
                  <span className={`qa-sev--${r.effectiveSeverity}`}>{t('security.severity.' + r.effectiveSeverity)}</span>
                  {r.effectiveSeverity !== r.severity && <span className="qa-find-orig"> ({t('security.severity.' + r.severity)})</span>}
                </td>
                <td>{r.engine}</td>
                <td>{r.title}{r.count > 1 && <span className="qa-find-count"> ×{r.count}</span>}</td>
                <td>{r.method && <MethodBadge method={r.method} size="sm" />} <code>{r.locationLabel}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

Object.assign(window, { FindingsPanel });
export { FindingsPanel, buildRows };
