// 一次性遷移腳本：把 src/ 內所有「相對路徑」import 的 .js/.jsx 副檔名移除，
// 讓模組改名為 .ts/.tsx 時引用方零變動（Vite/Vitest/tsc bundler 模式都支援
// extensionless 解析）。CSS 與套件路徑不動。可重複執行（idempotent）。
import fs from 'node:fs';
import path from 'node:path';

const RE = /(\bfrom\s+|\bimport\s+|import\(\s*|vi\.mock\(\s*)(['"])(\.{1,2}\/[^'"]+?)\.(?:js|jsx)\2/g;

let changed = 0;
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test-report' || e.name === 'node_modules') continue;
      walk(p);
      continue;
    }
    if (!/\.(js|jsx|ts|tsx)$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
    scanned++;
    const src = fs.readFileSync(p, 'utf8');
    const out = src.replace(RE, (_m, pre, q, spec) => `${pre}${q}${spec}${q}`);
    if (out !== src) {
      fs.writeFileSync(p, out);
      changed++;
      console.log('rewrote', p);
    }
  }
}

walk('src');
console.log(`scanned ${scanned} files; rewrote ${changed}`);
