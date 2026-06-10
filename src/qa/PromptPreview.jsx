// src/qa/PromptPreview.jsx
// ── QA Touchstone — prompt preview host + imperative approval bridge ────────
import './setup';
import React from 'react';
import { useI18n } from './useI18n';

let _host = null;                 // single mounted host callback
const _skip = new Set();          // session-scoped skip keys (memory only)

function skipKey(meta) {
  const d = meta && meta.destination;
  return `${meta && meta.site}|${meta && meta.mode}|${d && d.provider}`;
}

// Imperative API used by qaAiSend. Resolves true=send, false=cancel/deny.
export function requestPromptApproval(promptText, meta) {
  if (_skip.has(skipKey(meta))) return Promise.resolve(true);
  if (!_host) return Promise.resolve(false);   // no UI mounted → deny (CI/non-interactive)
  return new Promise((resolve) => { _host({ promptText, meta, resolve }); });
}

// Test/host helpers.
export function __registerHost(fn) { _host = fn; return () => { if (_host === fn) _host = null; }; }
export function __unregisterHost() { _host = null; }
export function __addSessionSkip(meta) { _skip.add(skipKey(meta)); }
export function __resetPreviewState() { _host = null; _skip.clear(); }

export function PromptPreviewHost() {
  const { t } = useI18n();
  const [req, setReq] = React.useState(null);
  const [skip, setSkip] = React.useState(false);
  React.useEffect(() => __registerHost((r) => { setSkip(false); setReq(r); }), []);
  if (!req) return null;
  const { promptText, meta, resolve } = req;
  const finish = (ok) => { if (ok && skip) _skip.add(skipKey(meta)); setReq(null); resolve(ok); };
  const dest = meta.destination || {};
  return (
    <div className="qa-modal-backdrop" role="dialog" aria-modal="true">
      <div className="qa-modal qa-aiprev">
        <div className="qa-aiprev-head">
          <span>{t('ai.preview.title')}</span>
          <span className="qa-aiprev-dest" data-cloud={dest.isCloud ? '1' : '0'}>
            {dest.label || dest.provider} · {dest.isCloud ? t('ai.preview.cloud') : t('ai.preview.local')} · {t('ai.preview.mode.' + meta.mode)}
          </span>
        </div>
        <pre className="qa-aiprev-body" data-testid="preview-prompt">{promptText}</pre>
        <label className="qa-aiprev-skip">
          <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} /> {t('ai.preview.skipSession')}
        </label>
        <div className="qa-aiprev-actions">
          <button className="qa-btn" data-testid="preview-cancel" onClick={() => finish(false)}>{t('common.cancel')}</button>
          <button className="qa-btn qa-btn-primary" data-testid="preview-send" onClick={() => finish(true)}>{t('ai.preview.send')}</button>
        </div>
      </div>
    </div>
  );
}
