// ── QA Touchstone — GitHub version update checks ────────────────────────────
// Browser-safe: uses public GitHub release/tag endpoints and fails silently.

export interface GitHubLatestVersion {
  version: string;
  rawTag: string;
  url: string;
  source: 'release' | 'tag';
  assets: GitHubUpdateAsset[];
}

export interface GitHubUpdateAsset {
  name: string;
  url: string;
  size?: number;
  contentType?: string;
}

export interface UpdateCheckResult {
  status: 'update' | 'current' | 'unknown';
  currentVersion: string;
  latestVersion?: string;
  url?: string;
  source?: 'release' | 'tag';
  assets?: GitHubUpdateAsset[];
  checkedAt: string;
  error?: string;
}

export type UpdatePlatform = 'windows' | 'macos' | 'linux' | 'unknown';

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export function normalizeVersion(value: unknown): string | null {
  const m = String(value || '').match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?/);
  if (!m) return null;
  return [m[1], m[2] || '0', m[3] || '0'].join('.');
}

function partsOf(version: string): number[] | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  return normalized.split('.').map((part) => Number(part));
}

export function compareVersions(a: string, b: string): number {
  const ap = partsOf(a);
  const bp = partsOf(b);
  if (!ap || !bp) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (ap[i] !== bp[i]) return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

function headers(): HeadersInit {
  return { Accept: 'application/vnd.github+json' };
}

function releaseAssets(value: unknown): GitHubUpdateAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((asset) => {
      if (!asset || typeof asset !== 'object') return null;
      const name = String((asset as any).name || '');
      const url = String((asset as any).browser_download_url || '');
      if (!name || !url) return null;
      return {
        name,
        url,
        size: Number.isFinite((asset as any).size) ? Number((asset as any).size) : undefined,
        contentType: String((asset as any).content_type || ''),
      };
    })
    .filter(Boolean) as GitHubUpdateAsset[];
}

export function detectUpdatePlatform(platform = ''): UpdatePlatform {
  const source =
    platform ||
    (typeof navigator !== 'undefined'
      ? String(
          (navigator as any).userAgentData?.platform ||
            navigator.platform ||
            navigator.userAgent ||
            ''
        )
      : '');
  if (/windows|win32|win64/i.test(source)) return 'windows';
  if (/mac|darwin/i.test(source)) return 'macos';
  if (/linux|x11/i.test(source)) return 'linux';
  return 'unknown';
}

function desktopAssetScore(asset: GitHubUpdateAsset, platform: UpdatePlatform): number {
  const name = asset.name.toLowerCase();
  if (name.endsWith('.sha256') || name.endsWith('.sig') || name.endsWith('.blockmap')) return -1;
  if (name.includes('qa-touchstone-ci')) return -1;
  if (!name.includes('touchstone')) return -1;

  if (platform === 'windows') {
    if (/setup.*\.exe$|\.msi$/.test(name)) return 100;
    if (/portable.*\.zip$/.test(name)) return 80;
    if (name.endsWith('.exe')) return 70;
    if (name.endsWith('.zip')) return 40;
    return -1;
  }
  if (platform === 'macos') {
    if (name.endsWith('.dmg')) return /arm64|aarch64|silicon/.test(name) ? 110 : 100;
    if (name.endsWith('.pkg')) return 80;
    return -1;
  }
  if (platform === 'linux') {
    if (name.endsWith('.appimage')) return 100;
    if (name.endsWith('.deb')) return 80;
    if (name.endsWith('.rpm')) return 70;
    return -1;
  }

  if (/setup.*\.exe$|\.dmg$|portable.*\.zip$/.test(name)) return 50;
  return -1;
}

export function pickUpdateAsset(
  assets: GitHubUpdateAsset[] | undefined,
  platform: UpdatePlatform = detectUpdatePlatform()
): GitHubUpdateAsset | null {
  const ranked = (assets || [])
    .map((asset) => ({ asset, score: desktopAssetScore(asset, platform) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.asset || null;
}

export async function fetchGitHubLatestVersion(
  repo: string,
  fetcher: FetchLike = fetch
): Promise<GitHubLatestVersion | null> {
  const base = `https://api.github.com/repos/${repo}`;
  const release = await fetcher(`${base}/releases/latest`, { headers: headers() });
  if (release.ok) {
    const json = await release.json();
    const rawTag = String(json.tag_name || json.name || '');
    const version = normalizeVersion(rawTag);
    if (version) {
      return {
        version,
        rawTag,
        url: String(json.html_url || `https://github.com/${repo}/releases/latest`),
        source: 'release',
        assets: releaseAssets(json.assets),
      };
    }
  } else if (release.status !== 404) {
    throw new Error(`GitHub release check failed (${release.status})`);
  }

  const tags = await fetcher(`${base}/tags?per_page=50`, { headers: headers() });
  if (!tags.ok) throw new Error(`GitHub tag check failed (${tags.status})`);
  const list = await tags.json();
  if (!Array.isArray(list)) return null;
  const candidates = list
    .map((tag) => {
      const rawTag = String((tag && tag.name) || '');
      const version = normalizeVersion(rawTag);
      return version ? { rawTag, version } : null;
    })
    .filter(Boolean) as Array<{ rawTag: string; version: string }>;
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  const latest = candidates[0];
  return latest
    ? {
        ...latest,
        url: `https://github.com/${repo}/tags`,
        source: 'tag',
        assets: [],
      }
    : null;
}

export async function checkForUpdate(
  currentVersion: string,
  repo: string,
  fetcher?: FetchLike
): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const latest = await fetchGitHubLatestVersion(repo, fetcher);
    if (!latest)
      return { status: 'unknown', currentVersion, checkedAt, error: 'No version tag found' };
    return compareVersions(latest.version, currentVersion) > 0
      ? {
          status: 'update',
          currentVersion,
          latestVersion: latest.version,
          url: latest.url,
          source: latest.source,
          assets: latest.assets,
          checkedAt,
        }
      : {
          status: 'current',
          currentVersion,
          latestVersion: latest.version,
          url: latest.url,
          source: latest.source,
          assets: latest.assets,
          checkedAt,
        };
  } catch (err) {
    return {
      status: 'unknown',
      currentVersion,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
