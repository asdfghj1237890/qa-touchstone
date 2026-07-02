import { describe, it, expect } from 'vitest';
import { buildDiagnosticsReport, collectStorageHealth } from '../qa/diagnostics';

// 「匯出診斷資料」報告組裝層。隱私邊界是硬需求：報告只能有版本/平台/外觀設定/
// storage key+位元組數/log 尾段 —— canary 測試釘死「值絕不出現」。

const CANARY = 'sk-CANARY-SECRET-9f3e2a77';

function fakeStorage(entries: Record<string, string>): Pick<Storage, 'length' | 'key' | 'getItem'> {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => (k in entries ? (entries[k] as string) : null),
  };
}

const baseInput = () => ({
  appVersion: '9.9.9-test',
  platform: 'testos',
  settings: { locale: 'zh-TW', accent: '#ff5533', density: 'comfortable' },
  storage: [{ key: 'qa_perf_runs', bytes: 12345 }],
  logTail: 'INFO boot ok\nWARN slow disk',
  generatedAt: '2026-07-02T03:04:05.000Z',
});

describe('buildDiagnosticsReport', () => {
  it('includes app version, platform, settings, and timestamp', () => {
    const r = buildDiagnosticsReport(baseInput());
    expect(r).toContain('app version: 9.9.9-test');
    expect(r).toContain('platform: testos');
    expect(r).toContain('locale: zh-TW');
    expect(r).toContain('accent: #ff5533');
    expect(r).toContain('density: comfortable');
    expect(r).toContain('generated: 2026-07-02T03:04:05.000Z');
  });

  it('lists storage keys with byte sizes and a total', () => {
    const r = buildDiagnosticsReport({
      ...baseInput(),
      storage: [
        { key: 'qa_accent', bytes: 4 },
        { key: 'qa_perf_runs', bytes: 12345 },
      ],
    });
    expect(r).toContain('qa_accent: 4 B');
    expect(r).toContain('qa_perf_runs: 12345 B');
    expect(r).toContain('total: 2 keys, 12349 B');
  });

  it('includes the log tail verbatim', () => {
    expect(buildDiagnosticsReport(baseInput())).toContain('INFO boot ok\nWARN slow disk');
  });

  it('marks empty storage and empty log tail', () => {
    const r = buildDiagnosticsReport({ ...baseInput(), storage: [], logTail: '' });
    expect(r).toContain('total: 0 keys, 0 B');
    expect(r).toContain('(no log content)');
  });

  it('defaults generatedAt to an ISO timestamp when omitted', () => {
    const { generatedAt: _omit, ...rest } = baseInput();
    const r = buildDiagnosticsReport(rest);
    expect(r).toMatch(/generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('collectStorageHealth', () => {
  it('returns keys with UTF-8 byte sizes only, sorted by key', () => {
    const entries = collectStorageHealth(fakeStorage({ b_key: '中文', a_key: 'four' }));
    expect(entries).toEqual([
      { key: 'a_key', bytes: 4 },
      { key: 'b_key', bytes: 6 },
    ]);
  });

  it('canary: a secret stored as a value never reaches the report', () => {
    const storage = collectStorageHealth(
      fakeStorage({
        qa_llm_cfg: JSON.stringify({ provider: 'openai', key: CANARY }),
        qa_env_vars: `token=${CANARY}`,
      })
    );
    const r = buildDiagnosticsReport({ ...baseInput(), storage });
    expect(r).toContain('qa_llm_cfg'); // key 本身要列出
    expect(r).toContain('qa_env_vars');
    expect(r).not.toContain(CANARY); // 值（token/LLM key）絕不出現
  });
});
