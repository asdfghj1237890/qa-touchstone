import React from 'react';
import './setup';
import { Icon, Spinner } from './components';
import { useI18n } from './useI18n';
import type { QaEnv } from './state/WorkspaceContext';

// ── QA Touchstone — Realtime client: WebSocket + Server-Sent Events ────────
const { useState: useStateRT, useRef: useRefRT, useEffect: useEffectRT } = React;

const RT_PROTOCOLS = [
  { key: 'ws', labelKey: 'realtime.ws', scheme: 'wss://' },
  { key: 'sse', labelKey: 'realtime.sse', scheme: 'https://' },
];

const RT_DEMO_WS_URL = 'wss://ws.postman-echo.com/raw';
const RT_DEMO_SSE_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
const RT_MAX_MESSAGES = 180;
const RT_MAX_BODY_CHARS = 5000;

function rtNow(): string { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
function rtTrimBody(body: unknown): string {
  const text = String(body == null ? '' : body);
  return text.length > RT_MAX_BODY_CHARS
    ? `${text.slice(0, RT_MAX_BODY_CHARS)}\n... truncated ${text.length - RT_MAX_BODY_CHARS} chars`
    : text;
}
async function rtDataToText(data: any): Promise<string> {
  if (typeof data === 'string') return rtTrimBody(data);
  if (data && typeof data.text === 'function') return rtTrimBody(await data.text());
  if (data instanceof ArrayBuffer) return `[binary ${data.byteLength} B]`;
  if (ArrayBuffer.isView(data)) return `[binary ${data.byteLength} B]`;
  return rtTrimBody(String(data || ''));
}

/** 串流訊息一筆（in/out/sys；SSE 另帶 event 名稱）。 */
interface RtMessage {
  dir: 'in' | 'out' | 'sys';
  body: string;
  at?: string;
  event?: string;
}

export interface RealtimeClientProps {
  /** RealtimePage 會傳入 env（目前未使用，保留供之後變數替換）。 */
  env?: QaEnv;
}

function RealtimeClient(_props: RealtimeClientProps = {}) {
  const { t } = useI18n();
  const [proto, setProto] = useStateRT('ws');
  const [url, setUrl] = useStateRT(RT_DEMO_WS_URL);
  const [status, setStatus] = useStateRT('disconnected'); // disconnected | connecting | open | closed
  const [msgs, setMsgs] = useStateRT<RtMessage[]>([]); // {dir, body, at, event}
  const [counts, setCounts] = useStateRT({ in: 0, out: 0 });
  const [compose, setCompose] = useStateRT('{"message":"hello from QA Touchstone","channel":"demo"}');
  const wsRef = useRefRT<WebSocket | null>(null);
  const eventSourceRef = useRefRT<EventSource | null>(null);
  const lastStreamErrorRef = useRefRT(0);
  const scrollRef = useRefRT<HTMLDivElement | null>(null);

  const isWs = proto === 'ws';
  const clearTransport = () => {
    if (wsRef.current) {
      const ws = wsRef.current;
      ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      try { ws.close(1000, 'client disconnect'); } catch {}
      wsRef.current = null;
    }
    if (eventSourceRef.current) {
      const source = eventSourceRef.current;
      source.onopen = null; source.onmessage = null; source.onerror = null;
      try { source.close(); } catch {}
      eventSourceRef.current = null;
    }
  };
  useEffectRT(() => () => clearTransport(), []);
  useEffectRT(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const resetStream = () => { setMsgs([]); setCounts({ in: 0, out: 0 }); };
  const push = (m: Omit<RtMessage, 'at'>) => {
    if (m.dir === 'in' || m.dir === 'out') {
      setCounts(c => ({ ...c, [m.dir as 'in' | 'out']: c[m.dir as 'in' | 'out'] + 1 }));
    }
    setMsgs(list => [...list, { at: rtNow(), ...m }].slice(-RT_MAX_MESSAGES));
  };
  const pushStreamError = (message: string) => {
    const now = Date.now();
    if (now - lastStreamErrorRef.current < 1400) return;
    lastStreamErrorRef.current = now;
    push({ dir: 'sys', body: message });
  };

  const switchProto = (p: string) => {
    clearTransport();
    setProto(p);
    setStatus('disconnected');
    setUrl(p === 'ws' ? RT_DEMO_WS_URL : RT_DEMO_SSE_URL);
    resetStream();
  };

  const connect = () => {
    if (status === 'open' || status === 'connecting') return;
    const targetUrl = url.trim();
    if (!targetUrl) return;
    setStatus('connecting'); resetStream();
    clearTransport();
    if (isWs) {
      if (typeof WebSocket !== 'function') {
        setStatus('closed');
        push({ dir: 'sys', body: t('realtime.unsupported.ws') });
        return;
      }
      const ws = new WebSocket(targetUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        setStatus('open');
        push({ dir: 'sys', body: t('realtime.connectedTo', { url: targetUrl }) });
      };
      ws.onmessage = async (event) => {
        push({ dir: 'in', body: await rtDataToText(event.data), event: 'message' });
      };
      ws.onerror = () => pushStreamError(t('realtime.connectionError'));
      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setStatus('closed');
        push({ dir: 'sys', body: t('realtime.closedWithCode', { code: event && event.code ? event.code : 1000 }) });
      };
      return;
    }
    if (typeof EventSource !== 'function') {
      setStatus('closed');
      push({ dir: 'sys', body: t('realtime.unsupported.sse') });
      return;
    }
    const source = new EventSource(targetUrl);
    eventSourceRef.current = source;
    source.onopen = () => {
      setStatus('open');
      push({ dir: 'sys', body: t('realtime.connectedTo', { url: targetUrl }) });
    };
    source.onmessage = (event) => {
      push({ dir: 'in', body: rtTrimBody(event.data), event: event.type || 'message' });
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        setStatus('closed');
        pushStreamError(t('realtime.connectionError'));
      } else {
        pushStreamError(t('realtime.sseReconnecting'));
      }
    };
  };

  const disconnect = () => {
    clearTransport();
    setStatus('closed');
    push({ dir: 'sys', body: t('realtime.closed') });
  };

  const sendMsg = () => {
    if (status !== 'open' || !compose.trim()) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      push({ dir: 'sys', body: t('realtime.connectionError') });
      return;
    }
    wsRef.current.send(compose);
    push({ dir: 'out', body: compose });
  };

  const connected = status === 'open';
  const inCount = counts.in;
  const outCount = counts.out;

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
        {msgs.length > 0 && <button className="qa-link" onClick={resetStream}>{t('common.clear')}</button>}
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
              <code dangerouslySetInnerHTML={{ __html: m.body[0] === '{' ? window.highlightJson!(m.body) : String(m.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }} />
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

export interface RealtimePageProps {
  env?: QaEnv;
}

function RealtimePage({ env }: RealtimePageProps) {
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
