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
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return route.continue(); // vite preview assets
    }
    if (url.hostname === 'api.github.com') {
      // Production preview boots checkForUpdate() (src/App.tsx — only
      // MODE==='test' skips it). 404 → the check fails closed and stays
      // quiet, and the request never counts as an unmocked host.
      return fulfillJson(route, JSON.stringify({ message: 'Not Found' }), 404);
    }
    if (url.hostname === 'restcountries.com') {
      return fulfillJson(route, fixture('restcountries-name.json'));
    }
    if (url.hostname === 'mock.local') {
      return fulfillJson(route, JSON.stringify({ ok: true, source: 'mock.local' }));
    }
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  return blocked;
}
