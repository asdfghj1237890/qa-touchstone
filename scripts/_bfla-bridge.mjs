// Loads the pure BFLA classifiers from bfla.ts (esbuild), stubbing side-effect imports.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-bfla-'));
process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const bflaRes = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'bfla.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  logLevel: 'silent',
  plugins: [stub],
});
const bflaTmp = join(tmpDir, 'bfla.mjs');
writeFileSync(bflaTmp, bflaRes.outputFiles[0].text);
const bflaMod = await import('file://' + bflaTmp.replace(/\\/g, '/'));
if (typeof bflaMod.bflaPlan !== 'function')
  throw new Error('bflaPlan not exported from bfla.ts bundle');

export const bflaPlan = bflaMod.bflaPlan;
export const classifyBfla = bflaMod.classifyBfla;
export const bflaSeverity = bflaMod.bflaSeverity;
