// Tauri patches the bundle-type token for NSIS, then restores the portable
// binary. Require the files to be identical apart from that exact token.
// https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [installedPath, portablePath] = process.argv.slice(2);
assert.ok(
  installedPath && portablePath,
  'Usage: compare-desktop-binaries.mjs installed.exe portable.exe'
);
const installed = readFileSync(installedPath);
const portable = readFileSync(portablePath);
const unpatched = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const nsis = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
const offset = portable.indexOf(unpatched);
assert.ok(offset >= 0, 'Portable executable is missing the unpatched Tauri bundle token');
assert.equal(portable.indexOf(unpatched, offset + 1), -1, 'Ambiguous portable bundle token');
assert.ok(
  installed.subarray(offset, offset + nsis.length).equals(nsis),
  'Installed bundle token is not NSIS'
);
const expected = Buffer.from(portable);
nsis.copy(expected, offset);
assert.ok(installed.equals(expected), 'Desktop binaries differ beyond the Tauri NSIS bundle token');
console.log(`PASS: desktop binaries match except for the NSIS bundle token at offset ${offset}`);
console.log(`NSIS SHA256: ${createHash('sha256').update(installed).digest('hex')}`);
console.log(`Portable SHA256: ${createHash('sha256').update(portable).digest('hex')}`);
