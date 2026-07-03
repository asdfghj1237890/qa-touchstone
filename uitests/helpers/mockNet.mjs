// uitests/helpers/mockNet.mjs
// Default-deny network policy: app assets pass, known fixture hosts are
// fulfilled, EVERYTHING else is aborted and recorded. Tests assert the
// recorded list is empty → proves full offline determinism.
//
// CORS: the app's executor fetches with mode:'cors' (src/qa/executor.ts),
// and the page origin is http://localhost:4173 — fulfilled cross-origin
// responses are still CORS-checked by the browser, so every API fulfill
// carries access-control-allow-origin, and OPTIONS preflights (POST+JSON
// is a non-simple request) are answered explicitly.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, '..', 'fixtures', name), 'utf8');

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
};

function fulfillJson(route, body, status = 200) {
  if (route.request().method() === 'OPTIONS') {
    // CORS preflight: empty 204 with the allow headers.
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  return route.fulfill({
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    body,
  });
}

export async function installMockNet(page) {
  const blocked = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    try {
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return route.continue(); // vite preview assets
      }
      if (url.hostname === 'api.github.com') {
        // The harness serves the PRODUCTION build (vite preview, MODE=
        // 'production'), so App.tsx's shouldSkipUpdateCheck() is false and
        // checkForUpdate() fires on every boot — this mock is the only thing
        // keeping that call offline/deterministic. 404 → the check fails
        // closed and stays quiet, and the request never counts as an
        // unmocked host.
        return fulfillJson(route, JSON.stringify({ message: 'Not Found' }), 404);
      }
      if (url.hostname === 'restcountries.com') {
        return fulfillJson(route, fixture('restcountries-name.json'));
      }
      if (url.hostname === 'mock.local') {
        return fulfillJson(route, JSON.stringify({ ok: true, source: 'mock.local' }));
      }
      if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        // index.html unconditionally links a Google Fonts stylesheet (every
        // boot, every spec) — not a mockable app fixture, just an inert
        // static asset. Fulfilling empty/octet-stream lets @font-face fail
        // soft (fallback font, non-fatal) without polluting the blocked list
        // or exercising the abort path for a host with no test-relevant
        // behavior.
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
    } catch (err) {
      // A throwing handler would otherwise stall the request and kill the
      // run with a playwright-internal stack. Record + abort instead so the
      // failure surfaces attributably in the spec's blocked-list assertion.
      blocked.push(`${url.href} (handler error: ${err && err.message})`);
      return route.abort('failed');
    }
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  return blocked;
}
