// src/__tests__/ratelimit-panel.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitPanel } from '../qa/RateLimitPanel.jsx';
import { I18nProvider } from '../qa/i18n.jsx';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }, clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

const identities = [{ id: 'anon', name: 'anon', auth: { type: 'none' } }];
const rl = (n = 5, sensitivity = 'sensitive') => ({ tests: [{ id: 'rl1', reqId: 'r1', method: 'POST', path: 'https://api.test/login', identityId: 'anon', n, concurrency: 2, sensitivity }] });

function renderPanel(rlState) {
  return render(
    <I18nProvider>
      <RateLimitPanel identities={identities} rateLimit={rlState} setRateLimit={() => {}}
                      env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('RateLimitPanel — runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'POST', name: 'login', path: 'https://api.test/login' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
  });

  it('requires the confirm modal before any burst, then flags a vuln + finding when unthrottled', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: {} } };
    renderPanel(rl());

    // Clicking Run opens the confirm modal but sends nothing yet.
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    expect(document.querySelector('.qa-rl-confirm')).not.toBeNull();
    expect(document.querySelector('.qa-rl-verdict')).toBeNull();

    // Confirm fires the burst.
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--vuln')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.qa-sec-findpanel, .qa-rl-findpanel')).not.toBeNull();
    // The stats card reflects the burst size (N=5 from the rl() helper).
    expect(document.querySelector('.qa-rl-result').textContent).toContain('5 sent');
  });

  it('reports pass when a rate-limit header is present', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: { 'Retry-After': '5' } } };
    renderPanel(rl());
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--pass')).not.toBeNull(), { timeout: 4000 });
  });
});
