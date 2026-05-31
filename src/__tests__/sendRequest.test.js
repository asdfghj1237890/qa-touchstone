import { describe, it, expect, beforeEach } from 'vitest';
import { qaRunSavedRequest } from '../qa/sendRequest.js';

// Outside Tauri, executeRequest falls back to window.QA.RESPONSES[req.id].
// Seed a collection + canned response and confirm the helper returns it.
describe('qaRunSavedRequest (canned fallback, no Tauri)', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 12, size: 5, body: { ok: true }, headers: {} } };
  });

  it('returns the live (canned) response for a saved request', async () => {
    const resp = await qaRunSavedRequest(
      { id: 'r1', method: 'GET', path: 'https://api.test/thing' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, collectionId: 'c1' }
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ ok: true });
  });

  it('matches cookies against the request URL without crashing', async () => {
    const cookies = [
      { on: true, name: 'good', value: '1', domain: 'api.test', path: '/', secure: false, hostOnly: false },
      { on: true, name: 'other', value: '2', domain: 'elsewhere.test', path: '/', secure: false, hostOnly: false },
    ];
    const resp = await qaRunSavedRequest(
      { id: 'r1', method: 'GET', path: 'https://api.test/thing' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, collectionId: 'c1', cookies }
    );
    expect(resp.status).toBe(200);
  });

  it('falls back to the first request when the id is unknown (buildReq fallback)', async () => {
    const resp = await qaRunSavedRequest(
      { id: 'does-not-exist', method: 'GET', path: 'https://api.test/thing' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, collectionId: 'c1' }
    );
    expect(resp.status).toBe(200);
  });
});
