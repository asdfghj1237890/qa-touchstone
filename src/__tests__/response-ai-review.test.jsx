import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResponsePanel } from '../qa/ResponsePanel.jsx';

const req = { method: 'GET', url: 'https://api.test/thing', headers: [], auth: { type: 'none' }, bodyMode: 'none', body: '' };
const okResponse = { status: 200, statusText: 'OK', time: 10, size: 4, body: { ok: true }, headers: {} };

describe('ResponsePanel AI review', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('Looks correct: 200 with the expected body.') };
  });

  it('reviews the response with the model and shows the verdict', async () => {
    render(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('shows a graceful message when no provider is available', async () => {
    window.claude = undefined; // built-in selected but unavailable → qaCallLLM throws
    render(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/AI review unavailable/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it('clears a prior verdict when a new response arrives', async () => {
    const { rerender } = render(<ResponsePanel state="done" response={okResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
    // A new response object arrives (user sent another request).
    const newResponse = { status: 404, statusText: 'Not Found', time: 5, size: 2, body: { error: 'nope' }, headers: {} };
    rerender(<ResponsePanel state="done" response={newResponse} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    expect(screen.queryByText(/Looks correct/)).not.toBeInTheDocument();
  });
});
