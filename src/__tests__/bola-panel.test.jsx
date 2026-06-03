import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BolaPanel } from '../qa/BolaPanel.jsx';
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

const identities = [
  { id: 'alice', name: 'Alice', auth: { type: 'none' } },
  { id: 'bob', name: 'Bob', auth: { type: 'none' } },
];
const bola = { tests: [{ id: 't1', reqId: 'r1', method: 'GET', path: 'https://api.test/users/42', idLocation: { kind: 'path', index: 1 }, idValues: { alice: 'A1', bob: 'B1' } }] };

function renderPanel() {
  let cur = bola;
  const setBola = (next) => { cur = typeof next === 'function' ? next(cur) : next; };
  return render(
    <I18nProvider>
      <BolaPanel identities={identities} bola={bola} setBola={setBola}
                 env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('BolaPanel — runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'user', path: 'https://api.test/users/42' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    // Same canned body for every call → attacker body == owner reference → matched → vuln.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 9, body: { secret: 'shared' }, headers: {} } };
  });

  it('runs the configured test and surfaces a confirmed BOLA cell + finding', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Run BOLA/i }));
    await waitFor(() => expect(document.querySelector('.qa-bola-cell--vuln')).not.toBeNull(), { timeout: 4000 });
    // A finding badge / panel shows the object-authz finding.
    await waitFor(() => expect(document.querySelector('.qa-sec-findpanel, .qa-bola-findpanel')).not.toBeNull());
    // The diagonal renders the reference (own-id) cell.
    expect(document.querySelector('.qa-bola-cell--ref')).not.toBeNull();
    // Clicking an attack cell opens the drawer with the response body.
    fireEvent.click(document.querySelector('.qa-bola-cell--vuln'));
    await waitFor(() => expect(document.querySelector('.qa-sec-drawer')).not.toBeNull());
    expect(document.querySelector('.qa-sec-drawer-body').textContent).toContain('shared');
  });
});
