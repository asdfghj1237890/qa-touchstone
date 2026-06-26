// Loads qaParseImport from import-parser.ts via esbuild and exports it.
// Maps the TS {collection, details, responses} (id-keyed) output into the
// inlined id-less ImportParsed shape the Rust model uses.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Stub: ./setup (side-effect import in import-parser.ts's sibling modules), ?raw imports,
// and any api/index import.
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
const tmpDir = mkdtempSync(join(tmpdir(), 'qa-import-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const res = await build({
  entryPoints: [join(__dir, '..', 'src', 'qa', 'import-parser.ts')],
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent', plugins: [stub],
});
const tmp = join(tmpDir, 'import-parser.mjs');
writeFileSync(tmp, res.outputFiles[0].text);
const mod = await import('file://' + tmp.replace(/\\/g, '/'));
if (typeof mod.qaParseImport !== 'function') throw new Error('qaParseImport not exported from import-parser.ts bundle');

// Map the TS result ({collection, details, responses, format} or {error}) into the
// Rust ImportParsed shape: {collection:{name,source,base_url}, folders:[{name, requests:[{method,name,path,params,headers,body,auth}]}]}
function tsToRustShape(tsResult) {
  if (tsResult.error) throw new Error('qaParseImport returned error: ' + tsResult.error);
  const { collection, details } = tsResult;
  // Rebuild folders with detail inlined and ids dropped
  const folders = collection.folders.map(folder => ({
    name: folder.name,
    requests: folder.requests.map(meta => {
      const d = details[meta.id] || { params: [], headers: [], body: null, auth: 'none' };
      return {
        method: meta.method,
        name: meta.name,
        path: meta.path,
        params: d.params,
        headers: d.headers,
        body: d.body,
        auth: d.auth,
      };
    }),
  }));
  return {
    collection: {
      name: collection.name,
      source: collection.source,         // 'postman' | 'openapi'
      base_url: collection.baseUrl ?? null,
    },
    folders,
  };
}

export function runImport(text) {
  const raw = mod.qaParseImport(text);
  if (raw.error) return { error: raw.error };
  return tsToRustShape(raw);
}

export { mod };
