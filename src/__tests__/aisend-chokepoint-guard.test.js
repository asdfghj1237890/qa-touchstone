// src/__tests__/aisend-chokepoint-guard.test.js
// Structural guard: feature modules must reach the LLM only through qaAiSend.
// Only the transport module (llm.js) may import or call qaCallLLM directly.
// A bare mention in a comment is fine; a real import binding or a call is not.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const QA_DIR = join(process.cwd(), 'src', 'qa');
const ALLOWED = new Set(['llm.js']);

const IMPORT_RE = /import\s*\{[^}]*\bqaCallLLM\b[^}]*\}\s*from\s*['"]\.\/llm\.js['"]/;
const CALL_RE = /\bqaCallLLM\s*\(/;

describe('chokepoint integrity', () => {
  it('no feature module imports or calls qaCallLLM directly (only llm.js may)', () => {
    const offenders = [];
    for (const f of readdirSync(QA_DIR)) {
      if (ALLOWED.has(f)) continue;
      if (!/\.(js|jsx)$/.test(f)) continue;
      const src = readFileSync(join(QA_DIR, f), 'utf8');
      if (IMPORT_RE.test(src) || CALL_RE.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
