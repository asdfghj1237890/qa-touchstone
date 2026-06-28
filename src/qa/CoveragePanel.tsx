// ── QA Touchstone — test-plan coverage view ────────────────────────────────
import React from 'react';
import './setup';
import { Icon } from './components';
import { useI18n } from './useI18n';
import type { CoverageBucket, CoverageModel } from './coverage';

function CoverageMeter({ value }: { value: number }) {
  return (
    <div className="qa-cov-meter" aria-label={`${value}%`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function BucketCard({
  title,
  bucket,
  emptyText,
}: {
  title: string;
  bucket: CoverageBucket;
  emptyText: string;
}) {
  return (
    <div className="qa-cov-card">
      <div className="qa-cov-card-head">
        <strong>{title}</strong>
        <span>{bucket.percent}%</span>
      </div>
      <CoverageMeter value={bucket.percent} />
      <div className="qa-meta">
        {bucket.covered}/{bucket.total}
      </div>
      {bucket.gaps.length ? (
        <ul className="qa-cov-gaps">
          {bucket.gaps.slice(0, 8).map((g) => (
            <li key={g.id}>
              <Icon name="shield" size={12} />
              <span>{g.label}</span>
              {g.detail && <em>{g.detail}</em>}
            </li>
          ))}
          {bucket.gaps.length > 8 && <li>+{bucket.gaps.length - 8}</li>}
        </ul>
      ) : (
        <div className="qa-cov-empty">{emptyText}</div>
      )}
    </div>
  );
}

export function CoveragePanel({ model }: { model: CoverageModel }) {
  const { t } = useI18n();
  return (
    <div className="qa-cov">
      <div className="qa-sec-head">
        <div>
          <h2>{t('coverage.title')}</h2>
          <p>{t('coverage.subtitle')}</p>
        </div>
      </div>

      <div className="qa-cov-grid">
        <BucketCard
          title={t('coverage.requirements')}
          bucket={model.requirements}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.endpoints')}
          bucket={model.endpoints}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.roles')}
          bucket={model.roles}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.matrixCells')}
          bucket={model.matrixCells}
          emptyText={t('coverage.noGaps')}
        />
      </div>

      <h3 className="qa-cov-section">{t('coverage.securityChecks')}</h3>
      <div className="qa-cov-grid qa-cov-grid--checks">
        <BucketCard
          title={t('coverage.check.conformance')}
          bucket={model.checks.conformance}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.check.bfla')}
          bucket={model.checks.bfla}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.check.bola')}
          bucket={model.checks.bola}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.check.fuzz')}
          bucket={model.checks.fuzz}
          emptyText={t('coverage.noGaps')}
        />
        <BucketCard
          title={t('coverage.check.ratelimit')}
          bucket={model.checks.rateLimit}
          emptyText={t('coverage.noGaps')}
        />
      </div>
    </div>
  );
}

Object.assign(window, { CoveragePanel });
