// Loads the REAL buildPayload from executor.ts via esbuild, stubbing heavy
// side-effect imports (./setup, ../api/index) and any Vite ?raw imports so
// esbuild can bundle it in Node. buildPayload only needs window.qaSubstitute
// (set by _engine-bridge.mjs) + btoa (available as a Node global since v16).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// esbuild plugin: stub setup/api (side-effect-only for buildPayload) and any *?raw import.
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
  entryPoints: [join(__dir, '..', 'src', 'qa', 'executor.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  logLevel: 'silent',
  plugins: [stub],
});
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-bp-'));
const tmp = join(tmpDir, 'executor.mjs');
writeFileSync(tmp, res.outputFiles[0].text);
process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.buildPayload !== 'function')
  throw new Error('buildPayload not exported from executor.ts bundle');
export const buildPayload = mod.buildPayload;
