import React from 'react';
import './setup';
import { Icon } from './components';
import { useI18n } from './useI18n';
import type { I18nValue } from './i18nContext';
import type { EngineId, EngineRunSummary, ReportRedaction } from './types';

const { useState: useS } = React;

const ORDER: EngineId[] = ['matrix', 'bola', 'ratelimit'];

/** 報告匯出格式。 */
export type ReportFormat = 'json' | 'html' | 'junit' | 'sarif';

/** 完成的 suite run 摘要（Security 頁存 Snapshot 形狀；aborted 時只有部分欄位）。 */
export interface SuiteLastRecord {
  status?: string;
  engines?: EngineRunSummary[];
  durationMs?: number;
  [k: string]: unknown;
}

/** Security 頁的 suite run UI 狀態（lastRecord 在 aborted 時可能是部分形狀）。 */
export interface SuiteUiState {
  running: boolean;
  engine?: EngineId | null;
  done?: number;
  total?: number;
  lastRecord?: SuiteLastRecord | null;
}

export interface SuiteRunBarProps {
  suite: SuiteUiState;
  onRun: () => void;
  onStop: () => void;
  canExport?: boolean;
  onExport?: (fmt: ReportFormat, redaction: ReportRedaction) => void;
  canEvidence?: boolean;
  onSaveEvidence?: () => void;
}

function fmtDuration(ms: number | undefined): string {
  const s = Math.round((ms || 0) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

// One-line summary of a completed run's engine breakdown.
function summarize(record: SuiteLastRecord, t: I18nValue['t']): string {
  return (record.engines || [])
    .map((e) => `${t('suite.engine.' + e.engine)} ${e.ran ? e.findingCount : t('suite.skipped')}`)
    .join(' · ');
}

function SuiteRunBar({
  suite,
  onRun,
  onStop,
  canExport,
  onExport,
  canEvidence,
  onSaveEvidence,
}: SuiteRunBarProps) {
  const { t } = useI18n();
  const rec = suite.lastRecord;
  const [expOpen, setExpOpen] = useS(false);
  const [redaction, setRedaction] = useS<ReportRedaction>('redacted');
  const FORMATS: ReportFormat[] = ['json', 'html', 'junit', 'sarif'];
  return (
    <div className="qa-suite">
      {suite.running ? (
        <>
          <span className="qa-suite-status">
            {suite.total
              ? t('suite.running', {
                  engine: t('suite.engine.' + (suite.engine || 'matrix')),
                  done: suite.done,
                  total: suite.total,
                })
              : t('suite.runningNoCount', {
                  engine: t('suite.engine.' + (suite.engine || 'matrix')),
                })}
          </span>
          <span className="qa-suite-pipe">
            {ORDER.map((e) => (
              <span
                key={e}
                className={`qa-suite-step ${suite.engine === e ? 'qa-suite-step--on' : ''}`}
              >
                {t('suite.engine.' + e)}
              </span>
            ))}
          </span>
          <button className="qa-btn qa-btn--danger qa-btn--sm" onClick={onStop}>
            <Icon name="stop" size={13} /> {t('suite.stop')}
          </button>
        </>
      ) : (
        <>
          <button className="qa-btn qa-btn--primary" onClick={onRun}>
            <Icon name="play" size={14} /> {t('suite.run')}
          </button>
          {rec && rec.status === 'aborted' ? (
            <span className="qa-suite-status qa-suite-status--warn">
              {t('suite.aborted', {
                engine: t(
                  'suite.engine.' +
                    ((rec.engines || []).filter((e) => e.ran).pop() || { engine: 'matrix' }).engine
                ),
              })}
            </span>
          ) : rec ? (
            <span className="qa-suite-status">
              {t('suite.last', {
                status: t('suite.status.' + rec.status),
                duration: fmtDuration(rec.durationMs),
                summary: summarize(rec, t),
              })}
            </span>
          ) : (
            <span className="qa-suite-status">{t('suite.idle')}</span>
          )}
          {canExport && onExport && (
            <span className="qa-report-export">
              <button className="qa-btn qa-btn--sm" onClick={() => setExpOpen((v) => !v)}>
                {t('report.export')} ▾
              </button>
              {expOpen && (
                <span className="qa-report-menu">
                  <label className="qa-report-redaction">
                    {t('report.redaction')}:
                    <select
                      value={!canEvidence && redaction === 'evidence' ? 'redacted' : redaction}
                      onChange={(e) => setRedaction(e.target.value as ReportRedaction)}
                    >
                      <option value="redacted">{t('report.redaction.redacted')}</option>
                      <option value="strict">{t('report.redaction.strict')}</option>
                      {canEvidence && (
                        <option value="evidence">{t('report.redaction.evidence')}</option>
                      )}
                    </select>
                  </label>
                  {canEvidence && onSaveEvidence && (
                    <button
                      className="qa-report-fmt"
                      onClick={() => {
                        onSaveEvidence();
                        setExpOpen(false);
                      }}
                    >
                      {t('report.saveEvidence')}
                    </button>
                  )}
                  {FORMATS.map((fmt) => (
                    <button
                      key={fmt}
                      className="qa-report-fmt"
                      onClick={() => {
                        onExport(fmt, redaction);
                        setExpOpen(false);
                      }}
                    >
                      {t('report.format.' + fmt)}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}

Object.assign(window, { SuiteRunBar });
export { SuiteRunBar };
