// Loads the pure BOLA classifiers from bola.ts (esbuild) and syntheticIdFor from
// bolaSetup.ts (separate esbuild entry), stubbing the side-effect ./setup import.
// The classifiers are pure functions that do not touch window or any browser API.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// esbuild plugin: stub ./setup (side-effect-only for the classifiers) and any ?raw import.
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
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-bola-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

// Bundle bola.ts for matchesOwner / classifyBola / negativeControlFailed /
// controlSuggestsIgnoredId / isIdentityKey.
const bolaRes = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'bola.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent', plugins: [stub],
});
const bolaTmp = join(tmpDir, 'bola.mjs');
writeFileSync(bolaTmp, bolaRes.outputFiles[0].text);
const bolaMod = await import('file://' + bolaTmp.replace(/\\/g, '/'));
if (typeof bolaMod.matchesOwner !== 'function') throw new Error('matchesOwner not exported from bola.ts bundle');

// Bundle bolaSetup.ts separately to get syntheticIdFor (bola.ts imports it but does not re-export it).
const setupRes = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'bolaSetup.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent', plugins: [stub],
});
const setupTmp = join(tmpDir, 'bolaSetup.mjs');
writeFileSync(setupTmp, setupRes.outputFiles[0].text);
const setupMod = await import('file://' + setupTmp.replace(/\\/g, '/'));
if (typeof setupMod.syntheticIdFor !== 'function') throw new Error('syntheticIdFor not exported from bolaSetup.ts bundle');

export const matchesOwner = bolaMod.matchesOwner;
export const classifyBola = bolaMod.classifyBola;
export const negativeControlFailed = bolaMod.negativeControlFailed;
export const controlSuggestsIgnoredId = bolaMod.controlSuggestsIgnoredId;
export const isIdentityKey = bolaMod.isIdentityKey;
export const syntheticIdFor = setupMod.syntheticIdFor;
