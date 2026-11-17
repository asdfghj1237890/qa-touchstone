import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function selectDmg(files, version) {
  const prefixes = [`QA Touchstone_${version}_`, `QA.Touchstone_${version}_`];
  const candidates = files.filter(
    (file) => prefixes.some((prefix) => file.startsWith(prefix)) && file.endsWith('.dmg')
  );
  assert.equal(
    candidates.length,
    1,
    `Expected one DMG for v${version}, got: ${candidates.join(', ')}`
  );
  return candidates[0];
}

export function compareDesktopBinaries(installed, portable) {
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
  assert.ok(
    installed.equals(expected),
    'Desktop binaries differ beyond the Tauri NSIS bundle token'
  );
  return {
    offset,
    nsisSha256: createHash('sha256').update(installed).digest('hex'),
    portableSha256: createHash('sha256').update(portable).digest('hex'),
  };
}

export function releaseState(tagRef, commit, release) {
  const tag = release.tag_name;
  assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Expected a stable vX.Y.Z tag');
  assert.equal(tagRef.ref, `refs/tags/${tag}`, 'Release and tag reference disagree');
  assert.equal(release.draft, false, 'Release is still a draft');
  assert.equal(release.prerelease, false, 'Expected a stable release');
  const version = tag.slice(1);
  const archives = [
    'qa-touchstone-ci-linux-x64.tar.gz',
    'qa-touchstone-ci-macos-arm64.tar.gz',
    'qa-touchstone-ci-windows-x64.zip',
  ];
  const names = [
    ...archives.flatMap((name) => [name, `${name}.sha256`]),
    `QA.Touchstone_${version}_aarch64.dmg`,
    `QA.Touchstone_${version}_x64-setup.exe`,
    `QA.Touchstone_${version}_x64-portable.zip`,
  ].sort();
  const assets = release.assets
    .map((asset) => {
      assert.equal(asset.state, 'uploaded', `Incomplete asset: ${asset.name}`);
      assert.ok(asset.size > 0, `Empty asset: ${asset.name}`);
      assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/, `Missing SHA256: ${asset.name}`);
      return {
        id: asset.id,
        name: asset.name,
        size: asset.size,
        digest: asset.digest,
        updated_at: asset.updated_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  assert.deepEqual(assets.map((asset) => asset.name).sort(), names, 'Unexpected release asset set');
  return {
    tag: { ref: tagRef.ref, ...tagRef.object },
    commit,
    release: { id: release.id, tag_name: tag },
    assets,
  };
}

export function assertReleaseUnchanged(before, after) {
  assert.deepEqual(
    after,
    before,
    'Tag, release identity, or published assets changed during verification'
  );
}
