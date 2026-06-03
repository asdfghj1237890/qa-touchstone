// src/__tests__/findings-panel.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../qa/i18n.jsx';
import { FindingsPanel } from '../qa/FindingsPanel.jsx';

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
