import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const stub = { name: 'stub', setup(b) {
  b.onResolve({ filter: /(\?raw$)|(\/setup$)|(api\/index$)/ }, a => ({ path: a.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
const guard = new Proxy(function(){}, { get(_, k){ if (k==='default'||k==='__esModule') return guard; throw new Error('stub prop '+String(k)); }, apply(){ throw new Error('stub call'); } });
export default guard;`, loader: 'js' })); } };
const __dir = dirname(fileURLToPath(import.meta.url));
const res = await build({ entryPoints: [join(__dir, '..', 'src', 'qa', 'oracles.ts')], bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent', plugins: [stub] });
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-oracle-'));
const tmp = join(tmpDir, 'oracles.mjs'); writeFileSync(tmp, res.outputFiles[0].text);
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.scanSensitive !== 'function') throw new Error('scanSensitive not exported from oracles.ts bundle');
export const scanSensitive = mod.scanSensitive;
export const inferContract = mod.inferContract;
export const checkSchema = mod.checkSchema;
export const runOracles = mod.runOracles;
export const redact = mod.redact;
