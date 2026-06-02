import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { runMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
}));

vi.mock('../qa/sendRequest.js', () => ({
  qaRunSavedRequest: (...args) => runMock(...args),
}));

import { Runner } from '../qa/Runner.jsx';
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

function renderRunner(props) {
  return render(
    <I18nProvider>
      <Runner {...props} />
    </I18nProvider>
  );
}

describe('Runner data iteration', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    runMock.mockReset();
    runMock.mockResolvedValue({ status: 200, statusText: 'OK', time: 1, size: 0, body: {}, headers: {} });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get user', path: 'https://api.test/users/{{userId}}' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = {};
  });

  it('passes each CSV row as local variables to the real request helper', async () => {
    renderRunner({
      env: { label: 'None', baseUrl: '' },
      vars: window.QA.VARIABLES,
      tests: {},
      cookies: [],
      sslVerify: true,
      oauthTokens: {},
    });

    fireEvent.change(screen.getByPlaceholderText(/CSV \/ JSON/), {
      target: { value: 'userId\n42\n43' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run 2 requests/i }));

    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));
    expect(runMock.mock.calls[0][1].localVars).toEqual({ userId: '42' });
    expect(runMock.mock.calls[1][1].localVars).toEqual({ userId: '43' });
  });
});
