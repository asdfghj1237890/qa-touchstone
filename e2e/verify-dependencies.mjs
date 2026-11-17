import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import serialize from 'serialize-javascript';

const require = createRequire(import.meta.url);
const dependencyFile = (name, file) => join(dirname(require.resolve(`${name}/package.json`)), file);

function fixture(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'qa-touchstone-deps-'));
  t.after(() => {
    assert.equal(dirname(root), parent);
    assert.ok(basename(root).startsWith('qa-touchstone-deps-'));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('Mocha discovers brace patterns and applies ignore filters with patched glob/minimatch', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'nested'));
  const source = "describe('dependency fixture', () => it('runs', () => {}));";
  writeFileSync(join(root, 'first.spec.cjs'), source);
  writeFileSync(join(root, 'nested', 'second.test.cjs'), source);
  writeFileSync(join(root, 'ignored.txt'), 'not a test');
  const pattern = `${root.replaceAll('\\', '/')}/**/*.{spec,test}.cjs`;
  const run = (extra = []) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          dependencyFile('mocha', 'bin/mocha.js'),
          '--no-config',
          '--reporter',
          'json',
          ...extra,
          pattern,
        ],
        { encoding: 'utf8', timeout: 15000 }
      )
    );
  assert.equal(run().stats.passes, 2);
  assert.equal(run(['--ignore', `${root.replaceAll('\\', '/')}/nested/**`]).stats.passes, 1);
});

test('Archiver preserves nested files and dotfiles through patched readdir-glob', async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'first.txt'), 'first archive payload');
  writeFileSync(join(root, 'nested', 'second.txt'), 'nested archive payload');
  writeFileSync(join(root, '.hidden.txt'), 'hidden archive payload');
  const archive = new ZipArchive({ store: true });
  const entries = [];
  const chunks = [];
  archive.on('entry', (entry) => entries.push(entry.name));
  archive.on('data', (chunk) => chunks.push(chunk));
  const ended = new Promise((resolveEnd, reject) => {
    archive.once('end', resolveEnd);
    archive.once('error', reject);
  });
  archive.directory(root, 'payload');
  await archive.finalize();
  await ended;
  assert.deepEqual(entries.filter((name) => !name.endsWith('/')).sort(), [
    'payload/.hidden.txt',
    'payload/first.txt',
    'payload/nested/second.txt',
  ]);
  const zip = Buffer.concat(chunks);
  for (const text of [
    'first archive payload',
    'nested archive payload',
    'hidden archive payload',
  ]) {
    assert.ok(zip.includes(Buffer.from(text)), `missing archived content: ${text}`);
  }
});

test('serialize-javascript escapes a script terminator at the end of function source', () => {
  const boundary = function boundary() {};
  boundary.toString = () => 'function boundary(){}//</script';
  const output = serialize({ nested: { boundary } }, { space: 2 });
  assert.doesNotMatch(output, /<\/script/i);
});

test('WDIO CLI starts with the patched dependency tree', () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./node_modules/@wdio/cli/bin/wdio.js', import.meta.url)), '--version'],
    {
      encoding: 'utf8',
      timeout: 15000,
    }
  );
  assert.match(output, /\d+\.\d+\.\d+/);
});
