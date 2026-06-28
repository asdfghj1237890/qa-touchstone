#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_REPO = 'asdfghj1237890/qa-touchstone';
const MAX_REDIRECTS = 5;
const packageJson = JSON.parse(
  await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8')
);

function platformName() {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      throw new Error(`unsupported platform: ${process.platform}`);
  }
}

function archName() {
  switch (process.arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(`unsupported architecture: ${process.arch}`);
  }
}

function executableName() {
  return process.platform === 'win32' ? 'qa-touchstone-ci.exe' : 'qa-touchstone-ci';
}

function normalizeTag(version) {
  const value = (version || packageJson.version || '').trim();
  if (!value) throw new Error('no QA Touchstone version was provided');
  return value.startsWith('v') ? value : `v${value}`;
}

function cacheRoot() {
  if (process.env.QA_TOUCHSTONE_CI_CACHE_DIR) {
    return path.resolve(process.env.QA_TOUCHSTONE_CI_CACHE_DIR);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'qa-touchstone-ci');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'qa-touchstone-ci');
  }
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'qa-touchstone-ci'
  );
}

function assetInfo() {
  const osName = platformName();
  const arch = archName();
  const baseName = `qa-touchstone-ci-${osName}-${arch}`;
  return {
    osName,
    arch,
    baseName,
    assetName: `${baseName}.${osName === 'windows' ? 'zip' : 'tar.gz'}`,
  };
}

function releaseBaseUrl(tag) {
  if (process.env.QA_TOUCHSTONE_CI_BASE_URL) {
    return process.env.QA_TOUCHSTONE_CI_BASE_URL.replace(/\/$/, '');
  }
  const repo = process.env.QA_TOUCHSTONE_CI_REPO || DEFAULT_REPO;
  return `https://github.com/${repo}/releases/download/${tag}`;
}

function tokenHeader() {
  const token = process.env.QA_TOUCHSTONE_CI_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function download(url, destination, redirects = 0) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.download-${process.pid}`;
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': `qa-touchstone-ci-npm/${packageJson.version}`,
    ...tokenHeader(),
  };

  const wroteFile = await new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        download(nextUrl, destination, redirects + 1).then(() => resolve(false), reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`download failed (${status}) for ${url}`));
        return;
      }
      const file = fs.createWriteStream(temp, { mode: 0o600 });
      response.pipe(file);
      file.on('finish', () => {
        file.close((error) => {
          if (error) reject(error);
          else resolve(true);
        });
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });

  if (wroteFile) await fsp.rename(temp, destination);
}

function exists(file) {
  return fs.existsSync(file);
}

function expectedSha(text) {
  const match = text.match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) throw new Error('checksum file does not contain a SHA256 digest');
  return match[0].toLowerCase();
}

async function sha256(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function verifyChecksum(assetPath, checksumPath) {
  const expected = expectedSha(await fsp.readFile(checksumPath, 'utf8'));
  const actual = await sha256(assetPath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${path.basename(assetPath)}`);
  }
}

async function ensureDownloaded(assetPath, checksumPath, assetUrl, checksumUrl) {
  if (!exists(assetPath)) await download(assetUrl, assetPath);
  if (!exists(checksumPath)) await download(checksumUrl, checksumPath);

  try {
    await verifyChecksum(assetPath, checksumPath);
  } catch (error) {
    await fsp.rm(assetPath, { force: true });
    await fsp.rm(checksumPath, { force: true });
    await download(assetUrl, assetPath);
    await download(checksumUrl, checksumPath);
    await verifyChecksum(assetPath, checksumPath);
    if (error && process.env.QA_TOUCHSTONE_CI_DEBUG) {
      console.warn(`qa-touchstone-ci: refreshed cached asset after ${error.message}`);
    }
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function psLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function extract(assetPath, extractDir) {
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });
  if (process.platform === 'win32') {
    const command = [
      'Expand-Archive',
      '-LiteralPath',
      psLiteral(assetPath),
      '-DestinationPath',
      psLiteral(extractDir),
      '-Force',
    ].join(' ');
    runChecked('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  } else {
    runChecked('tar', ['-xzf', assetPath, '-C', extractDir]);
  }
}

async function copyExecutable(source, installDir) {
  await fsp.mkdir(installDir, { recursive: true });
  const target = path.join(installDir, executableName());
  await fsp.copyFile(source, target);
  if (process.platform !== 'win32') await fsp.chmod(target, 0o755);
  return target;
}

async function ensureBinary() {
  if (process.env.QA_TOUCHSTONE_CI_BIN) {
    const local = path.resolve(process.env.QA_TOUCHSTONE_CI_BIN);
    if (!exists(local)) throw new Error(`QA_TOUCHSTONE_CI_BIN does not exist: ${local}`);
    return local;
  }

  const tag = normalizeTag(process.env.QA_TOUCHSTONE_CI_VERSION);
  const info = assetInfo();
  const root = path.join(cacheRoot(), tag, `${info.osName}-${info.arch}`);
  const assetPath = path.join(root, info.assetName);
  const checksumPath = `${assetPath}.sha256`;
  const extractDir = path.join(root, 'extracted');
  const binPath = path.join(extractDir, info.baseName, executableName());

  if (!exists(binPath)) {
    const baseUrl = releaseBaseUrl(tag);
    const assetUrl = `${baseUrl}/${info.assetName}`;
    const checksumUrl = `${assetUrl}.sha256`;
    await ensureDownloaded(assetPath, checksumPath, assetUrl, checksumUrl);
    await extract(assetPath, extractDir);
  } else if (process.platform !== 'win32') {
    await fsp.chmod(binPath, 0o755);
  }

  if (!exists(binPath)) {
    throw new Error(`release asset did not contain ${executableName()} at ${binPath}`);
  }
  return binPath;
}

function spawnAndExit(binary, args) {
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`qa-touchstone-ci: failed to start ${binary}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`qa-touchstone-ci: process terminated by ${result.signal}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

try {
  const binary = await ensureBinary();
  const installDir = process.env.QA_TOUCHSTONE_CI_INSTALL_DIR;
  const finalBinary = installDir ? await copyExecutable(binary, path.resolve(installDir)) : binary;
  if (process.env.QA_TOUCHSTONE_CI_INSTALL_ONLY === '1') {
    console.log(finalBinary);
  } else {
    spawnAndExit(finalBinary, process.argv.slice(2));
  }
} catch (error) {
  console.error(`qa-touchstone-ci: ${error.message}`);
  process.exit(1);
}
