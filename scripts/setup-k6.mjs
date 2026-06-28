#!/usr/bin/env node
// Ensure the platform-correct k6 binary exists in src-tauri/resources/.
//
// The k6 binaries are gitignored (tens of MB each), so after a fresh clone or
// `git pull` every contributor must materialize one for their OS — otherwise
// Tauri's bundle.resources validation fails the dev/build with a cryptic
// "resource path doesn't exist".
//
// Two modes, because dev convenience and release trust have different needs:
//
//   dev (default, pretauri:dev):   no-op if present; else copy a `k6` from PATH;
//                                  else download the pinned release. PATH copy
//                                  is fast and offline-friendly for local work.
//
//   release (--release, pretauri:build): NEVER trusts PATH or an unverified
//                                  pre-existing file. Always materializes a
//                                  pinned, OS/arch-correct official artifact,
//                                  verifies its SHA256 against the baked-in
//                                  checksum, then runs `k6 version` to confirm
//                                  the version and target before packaging.
//                                  Any mismatch fails the build.
//
// Why: `pretauri:build` bundles resources/k6 into the shipped installer, and the
// app later executes it. Copying "whatever k6 is on PATH" (npm prepends
// project-local shims) or accepting an unchecked gitignored file could ship a
// stale, wrong-arch, vulnerable, or malicious executable across that trust
// boundary. Release builds must have provenance; dev builds can stay loose.
//
// Override the version with K6_VERSION (must have a baked-in checksum below for
// release mode). Run manually via `npm run setup:k6` / `npm run setup:k6:release`.

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
  writeFileSync,
  readFileSync,
  createReadStream,
} from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const RES_DIR = join(ROOT, 'src-tauri', 'resources');

const RELEASE = process.argv.includes('--release') || process.env.K6_SETUP_RELEASE === '1';
const isWin = process.platform === 'win32';
const BIN_NAME = isWin ? 'k6.exe' : 'k6';
const DEST = join(RES_DIR, BIN_NAME);
const PROV = join(RES_DIR, '.k6.provenance.json');
const K6_VERSION = (process.env.K6_VERSION || '2.0.0').replace(/^v/, '');

// OS/arch tokens for the GitHub artifact name and the `k6 version` self-report.
const archMap = { x64: 'amd64', arm64: 'arm64' };
const osMap = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const goOsMap = { darwin: 'darwin', win32: 'windows', linux: 'linux' };
const arch = archMap[process.arch];
const os = osMap[process.platform];
const goOs = goOsMap[process.platform];
const key = `${os}-${arch}`;

// Pinned, baked-in SHA256 of the official release ARCHIVES (.zip / .tar.gz).
// Source of truth: https://github.com/grafana/k6/releases/download/v<ver>/k6-v<ver>-checksums.txt
// Bumping K6_VERSION requires adding the new version's checksums here, otherwise
// release mode refuses to proceed (fail-closed).
const CHECKSUMS = {
  '2.0.0': {
    'macos-arm64': '9a725f3faf8fc9de70f0bd86fb9783e6fb02f822492862846375ec0d8f2b35f7',
    'macos-amd64': '287f3b0ab9f936f20c37c649f220842385a7961ead84d695d7b5192268c61b3f',
    'windows-amd64': '58bb8530af85c57abeb5cc2bae7581d6aa976d43ca538d4be79a1dcc93388b05',
    'linux-amd64': '2ae87d976f6cdba17185bdd980d8819a3a98e9092c6f0638cd58272ecefc8b90',
    'linux-arm64': '397d338c0c50821994aa51a630e511c599c2e903d00f7fa6c55a82258e7a84e6',
  },
};

const log = (...a) => console.log(`[setup:k6${RELEASE ? ':release' : ''}]`, ...a);
const fail = (msg) => {
  console.error(`[setup:k6${RELEASE ? ':release' : ''}] ERROR: ${msg}`);
  process.exit(1);
};

if (!arch || !os) {
  fail(`unsupported platform ${process.platform}/${process.arch}. Install k6 manually at ${DEST}.`);
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// Run `<bin> version` and confirm it self-reports the expected version and
// target. k6 prints e.g. "k6 v2.0.0 (commit/devel, go1.26.3, darwin/arm64)".
function verifyK6Binary(binPath) {
  let out;
  try {
    out = execFileSync(binPath, ['version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { ok: false, detail: `could not execute: ${e.message}` };
  }
  const wantVer = `v${K6_VERSION}`;
  const wantTarget = `${goOs}/${arch}`;
  const okVer = out.includes(wantVer);
  const okTarget = out.includes(wantTarget);
  return {
    ok: okVer && okTarget,
    detail: `reported "${out.trim()}" (need ${wantVer} & ${wantTarget})`,
  };
}

const archiveExt = os === 'linux' ? 'tar.gz' : 'zip';
const archiveStem = `k6-v${K6_VERSION}-${os}-${arch}`;
const archiveUrl = `https://github.com/grafana/k6/releases/download/v${K6_VERSION}/${archiveStem}.${archiveExt}`;

async function downloadAndExtract(expectedSha) {
  const work = join(tmpdir(), `k6-setup-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const archivePath = join(work, `${archiveStem}.${archiveExt}`);
  try {
    log(`downloading ${archiveUrl}`);
    const res = await fetch(archiveUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));

    const got = await sha256File(archivePath);
    if (expectedSha) {
      if (got !== expectedSha) {
        throw new Error(
          `SHA256 mismatch for ${archiveStem}.${archiveExt}\n    expected ${expectedSha}\n    got      ${got}`
        );
      }
      log(`sha256 verified: ${got}`);
    } else {
      log(`sha256 (unverified, no pinned checksum): ${got}`);
    }

    log('extracting…');
    if (archiveExt === 'tar.gz') {
      execSync(`tar -xzf "${archivePath}" -C "${work}"`, { stdio: 'inherit' });
    } else if (isWin) {
      execSync(`tar -xf "${archivePath}" -C "${work}"`, { stdio: 'inherit' }); // Win10+ bsdtar handles zip
    } else {
      execSync(`unzip -o -q "${archivePath}" -d "${work}"`, { stdio: 'inherit' });
    }

    const extracted = join(work, archiveStem, BIN_NAME);
    if (!existsSync(extracted)) throw new Error(`binary not found in archive at ${extracted}`);
    mkdirSync(RES_DIR, { recursive: true });
    rmSync(DEST, { force: true });
    // copyFileSync, not renameSync: the temp dir and the project can live on
    // different drives (e.g. C: temp vs D: workspace on Windows CI), and rename
    // across devices throws EXDEV. The temp dir is removed in the finally below.
    copyFileSync(extracted, DEST);
    if (!isWin) chmodSync(DEST, 0o755);
    return got;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function readProvenance() {
  try {
    return JSON.parse(readFileSync(PROV, 'utf8'));
  } catch {
    return null;
  }
}
function writeProvenance(archiveSha256) {
  writeFileSync(
    PROV,
    JSON.stringify(
      {
        version: K6_VERSION,
        os,
        arch,
        archive: `${archiveStem}.${archiveExt}`,
        archiveSha256,
      },
      null,
      2
    ) + '\n'
  );
}

// ── Release: pinned + verified, no PATH, no blind reuse. Fail-closed. ────────
async function runRelease() {
  const expected = (CHECKSUMS[K6_VERSION] || {})[key];
  if (!expected) {
    fail(
      `no pinned SHA256 for k6 v${K6_VERSION} (${key}). Add it from ` +
        `https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-checksums.txt ` +
        `to CHECKSUMS in scripts/setup-k6.mjs before building a release.`
    );
  }

  // Accept an existing binary only if provenance matches the pinned checksum AND
  // it still self-reports the right version/target. Otherwise re-materialize.
  const prov = readProvenance();
  if (existsSync(DEST) && prov && prov.version === K6_VERSION && prov.archiveSha256 === expected) {
    const v = verifyK6Binary(DEST);
    if (v.ok) {
      log(`verified cached binary: ${DEST} (${v.detail})`);
      return;
    }
    log(`cached binary failed validation, re-fetching — ${v.detail}`);
  }

  let archiveSha;
  try {
    archiveSha = await downloadAndExtract(expected);
  } catch (e) {
    fail(e.message);
  }

  const v = verifyK6Binary(DEST);
  if (!v.ok) fail(`k6 binary validation failed after install — ${v.detail}`);
  writeProvenance(archiveSha);
  log(`installed & verified: ${DEST} (${v.detail})`);
}

// ── Dev: convenience first. No-op / PATH copy / pinned download. ─────────────
function findOnPath() {
  try {
    const cmd = isWin ? 'where k6' : 'command -v k6';
    const out = execSync(cmd, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWin ? undefined : '/bin/sh',
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0];
    return out && existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

async function runDev() {
  if (existsSync(DEST)) {
    log(`already present: ${DEST}`);
    return;
  }
  mkdirSync(RES_DIR, { recursive: true });

  const onPath = findOnPath();
  if (onPath) {
    log(`copying from PATH: ${onPath}`);
    copyFileSync(onPath, DEST);
    if (!isWin) chmodSync(DEST, 0o755);
    log(`installed: ${DEST}`);
    return;
  }

  const expected = (CHECKSUMS[K6_VERSION] || {})[key]; // verify when known
  try {
    await downloadAndExtract(expected);
  } catch (e) {
    fail(
      `${e.message}\n    Install k6 manually (https://k6.io/docs/get-started/installation/) and place it at ${DEST}.`
    );
  }
  log(`installed: ${DEST}`);
}

await (RELEASE ? runRelease() : runDev());
