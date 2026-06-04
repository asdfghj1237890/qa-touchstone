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

  it('flags a privileged endpoint and defaults a non-privileged identity to deny', () => {
    // Seed a matrix config: a normal (non-privileged) user identity + a DELETE /admin endpoint, no explicit expectations.
    const cfg = {
      identities: [{ id: 'anon', name: 'anon', auth: { type: 'none' } }, { id: 'u', name: 'user', auth: { type: 'bearer' } }],
      endpoints: [{ reqId: 'e1', method: 'DELETE', path: 'https://api.test/admin/users/1' }],
      expect: {}, denySet: [401, 403, 404],
    };
    installLocalStorage({ qa_locale: 'en-US', qa_security_matrix: JSON.stringify(cfg) });
    renderPage();
    // The privileged badge renders (effective-privileged via the heuristic).
    expect(document.querySelector('.qa-sec-priv--on')).not.toBeNull();
    // Both anon AND the non-privileged user default to deny on the privileged endpoint → 2 deny cells in the row.
    expect(document.querySelectorAll('td.qa-sec-cell[data-expect="deny"]').length).toBe(2);
  });

  it('renders exactly one header per mode (no double header in BOLA mode)', async () => {
    renderPage();
    // Matrix mode: one .qa-sec-head.
    expect(document.querySelectorAll('.qa-sec-head').length).toBe(1);
    // Switch to BOLA — still exactly one header (the panel's), not the matrix's too.
    fireEvent.click(screen.getByRole('button', { name: /Object access/i }));
    await waitFor(() => expect(document.querySelector('.qa-bola')).not.toBeNull());
    expect(document.querySelectorAll('.qa-sec-head').length).toBe(1);
  });

  it('renders the AI Triage card above the tabs', () => {
    renderPage();
    expect(screen.getByText('AI Triage')).toBeInTheDocument();
  });

  it('runs the full suite and records one completed run', async () => {
    // Reuse the file's setup: one endpoint (r1) + default identity (anon),
    // canned 200 response. BOLA/RL have no tests configured → they skip, but
    // the suite still completes and records a run snapshot.
    renderPage();

    // Add the endpoint via the picker (same flow as the matrix-run test).
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));

    // Trigger the full suite via the temporary page-level button.
    fireEvent.click(screen.getByText('Run full security suite'));

    const { loadSnapshots } = await import('../qa/findings.js');
    await waitFor(() => expect(loadSnapshots().lastRun).not.toBeNull(), { timeout: 4000 });
    expect(loadSnapshots().lastRun.status).toBe('complete');
  });

  it('exposes the redacted-evidence export option after a suite run and persists artifacts only on opt-in', async () => {
    // Override the canned response with an email leak so the matrix oracle emits
    // a real `sensitive-data` finding (a VULN verdict alone is not an oracle
    // finding). normalizeMatrix attaches `.raw` to that finding, so the suite's
    // buildEvidenceMap() yields a non-empty map → evidenceReady fires on complete.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 3, size: 9, body: { email: 'a@b.co' }, headers: {} } };
    renderPage();

    // Add the endpoint via the picker (same flow as the matrix-run tests).
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));

    // Run the FULL suite via the SuiteRunBar button (NOT the matrix-only "Run all").
    fireEvent.click(screen.getByText('Run full security suite'));

    // Wait for the suite to complete: the export control appears once
    // snapshots.lastRun is set (canExport={!!snapshots.lastRun}).
    await waitFor(() => expect(screen.getByText('Export report ▾')).toBeInTheDocument(), { timeout: 4000 });

    const { loadSnapshots } = await import('../qa/findings.js');

    // Opt-in proof, part 1: BEFORE saving, the persisted run has findings but NONE
    // carry an evidenceArtifact (persistence is opt-in, never automatic).
    const before = loadSnapshots().lastRun;
    expect(before.items.length).toBeGreaterThan(0);
    expect(before.items.some(it => 'evidenceArtifact' in it)).toBe(false);

    // Open the export menu and assert the redacted-evidence option is now present —
    // this proves the evidenceReady ref/state wiring fired after the suite run.
    fireEvent.click(screen.getByText('Export report ▾'));
    expect(screen.getByText('Evidence (redacted artifact)')).toBeInTheDocument();

    // Opt-in proof, part 2: clicking "Save evidence into run" embeds artifacts onto
    // the persisted snapshot items (deeper artifact-shape coverage lives in
    // evidence.test.js's embedEvidence/buildEvidenceArtifact unit tests).
    fireEvent.click(screen.getByText('Save evidence into run'));
    await waitFor(() => {
      const after = loadSnapshots().lastRun;
      expect(after.items.some(it => 'evidenceArtifact' in it && it.evidenceArtifact)).toBe(true);
    }, { timeout: 4000 });
  });

  it('matrix-only "Run all" does not record a snapshot (suite is the only boundary)', async () => {
    // Render with one endpoint (reuse the file's setup helper) + the canned 200 response.
    renderPage();

    // Add the endpoint via the picker (same flow as the matrix-run test).
    fireEvent.click(screen.getByRole('button', { name: /add endpoints/i }));
    const pickerModal = document.querySelector('.qa-sec-picker');
    fireEvent.click(within(pickerModal).getByText('https://api.test/thing').closest('button.qa-sec-picker-row'));
    fireEvent.click(document.querySelector('.qa-sec-modal'));

    // Click the matrix "Run all" button (NOT the suite bar) and await its completion.
    const runAllBtn = screen.getByRole('button', { name: /Run all/i });
    fireEvent.click(runAllBtn);
    await waitFor(() => expect(screen.getByText(/200.*VULN/)).toBeInTheDocument(), { timeout: 4000 });

    // The matrix is no longer a snapshot boundary — only a completed suite run records.
    const { loadSnapshots } = await import('../qa/findings.js');
    expect(loadSnapshots().lastRun).toBeNull();
  });
});
