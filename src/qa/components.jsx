import React from 'react';
import './setup.js';

// ── QA Touchstone — icons + shared atoms ───────────────────────────────────
// Simple stroke icons (Lucide-style 24x24 paths) and small shared components.

const ICON_PATHS = {
  home:        'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  send:        'M14.5 3.5 21 12l-6.5 8.5M3 12h17',
  settings:    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z|M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z',
  folder:      'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  chevron:     'M9 6l6 6-6 6',
  search:      'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  plus:        'M12 5v14M5 12h14',
  x:           'M6 6l12 12M18 6 6 18',
  eye:         'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff:      'M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.4 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.1 3.9M6.1 6.2A18 18 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 2.6-.4',
  copy:        'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z|M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check:       'M5 13l4 4L19 7',
  clock:       'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  key:         'M15.5 9.5a3.5 3.5 0 1 1-3.4 4.4L9 17l-2 0 0 2-2 0 0 2-3 0 0-3 6.1-6.1A3.5 3.5 0 0 1 15.5 9.5Z',
  shield:      'M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3Z',
  terminal:    'M5 7l5 5-5 5M13 17h6',
  zap:         'M13 3 4 14h7l-1 7 9-11h-7l1-7Z',
  layers:      'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  history:     'M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 8v4l3 2',
  trash:       'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
  download:    'M12 3v12M7 11l5 4 5-4M5 21h14',
  link:        'M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 1 0-5.7-5.7L12 7M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 1 0 5.7 5.7L12 17',
  server:      'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01',
  panel:       'M4 4h16v16H4zM9 4v16',
  dot:         'M12 12h.01',
  globe:       'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z',
  filter:      'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  save:        'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  refresh:     'M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4',
  bolt:        'M13 3 4 14h7l-1 7 9-11h-7l1-7Z',
  code:        'M16 18l6-6-6-6M8 6l-6 6 6 6',
  request:     'M4 6h16M4 12h10M4 18h7',
  gauge:       'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z|M13.4 10.6 17 7M4.5 18a9 9 0 1 1 15 0',
  activity:    'M3 12h4l3-8 4 16 3-8h4',
  play:        'M7 4l13 8-13 8V4Z',
  stop:        'M6 6h12v12H6z',
  beaker:      'M9 3h6M10 3v6.5L4.8 18A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-3L14 9.5V3M7.5 14h9',
  sparkle:     'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z|M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8L19 14Z',
  users:       'M16 19a4 4 0 0 0-8 0M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 19a3.5 3.5 0 0 0-4.5-3.3M18 10.8A3.5 3.5 0 0 0 18 4.2',
  upload:      'M12 15V3M7 7l5-4 5 4M5 21h14',
  fileText:    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6',
};

function Icon({ name, size = 16, stroke = 2, style, className }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const parts = d.split('|');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
         strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      {parts.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

// App icon mark, matching src-tauri/icons/source.svg. A bright pulse sweeps
// the line continuously; on successful requests it flashes green, and while a
// performance test is running it stays in that active color.
const PULSE_PATH = 'M1 12 H9 l1.2 -3 l1.4 6 l1.8 -11.5 l1.8 16.5 l1.4 -8 H27';
function PulseLogo({ busy, flashAt, active, size = 22 }) {
  const [flash, setFlash] = React.useState(false);
  React.useEffect(() => {
    if (!flashAt) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1000);
    return () => clearTimeout(t);
  }, [flashAt]);
  return (
    <svg className="qa-pulse" data-busy={busy ? '1' : '0'} data-flash={flash ? '1' : '0'} data-active={active ? '1' : '0'}
         width={size} height={size} viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="qa-logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#252d36" /><stop offset="1" stopColor="#0c0f13" />
        </linearGradient>
        <radialGradient id="qa-logo-ambient" cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#4d9fff" stopOpacity="0.30" />
          <stop offset="1" stopColor="#4d9fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="qa-logo-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="qa-logo-stroke" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#7fd6ff" /><stop offset="0.55" stopColor="#4d9fff" /><stop offset="1" stopColor="#3b78ff" />
        </linearGradient>
        <filter id="qa-logo-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="15" floodColor="#4d9fff" floodOpacity="0.95" />
        </filter>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="224" fill="url(#qa-logo-bg)" />
      <rect x="64" y="64" width="896" height="896" rx="224" fill="url(#qa-logo-ambient)" />
      <rect x="64" y="64" width="896" height="896" rx="224" fill="url(#qa-logo-sheen)" />
      <rect x="68" y="68" width="888" height="888" rx="220" fill="none" stroke="#7fb8ff" strokeOpacity="0.22" strokeWidth="3" />
      <g transform="translate(214,268) scale(21)" strokeLinecap="round" strokeLinejoin="round">
        <path className="qa-pulse-base" d={PULSE_PATH} pathLength="100" stroke="#4d9fff" strokeWidth="2.2" />
        <path className="qa-pulse-sweep" d={PULSE_PATH} pathLength="100" stroke="url(#qa-logo-stroke)" strokeWidth="2.2" filter="url(#qa-logo-glow)" />
      </g>
    </svg>
  );
}

function MethodBadge({ method, size = 'md' }) {
  const color = window.QATheme.methodColor(method);
  const fs = size === 'sm' ? '10px' : size === 'lg' ? '12px' : '11px';
  return (
    <span style={{
      color, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: fs,
      letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap',
      minWidth: size === 'lg' ? 52 : 44, display: 'inline-block', textAlign: 'right',
    }}>{method}</span>
  );
}

function StatusPill({ code, text, big }) {
  const color = window.QATheme.statusColor(code);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color, fontFamily: 'var(--font-mono)', fontWeight: 700,
      fontSize: big ? '14px' : '12px',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
      {code}{text ? ` ${text}` : ''}
    </span>
  );
}

function Spinner({ size = 16 }) {
  return (
    <span className="qa-spin" style={{
      width: size, height: size, borderRadius: '50%',
      border: '2px solid var(--accent-line)', borderTopColor: 'var(--accent)',
      display: 'inline-block',
    }} />
  );
}

// Tiny toggle row used in params/headers tables.
function MiniCheck({ on, onClick }) {
  return (
    <button onClick={onClick} className="qa-minicheck" data-on={on ? '1' : '0'} aria-label="toggle row">
      {on && <Icon name="check" size={11} stroke={3} />}
    </button>
  );
}

// Custom dropdown (replaces native <select> for reliable styling + rendering).
function Dropdown({ value, options, onChange, className, renderOption, renderValue }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const cur = opts.find(o => o.value === value);
  return (
    <div className={'qa-dd ' + (className || '')} ref={ref}>
      <button className="qa-dd-btn" onClick={() => setOpen(o => !o)} type="button">
        <span>{cur ? (renderValue ? renderValue(cur) : cur.label) : value}</span>
        <Icon name="chevron" size={14} className="qa-dd-chev" data-open={open ? '1' : '0'} />
      </button>
      {open && (
        <div className="qa-dd-menu">
          {opts.map(o => (
            <button key={o.value} type="button" data-active={o.value === value ? '1' : '0'}
                    title={o.title || (typeof o.label === 'string' ? o.label : undefined)}
                    onClick={() => { onChange(o.value); setOpen(false); }}>
              {renderOption ? renderOption(o) : o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtBytesShared(b) {
  b = Math.round(b);
  if (b <= 0) return '0 B';
  if (b < 1024) return b + ' B';
  return (b / 1024).toFixed(1) + ' KB';
}

function highlightJson(json) {
  json = String(json).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let cls = 'qa-j-num';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'qa-j-key' : 'qa-j-str';
      else if (/true|false/.test(m)) cls = 'qa-j-bool';
      else if (/null/.test(m)) cls = 'qa-j-null';
      return `<span class="${cls}">${m}</span>`;
    }
  );
}

Object.assign(window, { Icon, PulseLogo, MethodBadge, StatusPill, Spinner, MiniCheck, Dropdown, fmtBytesShared, highlightJson });

// Shared LLM config (used by Test Gen + Settings; persisted in localStorage).
const LLM_DEFAULT_CFG = { provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: 'https://api.openai.com/v1/chat/completions' };
const LLM_PROVIDERS = [
  { value: 'builtin', label: 'Claude (built-in, no key)' },
  { value: 'openai',  label: 'OpenAI' },
  { value: 'custom',  label: 'Custom (OpenAI-compatible)' },
];
function loadLlmCfg() {
  try { return { ...LLM_DEFAULT_CFG, ...JSON.parse(localStorage.getItem('qa_llm_cfg') || '{}') }; }
  catch { return { ...LLM_DEFAULT_CFG }; }
}
function saveLlmCfg(cfg) { try { localStorage.setItem('qa_llm_cfg', JSON.stringify(cfg)); } catch {} }
Object.assign(window, { LLM_DEFAULT_CFG, LLM_PROVIDERS, loadLlmCfg, saveLlmCfg });

export { Icon, PulseLogo, MethodBadge, StatusPill, Spinner, MiniCheck, Dropdown, fmtBytesShared, highlightJson };
export { LLM_DEFAULT_CFG, LLM_PROVIDERS, loadLlmCfg, saveLlmCfg };
