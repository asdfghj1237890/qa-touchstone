import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MonitorsPage } from '../qa/Monitors.jsx';
import { I18nProvider } from '../qa/i18n.jsx';

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

function renderMonitors(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('Monitors Run now executes real assertions (canned fallback)', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 7, size: 4, body: { ok: true }, headers: {} } };
    window.QA.MONITORS = [{ id: 'm1', name: 'M', collectionId: 'c1', env: 'None', cadence: 'Every hour',
      region: 'us-east-1', enabled: true, nextRun: 'in 5 min', runs: [] }];
  });

  it('records a deterministic pass run (1/1) instead of random', async () => {
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    renderMonitors(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('counts a failing assertion as a failed run (0/1)', async () => {
    // Canned response is a 500 — the status==200 assertion fails.
    window.QA.RESPONSES = { r1: { status: 500, statusText: 'Server Error', time: 7, size: 4, body: null, headers: {} } };
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    renderMonitors(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/0\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('with no assertions, a 2xx counts as pass via the status fallback', async () => {
    renderMonitors(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={{}} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('still records the run under React.StrictMode (mount→cleanup→mount)', async () => {
    // StrictMode runs effect setup→cleanup→setup at mount; a cleanup-only
    // mounted-guard would leave the ref stuck false, so runNow's post-await
    // guard would skip setMonitors/setRunning and the button would hang on
    // "Running…". This reproduces that exact path.
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(
      <React.StrictMode>
        <I18nProvider>
          <MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                        vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />
        </I18nProvider>
      </React.StrictMode>
    );
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
