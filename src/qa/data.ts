// ── QA Touchstone — runtime data store ─────────────────────────────────────
// The bundled demo Postman collection (see setup.js) is the only seeded
// content; everything else starts empty so the first launch shows a clean
// workspace instead of placeholder credentials, monitors, and history.

export {};

const METHOD_META: Record<string, { hue: number; label: string }> = {
  GET:    { hue: 150, label: 'GET' },
  POST:   { hue: 45,  label: 'POST' },
  PUT:    { hue: 215, label: 'PUT' },
  PATCH:  { hue: 285, label: 'PATCH' },
  DELETE: { hue: 12,  label: 'DELETE' },
};

// `None` is kept so the env dropdown always has a valid selection; add real
// environments from Settings → Environment.
const ENVIRONMENTS: Array<{ label: string; baseUrl: string }> = [
  { label: 'None', baseUrl: '' },
];

const RESPONSES: Record<string, any> = {};
const COLLECTIONS: any[] = [];
const REQUEST_DETAILS: Record<string, any> = {};
const SEED_HISTORY: any[] = [];
const CRED_PROFILES: any[] = [];

const VARIABLES: { globals: any[]; collections: Record<string, any>; environments: Record<string, any[]> } = {
  globals: [],
  collections: {},
  environments: { None: [] },
};

const COOKIES: any[] = [];

// GraphQL editor reads .endpoint and .types — keep the shape, leave it
// empty so the schema explorer just renders "No matching types".
const GRAPHQL_SCHEMA: { endpoint: string; types: any[] } = { endpoint: '/graphql', types: [] };

const MONITORS: any[] = [];

window.QA = { METHOD_META, ENVIRONMENTS, RESPONSES, COLLECTIONS, REQUEST_DETAILS, SEED_HISTORY, CRED_PROFILES, VARIABLES, COOKIES, GRAPHQL_SCHEMA, MONITORS };
