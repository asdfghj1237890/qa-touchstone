// Loads the pure rate-limit analysis functions from ratelimit.ts (esbuild), stubbing
// the side-effect ./setup import. These are pure functions (no window / browser API).
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
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-rl-'));
process.on('exit', () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const res = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'ratelimit.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  logLevel: 'silent',
  plugins: [stub],
});
const tmp = join(tmpDir, 'ratelimit.mjs');
writeFileSync(tmp, res.outputFiles[0].text);
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.analyzeThrottle !== 'function')
  throw new Error('analyzeThrottle not exported from ratelimit.ts bundle');

export const detectThrottleSignal = mod.detectThrottleSignal;
export const analyzeThrottle = mod.analyzeThrottle;
export const rateLimitStrength = mod.rateLimitStrength;
export const classifyRateLimit = mod.classifyRateLimit;
export const rateLimitSeverity = mod.rateLimitSeverity;
