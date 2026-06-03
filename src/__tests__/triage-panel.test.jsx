// src/__tests__/triage-panel.test.jsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TriagePanel } from '../qa/TriagePanel.jsx';

const union = [{ engine: 'bola', severity: 'critical', oracle: 'object-authz', title: 'IDOR', path: 'GET /o/{id}', evidence: 'alice→bob', ref: { testId: 't' } }];
const triageResult = { headline: '1 worth a look', total: 1, dropped: 0, items: [
  { title: 'IDOR cluster', category: 'object-authz', priority: 'p1', rationale: 'confirmed cross-object read', likelyFalsePositive: false, findings: union }] };

describe('TriagePanel', () => {
  afterEach(() => cleanup());
  it('disables the button when no AI provider is configured', () => {
    render(<TriagePanel union={union} aiReady={false} onGoToEngine={() => {}} />);
    expect(screen.getByText('Triage with AI').closest('button')).toBeDisabled();
  });
  it('disables the button when the union is empty', () => {
    render(<TriagePanel union={[]} aiReady={true} onGoToEngine={() => {}} />);
    expect(screen.getByText('Triage with AI').closest('button')).toBeDisabled();
  });
  it('runs triage and renders items; "Go to" calls onGoToEngine', async () => {
    const onGo = vi.fn();
    const runner = vi.fn(async () => triageResult);
    render(<TriagePanel union={union} aiReady={true} onGoToEngine={onGo} runner={runner} />);
    fireEvent.click(screen.getByText('Triage with AI'));
    await waitFor(() => expect(screen.getByText('IDOR cluster')).toBeInTheDocument());
    expect(screen.getByText('1 worth a look')).toBeInTheDocument();
    fireEvent.click(screen.getByText('IDOR cluster'));
    fireEvent.click(screen.getByText('Go to Object access'));
    expect(onGo).toHaveBeenCalledWith('bola');
  });
});
