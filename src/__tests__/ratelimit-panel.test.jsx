// src/__tests__/ratelimit-panel.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitPanel } from '../qa/RateLimitPanel';
import { I18nProvider } from '../qa/i18n';
import { runBurst, detectThrottleSignal, classifyRateLimit, rlFindingFor } from '../qa/ratelimit';

function ControlledRL(props) {
  const [results, setResults] = React.useState({});
  const onRunTest = async (test, { runner }) => {
    setResults(r => ({ ...r, [test.id]: { progress: { done: 0, n: test.n }, stats: null, verdict: null } }));
    const { responses, stats } = await runBurst(test, runner, {
      onProgress: (done, n) => setResults(r => ({ ...r, [test.id]: { ...(r[test.id] || {}), progress: { done, n } } })),
    });
    const finding = rlFindingFor(test, responses, stats, 'No rate limiting');
    const verdict = classifyRateLimit(detectThrottleSignal(responses), responses.filter(x => x.status != null).length);
    setResults(r => ({ ...r, [test.id]: { progress: { done: stats.sent, n: test.n }, stats, verdict, severity: finding ? finding.severity : null, finding } }));
  };
  return <RateLimitPanel {...props} results={results} setResults={setResults} onRunTest={onRunTest} />;
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

const identities = [{ id: 'anon', name: 'anon', auth: { type: 'none' } }];
const rl = (n = 5, sensitivity = 'sensitive') => ({ tests: [{ id: 'rl1', reqId: 'r1', method: 'POST', path: 'https://api.test/login', identityId: 'anon', n, concurrency: 2, sensitivity }] });

function renderPanel(rlState) {
  return render(
    <I18nProvider>
      <ControlledRL identities={identities} rateLimit={rlState} setRateLimit={() => {}}
                    env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
    </I18nProvider>
  );
}

describe('RateLimitPanel — runs on the canned path', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'POST', name: 'login', path: 'https://api.test/login' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
  });

  it('requires the confirm modal before any burst, then flags a vuln + finding when unthrottled', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: {} } };
    renderPanel(rl());

    // Clicking Run opens the confirm modal but sends nothing yet.
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    expect(document.querySelector('.qa-rl-confirm')).not.toBeNull();
    expect(document.querySelector('.qa-rl-verdict')).toBeNull();

    // Confirm fires the burst.
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--vuln')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('.qa-sec-findpanel, .qa-rl-findpanel')).not.toBeNull();
    // The stats card reflects the burst size (N=5 from the rl() helper).
    expect(document.querySelector('.qa-rl-result').textContent).toContain('5 sent');
  });

  it('calls onFindings with normalized rate-limit findings after a burst produces a vuln', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: {} } };
    const spy = vi.fn();
    render(
      <I18nProvider>
        <ControlledRL identities={identities} rateLimit={rl()} setRateLimit={() => {}} onFindings={spy}
                      env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--vuln')).not.toBeNull(), { timeout: 4000 });
    expect(spy).toHaveBeenCalled();
    const last = spy.mock.calls.at(-1)[0];
    expect(last.some(x => x.engine === 'ratelimit' && x.ref && x.ref.testId)).toBe(true);
  });

  it('reports pass when a rate-limit header is present', async () => {
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: { 'Retry-After': '5' } } };
    renderPanel(rl());
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));
    await waitFor(() => expect(document.querySelector('.qa-rl-verdict--pass')).not.toBeNull(), { timeout: 4000 });
  });
});

describe('RateLimitPanel — controlled-mode delegation', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({ qa_locale: 'en-US' });
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'POST', name: 'login', path: 'https://api.test/login' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    // Canned 200 with no throttle headers → the local fallback would produce a vuln cell if it ran.
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 2, size: 2, body: { ok: true }, headers: {} } };
  });

  it('delegates to onRunTest and does NOT run the local fallback (no double-run)', async () => {
    // A no-op onRunTest spy: called by the panel but streams no results.
    const onRunTestSpy = vi.fn(async () => { /* intentionally does nothing */ });

    function ControlledRLNoRun(props) {
      const [results, setResults] = React.useState({});
      return <RateLimitPanel {...props} results={results} setResults={setResults} onRunTest={props.onRunTest} />;
    }

    render(
      <I18nProvider>
        <ControlledRLNoRun identities={identities} rateLimit={rl()} setRateLimit={() => {}}
                           env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} cookies={[]} sslVerify={true}
                           onRunTest={onRunTestSpy} />
      </I18nProvider>
    );

    // Mirror the confirm-modal flow the existing run test uses.
    fireEvent.click(screen.getByRole('button', { name: /Run burst/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send burst/i }));

    // Wait for the run cycle to complete (the Stop button appears then disappears).
    await waitFor(() => expect(screen.queryByRole('button', { name: /Stop/i })).toBeNull(), { timeout: 4000 });

    // (a) onRunTest was called exactly once — the panel delegated control.
    expect(onRunTestSpy).toHaveBeenCalledTimes(1);

    // (b) Because onRunTest is a no-op (streams nothing) and the local fallback must NOT
    // fire, no result/verdict cell populates. If the local path erroneously also ran, the
    // canned response above would produce a vuln verdict + stats card and these would fail.
    expect(document.querySelector('.qa-rl-verdict--vuln')).toBeNull();
    expect(document.querySelector('.qa-rl-result')).toBeNull();
  });
});
