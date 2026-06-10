import React from 'react';
import './setup';
import { Icon, MethodBadge, PulseLogo } from './components';
import { useI18n } from './useI18n';
import type { QaEnv } from './state/WorkspaceContext';

// ── QA Touchstone — Home dashboard ─────────────────────────────────────────
export interface HomePageProps {
  setRoute: (route: string) => void;
  /** 最近送出的請求（runtime 累積；canned 形狀，型別從寬）。 */
  history: any[];
  onOpenRequest: (entry: any) => void;
  env: QaEnv;
}

function HomePage({ setRoute, history, onOpenRequest, env }: HomePageProps) {
  const { t } = useI18n();
  const tiles = [
    { key: 'testgen', icon: 'sparkle', title: t('home.tile.testgen.title'), desc: t('home.tile.testgen.desc'), cta: t('home.tile.testgen.cta'), onClick: () => setRoute('testgen') },
    { key: 'api', icon: 'send', title: t('home.tile.api.title'), desc: t('home.tile.api.desc'), cta: t('home.tile.api.cta'), onClick: () => setRoute('api') },
    { key: 'perf', icon: 'gauge', title: t('home.tile.perf.title'), desc: t('home.tile.perf.desc'), cta: t('home.tile.perf.cta'), onClick: () => setRoute('perf') },
    { key: 'settings', icon: 'key', title: t('home.tile.settings.title'), desc: t('home.tile.settings.desc'), cta: t('home.tile.settings.cta'), onClick: () => setRoute('settings') },
  ];
  const caps = [
    { icon: 'shield', label: t('home.cap.auth') },
    { icon: 'layers', label: t('home.cap.collections') },
    { icon: 'terminal', label: t('home.cap.execution') },
    { icon: 'gauge', label: t('home.cap.load') },
  ];
  const collTotal = window.QA.COLLECTIONS.reduce((n: number, c: any) => n + c.count, 0);

  return (
    <div className="qa-home">
      <div className="qa-home-inner">
        <header className="qa-home-head">
          <div className="qa-home-badge"><PulseLogo size={42} /></div>
          <div>
            <h1>QA Touchstone</h1>
            <p>{t('home.subtitle')}</p>
          </div>
          <span className="qa-chip">v{__APP_VERSION__}</span>
        </header>

        <div className="qa-home-grid">
          {tiles.map(t => (
            <button key={t.key} className="qa-tile" onClick={t.onClick}>
              <div className="qa-tile-icon"><Icon name={t.icon} size={20} /></div>
              <div className="qa-tile-title">{t.title}</div>
              <div className="qa-tile-desc">{t.desc}</div>
              <div className="qa-tile-cta">{t.cta} <Icon name="chevron" size={14} /></div>
            </button>
          ))}
        </div>

        <div className="qa-home-cols">
          <section className="qa-panel">
            <div className="qa-panel-head">
              <span><Icon name="history" size={14} /> {t('home.recent')}</span>
              <button className="qa-link" onClick={() => setRoute('api')}>{t('home.viewClient')}</button>
            </div>
            <div className="qa-recent">
              {history.slice(0, 5).map((h, i) => (
                <button key={i} className="qa-recent-row" onClick={() => onOpenRequest(h)}>
                  <MethodBadge method={h.method} size="sm" />
                  <span className="qa-recent-path">{h.path}</span>
                  <span className="qa-recent-status" style={{ color: window.QATheme.statusColor(h.status) }}>{h.status}</span>
                  <span className="qa-recent-time">{h.time}ms</span>
                </button>
              ))}
            </div>
          </section>

          <section className="qa-panel">
            <div className="qa-panel-head"><span><Icon name="globe" size={14} /> {t('home.workspace')}</span></div>
            <div className="qa-ws">
              <div className="qa-ws-row"><span>{t('home.activeEnv')}</span><strong>{env.label}</strong></div>
              <div className="qa-ws-row"><span>{t('home.collections')}</span><strong>{window.QA.COLLECTIONS.length}</strong></div>
              <div className="qa-ws-row"><span>{t('home.savedRequests')}</span><strong>{collTotal}</strong></div>
              <div className="qa-ws-row"><span>{t('home.credentialProfiles')}</span><strong>{window.QA.CRED_PROFILES.length}</strong></div>
            </div>
            <div className="qa-caps">
              {caps.map(c => (
                <span className="qa-cap" key={c.label}><Icon name={c.icon} size={13} /> {c.label}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage });

export { HomePage };
