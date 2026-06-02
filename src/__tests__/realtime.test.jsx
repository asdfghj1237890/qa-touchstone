import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { I18nProvider } from '../qa/i18n.jsx';
import { RealtimePage } from '../qa/Realtime.jsx';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen && this.onopen({});
  }

  send(body) {
    this.sent.push(body);
    this.onmessage && this.onmessage({ data: body });
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose && this.onclose({ code });
  }
}

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
    MockEventSource.instances.push(this);
  }

  open() {
    this.readyState = MockEventSource.OPEN;
    this.onopen && this.onopen({});
  }

  emit(data) {
    this.onmessage && this.onmessage({ type: 'message', data });
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

function renderRealtime() {
  return render(
    <I18nProvider>
      <RealtimePage env={{ label: 'None', baseUrl: '' }} />
    </I18nProvider>
  );
}

describe('RealtimePage live transports', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    document.body.innerHTML = '';
    installLocalStorage({ qa_locale: 'en-US' });
    MockWebSocket.instances = [];
    MockEventSource.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', { value: MockWebSocket, configurable: true });
    Object.defineProperty(window, 'WebSocket', { value: MockWebSocket, configurable: true });
    Object.defineProperty(globalThis, 'EventSource', { value: MockEventSource, configurable: true });
    Object.defineProperty(window, 'EventSource', { value: MockEventSource, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'WebSocket', { value: originalWebSocket, configurable: true });
    Object.defineProperty(window, 'WebSocket', { value: originalWebSocket, configurable: true });
    Object.defineProperty(globalThis, 'EventSource', { value: originalEventSource, configurable: true });
    Object.defineProperty(window, 'EventSource', { value: originalEventSource, configurable: true });
  });

  it('connects to the public Postman WebSocket echo demo and renders echoed frames', async () => {
    renderRealtime();

    expect(screen.getByDisplayValue('wss://ws.postman-echo.com/raw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    expect(MockWebSocket.instances[0].url).toBe('wss://ws.postman-echo.com/raw');

    act(() => MockWebSocket.instances[0].open());
    await waitFor(() => expect(screen.getByText(/Connected to wss:\/\/ws\.postman-echo\.com\/raw/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(MockWebSocket.instances[0].sent[0]).toContain('hello from QA Companion');
    await waitFor(() => expect(document.querySelectorAll('.rt-msg[data-dir="in"]').length).toBe(1));
  });

  it('connects to the public Wikimedia EventStreams SSE demo', async () => {
    renderRealtime();

    fireEvent.click(screen.getByRole('button', { name: 'Server-Sent Events' }));
    expect(screen.getByDisplayValue('https://stream.wikimedia.org/v2/stream/recentchange')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
    expect(MockEventSource.instances[0].url).toBe('https://stream.wikimedia.org/v2/stream/recentchange');

    act(() => {
      MockEventSource.instances[0].open();
      MockEventSource.instances[0].emit('{"type":"edit","wiki":"enwiki"}');
    });
    await waitFor(() => {
      expect(document.querySelector('.rt-msg[data-dir="in"] code').textContent).toContain('"wiki":"enwiki"');
    });
  });

  it('keeps cumulative inbound counts after the visible stream is capped', async () => {
    renderRealtime();

    fireEvent.click(screen.getByRole('button', { name: 'Server-Sent Events' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));

    act(() => {
      MockEventSource.instances[0].open();
      for (let i = 1; i <= 181; i += 1) {
        MockEventSource.instances[0].emit(`{"seq":${i}}`);
      }
    });

    await waitFor(() => expect(screen.getByText('↓ 181')).toBeInTheDocument());
    expect(document.querySelectorAll('.rt-msg[data-dir="in"]').length).toBe(180);
  });
});
