// ── QA Companion — mock data ──────────────────────────────────────────────
// Collections, environments, canned responses, and seed history so the
// prototype feels like a real working API client.

const METHOD_META = {
  GET:    { hue: 150, label: 'GET' },
  POST:   { hue: 45,  label: 'POST' },
  PUT:    { hue: 215, label: 'PUT' },
  PATCH:  { hue: 285, label: 'PATCH' },
  DELETE: { hue: 12,  label: 'DELETE' },
};

const ENVIRONMENTS = [
  { label: 'None',       baseUrl: '' },
  { label: 'Local',      baseUrl: 'http://localhost:3000' },
  { label: 'Staging',    baseUrl: 'https://staging.api.acme.dev' },
  { label: 'Production', baseUrl: 'https://api.acme.dev' },
];

// Canned response bodies keyed by request id.
const RESPONSES = {
  'usr-list': {
    status: 200, statusText: 'OK', time: 184, size: 612,
    body: {
      page: 1, per_page: 3, total: 248,
      data: [
        { id: 7301, name: 'Ada Lovelace',   email: 'ada@acme.dev',   role: 'admin',  active: true },
        { id: 7302, name: 'Alan Turing',    email: 'alan@acme.dev',  role: 'editor', active: true },
        { id: 7303, name: 'Grace Hopper',   email: 'grace@acme.dev', role: 'viewer', active: false },
      ],
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-remaining': '4998',
      'cache-control': 'public, max-age=30',
      'set-cookie': 'last_seen=2026-05-29; Path=/; Max-Age=86400; SameSite=Lax',
      'x-request-id': 'req_8f2c1a9e',
    },
  },
  'usr-get': {
    status: 200, statusText: 'OK', time: 96, size: 284,
    body: {
      id: 7301, name: 'Ada Lovelace', email: 'ada@acme.dev', role: 'admin',
      active: true, created_at: '2024-11-02T09:14:00Z',
      teams: ['platform', 'analytics'],
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-remaining': '4997',
      'x-request-id': 'req_2b7d4f01',
    },
  },
  'usr-create': {
    status: 201, statusText: 'Created', time: 241, size: 198,
    body: {
      id: 7349, name: 'Katherine Johnson', email: 'katherine@acme.dev',
      role: 'editor', active: true, created_at: '2026-05-29T16:02:11Z',
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'location': '/v1/users/7349',
      'x-request-id': 'req_5e1a8c33',
    },
  },
  'usr-update': {
    status: 200, statusText: 'OK', time: 173, size: 210,
    body: { id: 7301, name: 'Ada Lovelace', role: 'owner', updated_at: '2026-05-29T16:03:48Z' },
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req_9c0b2d77' },
  },
  'usr-delete': {
    status: 204, statusText: 'No Content', time: 88, size: 0,
    body: null,
    headers: { 'x-request-id': 'req_1f6e3a02' },
  },
  'auth-token': {
    status: 200, statusText: 'OK', time: 312, size: 342,
    body: {
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo',
      token_type: 'Bearer', expires_in: 3600, scope: 'read write',
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'session=sess_b71d0a4e9f2c1; Domain=staging.api.acme.dev; Path=/; Secure; HttpOnly; SameSite=Lax',
      'x-request-id': 'req_44ad9e10',
    },
  },
  'auth-me': {
    status: 401, statusText: 'Unauthorized', time: 64, size: 96,
    body: { error: 'invalid_token', message: 'The access token has expired.' },
    headers: { 'content-type': 'application/json; charset=utf-8', 'www-authenticate': 'Bearer', 'x-request-id': 'req_77fe1b29' },
  },
  'ord-list': {
    status: 200, statusText: 'OK', time: 207, size: 488,
    body: {
      data: [
        { id: 'ord_91', total: 128.4, currency: 'USD', status: 'shipped' },
        { id: 'ord_92', total: 42.0,  currency: 'USD', status: 'pending' },
      ],
      total: 2,
    },
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req_3a8c5e14' },
  },
  'health': {
    status: 200, statusText: 'OK', time: 22, size: 64,
    body: { status: 'ok', uptime: 998213, version: '0.13.1' },
    headers: { 'content-type': 'application/json; charset=utf-8' },
  },
  'gql-users': {
    status: 200, statusText: 'OK', time: 142, size: 318,
    body: { data: { users: [
      { id: '7301', name: 'Ada Lovelace', role: 'ADMIN' },
      { id: '7302', name: 'Alan Turing', role: 'EDITOR' },
    ] } },
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req_gql_01a2' },
  },
};

// Mock GraphQL schema for the schema explorer (introspection result).
const GRAPHQL_SCHEMA = {
  endpoint: '/graphql',
  types: [
    { name: 'Query', kind: 'OBJECT', fields: [
      { name: 'user', args: '(id: ID!)', type: 'User' },
      { name: 'users', args: '(role: Role, first: Int)', type: '[User!]!' },
      { name: 'order', args: '(id: ID!)', type: 'Order' },
      { name: 'orders', args: '(status: OrderStatus)', type: '[Order!]!' },
    ] },
    { name: 'Mutation', kind: 'OBJECT', fields: [
      { name: 'createUser', args: '(input: CreateUserInput!)', type: 'User!' },
      { name: 'updateUser', args: '(id: ID!, input: UpdateUserInput!)', type: 'User!' },
      { name: 'deleteUser', args: '(id: ID!)', type: 'Boolean!' },
    ] },
    { name: 'User', kind: 'OBJECT', fields: [
      { name: 'id', args: '', type: 'ID!' },
      { name: 'name', args: '', type: 'String!' },
      { name: 'email', args: '', type: 'String!' },
      { name: 'role', args: '', type: 'Role!' },
      { name: 'active', args: '', type: 'Boolean!' },
      { name: 'teams', args: '', type: '[String!]!' },
    ] },
    { name: 'Order', kind: 'OBJECT', fields: [
      { name: 'id', args: '', type: 'ID!' },
      { name: 'total', args: '', type: 'Float!' },
      { name: 'currency', args: '', type: 'String!' },
      { name: 'status', args: '', type: 'OrderStatus!' },
    ] },
    { name: 'Role', kind: 'ENUM', fields: [
      { name: 'ADMIN', args: '', type: '' }, { name: 'EDITOR', args: '', type: '' }, { name: 'VIEWER', args: '', type: '' },
    ] },
    { name: 'OrderStatus', kind: 'ENUM', fields: [
      { name: 'PENDING', args: '', type: '' }, { name: 'SHIPPED', args: '', type: '' }, { name: 'CANCELLED', args: '', type: '' },
    ] },
  ],
};

const COLLECTIONS = [
  {
    id: 'c-users', name: 'User Service', count: 5,
    folders: [
      {
        name: 'Users', requests: [
          { id: 'usr-list',   method: 'GET',    name: 'List users',    path: '/v1/users?page=1' },
          { id: 'usr-get',    method: 'GET',    name: 'Get user',      path: '/v1/users/7301' },
          { id: 'usr-create', method: 'POST',   name: 'Create user',   path: '/v1/users' },
          { id: 'usr-update', method: 'PATCH',  name: 'Update user',   path: '/v1/users/7301' },
          { id: 'usr-delete', method: 'DELETE', name: 'Delete user',   path: '/v1/users/7303' },
        ],
      },
    ],
  },
  {
    id: 'c-auth', name: 'Auth', count: 2,
    folders: [
      {
        name: 'OAuth', requests: [
          { id: 'auth-token', method: 'POST', name: 'Issue token',   path: '/oauth/token' },
          { id: 'auth-me',    method: 'GET',  name: 'Current user',  path: '/v1/me' },
        ],
      },
    ],
  },
  {
    id: 'c-orders', name: 'Orders API', count: 2,
    folders: [
      {
        name: 'Orders', requests: [
          { id: 'ord-list', method: 'GET', name: 'List orders', path: '/v1/orders' },
          { id: 'health',   method: 'GET', name: 'Health check', path: '/healthz' },
        ],
      },
    ],
  },
  {
    id: 'c-gql', name: 'GraphQL', count: 1,
    folders: [
      {
        name: 'Queries', requests: [
          { id: 'gql-users', method: 'POST', name: 'List users (GQL)', path: '/graphql' },
        ],
      },
    ],
  },
];

// Default param / header / body seeds per request for the builder.
const REQUEST_DETAILS = {
  'usr-list':   { params: [{ key: 'page', value: '1', on: true }, { key: 'per_page', value: '3', on: true }], body: null, auth: 'bearer' },
  'usr-get':    { params: [], body: null, auth: 'bearer' },
  'usr-create': { params: [], auth: 'bearer', body: JSON.stringify({ name: 'Katherine Johnson', email: 'katherine@acme.dev', role: 'editor' }, null, 2) },
  'usr-update': { params: [], auth: 'bearer', body: JSON.stringify({ role: 'owner' }, null, 2) },
  'usr-delete': { params: [], body: null, auth: 'bearer' },
  'auth-token': { params: [], auth: 'basic', body: JSON.stringify({ grant_type: 'client_credentials', scope: 'read write' }, null, 2) },
  'auth-me':    { params: [], body: null, auth: 'bearer' },
  'ord-list':   { params: [{ key: 'limit', value: '20', on: true }], body: null, auth: 'apiKey' },
  'health':     { params: [], body: null, auth: 'none' },
  'gql-users':  { params: [], body: null, auth: 'bearer', graphql: {
    query: 'query ListUsers($role: Role) {\n  users(role: $role, first: 10) {\n    id\n    name\n    role\n  }\n}',
    variables: '{\n  "role": "ADMIN"\n}',
  } },
};

const SEED_HISTORY = [
  { id: 'usr-list',   method: 'GET',  path: '/v1/users?page=1', status: 200, time: 184, at: '16:02' },
  { id: 'auth-token', method: 'POST', path: '/oauth/token',     status: 200, time: 312, at: '15:58' },
  { id: 'auth-me',    method: 'GET',  path: '/v1/me',           status: 401, time: 64,  at: '15:57' },
  { id: 'health',     method: 'GET',  path: '/healthz',         status: 200, time: 22,  at: '15:40' },
];

const CRED_PROFILES = [
  { id: 'p1', name: 'acme-staging',    type: 'aws',    region: 'us-east-1', detail: 'AWS SigV4 · execute-api' },
  { id: 'p2', name: 'acme-prod',       type: 'aws',    region: 'us-west-2', detail: 'AWS SigV4 · execute-api' },
  { id: 'p3', name: 'partner-bearer',  type: 'bearer', region: '—',         detail: 'Bearer token' },
  { id: 'p4', name: 'legacy-basic',    type: 'basic',  region: '—',         detail: 'Basic auth' },
];

const VARIABLES = {
  globals: [
    { key: 'apiVersion', value: 'v1', on: true },
    { key: 'userId', value: '7301', on: true },
  ],
  collections: {
    'c-users': [
      { key: 'userId', value: '7303', on: true },        // overrides the global userId for this collection
      { key: 'defaultRole', value: 'editor', on: true },
    ],
    'c-auth': [
      { key: 'clientId', value: 'qa-client-001', on: true },
      { key: 'scope', value: 'read write', on: true },
    ],
    'c-orders': [
      { key: 'currency', value: 'USD', on: true },
    ],
  },
  environments: {
    None: [],
    Local: [{ key: 'token', value: 'local-demo-token', on: true }],
    Staging: [{ key: 'token', value: 'stg-eyJhbGciOi9.demo', on: true }, { key: 'tenant', value: 'acme-stg', on: true }],
    Production: [{ key: 'token', value: 'prod-eyJhbGciOi9.demo', on: true }, { key: 'tenant', value: 'acme', on: true }],
  },
};

// Cookie Jar — cookies the client stores and replays on matching requests.
const COOKIES = [
  { id: 'ck1', name: 'session',     value: 'sess_8f2c1a9e4b71d0', domain: 'localhost',              path: '/',      expires: '2026-12-31', httpOnly: true,  secure: false, sameSite: 'Lax',    on: true },
  { id: 'ck2', name: 'csrf_token',  value: 'tok_44ad9e10f7',      domain: 'staging.api.acme.dev',   path: '/',      expires: '2026-06-30', httpOnly: false, secure: true,  sameSite: 'Strict', on: true },
  { id: 'ck3', name: '__auth',      value: 'eyJhbGciOi9.stg.demo',domain: 'staging.api.acme.dev',   path: '/v1',    expires: '2026-06-01', httpOnly: true,  secure: true,  sameSite: 'Lax',    on: false },
  { id: 'ck4', name: 'tracking_id', value: 'trk_f8e2a1c9b3',      domain: 'api.acme.dev',           path: '/',      expires: '2027-01-01', httpOnly: false, secure: true,  sameSite: 'None',   on: true },
];

// Scheduled monitors — a collection run on a cadence, with recent run history.
const MONITORS = [
  {
    id: 'mon-1', name: 'User Service · smoke', collectionId: 'c-users', env: 'Staging',
    cadence: 'Every 15 minutes', region: 'us-east-1', enabled: true, nextRun: 'in 7 min',
    runs: [
      { at: '16:00', status: 'pass', passed: 5, failed: 0, ms: 742 },
      { at: '15:45', status: 'pass', passed: 5, failed: 0, ms: 698 },
      { at: '15:30', status: 'fail', passed: 4, failed: 1, ms: 1180 },
      { at: '15:15', status: 'pass', passed: 5, failed: 0, ms: 705 },
      { at: '15:00', status: 'pass', passed: 5, failed: 0, ms: 690 },
      { at: '14:45', status: 'pass', passed: 5, failed: 0, ms: 712 },
    ],
  },
  {
    id: 'mon-2', name: 'Auth · token health', collectionId: 'c-auth', env: 'Production',
    cadence: 'Every hour', region: 'eu-west-1', enabled: true, nextRun: 'in 38 min',
    runs: [
      { at: '15:30', status: 'fail', passed: 1, failed: 1, ms: 540 },
      { at: '14:30', status: 'pass', passed: 2, failed: 0, ms: 488 },
      { at: '13:30', status: 'pass', passed: 2, failed: 0, ms: 502 },
      { at: '12:30', status: 'pass', passed: 2, failed: 0, ms: 495 },
    ],
  },
  {
    id: 'mon-3', name: 'Orders · nightly regression', collectionId: 'c-orders', env: 'Staging',
    cadence: 'Daily at 02:00', region: 'us-east-1', enabled: false, nextRun: 'paused',
    runs: [
      { at: '02:00', status: 'pass', passed: 2, failed: 0, ms: 320 },
      { at: 'yest 02:00', status: 'pass', passed: 2, failed: 0, ms: 310 },
    ],
  },
];

window.QA = { METHOD_META, ENVIRONMENTS, RESPONSES, COLLECTIONS, REQUEST_DETAILS, SEED_HISTORY, CRED_PROFILES, VARIABLES, COOKIES, GRAPHQL_SCHEMA, MONITORS };
