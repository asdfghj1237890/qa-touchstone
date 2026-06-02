import React from 'react';
import './setup.js';
import { Icon, Spinner, highlightJson } from './components.jsx';
import { useI18n } from './useI18n.js';

// ── QA Companion — Realtime client: WebSocket + Server-Sent Events ────────
const { useState: useStateRT, useRef: useRefRT, useEffect: useEffectRT } = React;

const RT_PROTOCOLS = [
  { key: 'ws', labelKey: 'realtime.ws', scheme: 'wss://' },
  { key: 'sse', labelKey: 'realtime.sse', scheme: 'https://' },
];

// Canned inbound traffic the mock server "pushes" once connected.
const WS_SCRIPT = [
  { dir: 'in', delay: 400, body: '{"type":"welcome","sessionId":"sess_8f2c","heartbeat":30}' },
  { dir: 'in', delay: 1600, body: '{"type":"presence","online":42}' },
  { dir: 'in', delay: 3200, body: '{"type":"ping"}' },
];
const SSE_SCRIPT = [
  { event: 'open', delay: 300, body: 'stream opened' },
  { event: 'message', delay: 900, body: '{"id":1,"price":128.40,"symbol":"ACME"}' },
  { event: 'message', delay: 1900, body: '{"id":2,"price":128.92,"symbol":"ACME"}' },
  { event: 'price', delay: 2900, body: '{"id":3,"price":129.05,"symbol":"ACME"}' },
  { event: 'message', delay: 3900, body: '{"id":4,"price":128.71,"symbol":"ACME"}' },
];

function rtNow() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }

function RealtimeClient({ env }) {
  const { t } = useI18n();
  const [proto, setProto] = useStateRT('ws');
  const [url, setUrl] = useStateRT('wss://staging.api.acme.dev/ws/events');
  const [status, setStatus] = useStateRT('disconnected'); // disconnected | connecting | open | closed
  const [msgs, setMsgs] = useStateRT([]); // {dir, body, at, event}
  const [compose, setCompose] = useStateRT('{"type":"subscribe","channel":"orders"}');
  const timersRef = useRefRT([]);
  const scrollRef = useRefRT(null);

  const isWs = proto === 'ws';
  const clearTimers = () => { timersRef.current.forEach(t => clearTimeout(t)); timersRef.current = []; };
  useEffectRT(() => () => clearTimers(), []);
  useEffectRT(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const push = (m) => setMsgs(list => [...list, { at: rtNow(), ...m }]);

  const switchProto = (p) => {
    if (status !== 'disconnected') disconnect();
    setProto(p);
    setUrl(p === 'ws' ? 'wss://staging.api.acme.dev/ws/events' : 'https://staging.api.acme.dev/sse/prices');
    setMsgs([]);
  };

  const connect = () => {
    if (status === 'open' || status === 'connecting') return;
    setStatus('connecting'); setMsgs([]);
    const t0 = setTimeout(() => {
      setStatus('open');
      push({ dir: 'sys', body: t('realtime.connectedTo', { url }) });
      const script = isWs ? WS_SCRIPT : SSE_SCRIPT;
      script.forEach(s => {
        const t = setTimeout(() => push({ dir: 'in', body: s.body, event: s.event }), s.delay);
        timersRef.current.push(t);
      });
      if (!isWs) { // SSE keeps emitting periodic events
        let n = 5;
        const tick = () => {
          const t = setTimeout(() => {
            push({ dir: 'in', body: `{"id":${n},"price":${(128 + Math.random() * 2).toFixed(2)},"symbol":"ACME"}`, event: 'price' });
            n++; tick();
          }, 2600);
          timersRef.current.push(t);
        };
        tick();
      }
    }, 650);
    timersRef.current.push(t0);
  };

  const disconnect = () => {
    clearTimers();
    setStatus('closed');
    push({ dir: 'sys', body: t('realtime.closed') });
  };

  const sendMsg = () => {
    if (status !== 'open' || !compose.trim()) return;
    push({ dir: 'out', body: compose });
    // Mock server echoes an ack.
    const t = setTimeout(() => push({ dir: 'in', body: `{"type":"ack","of":${JSON.stringify(safeChannel(compose))}}` }), 480);
    timersRef.current.push(t);
  };

  const connected = status === 'open';
  const inCount = msgs.filter(m => m.dir === 'in').length;
  const outCount = msgs.filter(m => m.dir === 'out').length;

  return (
    <div className="rt">
      <div className="rt-bar">
        <div className="qa-segs rt-proto">
          {RT_PROTOCOLS.map(p => (
            <button key={p.key} data-active={proto === p.key ? '1' : '0'} onClick={() => switchProto(p.key)}>{t(p.labelKey)}</button>
          ))}
        </div>
        <div className="rt-url">
          <span className="rt-scheme" data-status={status}>{status === 'open' ? '●' : '○'}</span>
          <input value={url} onChange={e => setUrl(e.target.value)} spellCheck="false"
                 placeholder={isWs ? 'wss://host/path' : 'https://host/stream'} disabled={connected} />
        </div>
        {connected || status === 'connecting'
          ? <button className="rt-btn rt-btn--off" onClick={disconnect}>{status === 'connecting' ? <Spinner size={14} /> : <Icon name="stop" size={14} />} {status === 'connecting' ? t('common.connecting') : t('common.disconnect')}</button>
          : <button className="rt-btn" onClick={connect}><Icon name="bolt" size={14} /> {t('common.connect')}</button>}
      </div>

      <div className="rt-statusline">
        <span className="rt-stat" data-status={status}>{t(`realtime.status.${status}`)}</span>
        <span className="qa-meta">{isWs ? 'WebSocket' : 'text/event-stream'}</span>
        <span className="rt-counts"><span className="rt-c-in">↓ {inCount}</span> <span className="rt-c-out">↑ {outCount}</span></span>
        {msgs.length > 0 && <button className="qa-link" onClick={() => setMsgs([])}>{t('common.clear')}</button>}
      </div>

      <div className="rt-stream" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="pf-empty rt-empty">
            <div className="pf-empty-icon"><Icon name={isWs ? 'bolt' : 'activity'} size={26} stroke={1.5} /></div>
            <div className="pf-empty-title">{isWs ? t('realtime.empty.wsTitle') : t('realtime.empty.sseTitle')}</div>
            <div className="pf-empty-sub">{isWs ? t('realtime.empty.wsSub') : t('realtime.empty.sseSub')}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="rt-msg" data-dir={m.dir}>
            <span className="rt-msg-arrow">{m.dir === 'in' ? '↓' : m.dir === 'out' ? '↑' : '•'}</span>
            <div className="rt-msg-body">
              {m.event && <span className="rt-msg-event">{m.event}</span>}
              <code dangerouslySetInnerHTML={{ __html: m.body[0] === '{' ? window.highlightJson(m.body) : String(m.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }} />
            </div>
            <span className="rt-msg-at">{m.at}</span>
          </div>
        ))}
      </div>

      {isWs && (
        <div className="rt-compose">
          <textarea value={compose} onChange={e => setCompose(e.target.value)} spellCheck="false"
                    placeholder='{"type":"subscribe","channel":"orders"}' disabled={!connected}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMsg(); }} />
          <button className="rt-send" onClick={sendMsg} disabled={!connected}>
            <Icon name="send" size={14} /> {t('realtime.send')}
          </button>
        </div>
      )}
      {!isWs && connected && (
        <div className="rt-ssehint"><Icon name="activity" size={13} /> {t('realtime.sseHint')}</div>
      )}
    </div>
  );
}
function safeChannel(s) { try { return JSON.parse(s).channel || JSON.parse(s).type || 'message'; } catch { return 'message'; } }

function RealtimePage({ env }) {
  const { t } = useI18n();
  return (
    <div className="qa-realtime">
      <div className="rt-head">
        <h2>{t('realtime.title')}</h2>
        <p>{t('realtime.subtitle')}</p>
      </div>
      <RealtimeClient env={env} />
    </div>
  );
}

Object.assign(window, { RealtimePage, RealtimeClient });

export { RealtimePage, RealtimeClient };
