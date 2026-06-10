import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import App from '../App';

// The redesigned QA Touchstone is a single-window app with a left nav rail and
// nine routes. Outside Tauri the request executor falls back to canned
// responses, so the send → response flow is exercisable in jsdom.

const RAIL_LABELS = [
  'Home', 'Test Gen', 'API Client', 'Realtime', 'Runner',
  'Monitors', 'API Docs', 'Performance', 'Settings',
];

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

describe('App (redesign shell)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    installLocalStorage({ qa_locale: 'en-US' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title bar and lands on Home', () => {
    render(<App />);
    expect(document.querySelector('.qa-titlebar-name').textContent).toBe('QA Touchstone');
    expect(document.querySelector('.qa-titlebar-route').textContent).toBe('Home');
    // Home dashboard tiles (unique copy)
    expect(screen.getByText('Test Generation')).toBeInTheDocument();
    expect(screen.getByText('Credentials & Env')).toBeInTheDocument();
  });

  it('renders macOS-style traffic-light controls on non-Windows platforms', () => {
    const prev = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
    Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });
    try {
      render(<App />);
      expect(screen.getByRole('button', { name: 'Close window' })
        .classList.contains('qa-winctl-close')).toBe(true);
      expect(document.querySelector('.qa-winctl-win')).toBeNull();
    } finally {
      if (prev) Object.defineProperty(navigator, 'userAgentData', prev);
      else delete navigator.userAgentData;
    }
  });

  it('renders Windows-style controls in minimize/maximize/close order on Windows', () => {
    const prev = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');
    Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'Windows' }, configurable: true });
    try {
      render(<App />);
      expect(document.querySelector('.qa-winctl-win')).not.toBeNull();
      const order = [...document.querySelectorAll('.qa-winctl-win button')]
        .map((b) => b.getAttribute('aria-label'));
      expect(order).toEqual(['Minimize window', 'Maximize window', 'Close window']);
      expect(screen.getByRole('button', { name: 'Close window' })
        .classList.contains('qa-winctl-wclose')).toBe(true);
    } finally {
      if (prev) Object.defineProperty(navigator, 'userAgentData', prev);
      else delete navigator.userAgentData;
    }
  });

  it('exposes all nine nav-rail destinations', () => {
    render(<App />);
    RAIL_LABELS.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('opens the API Client with collections and a Send action', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API Client' }));
    // The bundled public-apis demo collection auto-loads at boot, so the
    // sidebar shows it and its first request without any user import step.
    expect(screen.getByText('Public Live APIs — Verified Demo')).toBeInTheDocument();
    expect(screen.getByText('JSONPlaceholder todo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
  });

  it('sends a request and renders the response (canned fallback)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API Client' }));
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(
      () => expect(screen.getByText(/200/)).toBeInTheDocument(),
      { timeout: 4000 }
    );
  });

  it('switches to Settings and shows its tabs', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('AI / LLM')).toBeInTheDocument();
  });

  it('switches the UI language to Traditional Chinese', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByText('English (US)').closest('button'));
    // Dropdown 選項現在是 ARIA listbox/option（鍵盤可達），不再是裸 button。
    fireEvent.click(screen.getByRole('option', { name: '繁體中文' }));
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(document.querySelector('.qa-titlebar-route').textContent).toBe('設定');
    expect(screen.getByRole('button', { name: '首頁' })).toBeInTheDocument();
  });

  it('renders the remaining feature routes without crashing', () => {
    render(<App />);
    ['Test Gen', 'Realtime', 'Runner', 'Monitors', 'API Docs', 'Performance'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: label }));
      const content = document.querySelector('.qa-content');
      expect(content).toBeTruthy();
      expect(content.textContent.length).toBeGreaterThan(0);
    });
  });

  it('runs due monitors on the background cadence before the Monitors route is opened', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-02T00:00:00Z').getTime();
    vi.setSystemTime(now);
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 7, size: 4, body: { ok: true }, headers: {} } };
    window.QA.MONITORS = [{ id: 'm1', name: 'M', collectionId: 'c1', env: 'None', cadence: 'Every 5 minutes',
      region: 'us-east-1', enabled: true, nextDueAt: now - 1, runs: [] }];

    render(<App />);
    await vi.advanceTimersByTimeAsync(3000);

    fireEvent.click(screen.getByRole('button', { name: 'Monitors' }));
    expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument();
  });
});
