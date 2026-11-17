import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { assertReleaseUnchanged, releaseState } from './release-artifacts.mjs';

const mode = process.argv[2];
assert.ok(['capture', 'assert'].includes(mode), 'Expected capture or assert mode');
const tag = process.env.RELEASE_TAG;
const repo = process.env.GITHUB_REPOSITORY;
assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Expected vX.Y.Z release tag');
assert.match(repo, /^[\w.-]+\/[\w.-]+$/, 'Expected owner/repository');

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `GitHub ${path}: HTTP ${response.status}`);
  return response.json();
}

const tagRef = await api(`git/ref/tags/${tag}`);
let target = tagRef.object;
for (let depth = 0; target.type === 'tag' && depth < 8; depth++) {
  target = (await api(`git/tags/${target.sha}`)).object;
}
assert.equal(target.type, 'commit', 'Tag did not resolve to a commit');
const release = await api(`releases/tags/${tag}`);
const state = releaseState(tagRef, target.sha, release);

if (mode === 'capture') {
  const hashes = new Map();
  const checksums = [];
  for (const asset of release.assets) {
    assert.ok(
      asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/${tag}/`)
    );
    const response = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(120_000),
    });
    assert.ok(response.ok, `Download ${asset.name}: HTTP ${response.status}`);
    const hash = createHash('sha256');
    let size = 0;
    const checksumChunks = [];
    for await (const chunk of response.body) {
      hash.update(chunk);
      size += chunk.length;
      if (asset.name.endsWith('.sha256')) checksumChunks.push(chunk);
    }
    const digest = hash.digest('hex');
    assert.equal(size, asset.size, `Downloaded size mismatch: ${asset.name}`);
    assert.equal(`sha256:${digest}`, asset.digest, `Downloaded SHA256 mismatch: ${asset.name}`);
    hashes.set(asset.name, digest);
    if (checksumChunks.length)
      checksums.push(Buffer.concat(checksumChunks).toString('utf8').trim());
    console.log(`PASS download SHA256: ${asset.name}`);
  }
  assert.equal(checksums.length, 3, 'Expected three CLI checksum manifests');
  for (const checksum of checksums) {
    const match = checksum.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/i);
    assert.ok(match, 'Invalid CLI checksum manifest');
    assert.equal(
      hashes.get(match[2]),
      match[1].toLowerCase(),
      `CLI checksum mismatch: ${match[2]}`
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nstate=${JSON.stringify(state)}\n`);
  }
  console.log(`PASS inventory: ${tag} at ${target.sha}, ${state.assets.length} assets`);
} else {
  const results = JSON.parse(process.env.VERIFICATION_RESULTS);
  for (const job of ['ci', 'desktop', 'headless'])
    assert.equal(results[job].result, 'success', `${job} verification did not pass`);
  if (process.env.EXPECT_NPX === 'true')
    assert.equal(results.npx.result, 'success', 'npx verification did not pass');
  assertReleaseUnchanged(JSON.parse(process.env.RELEASE_SNAPSHOT), state);
  console.log(
    `PASS preservation: ${tag} reference, release ID, and all ${state.assets.length} asset IDs, sizes and SHA256 digests are unchanged`
  );
}
