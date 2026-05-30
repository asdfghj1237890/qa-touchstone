import React from 'react';
import './setup.js';
import { Icon, MethodBadge, PulseLogo } from './components.jsx';

// ── QA Touchstone — Home dashboard ─────────────────────────────────────────
function HomePage({ setRoute, history, onOpenRequest, env }) {
  const tiles = [
    { key: 'testgen', icon: 'sparkle', title: 'Test Generation', desc: 'Turn a spec, BDD feature, or PRD into classified test cases.', cta: 'Generate', onClick: () => setRoute('testgen') },
    { key: 'api', icon: 'send', title: 'API Client', desc: 'Build requests, switch environments, and inspect responses.', cta: 'Open client', onClick: () => setRoute('api') },
    { key: 'perf', icon: 'gauge', title: 'Performance', desc: 'Run performance, load, and stress tests with live metrics.', cta: 'Open tests', onClick: () => setRoute('perf') },
    { key: 'settings', icon: 'key', title: 'Credentials & Env', desc: 'Manage credential profiles, tokens, and environment paths.', cta: 'Open settings', onClick: () => setRoute('settings') },
  ];
  const caps = [
    { icon: 'shield', label: '5 auth methods' },
    { icon: 'layers', label: 'Postman collections' },
    { icon: 'terminal', label: 'Local execution' },
    { icon: 'gauge', label: 'Load & stress testing' },
  ];
  const collTotal = window.QA.COLLECTIONS.reduce((n, c) => n + c.count, 0);

  return (
    <div className="qa-home">
      <div className="qa-home-inner">
        <header className="qa-home-head">
          <div className="qa-home-badge"><PulseLogo size={26} /></div>
          <div>
            <h1>QA Touchstone</h1>
            <p>Local-first API client for QA workflows — Postman-compatible.</p>
          </div>
          <span className="qa-chip">v0.14.0</span>
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
              <span><Icon name="history" size={14} /> Recent requests</span>
              <button className="qa-link" onClick={() => setRoute('api')}>View client</button>
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
            <div className="qa-panel-head"><span><Icon name="globe" size={14} /> Workspace</span></div>
            <div className="qa-ws">
              <div className="qa-ws-row"><span>Active environment</span><strong>{env.label}</strong></div>
              <div className="qa-ws-row"><span>Collections</span><strong>{window.QA.COLLECTIONS.length}</strong></div>
              <div className="qa-ws-row"><span>Saved requests</span><strong>{collTotal}</strong></div>
              <div className="qa-ws-row"><span>Credential profiles</span><strong>{window.QA.CRED_PROFILES.length}</strong></div>
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
