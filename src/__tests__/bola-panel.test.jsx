import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BolaPanel } from '../qa/BolaPanel';
import { I18nProvider } from '../qa/i18n';
import { runBola } from '../qa/bola';

function ControlledBola(props) {
  const [results, setResults] = React.useState({});
  const onRun = async ({ runner, negativeControl }) => {
    await runBola({ identities: props.identities, tests: props.bola.tests }, runner, {
      signal: undefined, negativeControl,
      onCell: (testId, attackerId, ownerId, cell) => setResults(r => {
        const tr = r[testId] || { reference: {}, attacks: {} };
        if (attackerId == null) return { ...r, [testId]: { ...tr, reference: { ...tr.reference, [ownerId]: cell } } };
        return { ...r, [testId]: { ...tr, attacks: { ...tr.attacks, [attackerId]: { ...(tr.attacks[attackerId] || {}), [ownerId]: cell } } } };
      }),
    });
  };
  return <BolaPanel {...props} results={results} setResults={setResults} onRun={onRun} />;
}

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
      <ControlledBola identities={identities} bola={bola} setBola={setBola}
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
    // Negative control defaults ON; with a canned 200 for the synthetic probe it
    // would demote every verdict to inconclusive. Uncheck it so the attack verdicts
    // are computed normally, which is what this test exercises.
    fireEvent.click(screen.getByRole('checkbox', { name: /Negative control/i }));
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

  it('calls onFindings with normalized BOLA findings after a run produces a vuln cell', async () => {
    const spy = vi.fn();
    let cur = bola;
    const setBola = (next) => { cur = typeof next === 'function' ? next(cur) : next; };
    render(
      <I18nProvider>
        <ControlledBola identities={identities} bola={bola} setBola={setBola} onFindings={spy}
                   env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      </I18nProvider>
    );
    // Same reason as the first test: uncheck negative control to prevent verdict demotion.
    fireEvent.click(screen.getByRole('checkbox', { name: /Negative control/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run BOLA/i }));
    await waitFor(() => expect(document.querySelector('.qa-bola-cell--vuln')).not.toBeNull(), { timeout: 4000 });
    expect(spy).toHaveBeenCalled();
    const last = spy.mock.calls.at(-1)[0];
    expect(last.some(x => x.engine === 'bola' && x.ref && x.ref.testId && x.ref.attackerId && x.ref.ownerId)).toBe(true);
  });

  it('warns when the marked id location cannot apply to the request (bad body path)', () => {
    // r1 is a GET with no body, so a body id-location can never resolve → warn.
    const bodyBola = { tests: [{ id: 't2', reqId: 'r1', method: 'GET', path: 'https://api.test/users/42', idLocation: { kind: 'body', path: 'order.id' }, idValues: { alice: 'A1' } }] };
    render(
      <I18nProvider>
        <BolaPanel identities={identities} bola={bodyBola} setBola={() => {}}
                   env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      </I18nProvider>
    );
    expect(document.querySelector('.qa-bola-warn')).not.toBeNull();
  });
});

describe('BolaPanel — controlled-mode delegation', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'user', path: 'https://api.test/users/42' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    // Canned response: same body for every call → local runBola would produce a vuln cell if it ran.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 9, body: { secret: 'shared' }, headers: {} } };
  });

  it('delegates to onRun and does NOT run the local fallback (no double-run)', async () => {
    // A no-op onRun spy: called by the panel but streams no results.
    const onRunSpy = vi.fn(async () => { /* intentionally does nothing */ });

    function ControlledBolaNoRun(props) {
      const [results, setResults] = React.useState({});
      return <BolaPanel {...props} results={results} setResults={setResults} onRun={props.onRun} />;
    }

    let cur = bola;
    const setBola = (next) => { cur = typeof next === 'function' ? next(cur) : next; };
    render(
      <I18nProvider>
        <ControlledBolaNoRun identities={identities} bola={bola} setBola={setBola}
                             env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true}
                             onRun={onRunSpy} />
      </I18nProvider>
    );

    // Uncheck negative control (mirrors existing run tests) so that if the local fallback
    // did fire erroneously, verdicts are computed normally and vuln cells would appear.
    fireEvent.click(screen.getByRole('checkbox', { name: /Negative control/i }));
    fireEvent.click(screen.getByRole('button', { name: /Run BOLA/i }));

    // Wait for the run cycle to complete (the Stop button appears then disappears).
    await waitFor(() => expect(screen.queryByRole('button', { name: /Stop/i })).toBeNull(), { timeout: 4000 });

    // onRun must have been called exactly once — the panel delegated control.
    expect(onRunSpy).toHaveBeenCalledTimes(1);

    // Because onRun is a no-op (streams nothing) and the local runBola must NOT fire,
    // the grid must stay empty — no verdict cells.  If the local fallback erroneously also
    // ran, the canned responses above would produce a vuln cell and this assertion fails.
    expect(document.querySelector('.qa-bola-cell--vuln')).toBeNull();
    // Reference cells rendered with actual result data show the status text (e.g. "200 reference").
    // When no run happened they stay as plain "·" dots. Confirm the ref cell has no result text.
    const refCell = document.querySelector('.qa-bola-cell--ref');
    // The cell may exist (grid always renders for 2+ owned identities) but must not contain
    // a status code — a populated reference cell would read "200 reference".
    if (refCell) {
      expect(refCell.textContent).toBe('·');
    }
  });
});

describe('BolaPanel — setup automation', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    // Path /orders/123 contains a numeric id after a plural noun — detection fires with high confidence.
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r2', method: 'GET', name: 'order', path: '/orders/123' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r2: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r2: { status: 200, statusText: 'OK', time: 1, size: 9, body: { id: '123' }, headers: {} } };
  });

  it('test 1: adding a test via the select shows the detection suggestion', async () => {
    // Use a React-state-backed setBola so addTest's internal setSuggestions state
    // update triggers a re-render AND the new test card is visible.
    const { useState: useReactState } = React;
    function Wrapper() {
      const [cur, setCur] = useReactState({ tests: [], presets: [] });
      return (
        <BolaPanel identities={identities} bola={cur} setBola={setCur}
                   env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      );
    }
    render(<I18nProvider><Wrapper /></I18nProvider>);
    // Add a test by selecting the /orders/123 request — detection fires and suggestion appears.
    const addSelect = document.querySelector('.qa-sec-toolbar select');
    fireEvent.change(addSelect, { target: { value: 'r2' } });
    // The suggestion reads "Detected id in path segment 1 (numeric, after /orders) — confidence high."
    await waitFor(() => expect(screen.getByText(/Detected id in/i)).not.toBeNull(), { timeout: 3000 });
  });

  it('test 2: applying a preset fills idValues for the identities', async () => {
    const initialBola = {
      tests: [{ id: 'tp1', reqId: 'r2', method: 'GET', path: '/orders/123', idLocation: { kind: 'path', index: 1 }, idValues: {} }],
      presets: [{ id: 'p1', name: 'prod', values: { alice: '100', bob: '200' } }],
    };
    const { useState: useReactState } = React;
    function Wrapper() {
      const [cur, setCur] = useReactState(initialBola);
      return (
        <BolaPanel identities={identities} bola={cur} setBola={setCur}
                   env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      );
    }
    render(<I18nProvider><Wrapper /></I18nProvider>);
    // Find the preset select (the one with "p1" as an option value).
    const allSelects = document.querySelectorAll('select');
    const ps = Array.from(allSelects).find(s => s.querySelector('option[value="p1"]'));
    expect(ps).not.toBeNull();
    fireEvent.change(ps, { target: { value: 'p1' } });
    // After applying the preset the id-value inputs for alice and bob should show '100' and '200'.
    await waitFor(() => {
      const inputs = document.querySelectorAll('.qa-bola-idval input');
      const vals = Array.from(inputs).map(i => i.value);
      expect(vals).toContain('100');
      expect(vals).toContain('200');
    });
  });

  it('test 3: unchecking negative control omits the synthetic probe', async () => {
    // With 2 identities + 1 test: ref=2, attacks=2, control=1 (if ON) = 5 total.
    // With negControl=OFF: ref=2, attacks=2 = 4 total.
    const runBolaBola = {
      tests: [{ id: 'tn1', reqId: 'r2', method: 'GET', path: '/orders/123', idLocation: { kind: 'path', index: 1 }, idValues: { alice: '100', bob: '200' } }],
    };
    // Count each canned response lookup by patching the response store via a flag
    // set on each response object access.  We use a simple counter reset here.
    const origExec = window.QA.RESPONSES['r2'];
    // Override the response with a getter-counted version to track accesses.
    let accessedR2 = 0;
    Object.defineProperty(window.QA.RESPONSES, 'r2', {
      get() { accessedR2++; return origExec; },
      configurable: true,
    });
    const { useState: useReactState } = React;
    function Wrapper() {
      const [cur, setCur] = useReactState(runBolaBola);
      return (
        <BolaPanel identities={identities} bola={cur} setBola={setCur}
                   env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      );
    }
    render(<I18nProvider><Wrapper /></I18nProvider>);
    // Negative control defaults ON; verify it.
    const checkbox = screen.getByRole('checkbox', { name: /Negative control/i });
    expect(checkbox.checked).toBe(true);
    // Uncheck it.
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    // Reset the counter after any setup-phase accesses.
    accessedR2 = 0;
    // Run.
    fireEvent.click(screen.getByRole('button', { name: /Run BOLA/i }));
    // Wait for the run to complete (Stop button appears then disappears, or cells appear).
    await waitFor(() => expect(document.querySelector('.qa-bola-cell--vuln, .qa-bola-cell--unconfirmed, .qa-bola-cell--pass, .qa-bola-cell--inconclusive')).not.toBeNull(), { timeout: 8000 });
    // Wait for running to finish (no Stop button).
    await waitFor(() => expect(screen.queryByRole('button', { name: /Stop/i })).toBeNull(), { timeout: 8000 });
    // With negControl=OFF: 2 ref + 2 attacks = 4 calls. With ON: 5.
    expect(accessedR2).toBe(4);
    // Restore.
    delete (window.QA.RESPONSES).r2;
    window.QA.RESPONSES.r2 = origExec;
  });
});
