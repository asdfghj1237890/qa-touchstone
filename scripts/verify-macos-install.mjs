#!/usr/bin/env node
// scripts/verify-macos-install.mjs
// macOS install-chain smoke: build DMG → mount → verify bundle → install to
// a TEMP dir (never /Applications) → launch with $HOME sandboxed → assert
// alive signals → clean up. Exit 0 = PASS, 1 = FAIL.
//
// Usage: npm run test:install:mac [-- --skip-build]
//   --skip-build  reuse the newest version-matched DMG already in the bundle dir
//
// Isolation notes (scope stated precisely — do not overclaim):
// - Install target is a mkdtemp dir; the developer's real /Applications copy
//   is never touched.
// - The app is launched with HOME pointed at a fresh temp dir. The dirs-rs
//   family honors $HOME, so the RUST-SIDE config/data/log paths land in the
//   sandbox, never in the real
//   ~/Library/Application Support/com.qatouchstone.desktop. WKWebView's own
//   website data (localStorage/cache) is managed by WebKit's default data
//   store and is NOT covered by this guarantee — acceptable for a launch
//   smoke that performs no user actions.
// - Locally built DMGs carry no quarantine xattr → no Gatekeeper handling.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BUNDLE_ID = 'com.qatouchstone.desktop';
const APP_NAME = 'QA Touchstone.app';
const ALIVE_SECONDS = 10;

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const skipBuild = process.argv.includes('--skip-build');

const results = [];
function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message || e) });
    console.error(`  ❌ ${name} — ${e.message || e}`);
    throw e;
  }
}
function warn(name, message) {
  results.push({ name, ok: true, detail: `WARN: ${message}` });
  console.warn(`  ⚠️  ${name} — ${message}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mountPoint = null;
let installDir = null;
let sandboxHome = null;
let child = null;

function cleanup() {
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (mountPoint) {
    spawnSync('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' });
    mountPoint = null;
  }
  for (const dir of [installDir, sandboxHome]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

async function main() {
  console.log(`\nmacOS install verification — v${pkg.version}\n`);

  if (process.platform !== 'darwin') {
    console.error('This script only runs on macOS.');
    process.exit(1);
  }

  // 1. Build (or reuse) the DMG.
  if (!skipBuild) {
    console.log('  ⏳ building DMG (npm run tauri:build — several minutes)...');
    execFileSync('npm', ['run', 'tauri:build'], { cwd: root, stdio: 'inherit' });
  }

  // 2. Locate the DMG BY VERSION — the bundle dir may hold stale artifacts
  // (a pre-rename "QA Companion_0.13.1" DMG exists there today).
  const dmgDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  let dmgPath = null;
  step(`locate DMG for v${pkg.version}`, () => {
    const prefix = `QA Touchstone_${pkg.version}_`;
    const candidates = existsSync(dmgDir)
      ? readdirSync(dmgDir).filter((f) => f.startsWith(prefix) && f.endsWith('.dmg'))
      : [];
    if (candidates.length === 0) {
      throw new Error(
        `no "${prefix}*.dmg" in ${dmgDir} — build failed or version mismatch? ` +
          (skipBuild ? 'run without --skip-build.' : '')
      );
    }
    dmgPath = join(dmgDir, candidates[0]);
    return candidates[0];
  });

  // 3. Mount read-only.
  step('mount DMG (read-only)', () => {
    const out = execFileSync(
      'hdiutil',
      ['attach', dmgPath, '-nobrowse', '-readonly', '-plist'],
      { encoding: 'utf8' }
    );
    const m = out.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
    if (!m) throw new Error('could not parse hdiutil mount point');
    mountPoint = m[1];
    return mountPoint;
  });

  // 4. Bundle integrity.
  const mountedApp = join(mountPoint, APP_NAME);
  let binaryName = null;
  step('bundle integrity (Info.plist, binary, k6 resource)', () => {
    const plist = join(mountedApp, 'Contents', 'Info.plist');
    if (!existsSync(plist)) throw new Error(`missing ${plist}`);
    const bundleId = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleIdentifier', plist],
      { encoding: 'utf8' }
    ).trim();
    if (bundleId !== BUNDLE_ID) {
      throw new Error(`CFBundleIdentifier is "${bundleId}", expected "${BUNDLE_ID}"`);
    }
    binaryName = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleExecutable', plist],
      { encoding: 'utf8' }
    ).trim();
    const binPath = join(mountedApp, 'Contents', 'MacOS', binaryName);
    const st = statSync(binPath);
    if (!(st.mode & 0o111)) throw new Error(`${binPath} is not executable`);
    const k6 = join(mountedApp, 'Contents', 'Resources', 'resources', 'k6');
    if (!existsSync(k6)) throw new Error(`bundled k6 missing at ${k6}`);
    return `${bundleId}, bin=${binaryName}`;
  });

  // 5. "Install": copy out of the DMG to a temp dir (not /Applications).
  step('install .app to temp dir', () => {
    installDir = mkdtempSync(join(tmpdir(), 'qa-install-'));
    execFileSync('cp', ['-R', mountedApp, installDir]);
    return installDir;
  });

  step('detach DMG', () => {
    execFileSync('hdiutil', ['detach', mountPoint, '-quiet']);
    mountPoint = null;
  });

  // 6. Launch with HOME sandboxed.
  const installedBin = join(installDir, APP_NAME, 'Contents', 'MacOS', binaryName);
  sandboxHome = mkdtempSync(join(tmpdir(), 'qa-install-home-'));
  step('launch (sandboxed HOME)', () => {
    child = spawn(installedBin, [], {
      env: { ...process.env, HOME: sandboxHome },
      stdio: 'ignore',
      detached: false,
    });
    return `pid ${child.pid}, HOME=${sandboxHome}`;
  });

  // 7a. Primary alive signal: still running after ALIVE_SECONDS.
  await sleep(ALIVE_SECONDS * 1000);
  step(`process alive after ${ALIVE_SECONDS}s`, () => {
    if (child.exitCode !== null) {
      throw new Error(`app exited early with code ${child.exitCode}`);
    }
  });

  // 7b. Secondary: app data appeared under the sandboxed HOME (Rust side
  // initialized real config/data paths).
  step('app data written under sandboxed HOME', () => {
    const dataDir = join(sandboxHome, 'Library', 'Application Support', BUNDLE_ID);
    if (!existsSync(dataDir) || readdirSync(dataDir).length === 0) {
      throw new Error(`no app data at ${dataDir}`);
    }
    return readdirSync(dataDir).slice(0, 4).join(', ');
  });

  // 7c. Tertiary (best-effort): a window exists. Needs Automation permission;
  // WARN, never FAIL, on errors.
  try {
    const count = execFileSync(
      'osascript',
      ['-e', `tell application "System Events" to count windows of (first process whose unix id is ${child.pid})`],
      { encoding: 'utf8', timeout: 10_000 }
    ).trim();
    if (Number(count) >= 1) {
      results.push({ name: 'WebView window present', ok: true, detail: `${count} window(s)` });
      console.log(`  ✅ WebView window present — ${count} window(s)`);
    } else {
      warn('WebView window present', `window count = ${count}`);
    }
  } catch (e) {
    warn('WebView window present', `System Events check unavailable (${String(e.message).split('\n')[0]}) — grant Automation permission to enable`);
  }

  // 8. Teardown + summary.
  step('terminate app', () => {
    child.kill('SIGTERM');
  });
  await sleep(1500);
  if (child.exitCode === null) child.kill('SIGKILL');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length} steps, ${failed.length} failures\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(() => {
  console.log('\nFAIL\n');
  process.exit(1);
});
