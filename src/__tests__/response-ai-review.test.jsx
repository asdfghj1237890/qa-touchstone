import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResponsePanel } from '../qa/ResponsePanel.jsx';
import { I18nProvider } from '../qa/i18n.jsx';
import { setCachedAiPolicy } from '../qa/aiPolicy.js';

// Auto-approve the prompt preview so qaAiSend proceeds to the transport.
vi.mock('../qa/PromptPreview.jsx', () => ({
  requestPromptApproval: vi.fn(() => Promise.resolve(true)),
  PromptPreviewHost: () => null,
}));

const req = { method: 'GET', url: 'https://api.test/thing', headers: [], auth: { type: 'none' }, bodyMode: 'none', body: '' };
const okResponse = { status: 200, statusText: 'OK', time: 10, size: 4, body: { ok: true }, headers: {} };

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

function panel(ui) {
  return <I18nProvider>{ui}</I18nProvider>;
}

describe('ResponsePanel AI review', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    setCachedAiPolicy({ externalAllowed: true, locked: false });
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('Looks correct: 200 with the expected body.') };
  });

  it('reviews the response with the model and shows the verdict', async () => {
    render(panel(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />));
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('sends a host-stripped, value-redacted prompt by default (redacted mode)', async () => {
    const spy = window.claude.complete;
    render(panel(<ResponsePanel state="done"
        response={{ status: 200, statusText: 'OK', time: 10, size: 4, body: { email: 'a@b.com' }, headers: {} }}
        req={{ ...req, url: 'https://api.test/users/55?token=x' }}
        env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />));
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 4000 });
    const content = spy.mock.calls[0][0].messages[0].content;
    expect(content).not.toContain('api.test');
    expect(content).not.toContain('a@b.com');
    expect(content).toContain('/users/{id}');
  });

  it('shows a graceful message when no provider is available', async () => {
    window.claude = undefined; // built-in selected but unavailable → qaCallLLM throws
    render(panel(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />));
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/AI review unavailable/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('clears a prior verdict when a new response arrives', async () => {
    const { rerender } = render(panel(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />));
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
    const newResponse = { status: 404, statusText: 'Not Found', time: 5, size: 2, body: { error: 'nope' }, headers: {} };
    rerender(panel(<ResponsePanel state="done" response={newResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />));
    expect(screen.queryByText(/Looks correct/)).not.toBeInTheDocument();
  });

  it('still shows the verdict under React.StrictMode (mount→cleanup→mount)', async () => {
    render(
      <React.StrictMode>
        <I18nProvider>
          <ResponsePanel state="done" response={okResponse} req={req}
                         env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />
        </I18nProvider>
      </React.StrictMode>
    );
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
