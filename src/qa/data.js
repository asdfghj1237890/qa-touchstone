// ── QA Companion — runtime data store ─────────────────────────────────────
// The bundled demo Postman collection (see setup.js) is the only seeded
// content; everything else starts empty so the first launch shows a clean
// workspace instead of placeholder credentials, monitors, and history.

const METHOD_META = {
  GET:    { hue: 150, label: 'GET' },
  POST:   { hue: 45,  label: 'POST' },
  PUT:    { hue: 215, label: 'PUT' },
  PATCH:  { hue: 285, label: 'PATCH' },
  DELETE: { hue: 12,  label: 'DELETE' },
};

// `None` is kept so the env dropdown always has a valid selection; add real
// environments from Settings → Environment.
const ENVIRONMENTS = [
  { label: 'None', baseUrl: '' },
];

const RESPONSES = {};
const COLLECTIONS = [];
const REQUEST_DETAILS = {};
const SEED_HISTORY = [];
const CRED_PROFILES = [];

const VARIABLES = {
  globals: [],
  collections: {},
  environments: { None: [] },
};

const COOKIES = [];

// GraphQL editor reads .endpoint and .types — keep the shape, leave it
// empty so the schema explorer just renders "No matching types".
const GRAPHQL_SCHEMA = { endpoint: '/graphql', types: [] };

const MONITORS = [];

window.QA = { METHOD_META, ENVIRONMENTS, RESPONSES, COLLECTIONS, REQUEST_DETAILS, SEED_HISTORY, CRED_PROFILES, VARIABLES, COOKIES, GRAPHQL_SCHEMA, MONITORS };
