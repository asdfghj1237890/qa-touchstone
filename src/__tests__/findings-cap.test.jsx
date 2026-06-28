import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { FindingsPanel, MAX_VISIBLE_FINDINGS } from '../qa/FindingsPanel';
import { I18nProvider } from '../qa/i18n';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

// Distinct fingerprints (engine|ruleId|location|path) via a unique endpoint per row.
function mkUnion(n) {
  return Array.from({ length: n }, (_, i) => ({
    engine: 'matrix',
    ruleId: 'rule-' + i,
    severity: 'high',
    title: 'Finding ' + i,
    method: 'GET',
    endpoint: '/e' + i,
    path: 'data.x',
    identityLabel: 'admin',
    ref: { reqId: 'rq' + i, idId: 'admin' },
  }));
}

const renderPanel = (n) =>
  render(
    <I18nProvider>
      <FindingsPanel union={mkUnion(n)} />
    </I18nProvider>
  );

const rowCount = () => document.querySelectorAll('tr.qa-find-row').length;

describe('FindingsPanel — render cap for large scans', () => {
  afterEach(() => cleanup());
  beforeEach(() => installLocalStorage({ qa_locale: 'en-US' }));

  it('caps the rendered rows and surfaces a show-all control with the true total', () => {
    const n = MAX_VISIBLE_FINDINGS + 50;
    renderPanel(n);
    expect(rowCount()).toBe(MAX_VISIBLE_FINDINGS);
    // the show-all control reports the true total honestly (no silent truncation)
    expect(screen.getByText(/show all/i).textContent).toMatch(new RegExp(String(n)));
  });

  it('show-all reveals every row; show-fewer collapses again', () => {
    const n = MAX_VISIBLE_FINDINGS + 20;
    renderPanel(n);
    fireEvent.click(screen.getByText(/show all/i));
    expect(rowCount()).toBe(n);
    fireEvent.click(screen.getByText(/show fewer/i));
    expect(rowCount()).toBe(MAX_VISIBLE_FINDINGS);
  });

  it('shows no cap control for a small finding set', () => {
    renderPanel(5);
    expect(screen.queryByText(/show all/i)).toBeNull();
    expect(rowCount()).toBe(5);
  });
});
