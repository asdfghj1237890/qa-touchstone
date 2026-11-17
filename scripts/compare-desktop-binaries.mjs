// Tauri patches the bundle-type token for NSIS, then restores the portable
// binary. Require the files to be identical apart from that exact token.
// https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareDesktopBinaries } from './release-artifacts.mjs';

const [installedPath, portablePath] = process.argv.slice(2);
assert.ok(
  installedPath && portablePath,
  'Usage: compare-desktop-binaries.mjs installed.exe portable.exe'
);
const { offset, nsisSha256, portableSha256 } = compareDesktopBinaries(
  readFileSync(installedPath),
  readFileSync(portablePath)
);
console.log(`PASS: desktop binaries match except for the NSIS bundle token at offset ${offset}`);
console.log(`NSIS SHA256: ${nsisSha256}`);
console.log(`Portable SHA256: ${portableSha256}`);
