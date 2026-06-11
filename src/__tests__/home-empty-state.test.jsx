import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { HomePage } from '../qa/HomePage';
import { I18nProvider } from '../qa/i18n';

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

function renderHome(history, setRoute = () => {}) {
  return render(
    <I18nProvider>
      <HomePage setRoute={setRoute} history={history} onOpenRequest={() => {}} env={{ label: 'None', baseUrl: '' }} />
    </I18nProvider>
  );
}

describe('HomePage — Recent requests empty state', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [];
    window.QA.CRED_PROFILES = [];
  });

  it('shows a guiding empty state (not a blank panel) when there is no history', () => {
    renderHome([]);
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send your first request/i })).toBeInTheDocument();
  });

  it('the empty-state CTA routes to the API client', () => {
    const setRoute = vi.fn();
    renderHome([], setRoute);
    fireEvent.click(screen.getByRole('button', { name: /send your first request/i }));
    expect(setRoute).toHaveBeenCalledWith('api');
  });

  it('shows recent rows (and no empty state) when history exists', () => {
    renderHome([{ method: 'GET', path: '/x', status: 200, time: 5 }]);
    expect(screen.queryByText(/no requests yet/i)).toBeNull();
    expect(screen.getByText('/x')).toBeInTheDocument();
  });
});
