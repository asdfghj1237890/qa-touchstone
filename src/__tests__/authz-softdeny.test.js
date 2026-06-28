import { describe, it, expect } from 'vitest';
import { detectSoftDeny, classifyResponseOutcome, runMatrix, anonIdentity } from '../qa/authz';

describe('detectSoftDeny', () => {
  it('flags an explicit auth-denial phrase in a 2xx message field', () => {
    expect(detectSoftDeny({ status: 200, body: { error: 'Access denied' } })).toBe('denied');
    expect(
      detectSoftDeny({ status: 200, body: { message: 'You are not authorized to view this' } })
    ).toBe('denied');
    expect(detectSoftDeny({ status: 200, body: { detail: 'Insufficient scope' } })).toBe('denied');
  });

  it('flags a bare denial token in a machine status/code field', () => {
    expect(detectSoftDeny({ status: 200, body: { status: 'forbidden' } })).toBe('denied');
    expect(detectSoftDeny({ status: 200, body: { code: 'UNAUTHORIZED' } })).toBe('denied');
    expect(detectSoftDeny({ status: 200, body: { result: 'access_denied' } })).toBe('denied');
  });

  it('flags a denial phrase nested in an errors array', () => {
    expect(
      detectSoftDeny({ status: 200, body: { errors: [{ message: 'Permission denied' }] } })
    ).toBe('denied');
  });

  it('flags a denial phrase in a plain string body', () => {
    expect(detectSoftDeny({ status: 200, body: 'Forbidden' })).toBe('denied');
    expect(detectSoftDeny({ status: 200, body: 'login required' })).toBe('denied');
  });

  it('returns "error" (ambiguous) for a generic error marker without an auth phrase', () => {
    expect(detectSoftDeny({ status: 200, body: { error: 'validation failed' } })).toBe('error');
    expect(detectSoftDeny({ status: 200, body: { errors: ['email is required'] } })).toBe('error');
  });

  it('returns null for a genuine success body', () => {
    expect(detectSoftDeny({ status: 200, body: { id: 1, name: 'Alice' } })).toBe(null);
    expect(detectSoftDeny({ status: 200, body: { success: true, error: null } })).toBe(null);
    expect(detectSoftDeny({ status: 200, body: { ok: true, errors: [] } })).toBe(null);
    expect(detectSoftDeny({ status: 200 })).toBe(null); // no body at all
  });

  it('does NOT false-positive on benign prose that merely contains a denial word', () => {
    // "Forbidden City" in a human title must not be read as an auth denial.
    expect(
      detectSoftDeny({ status: 200, body: { title: 'Forbidden City walking tour', id: 7 } })
    ).toBe(null);
    expect(
      detectSoftDeny({ status: 200, body: { description: 'Access control basics for beginners' } })
    ).toBe(null);
  });
});

describe('classifyResponseOutcome', () => {
  it('keeps a genuine 2xx as allowed', () => {
    expect(classifyResponseOutcome({ status: 200, body: { id: 1 } })).toBe('allowed');
  });
  it('reclassifies a soft-403 (200 + denial body) as denied', () => {
    expect(classifyResponseOutcome({ status: 200, body: { error: 'Access denied' } })).toBe(
      'denied'
    );
  });
  it('downgrades a 200 with a generic error marker to other (not a clean allow)', () => {
    expect(classifyResponseOutcome({ status: 200, body: { error: 'boom' } })).toBe('other');
  });
  it('passes through real deny statuses unchanged', () => {
    expect(classifyResponseOutcome({ status: 403, body: { error: 'nope' } })).toBe('denied');
    expect(classifyResponseOutcome({ status: 401 })).toBe('denied');
  });
  it('honors a custom deny set', () => {
    expect(classifyResponseOutcome({ status: 404 }, [401, 403])).toBe('other');
  });
});

describe('runMatrix — soft-deny awareness', () => {
  const state = {
    identities: [
      anonIdentity(),
      { id: 'admin', name: 'admin', auth: { type: 'bearer', bearer: 'x' } },
    ],
    endpoints: [{ reqId: 'r1', method: 'GET', path: '/secret' }],
    expect: { r1: { anon: 'deny', admin: 'allow' } },
    denySet: [401, 403, 404],
  };

  it('does NOT flag a vuln when a deny-cell returns a 200 soft-403 (the API denied via body)', async () => {
    // anon expected deny; server returns 200 but body says access denied → genuine deny → pass, not vuln.
    const runner = (ep, id) =>
      Promise.resolve(
        id.id === 'anon'
          ? { status: 200, time: 1, body: { error: 'Access denied' } }
          : { status: 200, time: 1, body: { id: 1, name: 'Alice' } }
      );
    const results = await runMatrix(state, runner, {});
    expect(results.r1.anon.verdict).toBe('pass'); // was 'vuln' under status-only classification
    expect(results.r1.admin.verdict).toBe('pass');
  });

  it('fails an allow-cell that returns a 200 soft-403 (legit user is actually blocked)', async () => {
    const runner = () =>
      Promise.resolve({ status: 200, time: 1, body: { message: 'You are not authorized' } });
    const results = await runMatrix(
      { ...state, expect: { r1: { admin: 'allow', anon: 'skip' } } },
      runner,
      {}
    );
    expect(results.r1.admin.verdict).toBe('fail'); // was a false 'pass'
  });

  it('still flags a genuine BOLA-style hole: deny-cell returns real data on 200', async () => {
    const runner = () => Promise.resolve({ status: 200, time: 1, body: { id: 42, ssn: '123' } });
    const results = await runMatrix({ ...state, expect: { r1: { anon: 'deny' } } }, runner, {});
    expect(results.r1.anon.verdict).toBe('vuln');
  });
});
