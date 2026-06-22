// Generates TS-vs-Rust golden fixtures by running the real TS engine with a
// pinned clock + RNG. Run: `node scripts/gen-fixtures.mjs`. CI fails if the
// committed fixtures differ from a fresh run (staleness gate, added later).
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

const { qaSubstitute, qaVarMap } = await import('./_engine-bridge.mjs');

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
