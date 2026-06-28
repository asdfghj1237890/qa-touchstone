// Loads the pure classifiers from authz.ts via esbuild, stubbing the side-effect
// ./setup import (which pulls in React/Vite globals). The classifiers are pure
// functions that do not touch window or any browser API.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// esbuild plugin: stub ./setup (side-effect-only for the classifiers) and any ?raw import.
const stub = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /(\?raw$)|(\/setup$)|(api\/index$)/ }, (a) => ({
      path: a.path,
      namespace: 'stub',
    }));
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
const res = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'authz.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  logLevel: 'silent',
  plugins: [stub],
});
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-az-'));
const tmp = join(tmpDir, 'authz.mjs');
writeFileSync(tmp, res.outputFiles[0].text);
process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.classifyEndpoint !== 'function')
  throw new Error('classifyEndpoint not exported from authz.ts bundle');
export const classifyEndpoint = mod.classifyEndpoint;
export const classifyOutcome = mod.classifyOutcome;
export const detectSoftDeny = mod.detectSoftDeny;
export const classifyResponseOutcome = mod.classifyResponseOutcome;
export const verdictFor = mod.verdictFor;
export const defaultExpectation = mod.defaultExpectation;
