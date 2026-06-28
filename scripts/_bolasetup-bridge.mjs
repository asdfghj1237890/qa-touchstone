// Loads detectIdLocation from bolaSetup.ts via esbuild, stubbing the side-effect
// ./setup import and the oracles walkJson import.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// esbuild plugin: stub ./setup (side-effect-only), any ?raw import, and api/index.
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
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-bolasetup-'));
process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const res = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'bolaSetup.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  logLevel: 'silent',
  plugins: [stub],
});
const tmp = join(tmpDir, 'bolaSetup.mjs');
writeFileSync(tmp, res.outputFiles[0].text);
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.detectIdLocation !== 'function')
  throw new Error('detectIdLocation not exported from bolaSetup.ts bundle');

export const detectIdLocation = mod.detectIdLocation;
