import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      // Claude Code 本機目錄（.claude/worktrees/ 內有整份 repo 複本）；
      // 已列於 .gitignore，但 eslint 不讀 .gitignore，須在此明確忽略。
      '.claude/**',
      'build/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'src/__tests__/test-report/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  {
    // 全案通用：允許「故意吞掉」的空 catch（既有錯誤處理慣例）。
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // TypeScript：tseslint recommended（僅作用於 ts/tsx）。
  ...tseslint.configs.recommended.map((cfg) => ({ ...cfg, files: ['src/**/*.{ts,tsx}'] })),
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2023 },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 的 React Compiler 規則屬效能/慣例建議，非正確性錯誤；
      // 降為 warn，待逐步重構時再升回 error。
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      // 無 TypeScript：prop-types 噪音過大，先關閉（中期改 TS 時移除整條）。
      'react/prop-types': 'off',
      // Vite 的 automatic JSX runtime 不需要 import React。
      'react/react-in-jsx-scope': 'off',
      // 既有程式碼大量使用「故意吞掉」的空 catch；只允許 catch 為空。
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/setupTests.js', 'src/__mocks__/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: [
      'scripts/**/*.{js,mjs}',
      'packages/**/*.{js,mjs}',
      'setup-ci/**/*.{js,mjs}',
      'vite.config.mjs',
      'eslint.config.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // E2E harness：mocha 全域 + Node；browser/$/expect 由 @wdio/globals 匯入。
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.mocha },
    },
  },
  // 放在最後：ts/tsx 用 @typescript-eslint 版 unused-vars，關掉 core 版
  // （否則上方 js block 的 core 規則會打在型別宣告上）。
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off', // window 橋接過渡期允許 any
    },
  },
  {
    ignores: ['src/**/*.d.ts', 'src/qa/psl.data.ts'],
  },
];
