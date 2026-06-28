// ── QA Touchstone — batch AI response review panel ─────────────────────────
import React from 'react';
import './setup';
import { Icon, MethodBadge } from './components';
import { useI18n } from './useI18n';
import { runBatchResponseReview } from './batchReview';
import type { BatchReviewResult, ReviewPriority, ReviewSource } from './batchReview';

const { useState: useS } = React;

const PRIO_LABEL: Record<ReviewPriority, string> = {
  p1: 'security.review.p1',
  p2: 'security.review.p2',
  p3: 'security.review.p3',
};

type ReviewRunResult = BatchReviewResult & { dropped: number; total: number };

export interface BatchReviewPanelProps {
  responses?: ReviewSource[];
  aiReady?: boolean;
  runner?: (responses: ReviewSource[]) => Promise<ReviewRunResult>;
}

function BatchReviewPanel({ responses = [], aiReady, runner }: BatchReviewPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useS(false);
  const [busy, setBusy] = useS(false);
  const [error, setError] = useS<string | null>(null);
  const [review, setReview] = useS<ReviewRunResult | null>(null);
  const [expanded, setExpanded] = useS<Record<number, boolean>>({});
  const doReview = runner || runBatchResponseReview;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReview(await doReview(responses));
      setOpen(true);
    } catch (e: any) {
      setError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !aiReady || !responses.length;
  const hint = !aiReady
    ? t('security.review.aiUnavailable')
    : !responses.length
      ? t('security.review.empty')
      : undefined;

  return (
    <div className="qa-sec-triage qa-sec-review">
      <div className="qa-sec-triage-head">
        <button
          className="qa-iconbtn"
          onClick={() => setOpen((o) => !o)}
          title={t('security.review.title')}
        >
          <span className={open ? '' : 'qa-rot-90'}>
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <h3>
          <Icon name="sparkle" size={14} /> {t('security.review.title')}
        </h3>
        <span className="qa-meta">{t('security.review.count', { count: responses.length })}</span>
        <button className="qa-link" onClick={run} disabled={disabled} title={hint}>
          <Icon name="zap" size={13} />{' '}
          {busy ? t('security.review.running') : t('security.review.run')}
        </button>
      </div>

      {open && (
        <div className="qa-sec-triage-body">
          {error && <div className="qa-sec-drawer-err">{error}</div>}
          {review && review.dropped > 0 && (
            <div className="qa-meta">
              {t('security.review.capped', {
                kept: review.total - review.dropped,
                total: review.total,
                dropped: review.dropped,
              })}
            </div>
          )}
          {review && review.headline && (
            <div className="qa-sec-triage-headline">{review.headline}</div>
          )}
          {review && review.items.length === 0 && (
            <div className="qa-sec-empty">{t('security.review.none')}</div>
          )}
          {review &&
            review.items.map((it, i) => (
              <div key={i} className={`qa-sec-triage-item qa-prio--${it.priority}`}>
                <div
                  className="qa-sec-triage-item-head"
                  onClick={() => setExpanded((e) => ({ ...e, [i]: !e[i] }))}
                >
                  <span className={`qa-sec-triage-prio qa-prio--${it.priority}`}>
                    {t(PRIO_LABEL[it.priority])}
                  </span>
                  <span className="qa-sec-triage-title">{it.title}</span>
                  {it.likelyBug && (
                    <span className="qa-sec-triage-fp">{t('security.review.likelyBug')}</span>
                  )}
                  <span className="qa-meta">
                    {t('security.review.responseCount', { count: it.responses.length })}
                  </span>
                </div>
                {it.rationale && <div className="qa-sec-triage-rationale">{it.rationale}</div>}
                {expanded[i] && (
                  <ul className="qa-sec-findlist">
                    {it.responses.map((r, j) => (
                      <li key={j}>
                        <MethodBadge method={r.method} size="sm" />
                        <code className="qa-sec-find-path">{r.path}</code>
                        {r.identity && <span className="qa-sec-find-id">{r.identity}</span>}
                        <span className="qa-sec-find-ev">
                          {r.status ?? '-'} {r.verdict ? `· ${r.verdict}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BatchReviewPanel });
export { BatchReviewPanel };
