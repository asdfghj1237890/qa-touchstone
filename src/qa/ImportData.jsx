import React from 'react';
import './setup.js';
import { Icon } from './components.jsx';
import { qaParseImport } from './import-parser.js';
import { useI18n } from './useI18n.js';

// ── QA Touchstone — import Postman v2.1 collections & OpenAPI/Swagger specs ─
// Parsing logic lives in ./import-parser.js so setup.js can auto-load the
// bundled demo collection without pulling React in via this module.
const { useState: useStateIM, useRef: useRefIM } = React;

function ImportModal({ onClose, onImport }) {
  const { t } = useI18n();
  const [text, setText] = useStateIM('');
  const [drag, setDrag] = useStateIM(false);
  const fileRef = useRefIM(null);
  const parsed = text.trim() ? qaParseImport(text) : null;
  const ok = parsed && !parsed.error;
  const requestLabel = ok ? t(parsed.collection.count === 1 ? 'import.requestOne' : 'import.requestMany') : '';
  const folderLabel = ok ? t(parsed.collection.folders.length === 1 ? 'import.folderOne' : 'import.folderMany') : '';
  const importLabel = ok ? t('import.requests', { count: parsed.collection.count, requestLabel }) : '';

  const readFile = (file) => { const fr = new FileReader(); fr.onload = () => setText(String(fr.result || '')); fr.readAsText(file); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); };

  return (
    <div className="qa-modal-scrim" onMouseDown={onClose}>
      <div className="qa-modal qa-import" onMouseDown={ev => ev.stopPropagation()}>
        <div className="qa-modal-head">
          <span className="qa-modal-title"><Icon name="download" size={15} /> {t('import.title')}</span>
          <button className="qa-iconbtn" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={15} /></button>
        </div>
        <div className="qa-import-body">
          <div className={'qa-import-drop' + (drag ? ' is-drag' : '')}
               onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
               onClick={() => fileRef.current && fileRef.current.click()}>
            <Icon name="upload" size={22} stroke={1.6} />
            <strong>{t('import.drop')}</strong>
            <em>{t('import.formats')}</em>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                   onChange={e => { const f = e.target.files[0]; if (f) readFile(f); }} />
          </div>
          <div className="qa-import-or">{t('import.orPaste')}</div>
          <textarea className="qa-code-input qa-import-text" spellCheck="false" placeholder='{ "info": { … }, "item": [ … ] }'
                    value={text} onChange={e => setText(e.target.value)} />
          {parsed && parsed.error && <div className="rn-data-err"><Icon name="x" size={12} /> {parsed.error}</div>}
          {ok && (
            <div className="qa-import-preview">
              <div className="qa-import-preview-head">
                <span className="qa-cred-type" data-type={parsed.collection.source === 'postman' ? 'bearer' : 'basic'}>{parsed.format}</span>
                <strong>{parsed.collection.name}</strong>
                <span className="qa-meta">{t('import.preview', { requests: parsed.collection.count, requestLabel, folders: parsed.collection.folders.length, folderLabel })}</span>
              </div>
              {parsed.collection.baseUrl && <div className="qa-env-url">{parsed.collection.baseUrl}</div>}
            </div>
          )}
        </div>
        <div className="qa-modal-foot">
          <button className="qa-pathbtn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="qa-send" disabled={!ok} onClick={() => { onImport(parsed); onClose(); }}>
            <Icon name="download" size={14} /> {t('import.action', { label: importLabel })}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { qaParseImport, ImportModal });

export { qaParseImport, ImportModal };
