// src/qa/TriagePanel.jsx
// QA Companion — batch AI triage card. Advisory only: renders a separate
// prioritized/clustered view over the union of engine findings and never
// mutates them. Pure logic lives in triage.js.
import React from 'react';
import './setup.js';
import { Icon } from './components.jsx';
import { useI18n } from './useI18n.js';
import { I18nProvider } from './i18n.jsx';
import { runTriage } from './triage.js';

const { useState: useS } = React;
const PRIO_LABEL = { p1: 'security.triage.p1', p2: 'security.triage.p2', p3: 'security.triage.p3' };

function TriagePanelInner({ union = [], aiReady, onGoToEngine, runner }) {
  const { t } = useI18n();
  const doTriage = runner || runTriage;
  const [open, setOpen] = useS(true);
  const [busy, setBusy] = useS(false);
  const [error, setError] = useS(null);
  const [triage, setTriage] = useS(null);
  const [expanded, setExpanded] = useS({});

  const run = async () => {
    setBusy(true); setError(null);
    try { setTriage(await doTriage(union)); }
    catch (e) { setError(String((e && e.message) || e)); }
    finally { setBusy(false); }
  };

  const disabled = busy || !aiReady || !union.length;
  const hint = !aiReady ? t('security.triage.aiUnavailable') : (!union.length ? t('security.triage.empty') : undefined);

  return (
    <div className="qa-sec-triage">
      <div className="qa-sec-triage-head">
        <button className="qa-iconbtn" onClick={() => setOpen(o => !o)} title={t('security.triage.title')}>
          <span className={open ? '' : 'qa-rot-90'}>
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <h3><Icon name="sparkle" size={14} /> {t('security.triage.title')}</h3>
        <button className="qa-link" onClick={run} disabled={disabled} title={hint}>
          <Icon name="zap" size={13} /> {busy ? t('security.triage.running') : t('security.triage.run')}
        </button>
      </div>

      {open && (
        <div className="qa-sec-triage-body">
          {error && <div className="qa-sec-drawer-err">{error}</div>}
          {triage && triage.dropped > 0 && (
            <div className="qa-meta">{t('security.triage.capped', { kept: triage.total - triage.dropped, total: triage.total, dropped: triage.dropped })}</div>
          )}
          {triage && triage.headline && <div className="qa-sec-triage-headline">{triage.headline}</div>}
          {triage && triage.items.length === 0 && <div className="qa-sec-empty">{t('security.triage.none')}</div>}
          {triage && triage.items.map((it, i) => (
            <div key={i} className={`qa-sec-triage-item qa-prio--${it.priority}`}>
              <div className="qa-sec-triage-item-head" onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}>
                <span className={`qa-sec-triage-prio qa-prio--${it.priority}`}>{t(PRIO_LABEL[it.priority])}</span>
                <span className="qa-sec-triage-cat">{t('security.triage.cat.' + it.category)}</span>
                <span className="qa-sec-triage-title">{it.title}</span>
                {it.likelyFalsePositive && <span className="qa-sec-triage-fp">{t('security.triage.fp')}</span>}
                <span className="qa-meta">{t('security.triage.count', { count: it.findings.length })}</span>
              </div>
              {it.rationale && <div className="qa-sec-triage-rationale">{it.rationale}</div>}
              {expanded[i] && (
                <ul className="qa-sec-findlist">
                  {it.findings.map((f, j) => (
                    <li key={j} className={`qa-sev--${f.severity}`}>
                      <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                      <span className="qa-sec-find-oracle">{t('security.triage.engine.' + f.engine)}</span>
                      <code className="qa-sec-find-path">{f.path}</code>
                      {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                      <button className="qa-link qa-sec-triage-goto" onClick={() => onGoToEngine && onGoToEngine(f.engine)}>
                        {t('security.triage.goto', { engine: t('security.triage.engine.' + f.engine) })}
                      </button>
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

function TriagePanel(props) {
  return (
    <I18nProvider>
      <TriagePanelInner {...props} />
    </I18nProvider>
  );
}

Object.assign(window, { TriagePanel });
export { TriagePanel };
