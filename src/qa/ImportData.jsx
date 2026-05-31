import React from 'react';
import './setup.js';
import { Icon } from './components.jsx';
import { qaParseImport } from './import-parser.js';

// ── QA Touchstone — import Postman v2.1 collections & OpenAPI/Swagger specs ─
// Parsing logic lives in ./import-parser.js so setup.js can auto-load the
// bundled demo collection without pulling React in via this module.
const { useState: useStateIM, useRef: useRefIM } = React;

function ImportModal({ onClose, onImport }) {
  const [text, setText] = useStateIM('');
  const [drag, setDrag] = useStateIM(false);
  const fileRef = useRefIM(null);
  const parsed = text.trim() ? qaParseImport(text) : null;
  const ok = parsed && !parsed.error;

  const readFile = (file) => { const fr = new FileReader(); fr.onload = () => setText(String(fr.result || '')); fr.readAsText(file); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); };

  return (
    <div className="qa-modal-scrim" onMouseDown={onClose}>
      <div className="qa-modal qa-import" onMouseDown={ev => ev.stopPropagation()}>
        <div className="qa-modal-head">
          <span className="qa-modal-title"><Icon name="download" size={15} /> Import collection</span>
          <button className="qa-iconbtn" onClick={onClose} aria-label="close"><Icon name="x" size={15} /></button>
        </div>
        <div className="qa-import-body">
          <div className={'qa-import-drop' + (drag ? ' is-drag' : '')}
               onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
               onClick={() => fileRef.current && fileRef.current.click()}>
            <Icon name="upload" size={22} stroke={1.6} />
            <strong>Drop a file or click to browse</strong>
            <em>Postman v2.1 collection (.json) · OpenAPI / Swagger (.json)</em>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                   onChange={e => { const f = e.target.files[0]; if (f) readFile(f); }} />
          </div>
          <div className="qa-import-or">or paste below</div>
          <textarea className="qa-code-input qa-import-text" spellCheck="false" placeholder='{ "info": { … }, "item": [ … ] }'
                    value={text} onChange={e => setText(e.target.value)} />
          {parsed && parsed.error && <div className="rn-data-err"><Icon name="x" size={12} /> {parsed.error}</div>}
          {ok && (
            <div className="qa-import-preview">
              <div className="qa-import-preview-head">
                <span className="qa-cred-type" data-type={parsed.collection.source === 'postman' ? 'bearer' : 'basic'}>{parsed.format}</span>
                <strong>{parsed.collection.name}</strong>
                <span className="qa-meta">{parsed.collection.count} request{parsed.collection.count !== 1 ? 's' : ''} · {parsed.collection.folders.length} folder{parsed.collection.folders.length !== 1 ? 's' : ''}</span>
              </div>
              {parsed.collection.baseUrl && <div className="qa-env-url">{parsed.collection.baseUrl}</div>}
            </div>
          )}
        </div>
        <div className="qa-modal-foot">
          <button className="qa-pathbtn" onClick={onClose}>Cancel</button>
          <button className="qa-send" disabled={!ok} onClick={() => { onImport(parsed); onClose(); }}>
            <Icon name="download" size={14} /> Import {ok ? `${parsed.collection.count} request${parsed.collection.count !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { qaParseImport, ImportModal });

export { qaParseImport, ImportModal };
