/* global window -- addInitScript/evaluate callbacks are serialized and run inside the browser page, not Node */
// uitests/helpers/session.mjs
// Shared boot/diagnostic helpers for all specs.

/** Collect uncaught page errors; assert empty at the end of a test. */
export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Navigate to the app shell and wait for boot. */
export async function gotoApp(page) {
  await page.goto('/');
  await page.locator('.qa-app').waitFor({ timeout: 30_000 });
}

// Seed for findings.spec: loadSnapshots() (src/qa/findings.ts) reads plain
// JSON {fpVersion:1, baseline, lastRun} from localStorage key
// 'qa_security_snapshots'.
//
// WHY baseline (not lastRun): FindingsPanel.buildRows() renders rows only
// from (a) the live `union` prop — runtime state produced by engine runs,
// not seedable — or (b) baseline.items whose diff presence is 'resolved'
// (union empty + item in baseline → resolved). Seeding lastRun alone
// renders NOTHING. With baseline seeded and lastRun null, both items show
// as muted "resolved" rows, which still expand to the full lifecycle
// controls (suppress / severity override / owner / note).
//
// NOTE: snapshots store no `title` — buildRows uses locationLabel as the
// row title for snapshot-reconstructed rows, so specs assert on
// locationLabel text. Item shape: SnapshotItem in src/qa/types.ts.
export const SNAPSHOTS_KEY = 'qa_security_snapshots';
export const SEED_LOCATION_1 = 'GET /api/users @admin';
export const SEED_LOCATION_2 = 'bola:t1:userB->userA';
export const SNAPSHOT_SEED = {
  fpVersion: 1,
  lastRun: null,
  baseline: {
    runId: 'uitest-seed-baseline',
    createdAt: '2026-07-03T00:00:00.000Z',
    scopeHash: 'uitest-seed-scope',
    status: 'complete',
    items: [
      {
        fp: 'fp-uitest-1',
        effectiveSeverity: 'high',
        engine: 'matrix',
        ruleId: 'sensitive-data',
        path: '/api/users',
        locationLabel: SEED_LOCATION_1,
        title: 'Sensitive data in response',
        evidence: 'ssn: ***-**-1234',
        count: 1,
        dfp: 'dfp-uitest-1',
      },
      {
        fp: 'fp-uitest-2',
        effectiveSeverity: 'medium',
        engine: 'bola',
        ruleId: 'object-authz',
        path: '/api/orders/1',
        locationLabel: SEED_LOCATION_2,
        title: 'Cross-tenant read succeeded',
        evidence: 'HTTP 200 for foreign object id',
        count: 1,
        dfp: 'dfp-uitest-2',
      },
    ],
  },
};

/** Must be called BEFORE gotoApp: plants localStorage before the app boots. */
export async function seedFindings(page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SNAPSHOTS_KEY, JSON.stringify(SNAPSHOT_SEED)]
  );
}

/**
 * Response-bar status pill locator. StatusPill (src/qa/components.tsx) is a
 * class-less <span> rendering "<code> <statusText>" as the FIRST child of
 * .qa-resp-stats; its siblings (elapsed time "1200 ms", size) all carry
 * .qa-resp-stat. Scoping status asserts to this element keeps "200" from
 * matching timing text. Assert with: expect(statusPill(page)).toHaveText(/\b200\b/)
 */
export function statusPill(page) {
  return page.locator('.qa-resp-stats > span:not(.qa-resp-stat)');
}
