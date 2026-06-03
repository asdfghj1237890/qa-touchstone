// src/__tests__/findings-panel.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n.jsx';
import { FindingsPanel } from '../qa/FindingsPanel.jsx';
import { loadLifecycle, fingerprint } from '../qa/findings.js';

const union = [
  { engine: 'matrix', ruleId: 'jwt', severity: 'high', title: 'JWT in response',
    path: 'data.token', evidence: 'x', method: 'GET', endpoint: '/me',
    identityLabel: 'admin', ref: { reqId: 'r1', idId: 'admin' } },
];

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe('FindingsPanel (read-only)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it('renders one row per finding with a presence badge', () => {
    wrap(<FindingsPanel union={union} />);
    expect(screen.getByText('JWT in response')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy(); // no baseline -> new
  });

  it('shows the empty state when there are no findings', () => {
    wrap(<FindingsPanel union={[]} />);
    expect(screen.getByText('No findings yet — run a scan.')).toBeTruthy();
  });

  it('shows the new high/critical counter', () => {
    wrap(<FindingsPanel union={union} />);
    expect(screen.getByText('1 new high/critical')).toBeTruthy();
  });
});

describe('FindingsPanel (annotations)', () => {
  beforeEach(() => localStorage.clear());

  it('suppressing a finding persists to the lifecycle store and hides it by default', () => {
    wrap(<FindingsPanel union={union} />);
    fireEvent.click(screen.getByText('JWT in response'));          // expand the row
    fireEvent.click(screen.getByLabelText('Suppress (false positive)')); // toggle suppress
    const fp = fingerprint(union[0]).fp;
    expect(loadLifecycle().records[fp].suppressed).toBe(true);
    // hidden by default (filter off)
    expect(screen.queryByText('JWT in response')).toBeNull();
  });

  it('editing the owner persists', () => {
    wrap(<FindingsPanel union={union} />);
    fireEvent.click(screen.getByText('JWT in response'));
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'alice' } });
    const fp = fingerprint(union[0]).fp;
    expect(loadLifecycle().records[fp].owner).toBe('alice');
  });
});

describe('FindingsPanel (baseline)', () => {
  beforeEach(() => localStorage.clear());

  it('calls onPinBaseline when the pin button is clicked', () => {
    let pinned = 0;
    wrap(<FindingsPanel union={union} onPinBaseline={() => { pinned += 1; }} />);
    fireEvent.click(screen.getByText('Pin current as baseline'));
    expect(pinned).toBe(1);
  });

  it('shows the scope-differs badge when scopeMismatch is true', () => {
    const snapshots = { fpVersion: 1, baseline: { items: [{ fp: 'zzz', effectiveSeverity: 'low' }], scopeHash: 'old' }, lastRun: null };
    wrap(<FindingsPanel union={union} snapshots={snapshots} scopeMismatch={true} />);
    expect(screen.getByText('Baseline scope differs')).toBeTruthy();
  });
});
