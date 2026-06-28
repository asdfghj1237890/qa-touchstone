import { defineConfig } from 'vite';
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
      exclude: ['src/__tests__/**', 'src/setupTests.js']
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
