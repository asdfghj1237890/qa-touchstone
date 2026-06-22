// Generates TS-vs-Rust golden fixtures by running the real TS engine with a
// pinned clock + RNG. Run: `node scripts/gen-fixtures.mjs`. CI fails if the
// committed fixtures differ from a fresh run (staleness gate, added later).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXED_NOW = 1_700_000_000_000;
const FLOATS = [0.0, 0.5, 0.999, 0.123456, 0.7];
let _i = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a){ super(...(a.length?a:[FIXED_NOW])); } };
globalThis.Date.now = () => FIXED_NOW;
Math.random = () => FLOATS[(_i++) % FLOATS.length];

const { qaSubstitute } = await import('./_engine-bridge.mjs');

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'src-tauri', 'core', 'tests', 'fixtures');

const substitute = [
  { name: 'hit',           text: 'Hello {{who}}',  map: { who: 'world' } },
  { name: 'miss_passthru', text: 'Hello {{ who }}', map: {} },
  { name: 'multi',         text: '{{a}}/{{b}}',     map: { a: '1', b: '2' } },
  { name: 'empty_map',     text: 'no vars here',    map: {} },
];
const out = substitute.map(c => ({ ...c, expected: qaSubstitute(c.text, c.map) }));
writeFileSync(join(OUT, 'substitute.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote substitute.json (${out.length} cases)`);
