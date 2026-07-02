import { describe, it, expect } from 'vitest';
import {
  checkForUpdate,
  compareVersions,
  detectUpdatePlatform,
  fetchGitHubLatestVersion,
  normalizeVersion,
  pickUpdateAsset,
} from '../qa/updateCheck';

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('GitHub update check', () => {
  it('normalizes tag-looking version strings and compares semver numerically', () => {
    expect(normalizeVersion('v0.22.10')).toBe('0.22.10');
    expect(normalizeVersion('release-1.2')).toBe('1.2.0');
    expect(compareVersions('0.22.10', '0.22.9')).toBe(1);
    expect(compareVersions('0.23.0', '0.23.0')).toBe(0);
    expect(compareVersions('0.22.9', '0.22.10')).toBe(-1);
  });

  it('reports update when latest GitHub release is newer', async () => {
    const fetcher = async () =>
      res(200, {
        tag_name: 'v0.23.0',
        html_url: 'https://release.test',
        assets: [
          {
            name: 'QA.Touchstone_0.23.0_x64-setup.exe',
            browser_download_url:
              'https://github.com/owner/repo/releases/download/v0.23.0/setup.exe',
            size: 123,
            content_type: 'application/octet-stream',
          },
        ],
      });
    const result = await checkForUpdate('0.22.1', 'owner/repo', fetcher);
    expect(result).toMatchObject({
      status: 'update',
      currentVersion: '0.22.1',
      latestVersion: '0.23.0',
      url: 'https://release.test',
      source: 'release',
      assets: [
        {
          name: 'QA.Touchstone_0.23.0_x64-setup.exe',
          url: 'https://github.com/owner/repo/releases/download/v0.23.0/setup.exe',
          size: 123,
          contentType: 'application/octet-stream',
        },
      ],
    });
  });

  it('picks the desktop update asset for the current platform', () => {
    const assets = [
      {
        name: 'qa-touchstone-ci-windows-x64.zip',
        url: 'https://github.com/owner/repo/releases/download/v0.23.0/cli.zip',
      },
      {
        name: 'QA.Touchstone_0.23.0_x64-portable.zip',
        url: 'https://github.com/owner/repo/releases/download/v0.23.0/portable.zip',
      },
      {
        name: 'QA.Touchstone_0.23.0_x64-setup.exe',
        url: 'https://github.com/owner/repo/releases/download/v0.23.0/setup.exe',
      },
      {
        name: 'QA.Touchstone_0.23.0_aarch64.dmg',
        url: 'https://github.com/owner/repo/releases/download/v0.23.0/app.dmg',
      },
    ];
    expect(detectUpdatePlatform('Windows')).toBe('windows');
    expect(pickUpdateAsset(assets, 'windows')?.name).toBe('QA.Touchstone_0.23.0_x64-setup.exe');
    expect(pickUpdateAsset(assets, 'macos')?.name).toBe('QA.Touchstone_0.23.0_aarch64.dmg');
  });

  it('stays current when GitHub release is not newer', async () => {
    const fetcher = async () => res(200, { tag_name: 'v0.22.1' });
    const result = await checkForUpdate('0.22.1', 'owner/repo', fetcher);
    expect(result.status).toBe('current');
    expect(result.latestVersion).toBe('0.22.1');
  });

  it('falls back to tags when the repo has no latest release', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('/releases/latest')) return res(404, {});
      return res(200, [{ name: 'v0.22.9' }, { name: 'v0.23.1' }, { name: 'not-a-version' }]);
    };
    const latest = await fetchGitHubLatestVersion('owner/repo', fetcher);
    expect(calls).toEqual([
      'https://api.github.com/repos/owner/repo/releases/latest',
      'https://api.github.com/repos/owner/repo/tags?per_page=50',
    ]);
    expect(latest).toMatchObject({
      version: '0.23.1',
      rawTag: 'v0.23.1',
      source: 'tag',
      url: 'https://github.com/owner/repo/tags',
    });
  });

  it('returns unknown instead of throwing when GitHub rejects the check', async () => {
    const fetcher = async () => res(500, {});
    const result = await checkForUpdate('0.22.1', 'owner/repo', fetcher);
    expect(result.status).toBe('unknown');
    expect(result.error).toMatch(/failed/i);
  });
});
