// Loads the TS engine's pure functions for fixture generation, via esbuild
// (already a dev dependency). Returns the window-attached helpers.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const entry = join(__dir, '..', 'src', 'qa', 'engine.ts');
const res = await build({
  entryPoints: [entry], bundle: true, format: 'esm', write: false,
  platform: 'node', logLevel: 'silent',
});
const code = res.outputFiles[0].text;
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-eng-'));
const tmp = join(tmpDir, 'engine.mjs');
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
writeFileSync(tmp, code);
globalThis.window = globalThis;
await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof globalThis.qaSubstitute !== 'function') {
  throw new Error('engine bridge failed: qaSubstitute not found on globalThis (engine.ts load/bundle issue)');
}
export const qaSubstitute = globalThis.qaSubstitute;
export const qaVarMap = globalThis.qaVarMap;
export const qaEval = globalThis.qaEval;
export const qaRunAssertions = globalThis.qaRunAssertions;
