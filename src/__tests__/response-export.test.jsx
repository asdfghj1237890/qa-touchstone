import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { I18nProvider } from '../qa/i18n';
import { ResponsePanel } from '../qa/ResponsePanel';

const downloadFileMock = vi.hoisted(() => vi.fn());
vi.mock('../qa/download', () => ({
  downloadFile: (...args) => downloadFileMock(...args),
}));

function installLocalStorage(seed = {}) {
  let store = { ...seed };
  const storage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

const response = {
  status: 200,
  statusText: 'OK',
  time: 14,
  size: 11,
  body: { ok: true },
  headers: {},
};

const oauthReq = {
  id: 'oauth',
  method: 'GET',
  url: 'https://api.test/me',
  params: [],
  headers: [],
  bodyMode: 'none',
  body: '',
  gqlQuery: '',
  gqlVars: '',
  form: [],
  auth: {
    type: 'oauth2',
    bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: {
      grant: 'client_credentials',
      authUrl: '',
      tokenUrl: 'https://auth.test/oauth/token',
      clientId: 'client-1',
      clientSecret: 'super-secret-client-secret',
      scope: 'read:me',
      code: '',
      redirectUri: '',
      username: '',
      password: '',
    },
  },
};

describe('ResponsePanel export', () => {
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    downloadFileMock.mockReset();
  });

  afterEach(() => cleanup());

  it('exports an OAuth2 HTML report without leaking the client secret', () => {
    render(
      <I18nProvider>
        <ResponsePanel
          state="done"
          response={response}
          req={oauthReq}
          env={{ label: 'None', baseUrl: '' }}
          testList={[]}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTitle('Export report'));
    fireEvent.click(screen.getByText('HTML report'));

    expect(downloadFileMock).toHaveBeenCalledOnce();
    const [_name, html, mime] = downloadFileMock.mock.calls[0];
    expect(mime).toBe('text/html');
    expect(html).toContain('oauth2');
    expect(html).toContain('client_credentials');
    expect(html).not.toContain('super-secret-client-secret');
  });
});
