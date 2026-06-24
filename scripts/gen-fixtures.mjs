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
const { qaSubstitute, qaVarMap, qaRunAssertions, qaParseDataFile } = await import('./_engine-bridge.mjs');

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
  // --- 4-scope precedence (SP1-2): global < collection < environment < local ---
  { name: 'collection_over_global',
    vars: { globals:[{key:'h',value:'g',on:true}], collections:{ c:[{key:'h',value:'c',on:true}] }, environments:{} },
    env: null, collectionId: 'c', local: null },
  { name: 'env_over_collection',
    vars: { globals:[{key:'h',value:'g',on:true}], collections:{ c:[{key:'h',value:'c',on:true}] }, environments:{ staging:[{key:'h',value:'e',on:true}] } },
    env: 'staging', collectionId: 'c', local: null },
  { name: 'local_over_all',
    vars: { globals:[{key:'h',value:'g',on:true}], collections:{ c:[{key:'h',value:'c',on:true}] }, environments:{ staging:[{key:'h',value:'e',on:true}] } },
    env: 'staging', collectionId: 'c', local: { h: 'l' } },
  { name: 'four_scope_union',
    vars: { globals:[{key:'a',value:'ga',on:true},{key:'h',value:'g',on:true}],
            collections:{ c:[{key:'b',value:'cb',on:true},{key:'h',value:'c',on:true}] },
            environments:{ staging:[{key:'d',value:'ed',on:true},{key:'h',value:'e',on:true}] } },
    env: 'staging', collectionId: 'c', local: { h: 'l' } },
  { name: 'collection_off_row_skipped',
    vars: { globals:[], collections:{ c:[{key:'h',value:'c',on:false}] }, environments:{} },
    env: null, collectionId: 'c', local: null },
];
const varmapOut = varmapCases.map(c => ({ ...c, expected: qaVarMap(c.vars, c.env, c.collectionId, c.local || null) }));
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
const resp = { status: 200, time: 12, headers: { 'Content-Type': 'application/json', 'X-Count': '3', 'X-Version': 'v2' },
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
  { name: 'header_contains_num', a: { type:'header', name:'x-version', op:'contains', value:2, on:true } }, // String('v2'||'').includes(2) -> 'v2'.includes('2') -> true
  { name: 'header_contains_missing', a: { type:'header', name:'no-such-header', op:'contains', value:'x', on:true } }, // String(undefined||'')=''; ''.includes('x') -> false
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
  // Dynamic case: {{$timestamp}} in a query param → resolved via pinned Date.now (FIXED_NOW).
  // $timestamp does not consume floats, so float cursor ordering is unaffected.
  { name:'timestamp_query', req: mkReq({ url:'https://x.example/u', params:[{key:'t',value:'{{$timestamp}}',on:true}] }), varMap:{} },
];
const brOut = brCases.map(c => ({ name:c.name, expected: buildPayload(c.req, brEnv, c.varMap).requestDetails }));
writeFileSync(join(OUT, 'buildreq.json'), JSON.stringify({ fixedNowMs: FIXED_NOW, floats: FLOATS, cases: brOut }, null, 2) + '\n');
console.log(`wrote buildreq.json (${brOut.length} cases)`);

// qaParseDataFile — CSV/JSON data file parser (engine.ts:195-227).
_i = 0;
const dataCases = [
  { name:'csv_basic',     text:'a,b\n1,2\n3,4',                 file:'d.csv' },
  { name:'csv_quoted',    text:'a,b\n"x,y","he said ""hi"""',  file:'d.csv' },
  { name:'json_array',    text:'[{"a":1,"b":"two"},{"a":3}]',   file:'d.json' },
  { name:'json_single',   text:'{"a":1,"b":2}',                 file:'d.json' },
  { name:'json_empty',    text:'[]',                            file:'d.json' },
  { name:'empty_text',    text:'   ',                           file:'d.csv' },
  { name:'csv_too_short', text:'a,b',                           file:'d.csv' },
  { name:'json_malformed',text:'{"a": }',                       file:'d.json' },  // JSON.parse throws -> "Invalid JSON"
];
const dataOut = dataCases.map(c => ({ ...c, expected: qaParseDataFile(c.text, c.file) }));
writeFileSync(join(OUT, 'datafile.json'), JSON.stringify(dataOut, null, 2) + '\n');
console.log(`wrote datafile.json (${dataOut.length} cases)`);

// js_string coercion — JS String() per type, to pin the Rust js_string() behaviour.
_i = 0;
const coercion = [
  { name:'num',   value: 7 },      { name:'float', value: 1.5 },
  { name:'bool',  value: true },   { name:'null',  value: null },
  { name:'str',   value: 'hi' },   { name:'arr',   value: [1,2] },
  { name:'obj',   value: {a:1} },
].map(c => ({ name:c.name, value:c.value, expected: String(c.value) }));
writeFileSync(join(OUT, 'coercion.json'), JSON.stringify(coercion, null, 2) + '\n');
console.log(`wrote coercion.json (${coercion.length} cases)`);

const { classifyOutcome: czO, classifyResponseOutcome: cRO, verdictFor: vF, defaultExpectation: dE, classifyEndpoint: cE } = await import('./_authz-bridge.mjs');
_i = 0;
const azDeny = [401,403,404];
const azOutcome = [
  { name:'ok200', status:200 }, { name:'denied403', status:403 }, { name:'notfound404', status:404 },
  { name:'server500', status:500 }, { name:'null', status:null },
].map(c => ({ ...c, expected: czO(c.status, azDeny) }));
const azResp = [
  { name:'clean', status:200, body:{id:1} },
  { name:'soft_error_field', status:200, body:{error:'Access denied'} },
  { name:'soft_status_token', status:200, body:{status:'forbidden'} },
  { name:'soft_phrase_message', status:200, body:{message:"you don't have permission"} },
  { name:'generic_error_other', status:200, body:{error:'boom'} },
  { name:'nested_depth', status:200, body:{a:{b:{c:{error:'forbidden'}}}} },
  { name:'forbidden_city_title_clean', status:200, body:{title:'Forbidden City'} },
  { name:'hard_403', status:403, body:{} },
].map(c => ({ ...c, expected: cRO({ status:c.status, body:c.body }, azDeny) }));
const azVerdict = [];
for (const e of ['allow','deny','skip']) for (const o of ['allowed','denied','other'])
  azVerdict.push({ name:`${e}_${o}`, expectation:e, outcome:o, expected: vF(e, o) ?? null });
const azEndpoint = [
  { name:'get_plain', method:'GET', path:'/u' }, { name:'delete', method:'DELETE', path:'/u' },
  { name:'admin_path', method:'GET', path:'/admin/x' }, { name:'manage_token', method:'GET', path:'/v1/manage' },
].map(c => ({ ...c, expected: cE(c.method, c.path).privileged }));
const azDefault = [
  { name:'anon', identity:{ auth:{type:'none'} }, endpoint:{ method:'GET', path:'/u' } },
  { name:'priv_endpoint_nonpriv_id', identity:{ auth:{type:'bearer'} }, endpoint:{ method:'DELETE', path:'/u' } },
  { name:'priv_endpoint_priv_id', identity:{ auth:{type:'bearer'}, privileged:true }, endpoint:{ method:'DELETE', path:'/u' } },
  { name:'plain', identity:{ auth:{type:'bearer'} }, endpoint:{ method:'GET', path:'/u' } },
].map(c => ({ ...c, expected: dE(c.identity, c.endpoint) }));
writeFileSync(join(OUT, 'security_authz.json'), JSON.stringify(
  { denySet: azDeny, outcome: azOutcome, resp: azResp, verdict: azVerdict, endpoint: azEndpoint, defaultExpect: azDefault }, null, 2) + '\n');
console.log(`wrote security_authz.json`);

const { matchesOwner: mO, classifyBola: cB, negativeControlFailed: nCF, controlSuggestsIgnoredId: cSI, isIdentityKey: iIK, syntheticIdFor: sIF } = await import('./_bola-bridge.mjs');
_i = 0;
const bolaDeny = [401,403,404];
const matchCases = [
  { name:'id_echo', attack:{userId:'ownerX'}, owner:{}, idv:'ownerX' },
  { name:'id_echo_nonidentity_key', attack:{page:'1'}, owner:{}, idv:'1' },
  { name:'jaccard_hit', attack:{a:'x',b:'y',c:'z'}, owner:{a:'x',b:'y',c:'z'}, idv:'no' },
  { name:'jaccard_miss', attack:{a:'x'}, owner:{a:'x',b:'y',c:'z'}, idv:'no' },
  { name:'string_body_contains', attack:'...ownerX...', owner:'', idv:'ownerX' },
  // Jaccard boundary: 3-of-5 shared (inter=3, union=7 → 3/7 ≈ 0.43 < 0.6 → false)
  { name:'jaccard_3of5_miss', attack:{a:'1',b:'2',c:'3',d:'X',e:'Y'}, owner:{a:'1',b:'2',c:'3',f:'9',g:'8'}, idv:'no' },
  // 2-of-4 shared (inter=2, union=4 → 0.5 < 0.6 → false)
  { name:'jaccard_2of4_miss', attack:{a:'x',b:'y',c:'A',d:'B'}, owner:{a:'x',b:'y',e:'C',f:'D'}, idv:'no' },
  // 3-of-3 perfect overlap between different-keyed objects sharing all same scalar values
  { name:'jaccard_same_values_diff_keys', attack:{p:'x',q:'y',r:'z'}, owner:{a:'x',b:'y',c:'z'}, idv:'no' },
].map(c => ({ ...c, expected: mO({ body:c.attack }, { body:c.owner }, c.idv) }));
const classifyCases = [];
for (const [st, m] of [[403,false],[404,true],[200,true],[200,false],[500,false],[null,false]])
  classifyCases.push({ name:`s${st}_m${m}`, status:st, matched:m, expected: cB(undefined, st, m, bolaDeny) });
const ncfCases = [[403,true],[200,true],[200,false],[500,true]].map(([st,m]) => ({ name:`s${st}_m${m}`, status:st, matched:m, expected: nCF(st, bolaDeny, m) }));
const controlCases = [
  { name:'ignored', control:{id:'realA',n:1}, owner:{id:'realA',n:1}, idv:'realA', synth:'999999999' },
  { name:'object_scoped', control:{id:'999999999'}, owner:{id:'realA'}, idv:'realA', synth:'999999999' },
  // structural_mismatch: control shape differs from owner → expect false
  { name:'structural_mismatch', control:{id:'realA',extra:'x'}, owner:{id:'realA'}, idv:'realA', synth:'999999999' },
  // synth_in_leaves: synthetic id present in control leaves → expect false
  { name:'synth_in_leaves', control:{id:'realA',other:'999999999'}, owner:{id:'realA',other:'z'}, idv:'realA', synth:'999999999' },
].map(c => ({ ...c, expected: cSI({ body:c.control }, { body:c.owner }, c.idv, c.synth) }));
const idKeyCases = ['id','userId','owner_id','user-id','uuid','page','name','accountId'].map(k => ({ name:k, key:k, expected: iIK(k) }));
const synthCases = [
  { name:'num', sample:42 }, { name:'uuid', sample:'550e8400-e29b-41d4-a716-446655440000' },
  { name:'hex24', sample:'0123456789abcdef01234567' }, { name:'other', sample:'abc' }, { name:'null', sample:null },
].map(c => ({ ...c, expected: sIF(undefined, c.sample) }));
writeFileSync(join(OUT, 'security_bola.json'), JSON.stringify(
  { denySet: bolaDeny, match: matchCases, classify: classifyCases, ncf: ncfCases, control: controlCases, idKey: idKeyCases, synth: synthCases }, null, 2) + '\n');
console.log('wrote security_bola.json');

const { detectThrottleSignal: dTS, analyzeThrottle: aT, rateLimitStrength: rLS, classifyRateLimit: cRL, rateLimitSeverity: rLSev } = await import('./_ratelimit-bridge.mjs');
_i = 0;
// response-array driven cases: detect + analyze + strength derived from the SAME responses.
const rlResponses = [
  { name:'empty',          responses: [] },
  { name:'all_2xx_no_sig', responses: [ {status:200,headers:{}}, {status:200,headers:{}}, {status:200,headers:{}} ] },
  { name:'429_early',      responses: [ {status:200,headers:{}}, {status:429,headers:{}}, {status:429,headers:{}} ] },
  { name:'429_late_weak',  responses: Array.from({length:30}, (_,i) => i < 25 ? {status:200,headers:{}} : {status:429,headers:{}}) },
  { name:'headers_only',   responses: [ {status:200,headers:{'RateLimit-Limit':'100'}}, {status:200,headers:{'RateLimit-Remaining':'0'}} ] },
  { name:'retry_after_2xx',responses: [ {status:200,headers:{'Retry-After':'5'}} ] },
  { name:'net_errors',     responses: [ {status:null,headers:{}}, {status:0,headers:{}} ] },
  { name:'mixed_4xx_5xx',  responses: [ {status:400,headers:{}}, {status:500,headers:{}}, {status:200,headers:{}} ] },
];
const rlCases = rlResponses.map(c => {
  const detect = dTS(c.responses);
  const analyze = aT(c.responses);
  const strength = rLS(analyze);
  return { name: c.name, responses: c.responses, detect, analyze, strength };
});
const rlClassify = [
  { throttled:true,  completed:5 }, { throttled:false, completed:5 }, { throttled:false, completed:0 },
].map(c => ({ ...c, expected: cRL({ throttled: c.throttled }, c.completed) }));
const rlSeverity = [
  { sensitivity:'sensitive', verdict:'vuln' }, { sensitivity:'normal', verdict:'vuln' },
  { sensitivity:'sensitive', verdict:'pass' }, { sensitivity:null, verdict:'vuln' },
].map(c => ({ ...c, expected: rLSev(c.sensitivity, c.verdict) ?? null }));
writeFileSync(join(OUT, 'security_ratelimit.json'), JSON.stringify(
  { cases: rlCases, classify: rlClassify, severity: rlSeverity }, null, 2) + '\n');
console.log('wrote security_ratelimit.json');
