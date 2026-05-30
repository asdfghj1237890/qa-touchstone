# Public APIs — Callable Demo Collection

Date: 2026-05-30
Status: Approved (design)

## Goal

Ship a demo Postman v2.1 collection, built from the kind of free APIs catalogued
in https://github.com/public-apis/public-apis, that the app can **import and
actually call**. Pressing Send on its requests in the built Tauri `.exe` returns
real JSON — demonstrating that the HTTP engine is real, not the canned/mock
fallback used in browser/dev.

Scope: ~30–40 endpoints across ~10 categories, all no-auth + HTTPS + GET-returns-JSON.

## Why this needs an importer change

Two facts about the current code make a naive conversion non-callable:

1. The public-apis list's "Link" column is a **docs/homepage URL**, not a callable
   endpoint. So a 1:1 scrape of the README does not produce callable requests.
   → We hand-curate real endpoints instead of scraping.
2. The importer strips the host: `pmUrlToPath` (src/qa/ImportData.jsx) returns only
   `pathname+search`, and `buildPayload` (src/qa/executor.js) prepends `env.baseUrl`.
   This assumes "one collection = one host". public-apis spans many hosts, so an
   imported request would lose its host and fail.

## Design

### Artifact
- `demo/public-apis.postman_collection.json` — new `demo/` folder at the repo root.
- Postman v2.1 schema. One folder per category. Each request:
  - `method: GET`, an **absolute** `url` (object form with `raw` + `protocol`/`host`/`path`),
  - example params pre-filled so Send works immediately
    (e.g. `https://api.agify.io/?name=michael`, `https://dog.ceo/api/breeds/image/random`).

### Importer change (minimal, two spots)
- `pmUrlToPath` (src/qa/ImportData.jsx): when the URL is absolute (`^https?://`),
  return the **full URL** (string branch and object-`raw` branch). Relative URLs
  keep current pathname+query behavior.
- `buildPayload` (src/qa/executor.js): if `req.url` is absolute, use it directly;
  otherwise keep `(env.baseUrl || '') + req.url`.

### Deliberate behavior change
After this change, an imported request with a **hardcoded absolute URL** is pinned
to that host — environment switching (None/Local/Staging/Prod) no longer rewrites
its base. Collections that use Postman variables like `{{baseUrl}}` are unaffected
(the URL isn't absolute, so env still applies). This is correct for multi-host
demos and more intuitive for absolute-URL imports generally.

## Verification
1. Before generating the file, `curl` each candidate endpoint; keep only those
   returning 2xx + JSON. Target ~30–40 kept; **list any dropped** (no silent cap).
2. Unit tests: an absolute-URL Postman request survives `qaParseImport` with its
   full URL, and `buildPayload` does not prepend `env.baseUrl` for it; a relative
   request still gets the env base.
3. After build, import the file in the real `.exe` and Send 1–2 requests to confirm
   real JSON comes back.

## Out of scope (YAGNI)
- No full public-apis mirror; no README markdown scraping.
- No import persistence (imports stay in-memory, lost on restart — fine for a demo).
- No auth'd / non-JSON / CORS-only endpoints.
