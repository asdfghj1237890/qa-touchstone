import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
  },
  optimizeDeps: {
    include: [
      '@mui/material',
      '@mui/icons-material',
      '@mui/x-data-grid',
      '@mui/x-tree-view',
      '@emotion/react',
      '@emotion/styled'
    ]
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    reporter: ['verbose', 'html'],
    outputFile: {
      html: './src/__tests__/test-report/test-results.html'
    },
    watchExclude: [
      'src/__tests__/test-report/**',
      'build/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './src/__tests__/test-report/coverage',
      reportOnFailure: true,
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/setupTests.js']
    },
    // Use updated configuration format for Vitest
    server: {
      deps: {
        inline: [/@mui/]
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