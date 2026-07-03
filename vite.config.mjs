import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'node:fs';

// 單一版本來源：build/dev/test 都從 package.json 注入 __APP_VERSION__，
// UI 不再寫死版號（先前 HomePage/Sidebar 寫死 0.20.2，發版時漏改而過時）。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const githubRepo = process.env.VITE_GITHUB_REPO || 'asdfghj1237890/qa-touchstone';

export default defineConfig({
  plugins: [
    react({
      include: /\.(js|jsx|ts|tsx)$/,
      jsxRuntime: 'automatic',
      babel: {
        plugins: [
          ["@babel/plugin-transform-private-property-in-object", { "loose": true }],
          ["@babel/plugin-transform-private-methods", { "loose": true }],
          ["@babel/plugin-transform-class-properties", { "loose": true }],
          "@babel/plugin-transform-optional-chaining",
          "@babel/plugin-transform-nullish-coalescing-operator"
        ]
      }
    })
  ],
  base: './',
  build: {
    outDir: 'build',
    sourcemap: false,
    target: 'esnext'
  },
  server: {
    port: 3000,
    strictPort: true,
    open: false,
    // Tauri: 別讓 Vite 監看 Rust 的 target 目錄，否則 cargo 編譯時鎖檔會讓 chokidar 拋 EBUSY 而崩潰
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    }
  },
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GITHUB_REPO__: JSON.stringify(githubRepo),
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
      },
    },
    // uitests/ 是 Playwright 規格(import '@playwright/test'),不能被 vitest
    // 收集,否則 4 個檔案 collection error → npm test exit 1。Playwright 有自己
    // 的 config(uitests/playwright.config.mjs),不受此排除影響。
    exclude: [...configDefaults.exclude, 'uitests/**'],
    setupFiles: ['./src/setupTests.js'],
    reporters: ['verbose', 'html'],
    outputFile: {
      html: './src/__tests__/test-report/test-results.html'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './src/__tests__/test-report/coverage',
      reportOnFailure: true,
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/setupTests.js'],
      // Ratchet floor: set below the current measured coverage
      // (≈S68 / B58 / F56 / L71 as of 2026-07-02) so CI fails on a *regression*
      // below this line without flaking on minor churn. Raise these as coverage
      // improves; never lower them to make a red build pass.
      thresholds: {
        statements: 62,
        branches: 52,
        functions: 50,
        lines: 65
      }
    },
    // Handle CSS modules properly
    css: true,
    // Ensure the same alias resolution for tests
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    }
  }
});
