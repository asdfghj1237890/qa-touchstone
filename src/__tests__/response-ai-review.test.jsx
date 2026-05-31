import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponsePanel } from '../qa/ResponsePanel.jsx';

describe('ResponsePanel AI review', () => {
  beforeEach(() => {
    window.loadLlmCfg = () => ({ provider: 'builtin', model: 'claude-haiku-4-5', key: '', baseUrl: '' });
    window.claude = { complete: vi.fn().mockResolvedValue('Looks correct: 200 with the expected body.') };
  });

  it('reviews the response with the model and shows the verdict', async () => {
    const req = { method: 'GET', url: 'https://api.test/thing', headers: [], auth: { type: 'none' }, bodyMode: 'none', body: '' };
    const response = { status: 200, statusText: 'OK', time: 10, size: 4, body: { ok: true }, headers: {} };
    render(<ResponsePanel state="done" response={response} req={req}
                          env={{ label: 'None', baseUrl: '' }} varMap={{}} testList={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /AI review/i }));
    await waitFor(() => expect(screen.getByText(/Looks correct/)).toBeInTheDocument(), { timeout: 4000 });
  });
});
