#!/usr/bin/env node
// Ensure the platform-correct k6 binary exists in src-tauri/resources/.
//
// The k6 binaries are gitignored (tens of MB each), so after a fresh clone or
// `git pull` every contributor must materialize one for their OS — otherwise
// Tauri's bundle.resources validation fails the dev/build with a cryptic
// "resource path doesn't exist". This script fills that gap:
//   1. no-op if the binary is already present;
//   2. copy an existing `k6` from PATH (offline-friendly, version-matched);
//   3. otherwise download the matching release from GitHub and extract it.
//
// Runs automatically before `tauri:dev` / `tauri:build` (pre* hooks) and can be
// invoked directly via `npm run setup:k6`. Override the version with K6_VERSION.

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const RES_DIR = join(ROOT, 'src-tauri', 'resources');

const isWin = process.platform === 'win32';
const BIN_NAME = isWin ? 'k6.exe' : 'k6';
const DEST = join(RES_DIR, BIN_NAME);
const K6_VERSION = (process.env.K6_VERSION || '2.0.0').replace(/^v/, '');

const log = (...a) => console.log('[setup:k6]', ...a);

if (existsSync(DEST)) {
  log(`already present: ${DEST}`);
  process.exit(0);
}
mkdirSync(RES_DIR, { recursive: true });

// 1) Fast path: copy an existing k6 from PATH.
function findOnPath() {
  try {
    const cmd = isWin ? 'where k6' : 'command -v k6';
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], shell: isWin ? undefined : '/bin/sh' })
      .toString().trim().split(/\r?\n/)[0];
    return out && existsSync(out) ? out : null;
  } catch { return null; }
}

const onPath = findOnPath();
if (onPath) {
  log(`copying from PATH: ${onPath}`);
  copyFileSync(onPath, DEST);
  if (!isWin) chmodSync(DEST, 0o755);
  log(`installed: ${DEST}`);
  process.exit(0);
}

// 2) Download from GitHub releases.
const archMap = { x64: 'amd64', arm64: 'arm64' };
const osMap = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const arch = archMap[process.arch];
const os = osMap[process.platform];
if (!arch || !os) {
  log(`unsupported platform ${process.platform}/${process.arch}.`);
  log(`Install k6 manually and place it at ${DEST}, then re-run.`);
  process.exit(1);
}

const ext = os === 'linux' ? 'tar.gz' : 'zip';
const stem = `k6-v${K6_VERSION}-${os}-${arch}`;
const url = `https://github.com/grafana/k6/releases/download/v${K6_VERSION}/${stem}.${ext}`;

const work = join(tmpdir(), `k6-setup-${process.pid}`);
mkdirSync(work, { recursive: true });
const archivePath = join(work, `${stem}.${ext}`);

try {
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

  log('extracting…');
  if (ext === 'tar.gz') {
    execSync(`tar -xzf "${archivePath}" -C "${work}"`, { stdio: 'inherit' });
  } else if (isWin) {
    // Windows 10+ ships bsdtar, which extracts .zip too.
    execSync(`tar -xf "${archivePath}" -C "${work}"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -o -q "${archivePath}" -d "${work}"`, { stdio: 'inherit' });
  }

  const extracted = join(work, stem, BIN_NAME);
  if (!existsSync(extracted)) throw new Error(`binary not found in archive at ${extracted}`);
  renameSync(extracted, DEST);
  if (!isWin) chmodSync(DEST, 0o755);
  log(`installed: ${DEST}`);
} catch (e) {
  log(`failed: ${e.message}`);
  log(`Install k6 manually (https://k6.io/docs/get-started/installation/) and place it at ${DEST}.`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
