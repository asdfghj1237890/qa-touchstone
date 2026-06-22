// Generates TS-vs-Rust golden fixtures by running the real TS engine with a
// pinned clock + RNG. Run: `node scripts/gen-fixtures.mjs`.
// CI (ci.yml frontend job) regenerates these and fails on a dirty fixtures/ diff — keep fixtures committed in sync.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXED_NOW = 1_700_000_000_000;
const FLOATS = [0.0, 0.5, 0.999, 0.123456, 0.7];
let _i = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a){ super(...(a.length?a:[FIXED_NOW])); } };
globalThis.Date.now = () => FIXED_NOW;
Math.random = () => FLOATS[(_i++) % FLOATS.length];

// window must be set before engine bridge (which attaches qaSubstitute to it),
// and before buildPayload bridge (which reads window.qaSubstitute at call time).
globalThis.window = globalThis;
const { qaSubstitute, qaVarMap, qaRunAssertions } = await import('./_engine-bridge.mjs');

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'src-tauri', 'core', 'tests', 'fixtures');
mkdirSync(OUT, { recursive: true });

// reset RNG cursor so each fixture section is independent (later sections rely on this)
_i = 0;
const substitute = [
  { name: 'hit',           text: 'Hello {{who}}',  map: { who: 'world' } },
  { name: 'miss_passthru', text: 'Hello {{ who }}', map: {} },
  { name: 'multi',         text: '{{a}}/{{b}}',     map: { a: '1', b: '2' } },
  { name: 'empty_map',     text: 'no vars here',    map: {} },
];
const out = substitute.map(c => ({ ...c, expected: qaSubstitute(c.text, c.map) }));
writeFileSync(join(OUT, 'substitute.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote substitute.json (${out.length} cases)`);

// qaVarMap(vars, envLabel, collectionIdOrExtra, extra) — engine.ts:35-46.
// vars shape: { globals:[{key,value,on}], collections:{cid:[...]}, environments:{label:[...]} }
_i = 0;
const varmapCases = [
  { name: 'precedence_env_over_global',
    vars: { globals: [{key:'h',value:'g',on:true}], collections:{}, environments:{ staging:[{key:'h',value:'e',on:true}] } },
    env: 'staging', collectionId: null },
  { name: 'off_rows_skipped',
    vars: { globals: [{key:'a',value:'1',on:false},{key:'b',value:'2',on:true}], collections:{}, environments:{} },
    env: null, collectionId: null },
  { name: 'missing_on_is_disabled',
    vars: { globals: [{key:'a',value:'1'}], collections:{}, environments:{} },   // no `on` -> falsy
    env: null, collectionId: null },
];
const varmapOut = varmapCases.map(c => ({ ...c, expected: qaVarMap(c.vars, c.env, c.collectionId) }));
writeFileSync(join(OUT, 'varmap.json'), JSON.stringify(varmapOut, null, 2) + '\n');
console.log(`wrote varmap.json (${varmapOut.length} cases)`);

// qaDynamic via qaSubstitute (engine.ts:19-28). The pinned Date.now/Math.random
// (top of this file) make these deterministic. The Rust side replays the SAME
// float sequence + fixed clock.
const dynNames = ['$timestamp', '$isoTimestamp', '$randomInt', '$guid', '$randomEmail'];
const dynamics = dynNames.map(n => {
  _i = 0;                                   // reset the float cursor per case for determinism
  return { name: n, text: `{{${n}}}`, expected: qaSubstitute(`{{${n}}}`, {}) };
});
writeFileSync(join(OUT, 'dynamics.json'), JSON.stringify({ fixedNowMs: FIXED_NOW, floats: FLOATS, cases: dynamics }, null, 2) + '\n');
console.log(`wrote dynamics.json (${dynamics.length} cases)`);

// qaEval/qaRunAssertions (engine.ts:90-108). resp shape: { status, time, body, headers }.
_i = 0;
const resp = { status: 200, time: 12, headers: { 'Content-Type': 'application/json', 'X-Count': '3' },
  body: { id: 7, nullable: null, data: [1,2,3], name: 'alice' } };
const assertCases = [
  { name: 'status_eq',     a: { type:'status', op:'eq', value:200, on:true } },
  { name: 'status_neq',    a: { type:'status', op:'neq', value:201, on:true } },
  { name: 'bodyHas_null',  a: { type:'bodyHas', path:'nullable', on:true } },   // null is PRESENT
  { name: 'bodyHas_miss',  a: { type:'bodyHas', path:'nope', on:true } },
  { name: 'bodyEq_str',    a: { type:'bodyEq', path:'id', value:'7', on:true } }, // String(7)===String('7')
  { name: 'bodyArray_data',a: { type:'bodyArray', on:true } },                    // body.data is array
  { name: 'header_contains_cs', a: { type:'header', name:'content-type', op:'contains', value:'JSON', on:true } }, // case-SENSITIVE -> fail
  { name: 'time_lt',       a: { type:'time', op:'lt', value:100, on:true } },
  { name: 'unknown_type',  a: { type:'whatever', text:'x', on:true } },          // passes by default
  { name: 'disabled',      a: { type:'status', op:'eq', value:999, on:false } }, // skipped by run_assertions
  { name: 'header_eq_num', a: { type:'header', name:'x-count', op:'eq', value:3, on:true } }, // String("3")===String(3) -> pass
  { name: 'bodyEq_string_val', a: { type:'bodyEq', path:'name', value:'alice', on:true } },   // JSON.stringify("alice")='"alice"'; String("alice")===String("alice") -> pass
];
const assertOut = assertCases.map(c => ({ ...c,
  expected: qaRunAssertions([c.a], resp)[0] || null }));   // null when on:false (filtered out)
writeFileSync(join(OUT, 'assertions.json'), JSON.stringify({ resp, cases: assertOut }, null, 2) + '\n');
console.log(`wrote assertions.json (${assertOut.length} cases)`);

// buildreq vs TS buildPayload(...).requestDetails.
// buildPayload(req, env, varMap, opts) — executor.ts:84-150.
// Compare ONLY the inner `requestDetails` (the { request } shape execute_request consumes).
// Use dynamic import so window.qaSubstitute is set (by engine bridge above) before the
// buildPayload bundle executes at module evaluation time.
const { buildPayload } = await import('./_buildpayload-bridge.mjs');
_i = 0;
// QaRequest shape (buildReq.ts): id, method, url, params[], headers[], bodyMode, body, auth{...}
const mkReq = (o) => ({ id:'r', method:'GET', url:'', params:[], headers:[], bodyMode:'none', body:'',
  gqlQuery:'', gqlVars:'', form:[], auth:{ type:'none', bearer:'', apiKey:{key:'',value:'',placement:'header'},
  basic:{user:'',pass:''}, aws:{}, oauth2:{} }, ...o });
const brEnv = { baseUrl: '' };  // absolute URLs in fixtures so no rebasing
const brCases = [
  { name:'bearer', req: mkReq({ url:'https://x.example/u', auth:{ type:'bearer', bearer:'TOK', apiKey:{}, basic:{}, aws:{}, oauth2:{} } }), varMap:{} },
  { name:'apikey_header', req: mkReq({ url:'https://x.example/u', auth:{ type:'apiKey', bearer:'', apiKey:{key:'X-API-Key',value:'AK',placement:'header'}, basic:{}, aws:{}, oauth2:{} } }), varMap:{} },
  { name:'apikey_query', req: mkReq({ url:'https://x.example/u', auth:{ type:'apiKey', bearer:'', apiKey:{key:'X-API-Key',value:'AK',placement:'query'}, basic:{}, aws:{}, oauth2:{} } }), varMap:{} },
  { name:'basic', req: mkReq({ url:'https://x.example/u', auth:{ type:'basic', bearer:'', apiKey:{}, basic:{user:'u',pass:'p'}, aws:{}, oauth2:{} } }), varMap:{} },
  { name:'query_enc', req: mkReq({ url:'https://x.example/s', params:[{key:'q',value:'a b&c',on:true}] }), varMap:{} },
  { name:'json_body', req: mkReq({ method:'POST', url:'https://x.example/u', bodyMode:'json', body:'{"a":1}' }), varMap:{} },
];
const brOut = brCases.map(c => ({ name:c.name, expected: buildPayload(c.req, brEnv, c.varMap).requestDetails }));
writeFileSync(join(OUT, 'buildreq.json'), JSON.stringify(brOut, null, 2) + '\n');
console.log(`wrote buildreq.json (${brOut.length} cases)`);
