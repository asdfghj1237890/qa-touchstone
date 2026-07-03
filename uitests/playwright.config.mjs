// uitests/playwright.config.mjs
// Cross-engine UI harness: drives the PRODUCTION vite bundle (vite preview)
// in Playwright's bundled WebKit (≈ macOS WKWebView) and Chromium
// (≈ Windows WebView2). This layer proves engine-family UI compatibility;
// it does NOT touch Tauri IPC / Rust — that chain is owned by e2e/ and unit
// tests. See uitests/README.md.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  // Specs are independent; run files in parallel but keep one worker per
  // file (default) — the preview server is shared and stateless.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4173',
    // Deterministic language: en-US assertions everywhere (settings.spec
    // exercises the zh-TW switch explicitly).
    locale: 'en-US',
    viewport: { width: 1440, height: 900 }, // app default window size
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    // Production bundle, not the dev server: closer to what ships in the
    // Tauri shell (no HMR client, real minified output).
    command: 'npm --prefix .. run build && npm --prefix .. run serve -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
