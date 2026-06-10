import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { qaRunSavedRequest } from '../qa/sendRequest';
import { buildReq } from '../qa/buildReq';
import api from '../api/index';

// Outside Tauri, executeRequest falls back to window.QA.RESPONSES[req.id].
// Seed a collection + canned response and confirm the helper returns it.
describe('qaRunSavedRequest (canned fallback, no Tauri)', () => {
  afterEach(() => {
    delete window.__TAURI__;
    vi.restoreAllMocks();
  });

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

  it('uses data/local variables in the actual Tauri request payload', async () => {
    window.__TAURI__ = true;
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'Get user', path: 'https://api.test/users/{{userId}}' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    const execute = vi.spyOn(api, 'executePostmanRequest').mockResolvedValue({
      success: true,
      status: 200,
      headers: {},
      body: '{"ok":true}',
    });

    const resp = await qaRunSavedRequest(
      { id: 'r1', method: 'GET', path: 'https://api.test/users/{{userId}}' },
      {
        env: { label: 'None', baseUrl: '' },
        vars: window.QA.VARIABLES,
        collectionId: 'c1',
        localVars: { userId: '42' },
      }
    );

    expect(resp.status).toBe(200);
    expect(execute.mock.calls[0][0].requestDetails.request.url).toBe('https://api.test/users/42');
  });
});

describe('qaRunSavedRequest — authOverride', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/thing' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'bearer' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 2, body: { ok: true }, headers: {} } };
  });

  it('accepts authOverride without throwing (canned path)', async () => {
    const resp = await qaRunSavedRequest(
      { id: 'r1' },
      { env: { label: 'None', baseUrl: '' }, vars: window.QA.VARIABLES, authOverride: { type: 'none' } },
    );
    expect(resp.status).toBe(200);
  });

  it('buildReq retains the saved request auth type when no override is given', () => {
    const req = buildReq('r1');
    expect(req.auth.type).toBe('bearer');
  });
});

describe('qaRunSavedRequest — mutate hook', () => {
  beforeEach(() => {
    window.QA.COLLECTIONS = [{ id: 'c1', name: 'C', count: 1, folders: [{ name: 'F', requests: [
      { id: 'r1', method: 'GET', name: 'thing', path: 'https://api.test/users/42' },
    ] }] }];
    window.QA.REQUEST_DETAILS = { r1: { params: [], headers: [], body: null, auth: 'none' } };
    window.QA.RESPONSES = { r1: { status: 200, statusText: 'OK', time: 1, size: 2, body: { ok: true }, headers: {} } };
  });
  it('applies mutate(req) before execution so the sent URL reflects the change', async () => {
    let sentUrl = null;
    const mutate = (req) => { sentUrl = req.url; return { ...req, url: req.url.replace('/42', '/99') }; };
    const resp = await qaRunSavedRequest({ id: 'r1' }, { env: { label: 'None', baseUrl: '' }, mutate });
    expect(sentUrl).toBe('https://api.test/users/42');   // mutate saw the original built url
    expect(resp.status).toBe(200);                        // canned path still returns
  });
});
