import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDesktopBinaries, selectDmg, assertReleaseUnchanged } from './release-artifacts.mjs';

test('published and local DMG names both select the requested version', () => {
  for (const product of ['QA Touchstone', 'QA.Touchstone']) {
    const name = `${product}_0.23.1_aarch64.dmg`;
    assert.equal(selectDmg(['QA Touchstone_0.23.0_aarch64.dmg', name], '0.23.1'), name);
  }
});

test('missing, wrong-version, and ambiguous DMGs are rejected', () => {
  assert.throws(() => selectDmg([], '0.23.1'));
  assert.throws(() => selectDmg(['QA.Touchstone_0.23.0_aarch64.dmg'], '0.23.1'));
  assert.throws(() =>
    selectDmg(['QA.Touchstone_0.23.1_aarch64.dmg', 'QA Touchstone_0.23.1_aarch64.dmg'], '0.23.1')
  );
});

const portable = Buffer.from('MZ-header__TAURI_BUNDLE_TYPE_VAR_UNK-desktop-payload');
const installed = Buffer.from('MZ-header__TAURI_BUNDLE_TYPE_VAR_NSS-desktop-payload');

test('NSIS marker difference passes while the two original file hashes differ', () => {
  const result = compareDesktopBinaries(installed, portable);
  assert.notEqual(result.nsisSha256, result.portableSha256);
});

test('unrelated executable changes and appended bytes remain failures', () => {
  const damaged = Buffer.from(installed);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => compareDesktopBinaries(damaged, portable));
  assert.throws(() =>
    compareDesktopBinaries(Buffer.concat([installed, Buffer.from('extra')]), portable)
  );
});

test('missing, wrong, and ambiguous bundle markers remain failures', () => {
  assert.throws(() => compareDesktopBinaries(portable, portable));
  assert.throws(() => compareDesktopBinaries(installed, Buffer.from('another executable')));
  assert.throws(() => compareDesktopBinaries(installed, Buffer.concat([portable, portable])));
});

test('preservation gate rejects tag movement and replaced or modified assets', () => {
  const before = { tag: { sha: 'tag-sha' }, assets: [{ id: 1, digest: 'sha256:abc', size: 123 }] };
  assertReleaseUnchanged(before, structuredClone(before));
  for (const change of [
    (state) => {
      state.tag.sha = 'another-tag';
    },
    (state) => {
      state.assets[0].id = 2;
    },
    (state) => {
      state.assets[0].digest = 'sha256:changed';
    },
    (state) => {
      state.assets[0].size = 124;
    },
  ]) {
    const after = structuredClone(before);
    change(after);
    assert.throws(() => assertReleaseUnchanged(before, after));
  }
});
