// src/qa/FindingsPanel.tsx
import React from 'react';
import './setup';
import { Icon, MethodBadge } from './components';
import { useI18n } from './useI18n';
import { SEVERITY_ORDER } from './oracles';
import {
  fingerprint,
  ruleIdOf,
  locationLabel,
  effectiveSeverity,
  snapshotOf,
  diffRuns,
  gateCount,
  loadLifecycle,
  saveLifecycle,
  upsertRecord,
  loadSnapshots,
  STATUSES,
} from './findings';
import type {
  FindingStatus,
  LifecycleRecord,
  LifecycleState,
  Presence,
  Severity,
  SnapshotItem,
  SnapshotsState,
  UnionFinding,
} from './types';

const { useState: useS, useMemo, useCallback } = React;
const PRESENCE_ORDER: Record<Presence, number> = { new: 0, carried: 1, resolved: 2 };
// Bound the DOM: render at most this many finding rows until the user opts into
// the full list. A scan can legitimately produce thousands of findings, and a
// table with thousands of rows (each expandable) janks badly on every re-render.
export const MAX_VISIBLE_FINDINGS = 300;

/** 顯示列：每個 fingerprint 一列（同 fp 聚合 count）。 */
interface FindingRow {
  fp: string;
  count: number;
  engine: string;
  ruleId: string;
  title: string;
  method?: string;
  endpoint?: string;
  locationLabel: string;
  severity: Severity;
  effectiveSeverity: Severity;
  presence: Presence;
  record: LifecycleRecord | null;
}

// Build display rows: one per fingerprint, with effective severity, presence,
// and the lifecycle record. Same-fp occurrences are grouped (count).
function buildRows(
  union: UnionFinding[] | null | undefined,
  lifecycle: LifecycleState,
  diff: Map<string, Presence>,
  baselineItems: SnapshotItem[]
): FindingRow[] {
  const records = (lifecycle && lifecycle.records) || {};
  const byFp = new Map<string, FindingRow>();
  for (const f of union || []) {
    const { fp } = fingerprint(f);
    const rec = records[fp];
    const existing = byFp.get(fp);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byFp.set(fp, {
      fp,
      count: 1,
      engine: f.engine,
      ruleId: ruleIdOf(f),
      title: f.title,
      method: f.method,
      endpoint: f.endpoint,
      locationLabel: locationLabel(f),
      severity: f.severity,
      effectiveSeverity: effectiveSeverity(f, rec),
      presence: diff.get(fp) || 'new',
      record: rec || null,
    });
  }
  // Resolved findings live only in the pinned baseline snapshot (absent from the
  // current union). Reconstruct a muted row from the snapshot's stored fields.
  for (const bi of baselineItems || []) {
    if (diff.get(bi.fp) !== 'resolved' || byFp.has(bi.fp)) continue;
    byFp.set(bi.fp, {
      fp: bi.fp,
      count: bi.count || 1,
      engine: bi.engine,
      ruleId: bi.ruleId,
      title: bi.locationLabel || bi.ruleId, // snapshots have no title; use the human location label
      method: undefined,
      endpoint: undefined,
      locationLabel: bi.locationLabel || '',
      severity: bi.effectiveSeverity,
      effectiveSeverity: bi.effectiveSeverity,
      presence: 'resolved',
      record: (lifecycle.records && lifecycle.records[bi.fp]) || null,
    });
  }
  return [...byFp.values()].sort(
    (a, b) =>
      PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] ||
      SEVERITY_ORDER.indexOf(b.effectiveSeverity) - SEVERITY_ORDER.indexOf(a.effectiveSeverity)
  );
}

export interface FindingsPanelProps {
  union?: UnionFinding[];
  snapshots?: SnapshotsState | null;
  lifecycle?: LifecycleState | null;
  onPinBaseline?: () => void;
  scopeMismatch?: boolean;
}

function FindingsPanel({
  union = [],
  snapshots: snapshotsProp,
  lifecycle: lifecycleProp,
  onPinBaseline,
  scopeMismatch = false,
}: FindingsPanelProps) {
  const { t } = useI18n();
  // Props win (Security.jsx owns the live state); otherwise own local state.
  const [localLc, setLocalLc] = useS<LifecycleState>(() => lifecycleProp || loadLifecycle());
  const lifecycle = lifecycleProp || localLc;
  const snapshots = snapshotsProp || loadSnapshots();
  const [showSuppressed, setShowSuppressed] = useS(false);
  const [openFp, setOpenFp] = useS<string | null>(null);
  const [legacyDismissed, setLegacyDismissed] = useS(false);
  const [showAll, setShowAll] = useS(false);

  // Patch a finding's record, persist, and reflect locally. `now` is a real ISO
  // timestamp here (UI side); findings.js stays pure by taking it as an arg.
  const patch = useCallback(
    (fp: string, p: Partial<LifecycleRecord>) => {
      const next = upsertRecord(lifecycle, fp, p, new Date().toISOString());
      saveLifecycle(next);
      if (!lifecycleProp) setLocalLc(next);
    },
    [lifecycle, lifecycleProp, setLocalLc]
  );

  const current = useMemo(() => snapshotOf(union, lifecycle, {}), [union, lifecycle]);
  const baselineItems = useMemo(
    () => (snapshots.baseline && snapshots.baseline.items) || [],
    [snapshots.baseline]
  );
  const diff = useMemo(() => diffRuns(current.items, baselineItems), [current, baselineItems]);
  const rows = useMemo(
    () => buildRows(union, lifecycle, diff, baselineItems),
    [union, lifecycle, diff, baselineItems]
  );
  const gate = useMemo(() => gateCount(current.items, lifecycle, diff), [current, lifecycle, diff]);

  const visible = useMemo(
    () => rows.filter((r) => showSuppressed || !(r.record && r.record.suppressed)),
    [rows, showSuppressed]
  );
  // Render only the first MAX_VISIBLE_FINDINGS rows unless the user expands —
  // bounds the DOM for very large scans. An open detail row stays rendered even
  // past the cap so expanding then scrolling never hides the editor.
  const capped = useMemo(
    () => (showAll ? visible : visible.slice(0, MAX_VISIBLE_FINDINGS)),
    [visible, showAll]
  );

  return (
    <div className="qa-find">
      <div className="qa-find-head">
        <span className="qa-find-counter">{t('findings.counter', { count: gate })}</span>
        {onPinBaseline && (
          <button className="qa-btn" onClick={onPinBaseline}>
            <Icon name="save" size={13} /> {t('findings.pinBaseline')}
          </button>
        )}
        <span className="qa-find-baseline">
          {snapshots.baseline
            ? t('findings.baseline.set', { count: baselineItems.length })
            : t('findings.baseline.none')}
        </span>
        {scopeMismatch && (
          <span className="qa-find-scopewarn">{t('findings.baseline.scopeDiffers')}</span>
        )}
        <label className="qa-find-filter">
          <input
            type="checkbox"
            checked={showSuppressed}
            onChange={(e) => setShowSuppressed(e.target.checked)}
          />
          {t('findings.filter.suppressed')}
        </label>
      </div>

      {lifecycle.legacy && !legacyDismissed && (
        <div className="qa-find-legacy">
          {t('findings.legacy.notice')}
          <button className="qa-link" onClick={() => setLegacyDismissed(true)}>
            {t('findings.legacy.dismiss')}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="qa-sec-empty">{t('findings.empty')}</div>
      ) : (
        <table className="qa-find-table">
          <thead>
            <tr>
              <th>{t('findings.col.presence')}</th>
              <th>{t('findings.col.severity')}</th>
              <th>{t('findings.col.engine')}</th>
              <th>{t('findings.col.rule')}</th>
              <th>{t('findings.col.location')}</th>
            </tr>
          </thead>
          <tbody>
            {capped.map((r) => (
              <React.Fragment key={r.fp}>
                <tr
                  className={`qa-find-row qa-presence--${r.presence}`}
                  onClick={() => setOpenFp(openFp === r.fp ? null : r.fp)}
                >
                  <td>
                    <span className={`qa-find-presence qa-presence--${r.presence}`}>
                      {t('findings.presence.' + r.presence)}
                    </span>
                  </td>
                  <td>
                    <span className={`qa-sev--${r.effectiveSeverity}`}>
                      {t('security.severity.' + r.effectiveSeverity)}
                    </span>
                    {r.effectiveSeverity !== r.severity && (
                      <span className="qa-find-orig">
                        {' '}
                        ({t('security.severity.' + r.severity)})
                      </span>
                    )}
                  </td>
                  <td>{r.engine}</td>
                  <td>
                    {r.title}
                    {r.count > 1 && <span className="qa-find-count"> ×{r.count}</span>}
                    {r.record && r.record.suppressed && (
                      <span className="qa-find-suppressed"> · {t('findings.suppressed')}</span>
                    )}
                  </td>
                  <td>
                    {r.method && <MethodBadge method={r.method} size="sm" />}{' '}
                    <code>{r.locationLabel}</code>
                  </td>
                </tr>
                {openFp === r.fp && (
                  <tr className="qa-find-detail">
                    <td colSpan={5}>
                      <label className="qa-find-ctl">
                        <input
                          type="checkbox"
                          aria-label={t('findings.suppress')}
                          checked={!!(r.record && r.record.suppressed)}
                          onChange={(e) => patch(r.fp, { suppressed: e.target.checked })}
                        />
                        {t('findings.suppress')}
                      </label>
                      {r.record && r.record.suppressed && (
                        <input
                          className="qa-inp"
                          aria-label={t('findings.suppressReason')}
                          placeholder={t('findings.suppressReason')}
                          value={r.record.suppressReason || ''}
                          onChange={(e) => patch(r.fp, { suppressReason: e.target.value })}
                        />
                      )}
                      <label className="qa-find-ctl">
                        {t('findings.col.status')}:
                        <select
                          aria-label={t('findings.col.status')}
                          value={(r.record && r.record.status) || 'open'}
                          onChange={(e) => patch(r.fp, { status: e.target.value as FindingStatus })}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t('findings.status.' + s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="qa-find-ctl">
                        {t('findings.severityOverride')}:
                        <select
                          aria-label={t('findings.severityOverride')}
                          value={(r.record && r.record.severityOverride) || ''}
                          onChange={(e) =>
                            patch(r.fp, {
                              severityOverride: (e.target.value || null) as Severity | null,
                            })
                          }
                        >
                          <option value="">{t('findings.override.none')}</option>
                          {SEVERITY_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {t('security.severity.' + s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input
                        className="qa-inp"
                        aria-label={t('findings.owner')}
                        placeholder={t('findings.owner')}
                        value={(r.record && r.record.owner) || ''}
                        onChange={(e) => patch(r.fp, { owner: e.target.value })}
                      />
                      <textarea
                        className="qa-inp"
                        aria-label={t('findings.note')}
                        placeholder={t('findings.note')}
                        value={(r.record && r.record.note) || ''}
                        onChange={(e) => patch(r.fp, { note: e.target.value })}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {visible.length > MAX_VISIBLE_FINDINGS && (
        <div className="qa-find-more">
          <button className="qa-link" onClick={() => setShowAll((s) => !s)}>
            {showAll
              ? t('findings.showFewer')
              : t('findings.showAll', { shown: MAX_VISIBLE_FINDINGS, count: visible.length })}
          </button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { FindingsPanel });
export { FindingsPanel, buildRows };
