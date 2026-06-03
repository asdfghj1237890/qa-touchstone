// src/qa/FindingsPanel.jsx
import React from 'react';
import './setup.js';
import { Icon, MethodBadge } from './components.jsx';
import { useI18n } from './useI18n.js';
import { SEVERITY_ORDER } from './oracles.js';
import {
  fingerprint, ruleIdOf, locationLabel, effectiveSeverity, snapshotOf, diffRuns, gateCount,
  loadLifecycle, saveLifecycle, upsertRecord, loadSnapshots, STATUSES,
} from './findings.js';

const { useState: useS, useMemo, useCallback } = React;
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

function FindingsPanel({ union = [], snapshots: snapshotsProp, lifecycle: lifecycleProp, onPinBaseline, scopeMismatch = false }) {
  const { t } = useI18n();
  // Props win (Security.jsx owns the live state); otherwise own local state.
  const [localLc, setLocalLc] = useS(() => lifecycleProp || loadLifecycle());
  const lifecycle = lifecycleProp || localLc;
  const snapshots = snapshotsProp || loadSnapshots();
  const [showSuppressed, setShowSuppressed] = useS(false);
  const [openFp, setOpenFp] = useS(null);

  // Patch a finding's record, persist, and reflect locally. `now` is a real ISO
  // timestamp here (UI side); findings.js stays pure by taking it as an arg.
  const patch = useCallback((fp, p) => {
    const next = upsertRecord(lifecycle, fp, p, new Date().toISOString());
    saveLifecycle(next);
    if (!lifecycleProp) setLocalLc(next);
  }, [lifecycle, lifecycleProp]);

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
        {scopeMismatch && <span className="qa-find-scopewarn">{t('findings.baseline.scopeDiffers')}</span>}
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
              <React.Fragment key={r.fp}>
                <tr className={`qa-find-row qa-presence--${r.presence}`} onClick={() => setOpenFp(openFp === r.fp ? null : r.fp)}>
                  <td><span className={`qa-find-presence qa-presence--${r.presence}`}>{t('findings.presence.' + r.presence)}</span></td>
                  <td>
                    <span className={`qa-sev--${r.effectiveSeverity}`}>{t('security.severity.' + r.effectiveSeverity)}</span>
                    {r.effectiveSeverity !== r.severity && <span className="qa-find-orig"> ({t('security.severity.' + r.severity)})</span>}
                  </td>
                  <td>{r.engine}</td>
                  <td>{r.title}{r.count > 1 && <span className="qa-find-count"> ×{r.count}</span>}{r.record && r.record.suppressed && <span className="qa-find-suppressed"> · {t('findings.suppressed')}</span>}</td>
                  <td>{r.method && <MethodBadge method={r.method} size="sm" />} <code>{r.locationLabel}</code></td>
                </tr>
                {openFp === r.fp && (
                  <tr className="qa-find-detail"><td colSpan={5}>
                    <label className="qa-find-ctl">
                      <input type="checkbox" aria-label={t('findings.suppress')}
                             checked={!!(r.record && r.record.suppressed)}
                             onChange={e => patch(r.fp, { suppressed: e.target.checked })} />
                      {t('findings.suppress')}
                    </label>
                    {r.record && r.record.suppressed && (
                      <input className="qa-inp" aria-label={t('findings.suppressReason')} placeholder={t('findings.suppressReason')}
                             value={r.record.suppressReason || ''} onChange={e => patch(r.fp, { suppressReason: e.target.value })} />
                    )}
                    <label className="qa-find-ctl">{t('findings.col.status')}:
                      <select aria-label={t('findings.col.status')} value={(r.record && r.record.status) || 'open'}
                              onChange={e => patch(r.fp, { status: e.target.value })}>
                        {STATUSES.map(s => <option key={s} value={s}>{t('findings.status.' + s)}</option>)}
                      </select>
                    </label>
                    <label className="qa-find-ctl">{t('findings.severityOverride')}:
                      <select aria-label={t('findings.severityOverride')} value={(r.record && r.record.severityOverride) || ''}
                              onChange={e => patch(r.fp, { severityOverride: e.target.value || null })}>
                        <option value="">{t('findings.override.none')}</option>
                        {SEVERITY_ORDER.map(s => <option key={s} value={s}>{t('security.severity.' + s)}</option>)}
                      </select>
                    </label>
                    <input className="qa-inp" aria-label={t('findings.owner')} placeholder={t('findings.owner')}
                           value={(r.record && r.record.owner) || ''} onChange={e => patch(r.fp, { owner: e.target.value })} />
                    <textarea className="qa-inp" aria-label={t('findings.note')} placeholder={t('findings.note')}
                              value={(r.record && r.record.note) || ''} onChange={e => patch(r.fp, { note: e.target.value })} />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

Object.assign(window, { FindingsPanel });
export { FindingsPanel, buildRows };
