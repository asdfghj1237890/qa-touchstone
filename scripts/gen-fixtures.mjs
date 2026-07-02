// Generates TS-vs-Rust golden fixtures by running the real TS engine with a
// pinned clock + RNG. Run: `node scripts/gen-fixtures.mjs`.
// CI (ci.yml frontend job) regenerates these and fails on a dirty fixtures/ diff — keep fixtures committed in sync.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Each _*-bridge.mjs registers a process 'exit' listener for tmpdir cleanup;
// with 11+ bridges that trips Node's default max of 10 (MaxListenersExceededWarning).
process.setMaxListeners(32);

const FIXED_NOW = 1_700_000_000_000;
const FLOATS = [0.0, 0.5, 0.999, 0.123456, 0.7];
let _i = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [FIXED_NOW]));
  }
};
globalThis.Date.now = () => FIXED_NOW;
Math.random = () => FLOATS[_i++ % FLOATS.length];

// window must be set before engine bridge (which attaches qaSubstitute to it),
// and before buildPayload bridge (which reads window.qaSubstitute at call time).
globalThis.window = globalThis;
const { qaSubstitute, qaVarMap, qaRunAssertions, qaParseDataFile } =
  await import('./_engine-bridge.mjs');

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'src-tauri', 'core', 'tests', 'fixtures');
mkdirSync(OUT, { recursive: true });

// reset RNG cursor so each fixture section is independent (later sections rely on this)
_i = 0;
const substitute = [
  { name: 'hit', text: 'Hello {{who}}', map: { who: 'world' } },
  { name: 'miss_passthru', text: 'Hello {{ who }}', map: {} },
  { name: 'multi', text: '{{a}}/{{b}}', map: { a: '1', b: '2' } },
  { name: 'empty_map', text: 'no vars here', map: {} },
];
const out = substitute.map((c) => ({ ...c, expected: qaSubstitute(c.text, c.map) }));
writeFileSync(join(OUT, 'substitute.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote substitute.json (${out.length} cases)`);

// qaVarMap(vars, envLabel, collectionIdOrExtra, extra) — engine.ts:35-46.
// vars shape: { globals:[{key,value,on}], collections:{cid:[...]}, environments:{label:[...]} }
_i = 0;
const varmapCases = [
  {
    name: 'precedence_env_over_global',
    vars: {
      globals: [{ key: 'h', value: 'g', on: true }],
      collections: {},
      environments: { staging: [{ key: 'h', value: 'e', on: true }] },
    },
    env: 'staging',
    collectionId: null,
  },
  {
    name: 'off_rows_skipped',
    vars: {
      globals: [
        { key: 'a', value: '1', on: false },
        { key: 'b', value: '2', on: true },
      ],
      collections: {},
      environments: {},
    },
    env: null,
    collectionId: null,
  },
  {
    name: 'missing_on_is_disabled',
    vars: { globals: [{ key: 'a', value: '1' }], collections: {}, environments: {} }, // no `on` -> falsy
    env: null,
    collectionId: null,
  },
  // --- 4-scope precedence (SP1-2): global < collection < environment < local ---
  {
    name: 'collection_over_global',
    vars: {
      globals: [{ key: 'h', value: 'g', on: true }],
      collections: { c: [{ key: 'h', value: 'c', on: true }] },
      environments: {},
    },
    env: null,
    collectionId: 'c',
    local: null,
  },
  {
    name: 'env_over_collection',
    vars: {
      globals: [{ key: 'h', value: 'g', on: true }],
      collections: { c: [{ key: 'h', value: 'c', on: true }] },
      environments: { staging: [{ key: 'h', value: 'e', on: true }] },
    },
    env: 'staging',
    collectionId: 'c',
    local: null,
  },
  {
    name: 'local_over_all',
    vars: {
      globals: [{ key: 'h', value: 'g', on: true }],
      collections: { c: [{ key: 'h', value: 'c', on: true }] },
      environments: { staging: [{ key: 'h', value: 'e', on: true }] },
    },
    env: 'staging',
    collectionId: 'c',
    local: { h: 'l' },
  },
  {
    name: 'four_scope_union',
    vars: {
      globals: [
        { key: 'a', value: 'ga', on: true },
        { key: 'h', value: 'g', on: true },
      ],
      collections: {
        c: [
          { key: 'b', value: 'cb', on: true },
          { key: 'h', value: 'c', on: true },
        ],
      },
      environments: {
        staging: [
          { key: 'd', value: 'ed', on: true },
          { key: 'h', value: 'e', on: true },
        ],
      },
    },
    env: 'staging',
    collectionId: 'c',
    local: { h: 'l' },
  },
  {
    name: 'collection_off_row_skipped',
    vars: {
      globals: [],
      collections: { c: [{ key: 'h', value: 'c', on: false }] },
      environments: {},
    },
    env: null,
    collectionId: 'c',
    local: null,
  },
];
const varmapOut = varmapCases.map((c) => ({
  ...c,
  expected: qaVarMap(c.vars, c.env, c.collectionId, c.local || null),
}));
writeFileSync(join(OUT, 'varmap.json'), JSON.stringify(varmapOut, null, 2) + '\n');
console.log(`wrote varmap.json (${varmapOut.length} cases)`);

// qaDynamic via qaSubstitute (engine.ts:19-28). The pinned Date.now/Math.random
// (top of this file) make these deterministic. The Rust side replays the SAME
// float sequence + fixed clock.
const dynNames = ['$timestamp', '$isoTimestamp', '$randomInt', '$guid', '$randomEmail'];
const dynamics = dynNames.map((n) => {
  _i = 0; // reset the float cursor per case for determinism
  return { name: n, text: `{{${n}}}`, expected: qaSubstitute(`{{${n}}}`, {}) };
});
writeFileSync(
  join(OUT, 'dynamics.json'),
  JSON.stringify({ fixedNowMs: FIXED_NOW, floats: FLOATS, cases: dynamics }, null, 2) + '\n'
);
console.log(`wrote dynamics.json (${dynamics.length} cases)`);

// qaEval/qaRunAssertions (engine.ts:90-108). resp shape: { status, time, body, headers }.
_i = 0;
const resp = {
  status: 200,
  time: 12,
  headers: { 'Content-Type': 'application/json', 'X-Count': '3', 'X-Version': 'v2' },
  body: { id: 7, nullable: null, data: [1, 2, 3], name: 'alice' },
};
const assertCases = [
  { name: 'status_eq', a: { type: 'status', op: 'eq', value: 200, on: true } },
  { name: 'status_neq', a: { type: 'status', op: 'neq', value: 201, on: true } },
  { name: 'bodyHas_null', a: { type: 'bodyHas', path: 'nullable', on: true } }, // null is PRESENT
  { name: 'bodyHas_miss', a: { type: 'bodyHas', path: 'nope', on: true } },
  { name: 'bodyEq_str', a: { type: 'bodyEq', path: 'id', value: '7', on: true } }, // String(7)===String('7')
  { name: 'bodyArray_data', a: { type: 'bodyArray', on: true } }, // body.data is array
  {
    name: 'header_contains_cs',
    a: { type: 'header', name: 'content-type', op: 'contains', value: 'JSON', on: true },
  }, // case-SENSITIVE -> fail
  { name: 'time_lt', a: { type: 'time', op: 'lt', value: 100, on: true } },
  { name: 'unknown_type', a: { type: 'whatever', text: 'x', on: true } }, // passes by default
  { name: 'disabled', a: { type: 'status', op: 'eq', value: 999, on: false } }, // skipped by run_assertions
  { name: 'header_eq_num', a: { type: 'header', name: 'x-count', op: 'eq', value: 3, on: true } }, // String("3")===String(3) -> pass
  { name: 'bodyEq_string_val', a: { type: 'bodyEq', path: 'name', value: 'alice', on: true } }, // JSON.stringify("alice")='"alice"'; String("alice")===String("alice") -> pass
  {
    name: 'header_contains_num',
    a: { type: 'header', name: 'x-version', op: 'contains', value: 2, on: true },
  }, // String('v2'||'').includes(2) -> 'v2'.includes('2') -> true
  {
    name: 'header_contains_missing',
    a: { type: 'header', name: 'no-such-header', op: 'contains', value: 'x', on: true },
  }, // String(undefined||'')=''; ''.includes('x') -> false
];
const assertOut = assertCases.map((c) => ({
  ...c,
  expected: qaRunAssertions([c.a], resp)[0] || null,
})); // null when on:false (filtered out)
writeFileSync(
  join(OUT, 'assertions.json'),
  JSON.stringify({ resp, cases: assertOut }, null, 2) + '\n'
);
console.log(`wrote assertions.json (${assertOut.length} cases)`);

// buildreq vs TS buildPayload(...).requestDetails.
// buildPayload(req, env, varMap, opts) — executor.ts:84-150.
// Compare ONLY the inner `requestDetails` (the { request } shape execute_request consumes).
// Use dynamic import so window.qaSubstitute is set (by engine bridge above) before the
// buildPayload bundle executes at module evaluation time.
const { buildPayload } = await import('./_buildpayload-bridge.mjs');
_i = 0;
// QaRequest shape (buildReq.ts): id, method, url, params[], headers[], bodyMode, body, auth{...}
const mkReq = (o) => ({
  id: 'r',
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  bodyMode: 'none',
  body: '',
  gqlQuery: '',
  gqlVars: '',
  form: [],
  auth: {
    type: 'none',
    bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: {},
    oauth2: {},
  },
  ...o,
});
const brEnv = { baseUrl: '' }; // absolute URLs in fixtures so no rebasing
const brCases = [
  {
    name: 'bearer',
    req: mkReq({
      url: 'https://x.example/u',
      auth: { type: 'bearer', bearer: 'TOK', apiKey: {}, basic: {}, aws: {}, oauth2: {} },
    }),
    varMap: {},
  },
  {
    name: 'apikey_header',
    req: mkReq({
      url: 'https://x.example/u',
      auth: {
        type: 'apiKey',
        bearer: '',
        apiKey: { key: 'X-API-Key', value: 'AK', placement: 'header' },
        basic: {},
        aws: {},
        oauth2: {},
      },
    }),
    varMap: {},
  },
  {
    name: 'apikey_query',
    req: mkReq({
      url: 'https://x.example/u',
      auth: {
        type: 'apiKey',
        bearer: '',
        apiKey: { key: 'X-API-Key', value: 'AK', placement: 'query' },
        basic: {},
        aws: {},
        oauth2: {},
      },
    }),
    varMap: {},
  },
  {
    name: 'apikey_header_template_key',
    req: mkReq({
      url: 'https://x.example/u',
      auth: {
        type: 'apiKey',
        bearer: '',
        apiKey: { key: '{{tenantHeader}}', value: 'AK', placement: 'header' },
        basic: {},
        aws: {},
        oauth2: {},
      },
    }),
    varMap: { tenantHeader: 'X-Tenant-Token' },
  },
  {
    name: 'apikey_query_template_key',
    req: mkReq({
      url: 'https://x.example/u',
      auth: {
        type: 'apiKey',
        bearer: '',
        apiKey: { key: '{{apiKeyParam}}', value: 'AK', placement: 'query' },
        basic: {},
        aws: {},
        oauth2: {},
      },
    }),
    varMap: { apiKeyParam: 'api_key' },
  },
  {
    name: 'basic',
    req: mkReq({
      url: 'https://x.example/u',
      auth: {
        type: 'basic',
        bearer: '',
        apiKey: {},
        basic: { user: 'u', pass: 'p' },
        aws: {},
        oauth2: {},
      },
    }),
    varMap: {},
  },
  {
    name: 'query_enc',
    req: mkReq({ url: 'https://x.example/s', params: [{ key: 'q', value: 'a b&c', on: true }] }),
    varMap: {},
  },
  {
    name: 'json_body',
    req: mkReq({ method: 'POST', url: 'https://x.example/u', bodyMode: 'json', body: '{"a":1}' }),
    varMap: {},
  },
  // Dynamic case: {{$timestamp}} in a query param → resolved via pinned Date.now (FIXED_NOW).
  // $timestamp does not consume floats, so float cursor ordering is unaffected.
  {
    name: 'timestamp_query',
    req: mkReq({
      url: 'https://x.example/u',
      params: [{ key: 't', value: '{{$timestamp}}', on: true }],
    }),
    varMap: {},
  },
];
const brOut = brCases.map((c) => ({
  name: c.name,
  expected: buildPayload(c.req, brEnv, c.varMap).requestDetails,
}));
writeFileSync(
  join(OUT, 'buildreq.json'),
  JSON.stringify({ fixedNowMs: FIXED_NOW, floats: FLOATS, cases: brOut }, null, 2) + '\n'
);
console.log(`wrote buildreq.json (${brOut.length} cases)`);

// qaParseDataFile — CSV/JSON data file parser (engine.ts:195-227).
_i = 0;
const dataCases = [
  { name: 'csv_basic', text: 'a,b\n1,2\n3,4', file: 'd.csv' },
  { name: 'csv_quoted', text: 'a,b\n"x,y","he said ""hi"""', file: 'd.csv' },
  { name: 'json_array', text: '[{"a":1,"b":"two"},{"a":3}]', file: 'd.json' },
  { name: 'json_single', text: '{"a":1,"b":2}', file: 'd.json' },
  { name: 'json_empty', text: '[]', file: 'd.json' },
  { name: 'empty_text', text: '   ', file: 'd.csv' },
  { name: 'csv_too_short', text: 'a,b', file: 'd.csv' },
  { name: 'json_malformed', text: '{"a": }', file: 'd.json' }, // JSON.parse throws -> "Invalid JSON"
];
const dataOut = dataCases.map((c) => ({ ...c, expected: qaParseDataFile(c.text, c.file) }));
writeFileSync(join(OUT, 'datafile.json'), JSON.stringify(dataOut, null, 2) + '\n');
console.log(`wrote datafile.json (${dataOut.length} cases)`);

// js_string coercion — JS String() per type, to pin the Rust js_string() behaviour.
_i = 0;
const coercion = [
  { name: 'num', value: 7 },
  { name: 'float', value: 1.5 },
  { name: 'bool', value: true },
  { name: 'null', value: null },
  { name: 'str', value: 'hi' },
  { name: 'arr', value: [1, 2] },
  { name: 'obj', value: { a: 1 } },
].map((c) => ({ name: c.name, value: c.value, expected: String(c.value) }));
writeFileSync(join(OUT, 'coercion.json'), JSON.stringify(coercion, null, 2) + '\n');
console.log(`wrote coercion.json (${coercion.length} cases)`);

const {
  classifyOutcome: czO,
  classifyResponseOutcome: cRO,
  verdictFor: vF,
  defaultExpectation: dE,
  classifyEndpoint: cE,
} = await import('./_authz-bridge.mjs');
_i = 0;
const azDeny = [401, 403, 404];
const azOutcome = [
  { name: 'ok200', status: 200 },
  { name: 'denied403', status: 403 },
  { name: 'notfound404', status: 404 },
  { name: 'server500', status: 500 },
  { name: 'null', status: null },
].map((c) => ({ ...c, expected: czO(c.status, azDeny) }));
const azResp = [
  { name: 'clean', status: 200, body: { id: 1 } },
  { name: 'soft_error_field', status: 200, body: { error: 'Access denied' } },
  { name: 'soft_status_token', status: 200, body: { status: 'forbidden' } },
  { name: 'soft_phrase_message', status: 200, body: { message: "you don't have permission" } },
  { name: 'generic_error_other', status: 200, body: { error: 'boom' } },
  { name: 'nested_depth', status: 200, body: { a: { b: { c: { error: 'forbidden' } } } } },
  { name: 'forbidden_city_title_clean', status: 200, body: { title: 'Forbidden City' } },
  { name: 'hard_403', status: 403, body: {} },
].map((c) => ({ ...c, expected: cRO({ status: c.status, body: c.body }, azDeny) }));
const azVerdict = [];
for (const e of ['allow', 'deny', 'skip'])
  for (const o of ['allowed', 'denied', 'other'])
    azVerdict.push({ name: `${e}_${o}`, expectation: e, outcome: o, expected: vF(e, o) ?? null });
const azEndpoint = [
  { name: 'get_plain', method: 'GET', path: '/u' },
  { name: 'delete', method: 'DELETE', path: '/u' },
  { name: 'admin_path', method: 'GET', path: '/admin/x' },
  { name: 'manage_token', method: 'GET', path: '/v1/manage' },
].map((c) => ({ ...c, expected: cE(c.method, c.path).privileged }));
const azDefault = [
  { name: 'anon', identity: { auth: { type: 'none' } }, endpoint: { method: 'GET', path: '/u' } },
  {
    name: 'priv_endpoint_nonpriv_id',
    identity: { auth: { type: 'bearer' } },
    endpoint: { method: 'DELETE', path: '/u' },
  },
  {
    name: 'priv_endpoint_priv_id',
    identity: { auth: { type: 'bearer' }, privileged: true },
    endpoint: { method: 'DELETE', path: '/u' },
  },
  {
    name: 'plain',
    identity: { auth: { type: 'bearer' } },
    endpoint: { method: 'GET', path: '/u' },
  },
].map((c) => ({ ...c, expected: dE(c.identity, c.endpoint) }));
writeFileSync(
  join(OUT, 'security_authz.json'),
  JSON.stringify(
    {
      denySet: azDeny,
      outcome: azOutcome,
      resp: azResp,
      verdict: azVerdict,
      endpoint: azEndpoint,
      defaultExpect: azDefault,
    },
    null,
    2
  ) + '\n'
);
console.log(`wrote security_authz.json`);

const {
  matchesOwner: mO,
  classifyBola: cB,
  negativeControlFailed: nCF,
  controlSuggestsIgnoredId: cSI,
  isIdentityKey: iIK,
  syntheticIdFor: sIF,
} = await import('./_bola-bridge.mjs');
_i = 0;
const bolaDeny = [401, 403, 404];
const matchCases = [
  { name: 'id_echo', attack: { userId: 'ownerX' }, owner: {}, idv: 'ownerX' },
  { name: 'id_echo_nonidentity_key', attack: { page: '1' }, owner: {}, idv: '1' },
  {
    name: 'jaccard_hit',
    attack: { a: 'x', b: 'y', c: 'z' },
    owner: { a: 'x', b: 'y', c: 'z' },
    idv: 'no',
  },
  { name: 'jaccard_miss', attack: { a: 'x' }, owner: { a: 'x', b: 'y', c: 'z' }, idv: 'no' },
  { name: 'string_body_contains', attack: '...ownerX...', owner: '', idv: 'ownerX' },
  // Jaccard boundary: 3-of-5 shared (inter=3, union=7 → 3/7 ≈ 0.43 < 0.6 → false)
  {
    name: 'jaccard_3of5_miss',
    attack: { a: '1', b: '2', c: '3', d: 'X', e: 'Y' },
    owner: { a: '1', b: '2', c: '3', f: '9', g: '8' },
    idv: 'no',
  },
  // 2-of-4 shared (inter=2, union=4 → 0.5 < 0.6 → false)
  {
    name: 'jaccard_2of4_miss',
    attack: { a: 'x', b: 'y', c: 'A', d: 'B' },
    owner: { a: 'x', b: 'y', e: 'C', f: 'D' },
    idv: 'no',
  },
  // 3-of-3 perfect overlap between different-keyed objects sharing all same scalar values
  {
    name: 'jaccard_same_values_diff_keys',
    attack: { p: 'x', q: 'y', r: 'z' },
    owner: { a: 'x', b: 'y', c: 'z' },
    idv: 'no',
  },
].map((c) => ({ ...c, expected: mO({ body: c.attack }, { body: c.owner }, c.idv) }));
const classifyCases = [];
for (const [st, m] of [
  [403, false],
  [404, true],
  [200, true],
  [200, false],
  [500, false],
  [null, false],
])
  classifyCases.push({
    name: `s${st}_m${m}`,
    status: st,
    matched: m,
    expected: cB(undefined, st, m, bolaDeny),
  });
const ncfCases = [
  [403, true],
  [200, true],
  [200, false],
  [500, true],
].map(([st, m]) => ({
  name: `s${st}_m${m}`,
  status: st,
  matched: m,
  expected: nCF(st, bolaDeny, m),
}));
const controlCases = [
  {
    name: 'ignored',
    control: { id: 'realA', n: 1 },
    owner: { id: 'realA', n: 1 },
    idv: 'realA',
    synth: '999999999',
  },
  {
    name: 'object_scoped',
    control: { id: '999999999' },
    owner: { id: 'realA' },
    idv: 'realA',
    synth: '999999999',
  },
  // structural_mismatch: control shape differs from owner → expect false
  {
    name: 'structural_mismatch',
    control: { id: 'realA', extra: 'x' },
    owner: { id: 'realA' },
    idv: 'realA',
    synth: '999999999',
  },
  // synth_in_leaves: synthetic id present in control leaves → expect false
  {
    name: 'synth_in_leaves',
    control: { id: 'realA', other: '999999999' },
    owner: { id: 'realA', other: 'z' },
    idv: 'realA',
    synth: '999999999',
  },
].map((c) => ({ ...c, expected: cSI({ body: c.control }, { body: c.owner }, c.idv, c.synth) }));
const idKeyCases = ['id', 'userId', 'owner_id', 'user-id', 'uuid', 'page', 'name', 'accountId'].map(
  (k) => ({ name: k, key: k, expected: iIK(k) })
);
const synthCases = [
  { name: 'num', sample: 42 },
  { name: 'uuid', sample: '550e8400-e29b-41d4-a716-446655440000' },
  { name: 'hex24', sample: '0123456789abcdef01234567' },
  { name: 'other', sample: 'abc' },
  { name: 'null', sample: null },
].map((c) => ({ ...c, expected: sIF(undefined, c.sample) }));
writeFileSync(
  join(OUT, 'security_bola.json'),
  JSON.stringify(
    {
      denySet: bolaDeny,
      match: matchCases,
      classify: classifyCases,
      ncf: ncfCases,
      control: controlCases,
      idKey: idKeyCases,
      synth: synthCases,
    },
    null,
    2
  ) + '\n'
);
console.log('wrote security_bola.json');

const {
  detectThrottleSignal: dTS,
  analyzeThrottle: aT,
  rateLimitStrength: rLS,
  classifyRateLimit: cRL,
  rateLimitSeverity: rLSev,
} = await import('./_ratelimit-bridge.mjs');
_i = 0;
// response-array driven cases: detect + analyze + strength derived from the SAME responses.
const rlResponses = [
  { name: 'empty', responses: [] },
  {
    name: 'all_2xx_no_sig',
    responses: [
      { status: 200, headers: {} },
      { status: 200, headers: {} },
      { status: 200, headers: {} },
    ],
  },
  {
    name: '429_early',
    responses: [
      { status: 200, headers: {} },
      { status: 429, headers: {} },
      { status: 429, headers: {} },
    ],
  },
  {
    name: '429_late_weak',
    responses: Array.from({ length: 30 }, (_, i) =>
      i < 25 ? { status: 200, headers: {} } : { status: 429, headers: {} }
    ),
  },
  // strength budget boundary (pins the `<=` in rate_limit_strength): budget = max(20, ceil(completed*0.5)).
  // 20 successes then a 429 → completed 21, budget 20, allowed 20 == budget → STRONG.
  {
    name: 'at_budget_strong',
    responses: Array.from({ length: 21 }, (_, i) =>
      i < 20 ? { status: 200, headers: {} } : { status: 429, headers: {} }
    ),
  },
  // 21 successes then a 429 → completed 22, budget 20, allowed 21 > budget → WEAK (one over).
  {
    name: 'over_budget_weak',
    responses: Array.from({ length: 22 }, (_, i) =>
      i < 21 ? { status: 200, headers: {} } : { status: 429, headers: {} }
    ),
  },
  {
    name: 'headers_only',
    responses: [
      { status: 200, headers: { 'RateLimit-Limit': '100' } },
      { status: 200, headers: { 'RateLimit-Remaining': '0' } },
    ],
  },
  { name: 'retry_after_2xx', responses: [{ status: 200, headers: { 'Retry-After': '5' } }] },
  {
    name: 'net_errors',
    responses: [
      { status: null, headers: {} },
      { status: 0, headers: {} },
    ],
  },
  {
    name: 'mixed_4xx_5xx',
    responses: [
      { status: 400, headers: {} },
      { status: 500, headers: {} },
      { status: 200, headers: {} },
    ],
  },
];
const rlCases = rlResponses.map((c) => {
  const detect = dTS(c.responses);
  const analyze = aT(c.responses);
  const strength = rLS(analyze);
  return { name: c.name, responses: c.responses, detect, analyze, strength };
});
const rlClassify = [
  { throttled: true, completed: 5 },
  { throttled: false, completed: 5 },
  { throttled: false, completed: 0 },
].map((c) => ({ ...c, expected: cRL({ throttled: c.throttled }, c.completed) }));
const rlSeverity = [
  { sensitivity: 'sensitive', verdict: 'vuln' },
  { sensitivity: 'normal', verdict: 'vuln' },
  { sensitivity: 'sensitive', verdict: 'pass' },
  { sensitivity: null, verdict: 'vuln' },
].map((c) => ({ ...c, expected: rLSev(c.sensitivity, c.verdict) ?? null }));
writeFileSync(
  join(OUT, 'security_ratelimit.json'),
  JSON.stringify({ cases: rlCases, classify: rlClassify, severity: rlSeverity }, null, 2) + '\n'
);
console.log('wrote security_ratelimit.json');

const {
  fnv1a: fH,
  canonicalRuleId: cR,
  effectiveSeverity: eS,
} = await import('./_findings-bridge.mjs');
_i = 0;
const fnvCases = ['', 'a', 'matrix|matrix.deny-bypass|GET /u @anon|GET /u', 'café', 'a😀b'].map(
  (s) => ({ s, expected: fH(s) })
);
const aliasCases = [
  'jwt-in-response',
  'jwt-leakage',
  'aws-access-key',
  'object-authz-bola',
  'bola.cross-object',
  'unknown',
].map((id) => ({ id, expected: cR(id) }));
const sevCases = [
  { sev: 'high', ov: null },
  { sev: 'high', ov: 'critical' },
  { sev: 'low', ov: 'bogus' },
].map((c) => ({
  ...c,
  expected: eS({ severity: c.sev }, c.ov ? { severityOverride: c.ov } : null),
}));
writeFileSync(
  join(OUT, 'security_lifecycle.json'),
  JSON.stringify({ fnv: fnvCases, alias: aliasCases, sev: sevCases }, null, 2) + '\n'
);
console.log('wrote security_lifecycle.json');

const {
  reportToSarif: rS,
  sevToSarifLevel: sL,
  sarifBaselineState: bS,
  buildReport: bR,
  reportToJUnit: rJU,
} = await import('./_findings-bridge.mjs');
const item = (o) => ({
  fp: o.fp,
  effectiveSeverity: o.sev,
  engine: o.engine,
  ruleId: o.ruleId,
  path: o.path || '',
  locationLabel: o.loc || '',
  title: o.title || o.ruleId,
  evidence: o.evidence || '',
  dfp: o.dfp || '',
  count: o.count || 1,
});
const cur = {
  fpVersion: 1,
  runId: 'r',
  items: [
    item({
      fp: 'aa',
      sev: 'high',
      engine: 'bola',
      ruleId: 'bola.cross-object',
      loc: 'GET getOrder @t1: alice→bob',
      title: 'Cross-object access confirmed',
    }),
    item({
      fp: 'bb',
      sev: 'critical',
      engine: 'matrix',
      ruleId: 'matrix.deny-bypass',
      loc: 'DELETE delU @anon',
      title: 'Access-control bypass',
    }),
  ],
};
const base = {
  fpVersion: 1,
  runId: 'b',
  items: [
    item({
      fp: 'bb',
      sev: 'critical',
      engine: 'matrix',
      ruleId: 'matrix.deny-bypass',
      loc: 'DELETE delU @anon',
      title: 'Access-control bypass',
    }),
  ],
};
const records = {
  aa: { suppressed: true, suppressReason: 'accepted' },
  bb: { status: 'acknowledged', owner: 'alice', note: 'tracked' },
};
const model = bR(cur, base, { records });
const sarif = JSON.parse(rS(model));
const junit = rJU(model);
const sevLevel = ['critical', 'high', 'medium', 'low', 'info'].map((s) => ({ s, expected: sL(s) }));
const baseState = ['new', 'carried', 'resolved'].map((p) => ({ p, expected: bS(p) }));
writeFileSync(
  join(OUT, 'security_report.json'),
  JSON.stringify({ sarif, junit, sevLevel, baseState }, null, 2) + '\n'
);
console.log('wrote security_report.json');

const {
  bflaPlan: bP,
  classifyBfla: cBfla,
  bflaSeverity: bSev,
} = await import('./_bfla-bridge.mjs');
_i = 0;
const bflaDeny = [401, 403, 404];

// plan cases: [endpoint, identity] → expected pairs as ["{method} {path}", "{identityId}"] tuples.
// endpoint-major / identity-minor order must match bfla_plan's nested-loop order.
const bflaEndpoints = [
  { method: 'DELETE', path: '/admin/x' }, // heuristic: mutating (privileged)
  { method: 'GET', path: '/admin/y' }, // heuristic: admin path (privileged)
  { method: 'GET', path: '/u', privileged: true }, // explicit override: privileged
  { method: 'DELETE', path: '/v', privileged: false }, // explicit false: NOT privileged
  { method: 'GET', path: '/w' }, // non-privileged (read + no admin token)
];
const bflaIdentities = [
  { id: 'admin', privileged: true },
  { id: 'anon', privileged: false },
  { id: 'user', privileged: false },
];
const bflaPairs = bP(bflaEndpoints, bflaIdentities);
// bflaPlan returns {endpoint, identity} objects; map to ["{method} {path}", "{id}"] tuples
// for the ordered-Vec comparison in the Rust fixture test.
const bflaPlanTuples = bflaPairs.map((p) => [
  `${p.endpoint.method} ${p.endpoint.path}`,
  p.identity.id,
]);

const bflaClassifyCases = [
  { name: 'allowed_200', status: 200, body: {}, denySet: bflaDeny },
  { name: 'denied_403', status: 403, body: {}, denySet: bflaDeny },
  { name: 'denied_401', status: 401, body: {}, denySet: bflaDeny },
  { name: 'denied_404', status: 404, body: {}, denySet: bflaDeny },
  { name: 'other_500', status: 500, body: {}, denySet: bflaDeny },
  { name: 'null_status', status: null, body: {}, denySet: bflaDeny },
  { name: 'soft_deny_200', status: 200, body: { error: 'Access denied' }, denySet: bflaDeny },
  {
    name: 'soft_deny_phrase',
    status: 200,
    body: { message: "you don't have permission" },
    denySet: bflaDeny,
  },
  { name: 'empty_deny_set_200', status: 200, body: {}, denySet: [] },
  { name: 'empty_deny_set_403', status: 403, body: {}, denySet: [] },
].map((c) => ({ ...c, expected: cBfla({ status: c.status, body: c.body }, c.denySet) }));

const bflaSeverityCases = [
  { name: 'delete_vuln', method: 'DELETE', verdict: 'vuln' },
  { name: 'post_vuln', method: 'POST', verdict: 'vuln' },
  { name: 'put_vuln', method: 'PUT', verdict: 'vuln' },
  { name: 'patch_vuln', method: 'PATCH', verdict: 'vuln' },
  { name: 'get_vuln', method: 'GET', verdict: 'vuln' },
  { name: 'delete_pass', method: 'DELETE', verdict: 'pass' },
  { name: 'get_inconclusive', method: 'GET', verdict: 'inconclusive' },
].map((c) => ({ ...c, expected: bSev(c.method, c.verdict) ?? null }));

writeFileSync(
  join(OUT, 'security_bfla.json'),
  JSON.stringify(
    {
      denySet: bflaDeny,
      plan: bflaPlanTuples,
      classify: bflaClassifyCases,
      severity: bflaSeverityCases,
    },
    null,
    2
  ) + '\n'
);
console.log(
  `wrote security_bfla.json (${bflaPlanTuples.length} plan pairs, ${bflaClassifyCases.length} classify, ${bflaSeverityCases.length} severity)`
);

const { scanSensitive: oScan, redact: oRedact } = await import('./_oracles-bridge.mjs');
const sensCases = [
  {
    name: 'jwt',
    resp: {
      status: 200,
      headers: {},
      body: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEF' },
    },
  },
  { name: 'aws-key', resp: { status: 200, headers: {}, body: { key: 'AKIAIOSFODNN7EXAMPLE' } } },
  {
    name: 'private-key',
    resp: { status: 200, headers: {}, body: { pem: '-----BEGIN RSA PRIVATE KEY-----xxxx' } },
  },
  {
    name: 'secret-name',
    resp: { status: 200, headers: {}, body: { password: 'hunter2', other: 'ok' } },
  },
  { name: 'secret_null', resp: { status: 200, headers: {}, body: { password: null } } },
  { name: 'email', resp: { status: 200, headers: {}, body: { contact: 'user@example.com' } } },
  {
    name: 'card_luhn_ok',
    resp: { status: 200, headers: {}, body: { pan: '4111 1111 1111 1111' } },
  },
  {
    name: 'card_luhn_no',
    resp: { status: 200, headers: {}, body: { pan: '4111 1111 1111 1112' } },
  },
  { name: 'internal', resp: { status: 200, headers: {}, body: { stack_trace: 'at x' } } },
  { name: 'leaky_header', resp: { status: 200, headers: { Server: 'nginx/1.2' }, body: {} } },
  {
    name: 'secret_as_key',
    resp: {
      status: 200,
      headers: {},
      body: { 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123': 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig123' },
    },
  },
  {
    name: 'dedup',
    resp: { status: 200, headers: {}, body: { a: { email: 'x@y.com' }, b: { email: 'x@y.com' } } },
  },
];
const sensOut = sensCases.map((c) => ({
  name: c.name,
  findings: oScan(c.resp).map((f) => ({
    ruleId: f.ruleId,
    oracle: f.oracle,
    severity: f.severity,
    title: f.title,
    path: f.path,
    evidence: f.evidence,
  })),
}));
const redactCases = ['', 'short', 'abcdefgh', 'eyJverylongsecretvalue99'].map((s) => ({
  s,
  expected: oRedact(s),
}));
const {
  checkSchema: oCheck,
  inferContract: oInfer,
  runOracles: oRun,
} = await import('./_oracles-bridge.mjs');
const oContract = oInfer({ id: 1, name: 'a', tags: ['x'] });
const schemaCases = [
  { name: 'undeclared', body: { id: 1, name: 'a', tags: ['x'], extra: true } },
  { name: 'type_mismatch', body: { id: '1', name: 'a', tags: ['x'] } },
  { name: 'missing', body: { id: 1, tags: ['x'] } },
  { name: 'nullable_tol', body: { id: null, name: 'a', tags: ['x'] } },
].map((c) => ({
  name: c.name,
  findings: oCheck(c.body, oContract).map((f) => ({
    ruleId: f.ruleId,
    oracle: f.oracle,
    severity: f.severity,
    title: f.title,
    path: f.path,
    evidence: f.evidence,
  })),
}));
// runOracles bump: an undeclared field whose value also leaks (email) → high
const runBump = oRun(
  { status: 200, response: { body: { id: 1, name: 'a', tags: ['x'], leak: 'u@v.com' } } },
  { baseline: oInfer({ id: 1, name: 'a', tags: ['x'] }) }
).map((f) => ({ ruleId: f.ruleId, oracle: f.oracle, severity: f.severity, path: f.path }));
writeFileSync(
  join(OUT, 'security_oracles.json'),
  JSON.stringify(
    { sensitive: sensOut, redact: redactCases, schema: schemaCases, runBump },
    null,
    2
  ) + '\n'
);
console.log('wrote security_oracles.json');

// ── bolasetup: detect_id_location golden fixtures ────────────────────────────
// url inputs are PATH-LIKE (pathname only — no scheme/host) to match the pure fn
// and the CLI adapter behaviour. Each case must have DISTINCT candidate scores
// (no exact ties) so the ordered-Vec compare is deterministic.
const { detectIdLocation: dIdLoc } = await import('./_bolasetup-bridge.mjs');
const bolasetupCases = [
  // numeric path id after plural noun → score 55+25=80 → "high"
  { name: 'path_numeric_after_plural', req: { url: '/orders/42', params: [], body: null } },
  // uuid path id without plural noun → score 90+0=90 → "high"
  {
    name: 'path_uuid_no_plural',
    req: { url: '/item/550e8400-e29b-41d4-a716-446655440000', params: [], body: null },
  },
  // query key matching is_id_key with numeric value → score 55 → "medium"
  {
    name: 'query_id_key_numeric',
    req: { url: '/search', params: [{ key: 'user_id', value: '99', on: true }], body: null },
  },
  // query key matching is_id_key with UUID value → score 78 → "high"
  {
    name: 'query_id_key_uuid',
    req: {
      url: '/items',
      params: [{ key: 'userId', value: '550e8400-e29b-41d4-a716-446655440000', on: true }],
      body: null,
    },
  },
  // body field with id key, numeric value → score 50 → "medium"
  {
    name: 'body_id_field_numeric',
    req: { url: '/create', params: [], body: JSON.stringify({ orderId: 77 }) },
  },
  // body field with id key, hex24 value → score 72 → "medium"  (72 >= 50, < 75)
  {
    name: 'body_id_field_hex24',
    req: {
      url: '/update',
      params: [],
      body: JSON.stringify({ documentId: '0123456789abcdef01234567' }),
    },
  },
  // denylist key in query → excluded → empty candidates
  {
    name: 'denylist_key_excluded',
    req: { url: '/list', params: [{ key: 'page', value: '2', on: true }], body: null },
  },
  // non-id key in query → excluded → empty candidates
  {
    name: 'non_id_key_ignored',
    req: { url: '/list', params: [{ key: 'name', value: 'alice', on: true }], body: null },
  },
  // non-JSON body → no body candidates
  { name: 'non_json_body_skipped', req: { url: '/upload', params: [], body: 'not-json' } },
  // multi-candidate: path uuid + query id → ordered by score (uuid path 90 > query uuid 78)
  {
    name: 'multi_candidate_order',
    req: {
      url: '/users/550e8400-e29b-41d4-a716-446655440000',
      params: [{ key: 'account_id', value: '7', on: true }],
      body: null,
    },
  },
  // nested/array body → golden-locks walkJson's array-path format (items[0].id, meta.account_id).
  // hex24 id (72) vs numeric account_id (50) → distinct scores → deterministic order.
  {
    name: 'nested_array_body',
    req: {
      url: '/save',
      params: [],
      body: JSON.stringify({
        items: [{ id: 'a1b2c3d4e5f6a7b8c9d0e1f2' }],
        meta: { account_id: 9 },
      }),
    },
  },
];
// TS detectIdLocation takes the same DetectableRequest shape (url, params, body).
// params items need on:true to not be filtered (the TS fn filters p.on !== false).
// However the TS fn uses p.key / p.value directly — the on field is not checked in
// detectIdLocation itself (it is checked by buildReq before calling detect). So we
// pass them through directly (the TS fn only reads p.key and p.value).
const bolasetupOut = bolasetupCases.map((c) => ({
  name: c.name,
  req: c.req,
  expected: dIdLoc(c.req),
}));
writeFileSync(join(OUT, 'security_bolasetup.json'), JSON.stringify(bolasetupOut, null, 2) + '\n');
console.log(`wrote security_bolasetup.json (${bolasetupOut.length} cases)`);

const {
  classifyFuzzResponse: cFR,
  fuzzFinding: fF,
  fuzzCasesFor: fCF,
  FUZZ_PAYLOADS: FP,
} = await import('./_fuzz-bridge.mjs');
_i = 0;

// Helper: build a QaResponse-like object (status + body) matching fuzz.ts's QaResponse type.
const mkResp = (status, body) => ({ status, body });
const seedLoc = { kind: 'query', key: 'id' };
const meta = { method: 'GET', path: '/items' };

// classify cases — keyed by name
const fuzzClassify = {};

// 1. 5xx → server-error
fuzzClassify['server-error'] = cFR(
  FP.find((p) => p.id === 'long'),
  mkResp(500, '')
);

// 2. One case per ERROR_SIGNATURE family (using a string body that matches only that family)
fuzzClassify['error-leak-js'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, '    at Object.fn(app.js:10:3)')
);
fuzzClassify['error-leak-python'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'Traceback (most recent call last):')
);
fuzzClassify['error-leak-sql'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'You have an error in your SQL syntax near "1": syntax error')
);
fuzzClassify['error-leak-jvm'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'java.lang.NullPointerException')
);
fuzzClassify['error-leak-dotnet'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'System.NullReferenceException')
);
fuzzClassify['error-leak-php'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, '<b>Fatal error</b>: Uncaught')
);
fuzzClassify['error-leak-go'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'goroutine 1 [running],')
);
fuzzClassify['error-leak-node'] = cFR(
  FP.find((p) => p.id === 'sqli'),
  mkResp(200, 'UnhandledPromiseRejection')
);

// 3. reflected xss → high
const xssP = FP.find((p) => p.id === 'xss');
fuzzClassify['reflected-xss'] = cFR(xssP, mkResp(200, `<div>${xssP.value}</div>`));

// 4. reflected sqli → medium (sqli is not xss → medium)
const sqliP = FP.find((p) => p.id === 'sqli');
fuzzClassify['reflected-sqli'] = cFR(sqliP, mkResp(200, `echo: ${sqliP.value}`));

// 5. echoed benign (empty payload) → ok
const emptyP = FP.find((p) => p.id === 'empty');
fuzzClassify['benign-echo'] = cFR(emptyP, mkResp(200, ''));

// 6. clean 400 with payload present in body (not an error body — no signature match) → ok
const sqliClean = FP.find((p) => p.id === 'sqli');
fuzzClassify['clean-400'] = cFR(sqliClean, mkResp(400, { error: 'invalid id' }));

// fuzz_cases_for: verify 12 cases + first carries the location
const casesForSeed = { name: 'id', location: seedLoc, value: '1' };
const casesArr = fCF(casesForSeed);
// NOTE: the cases-length count is written as a SEPARATE top-level `casesLength` field below,
// NOT as a classify entry — a {length} object has no signal/severity and must not be
// deserialized as a verdict (would panic the fixture test on a missing `signal`).

// fuzz_finding cases — keyed by name (compare ruleId, severity, title, path, evidence)
const fuzzFindings = {};
const longCase = casesArr.find((c) => c.payload.id === 'long');
const resp500 = mkResp(500, '');
fuzzFindings['finding-server-error'] = fF(meta, longCase, resp500);

const xssCase = casesArr.find((c) => c.payload.id === 'xss');
const respXss = mkResp(200, `<div>${xssCase.payload.value}</div>`);
fuzzFindings['finding-reflected-xss'] = fF(meta, xssCase, respXss);

const sqliCase = casesArr.find((c) => c.payload.id === 'sqli');
const respOk = mkResp(200, { ok: true });
fuzzFindings['finding-clean-null'] = fF(meta, sqliCase, respOk); // must be null

writeFileSync(
  join(OUT, 'security_fuzz.json'),
  JSON.stringify(
    { classify: fuzzClassify, findings: fuzzFindings, casesLength: casesArr.length },
    null,
    2
  ) + '\n'
);
console.log(
  `wrote security_fuzz.json (${Object.keys(fuzzClassify).length} classify, ${Object.keys(fuzzFindings).length} finding, casesLength=${casesArr.length})`
);

// ── import: qaParseImport golden fixtures ────────────────────────────────────
// Two sample inputs: a Postman v2.1 collection and an OpenAPI 3 spec.
// The bridge maps {collection,details} → inlined ImportParsed (no ids, no responses).
// Includes falsey-example cases to lock the schemaStub truthiness asymmetry.
const { runImport, mod: importMod } = await import('./_import-bridge.mjs');

const SAMPLE_POSTMAN = JSON.stringify({
  info: {
    name: 'Pet Store',
    _postman_id: 'abc123',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    // Root request with string url (query inline)
    {
      name: 'List Pets',
      request: {
        method: 'GET',
        url: 'https://api.pets.io/v1/pets?limit=10',
        header: [
          { key: 'Accept', value: 'application/json', disabled: false },
          { key: 'X-Internal', value: 'secret', disabled: true }, // disabled → excluded
        ],
      },
    },
    // Root request with raw body
    {
      name: 'Create Pet',
      request: {
        method: 'POST',
        url: { raw: 'https://api.pets.io/v1/pets', path: ['v1', 'pets'], query: [] },
        header: [{ key: 'Content-Type', value: 'application/json', disabled: false }],
        body: { mode: 'raw', raw: '{"name":"Buddy","species":"dog"}' },
      },
    },
    // String-url with percent-encoded multibyte query → exercises the string-url query
    // branch + pct_decode. Real decodeURIComponent yields q="é", tag="a b" (locks FIX 2).
    {
      name: 'Search',
      request: {
        method: 'GET',
        url: 'https://api.example.io/search?q=%C3%A9&tag=a%20b',
        header: [],
      },
    },
    // Object url that is RELATIVE raw-only (no path[]/query[]) → new URL throws → TS catch
    // returns raw verbatim, query kept. Emitted path = "orders/recent?status=open" (locks FIX 3).
    {
      name: 'Recent Orders',
      request: {
        method: 'GET',
        url: { raw: 'orders/recent?status=open' },
        header: [],
      },
    },
    // Folder with a nested request (structured url with query)
    {
      name: 'Users',
      item: [
        {
          name: 'Get User',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.pets.io/v1/users/{{userId}}',
              path: ['v1', 'users', '{{userId}}'],
              query: [{ key: 'include', value: 'pets', disabled: false }],
            },
            header: [],
          },
        },
      ],
    },
  ],
});

const SAMPLE_OPENAPI = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Pet API', version: '1.0.0' },
  servers: [{ url: 'https://api.pets.io' }],
  paths: {
    '/pets': {
      get: {
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [
          { name: 'limit', in: 'query', required: true, example: 20 },
          { name: 'offset', in: 'query', required: false, example: 0 },
          { name: 'X-Trace-Id', in: 'header' },
        ],
        security: [], // empty array is truthy in JS → auth:bearer
      },
      post: {
        summary: 'Create pet',
        tags: ['pets'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Buddy' },
                  active: { type: 'boolean', example: false }, // falsey property example
                  score: { type: 'number', example: 0 }, // falsey property example
                  species: { type: 'string', example: '' }, // falsey property example (empty string)
                  count: { type: 'integer', example: null }, // null → typed zero
                  tags: { type: 'array' }, // absent example → []
                },
              },
            },
          },
        },
      },
    },
    '/pets/{id}': {
      get: {
        summary: 'Get pet',
        operationId: 'getPetById',
        tags: ['pets'],
        parameters: [],
        // Top-level schema with falsey examples to test the truthiness asymmetry:
        requestBody: {
          content: {
            'application/json': {
              schema: {
                // top-level example:0 → FALSY → fall through to property stubs
                type: 'object',
                example: 0,
                properties: { id: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    '/users': {
      get: {
        summary: 'List users',
        tags: ['users'],
        parameters: [{ name: 'role', in: 'query', required: true }],
      },
    },
    '/orders': {
      // requestBody-LEVEL example truthiness (Bug A): TS `if (ex)` is JS-truthy, so a
      // falsey requestBody example (0 / "") must FALL THROUGH to schemaStub — not be
      // emitted as "0" / "". Each op carries a schema so the stub is observable.
      post: {
        summary: 'Create order',
        tags: ['orders'],
        requestBody: {
          content: {
            'application/json': {
              example: 0, // FALSY → fall through to schemaStub
              schema: { type: 'object', properties: { total: { type: 'number' } } },
            },
          },
        },
      },
      put: {
        summary: 'Replace order',
        tags: ['orders'],
        requestBody: {
          content: {
            'application/json': {
              example: '', // FALSY → fall through to schemaStub
              schema: { type: 'object', properties: { note: { type: 'string' } } },
            },
          },
        },
      },
    },
  },
});

const importPostman = runImport(SAMPLE_POSTMAN);
const importOpenApi = runImport(SAMPLE_OPENAPI);

// Error cases (not stored in fixture — verified separately in unit tests)
const importBadJson = importMod.qaParseImport('not json');
const importUnknown = importMod.qaParseImport('{"something":"else"}');

writeFileSync(
  join(OUT, 'import.json'),
  JSON.stringify(
    {
      postman: importPostman,
      openapi: importOpenApi,
      errors: {
        bad_json: importBadJson.error,
        unknown: importUnknown.error,
      },
    },
    null,
    2
  ) + '\n'
);
console.log('wrote import.json');
