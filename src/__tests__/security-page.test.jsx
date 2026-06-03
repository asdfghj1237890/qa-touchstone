import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityPage } from '../qa/Security.jsx';
import { I18nProvider } from '../qa/i18n.jsx';

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

function renderPage() {
  return render(
    <I18nProvider>
      <SecurityPage env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('SecurityPage — matrix runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    // Fresh localStorage with locale — ensures loadMatrixConfig() returns null
    // so the page starts from scratch (no stored endpoints).
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    // Canned response: HTTP 200 — anon expects deny → outcome: allowed → verdict: vuln
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 4, body: { ok: true }, headers: {} } };
  });

  it('adds an endpoint, runs the matrix, and surfaces a VULN verdict for anon', async () => {
    renderPage();

    // Step 1: Open the endpoint picker via the toolbar button (i18n
    // 'security.addEndpoints' = 'Add endpoints'). A case-insensitive name regex
    // tolerates any icon-contributed tokens in the accessible name and i18n
    // casing drift, while still being distinct from 'Add identity'.
    const addBtn = screen.getByRole('button', { name: /add endpoints/i });
    fireEvent.click(addBtn);

    // Step 2: The picker modal is now open. Find the request row button by its path
    // text (rendered as <code>https://api.test/thing</code> inside the button).
    const pickerModal = document.querySelector('.qa-sec-picker');
    expect(pickerModal).not.toBeNull();

    // The request row is a button containing a <code> with the path.
    // Use within() to scope to the picker, then find by the code text.
    const pathCode = within(pickerModal).getByText('https://api.test/thing');
    // The button wrapping the code element:
    const requestRowBtn = pathCode.closest('button.qa-sec-picker-row');
    expect(requestRowBtn).not.toBeNull();
    fireEvent.click(requestRowBtn);

    // Step 3: onAdd does NOT auto-close the picker. Close it by clicking the modal
    // overlay (the .qa-sec-modal div that has onClick={() => setPicking(false)}).
    // We click the overlay element directly — not the inner body (which stops propagation).
    // Only the picker modal is open at this point, so the first .qa-sec-modal is it.
    const modalOverlay = document.querySelector('.qa-sec-modal');
    expect(modalOverlay).not.toBeNull();
    fireEvent.click(modalOverlay);

    // Step 4: The picker should now be gone and the endpoint row should be in the grid.
    expect(document.querySelector('.qa-sec-picker')).toBeNull();

    // Step 5: Click "Run all" — it's enabled now that an endpoint is present.
    const runAllBtn = screen.getByRole('button', { name: /Run all/i });
    expect(runAllBtn).not.toBeDisabled();
    fireEvent.click(runAllBtn);

    // Step 6: Wait for the VULN verdict to appear.
    // Cell renders: <span class="qa-sec-verdict">{status} · {t(VERDICT_LABEL[v])}</span>
    // With canned 200 + anon expecting deny: outcome=allowed, verdict=vuln, label='VULN'
    // The cell text will be "200 · VULN"
    await waitFor(() => expect(screen.getByText(/200.*VULN/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('surfaces a findings badge when the response leaks sensitive data', async () => {
    // Override the canned response with an email leak in the body.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));

    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });
  });

  it('lists findings in the cell drawer with a Scan with AI action', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));
    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });

    // Open the cell drawer by clicking the run cell (it has a result now).
    fireEvent.click(document.querySelector('.qa-sec-cell'));
    await waitFor(() => expect(document.querySelector('.qa-sec-findings')).not.toBeNull());

    // The drawer's findings list renders the leak path 'email' as a <code>.
    const findings = document.querySelector('.qa-sec-findings');
    expect(within(findings).getByText('email')).toBeTruthy();
    // No LLM is reachable in jsdom (built-in needs window.claude), so the AI
    // scan is offered but disabled with a hint rather than failing on click.
    const aiBtn = screen.getByRole('button', { name: /Scan with AI/i });
    expect(aiBtn).toBeInTheDocument();
    expect(aiBtn).toBeDisabled();
    expect(screen.getByText(/Configure AI in Settings/i)).toBeInTheDocument();
  });

  it('shows a severity summary chip and an aggregated findings panel after a run', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));
    fireEvent.click(screen.getByRole('button', { name: /Run all/i }));
    await waitFor(() => expect(document.querySelector('.qa-sec-findbadge')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.qa-sec-findsummary')).not.toBeNull();
    expect(document.querySelector('.qa-sec-findpanel')).not.toBeNull();
  });

  it('switches to the Object-access (BOLA) mode via the header toggle', async () => {
    renderPage();
    const bolaToggle = screen.getByRole('button', { name: /Object access/i });
    fireEvent.click(bolaToggle);
    await waitFor(() => expect(document.querySelector('.qa-bola')).not.toBeNull());
  });

  it('switches to the Rate-limit mode via the header toggle', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Rate limit/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl')).not.toBeNull());
  });
});
