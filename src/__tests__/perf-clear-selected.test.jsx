import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerfTest } from '../qa/PerfTest';
import { I18nProvider } from '../qa/i18n';
import api from '../api/index';

const PERF_KEY = 'qa_perf_runs';

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

// Minimal but fully-renderable historical run (PerfRun extends K6Snapshot).
function makeRun(ts) {
  return {
    ts,
    type: 'load',
    typeLabel: 'Load',
    maxVus: 50,
    dur: 30,
    rows: [{ label: 'p95', actual: 150, unit: 'ms', limit: 200, pass: true }],
    pass: true,
    error: null,
    m: { sent: 100, rps: 10, avg: 100, p80: 100, p90: 120, p95: 150, p99: 200, err: 0 },
    latSeries: [100, 120, 110],
    rpsSeries: [10, 10, 10],
    dist: { ok: 100, c4: 0, c5: 0, net: 0 },
    broke: null,
    slo: { p80: 100, p90: 100, p95: 100, p99: 100, err: 1 },
  };
}

function renderPerf() {
  return render(
    <I18nProvider>
      <PerfTest env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} />
    </I18nProvider>
  );
}

// The "Clear" button under Run history used to wipe ALL runs regardless of the
// per-row checkboxes (which only scope Export). Selecting a few rows then
// clicking Clear should remove ONLY the checked runs.
describe('PerfTest Run history — Clear respects selection', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    installLocalStorage({
      qa_locale: 'en-US',
      [PERF_KEY]: JSON.stringify([makeRun('RUN-A'), makeRun('RUN-B'), makeRun('RUN-C')]),
    });
    window.QA.COLLECTIONS = [
      {
        id: 'c1',
        name: 'C',
        count: 1,
        folders: [
          {
            name: 'F',
            requests: [
              { id: 'r1', method: 'GET', name: 'Cat fact', path: 'https://catfact.ninja/fact' },
            ],
          },
        ],
      },
    ];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    api.stopCommand = vi.fn();
  });

  it('clears only the selected run, leaving the rest intact', () => {
    const { container } = renderPerf();

    // Three runs seeded; newest-first DOM order is [RUN-A, RUN-B, RUN-C].
    let rows = container.querySelectorAll('.pf-run-row');
    expect(rows).toHaveLength(3);

    // Check the middle run (RUN-B) only.
    fireEvent.click(rows[1].querySelector('.qa-minicheck'));

    // Click the danger "Clear" button in the history header.
    fireEvent.click(container.querySelector('.pf-hbtn--danger'));

    // RUN-A and RUN-C must survive; RUN-B is gone.
    rows = container.querySelectorAll('.pf-run-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText('RUN-C')).toBeInTheDocument();
    expect(screen.queryByText('RUN-B')).not.toBeInTheDocument();

    // Persisted history reflects the partial clear.
    const persisted = JSON.parse(window.localStorage.getItem(PERF_KEY));
    expect(persisted.map((r) => r.ts)).toEqual(['RUN-A', 'RUN-C']);
  });

  it('with no selection, Clear still wipes the whole history', () => {
    const { container } = renderPerf();
    expect(container.querySelectorAll('.pf-run-row')).toHaveLength(3);

    fireEvent.click(container.querySelector('.pf-hbtn--danger'));

    expect(container.querySelectorAll('.pf-run-row')).toHaveLength(0);
    expect(window.localStorage.getItem(PERF_KEY)).toBeNull();
  });
});
