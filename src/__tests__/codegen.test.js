import { describe, it, expect } from 'vitest';
import { qaEffectiveRequest, QA_LANGS } from '../qa/CodeGen';

const EMPTY_AUTH = {
  type: 'none',
  bearer: '',
  apiKey: { key: '', value: '', placement: 'header' },
  basic: { user: '', pass: '' },
  aws: { profile: '', service: '', region: '' },
  oauth2: {
    grant: 'client_credentials',
    authUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    scope: '',
    code: '',
    redirectUri: '',
    username: '',
    password: '',
  },
};

describe('qaEffectiveRequest', () => {
  it('encodes Basic auth credentials as UTF-8 so Unicode does not crash codegen', () => {
    const req = {
      id: 'r1',
      method: 'GET',
      url: 'https://api.test/me',
      params: [],
      headers: [],
      bodyMode: 'none',
      body: '',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: {
        ...EMPTY_AUTH,
        type: 'basic',
        basic: { user: '使用者', pass: '密碼' },
      },
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const auth = out.headers.find(([k]) => k === 'Authorization');

    expect(auth).toEqual(['Authorization', 'Basic 5L2/55So6ICFOuWvhueivA==']);
  });

  it('generates valid Python for JSON booleans and nulls', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/flags',
      params: [],
      headers: [],
      bodyMode: 'json',
      body: '{\n  "ok": true,\n  "missing": null\n}',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const python = QA_LANGS.find((l) => l.key === 'python').gen(out);

    expect(python).toContain('import json');
    expect(python).toContain('payload = json.loads(');
    expect(python).toContain('\\n  \\"ok\\": true');
    expect(python).toContain('\\n  \\"missing\\": null');
    expect(python).toContain('json=payload');
    expect(python).not.toContain('payload = {\n');
  });

  it('keeps HTTPie JSON object bodies as field arguments', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/flags',
      params: [],
      headers: [],
      bodyMode: 'json',
      body: '{"ok":true,"name":"Ada"}',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const httpie = QA_LANGS.find((l) => l.key === 'httpie').gen(out);

    expect(httpie).toContain("'ok:=true'");
    expect(httpie).toContain('\'name:="Ada"\'');
    expect(httpie).not.toContain('<<<');
  });

  it('keeps HTTPie form bodies instead of dropping them', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/login',
      params: [],
      headers: [],
      bodyMode: 'form',
      body: '',
      gqlQuery: '',
      gqlVars: '',
      form: [
        { on: true, key: 'name', value: 'Ada' },
        { on: true, key: 'role', value: 'qa' },
      ],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const httpie = QA_LANGS.find((l) => l.key === 'httpie').gen(out);

    expect(httpie).toContain("'Content-Type:application/x-www-form-urlencoded'");
    expect(httpie).toContain("<<< 'name=Ada&role=qa'");
  });

  it('keeps HTTPie non-object JSON bodies as raw stdin', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/batch',
      params: [],
      headers: [],
      bodyMode: 'json',
      body: '[true,null]',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const httpie = QA_LANGS.find((l) => l.key === 'httpie').gen(out);

    expect(httpie).toContain("<<< '[true,null]'");
    expect(httpie).not.toContain('0:=');
    expect(httpie).not.toContain('1:=');
  });

  it('keeps HTTPie empty JSON object bodies as raw stdin', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/empty',
      params: [],
      headers: [],
      bodyMode: 'json',
      body: '{}',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const httpie = QA_LANGS.find((l) => l.key === 'httpie').gen(out);

    expect(httpie).toContain("<<< '{}'");
  });

  it('keeps malformed JSON bodies raw in Python and fetch snippets', () => {
    const req = {
      id: 'r1',
      method: 'POST',
      url: 'https://api.test/raw-json',
      params: [],
      headers: [],
      bodyMode: 'json',
      body: '{"ok": true',
      gqlQuery: '',
      gqlVars: '',
      form: [],
      auth: EMPTY_AUTH,
    };

    const out = qaEffectiveRequest(req, { label: 'None', baseUrl: '' }, {}, [], true);
    const python = QA_LANGS.find((l) => l.key === 'python').gen(out);
    const fetch = QA_LANGS.find((l) => l.key === 'js').gen(out);

    expect(python).not.toContain('json.loads');
    expect(python).toContain('data=payload');
    expect(fetch).toContain('body: "{\\"ok\\": true",');
    expect(fetch).not.toContain('body: JSON.stringify({"ok": true),');
  });
});
