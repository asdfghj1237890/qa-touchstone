// ── QA Touchstone — build a full request object from a saved-request id ─────
// Extracted from App.jsx so the Collection Runner and Monitors can construct
// the same request shape the API client sends, without duplicating logic.
import './setup';

/** 一列 key/value（params/headers/form 共用；on = 該列是否啟用）。 */
export interface QaKVRow {
  key: string;
  value: string;
  on: boolean;
}

/** request 的 auth 區塊（所有 grant/型別欄位都保留空字串預設值）。 */
export interface QaAuth {
  type: 'none' | 'bearer' | 'basic' | 'apiKey' | 'aws' | 'oauth2';
  bearer: string;
  apiKey: { key: string; value: string; placement: 'header' | 'query' };
  basic: { user: string; pass: string };
  aws: { profile: string; service: string; region: string };
  oauth2: {
    grant: 'client_credentials' | 'password' | 'authorization_code';
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
    code: string;
    redirectUri: string;
    username: string;
    password: string;
  };
}

/** API client 送出的完整 request 形狀（Collection Runner / Monitors 共用）。 */
export interface QaRequest {
  id: string;
  method: string;
  url: string;
  params: QaKVRow[];
  headers: QaKVRow[];
  bodyMode: 'none' | 'json' | 'graphql' | 'form';
  body: string;
  gqlQuery: string;
  gqlVars: string;
  form: QaKVRow[];
  auth: QaAuth;
}

export const DEFAULT_HEADERS: QaKVRow[] = [{ key: 'Accept', value: 'application/json', on: true }];

function buildHeaders(detailHeaders: Array<{ key?: string; value?: string; on?: boolean }> | null | undefined): QaKVRow[] {
  const imported = (detailHeaders || []).map(h => ({
    key: h.key || '',
    value: h.value || '',
    on: h.on !== false,
  }));
  const hasAccept = imported.some(h => h.key.toLowerCase() === 'accept');
  return hasAccept ? imported : [...DEFAULT_HEADERS.map(h => ({ ...h })), ...imported];
}

// Placeholder request used when no collections are loaded yet. Components guard
// on req.id, but React's initial render still needs a valid shape.
export const EMPTY_REQ: QaRequest = {
  id: '', method: 'GET', url: '', params: [], headers: DEFAULT_HEADERS.map(h => ({ ...h })),
  bodyMode: 'none', body: '', gqlQuery: '', gqlVars: '', form: [],
  auth: {
    type: 'none', bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', code: '', redirectUri: '', username: '', password: '' },
  },
};

// id 為 null 時回傳第一個可用 request（或 EMPTY_REQ）— App 開機時的預設選取。
export function buildReq(id: string | null): QaRequest {
  const { COLLECTIONS, REQUEST_DETAILS } = window.QA;
  const all = COLLECTIONS.flatMap((c: any) => c.folders.flatMap((f: any) => f.requests));
  const meta = all.find((r: any) => r.id === id) || all[0];
  if (!meta) return { ...EMPTY_REQ, headers: DEFAULT_HEADERS.map(h => ({ ...h })) };
  const det = REQUEST_DETAILS[meta.id] || {};
  const isGql = !!det.graphql;
  return {
    id: meta.id,
    method: meta.method,
    url: meta.path.split('?')[0],
    params: (det.params || []).map((p: any) => ({ ...p })),
    headers: buildHeaders(det.headers),
    bodyMode: isGql ? 'graphql' : (det.body ? 'json' : 'none'),
    body: det.body || '',
    gqlQuery: isGql ? det.graphql.query : '',
    gqlVars: isGql ? det.graphql.variables : '',
    form: [],
    auth: {
      type: det.auth || 'none', bearer: '',
      apiKey: { key: '', value: '', placement: 'header' },
      basic: { user: '', pass: '' },
      aws: { profile: '', service: '', region: '' },
      oauth2: { grant: 'client_credentials', authUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', code: '', redirectUri: '', username: '', password: '' },
    },
  };
}
