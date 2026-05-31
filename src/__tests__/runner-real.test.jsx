import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Runner } from '../qa/Runner.jsx';

describe('Runner runs real requests + live assertions (canned fallback)', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 9, size: 4, body: { ok: true }, headers: {} } };
  });

  it('reports assertion pass/total from the live response', async () => {
    const tests = { r1: [{ type: 'status', op: 'eq', value: 200, on: true }] };
    render(<Runner env={{ label: 'None', baseUrl: '' }} vars={window.QA.VARIABLES} tests={tests}
                   cookies={[]} sslVerify={true} oauthTokens={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run 1 request/ }));
    await waitFor(() => expect(screen.getByText('1/1')).toBeInTheDocument(), { timeout: 4000 });
  });
});
