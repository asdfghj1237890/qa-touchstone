// Loads the pure fuzz classifiers from fuzz.ts (esbuild), stubbing side-effect imports.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const stub = {
  name: 'stub', setup(b) {
    b.onResolve({ filter: /(\?raw$)|(\/setup$)|(api\/index$)/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
const guard = new Proxy(function(){}, {
  get(_, k) { if (k === 'default' || k === '__esModule') return guard; throw new Error('stubbed module property accessed during fixture gen: ' + String(k)); },
  apply() { throw new Error('stubbed module called during fixture gen'); },
});
export default guard;
`,
      loader: 'js',
    }));
  },
};
const __dir = dirname(fileURLToPath(import.meta.url));
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-fuzz-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const fuzzRes = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'fuzz.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent', plugins: [stub],
});
const fuzzTmp = join(tmpDir, 'fuzz.mjs');
writeFileSync(fuzzTmp, fuzzRes.outputFiles[0].text);
const fuzzMod = await import('file://' + fuzzTmp.replace(/\\/g, '/'));
if (typeof fuzzMod.classifyFuzzResponse !== 'function') throw new Error('classifyFuzzResponse not exported from fuzz.ts bundle');

export const classifyFuzzResponse = fuzzMod.classifyFuzzResponse;
export const fuzzFinding = fuzzMod.fuzzFinding;
export const fuzzCasesFor = fuzzMod.fuzzCasesFor;
export const FUZZ_PAYLOADS = fuzzMod.FUZZ_PAYLOADS;
