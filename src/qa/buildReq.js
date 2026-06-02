// ── QA Touchstone — build a full request object from a saved-request id ─────
// Extracted from App.jsx so the Collection Runner and Monitors can construct
// the same request shape the API client sends, without duplicating logic.
import './setup.js';

export const DEFAULT_HEADERS = [{ key: 'Accept', value: 'application/json', on: true }];

function buildHeaders(detailHeaders) {
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
export const EMPTY_REQ = {
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

export function buildReq(id) {
  const { COLLECTIONS, REQUEST_DETAILS } = window.QA;
  const all = COLLECTIONS.flatMap(c => c.folders.flatMap(f => f.requests));
  const meta = all.find(r => r.id === id) || all[0];
  if (!meta) return { ...EMPTY_REQ, headers: DEFAULT_HEADERS.map(h => ({ ...h })) };
  const det = REQUEST_DETAILS[meta.id] || {};
  const isGql = !!det.graphql;
  return {
    id: meta.id,
    method: meta.method,
    url: meta.path.split('?')[0],
    params: (det.params || []).map(p => ({ ...p })),
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
