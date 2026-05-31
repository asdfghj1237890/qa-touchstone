import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MonitorsPage } from '../qa/Monitors.jsx';

describe('Monitors Run now executes real assertions (canned fallback)', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 7, size: 4, body: { ok: true }, headers: {} } };
    window.QA.MONITORS = [{ id: 'm1', name: 'M', collectionId: 'c1', env: 'None', cadence: 'Every hour',
      region: 'us-east-1', enabled: true, nextRun: 'in 5 min', runs: [] }];
  });

  it('records a deterministic pass run (1/1) instead of random', async () => {
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('counts a failing assertion as a failed run (0/1)', async () => {
    // Canned response is a 500 — the status==200 assertion fails.
    window.QA.RESPONSES = { r1: { status: 500, statusText: 'Server Error', time: 7, size: 4, body: null, headers: {} } };
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={tests} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/0\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('with no assertions, a 2xx counts as pass via the status fallback', async () => {
    render(<MonitorsPage env={{ label: 'None', baseUrl: '' }} setRoute={() => {}}
                         vars={window.QA.VARIABLES} cookies={[]} sslVerify={true} tests={{}} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    await waitFor(() => expect(screen.getByText(/1\/1 passed/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
