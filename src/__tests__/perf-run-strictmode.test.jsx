import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerfTest } from '../qa/PerfTest.jsx';
import { I18nProvider } from '../qa/i18n.jsx';
import api from '../api/index.js';

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

// Regression guard for the StrictMode mounted-guard bug: PerfTest's cleanup-only
// effect left mountedRef stuck false under React.StrictMode (the real App wraps
// <App/> in StrictMode), so run() bailed right after `await writeTempText` —
// before launching k6 — and the Run button did nothing in dev builds.
describe('PerfTest Run under React.StrictMode', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Cat fact', path: 'https://catfact.ninja/fact' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    api.writeTempText = vi.fn().mockResolvedValue('/tmp/script.js');
    api.runK6WithRealTimeOutput = vi.fn().mockResolvedValue(0);
    api.cleanupTempFile = vi.fn().mockResolvedValue();
    api.stopCommand = vi.fn();
  });

  it('Run actually launches k6 (does not silently bail)', async () => {
    render(
      <React.StrictMode>
        <I18nProvider>
          <PerfTest env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} />
        </I18nProvider>
      </React.StrictMode>
    );
    fireEvent.click(screen.getByRole('button', { name: /Run test/i }));
    // Without the fix, mountedRef is false after StrictMode's mount cycle, so
    // run() returns after writeTempText and k6 is never spawned.
    await waitFor(() => expect(api.runK6WithRealTimeOutput).toHaveBeenCalled(), { timeout: 4000 });
  });
});
