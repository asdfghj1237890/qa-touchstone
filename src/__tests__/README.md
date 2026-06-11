# Test Suite

Vitest + Testing Library (jsdom). All frontend tests live flat in this
directory as `*.test.js(x)`, with one exception: the Tauri IPC-contract suite
sits next to the bridge it locks down (`src/api/index.test.js`). Rust unit
tests live next to their modules in `src-tauri/src/**` (`cargo test`).

## Commands

```bash
npm test               # full run (CI gate)
npm run test:watch     # watch mode
npm run test:coverage  # v8 coverage (HTML + text)
npm run test:html-view # browse the HTML report
```

## Layout

- `*.test.js` — pure-logic suites (engine, findings, bola, oracles,
  schema-conformance / fuzz / bfla engines, aiPrivacy redaction, storage
  layer, k6 helpers, import parser, …).
- `*.test.jsx` — component/integration suites rendered with Testing Library
  (App shell, Security page, BOLA/rate-limit panels, PerfTest StrictMode
  races, prompt preview, error boundary, …).
- `test-report/` — generated HTML reports (ignored content; do not edit).

## Conventions

- `src/setupTests.js` installs the shared jsdom polyfills (Web Storage,
  observers, timers-leak tracking) and clears `localStorage` between tests.
- Canned data comes from `window.QA` fixtures (see `src/qa/setup.ts`);
  Tauri commands are mocked per-suite by mocking `src/api/index.ts` or
  `@tauri-apps/*` modules — there is no global Tauri mock.
- New persistence code must go through `src/qa/storage.ts` (see
  `storage.test.js` for the contract: fallback on corrupt data, visible
  write failures, disk-mirror behaviour, on-read migrations).
