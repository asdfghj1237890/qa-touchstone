import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadJSON,
  saveJSON,
  loadString,
  saveString,
  initStorageMirror,
  flushMirror,
  MIRRORED_KEYS,
  STORAGE_ERROR_EVENT,
  _resetStorageMirrorForTests,
  migrateRecord,
  loadVersioned,
  saveVersioned,
  SCHEMA_VERSION_FIELD,
} from '../qa/storage';

describe('qaStorage — JSON 存取', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStorageMirrorForTests();
  });

  it('saveJSON / loadJSON roundtrip', () => {
    expect(saveJSON('k1', { a: 1 })).toBe(true);
    expect(loadJSON('k1')).toEqual({ a: 1 });
  });

  it('缺少 key 時回傳 fallback', () => {
    expect(loadJSON('nope', [])).toEqual([]);
    expect(loadString('nope', 'auto')).toBe('auto');
  });

  it('損壞的 JSON 回傳 fallback 並 console.error（不丟例外）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('bad', '{not json');
    expect(loadJSON('bad', { d: true })).toEqual({ d: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('寫入失敗回傳 false、console.error、發出 qa-storage-error 事件', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = [];
    const onErr = (e) => events.push(e.detail);
    window.addEventListener(STORAGE_ERROR_EVENT, onErr);
    const orig = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      expect(saveJSON('full', { x: 1 })).toBe(false);
      expect(saveString('full2', 'v')).toBe(false);
    } finally {
      localStorage.setItem = orig;
      window.removeEventListener(STORAGE_ERROR_EVENT, onErr);
    }
    expect(events.length).toBe(2);
    expect(events[0].key).toBe('full');
    expect(events[0].message).toMatch(/Quota/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('saveString / loadString roundtrip', () => {
    expect(saveString('s1', 'ocean')).toBe(true);
    expect(loadString('s1')).toBe('ocean');
  });
});

describe('qaStorage — schema 版本 / migration', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStorageMirrorForTests();
  });

  const bump1 = (d) => ({ ...d, a: (d.a || 0) + 1 });
  const renameB = (d) => {
    const { b, ...rest } = d;
    return { ...rest, c: b };
  };

  it('treats unversioned legacy data as v0 and runs every step', () => {
    const out = migrateRecord({ a: 0, b: 'x' }, 2, [bump1, renameB]);
    expect(out.a).toBe(1);
    expect(out.c).toBe('x');
    expect(out.b).toBeUndefined();
    expect(out[SCHEMA_VERSION_FIELD]).toBe(2);
  });

  it('starts from the recorded version and only runs the remaining steps', () => {
    const out = migrateRecord({ a: 5, b: 'y', [SCHEMA_VERSION_FIELD]: 1 }, 2, [bump1, renameB]);
    expect(out.a).toBe(5); // bump1 (step 0) skipped — already at v1
    expect(out.c).toBe('y'); // renameB (step 1) ran
    expect(out[SCHEMA_VERSION_FIELD]).toBe(2);
  });

  it('is a no-op when already at the target version', () => {
    const out = migrateRecord({ a: 9, [SCHEMA_VERSION_FIELD]: 3 }, 3, [bump1, bump1, bump1]);
    expect(out.a).toBe(9);
    expect(out[SCHEMA_VERSION_FIELD]).toBe(3);
  });

  it('loadVersioned migrates persisted legacy data on read and saveVersioned stamps the version', () => {
    localStorage.setItem('cfg', JSON.stringify({ a: 0, b: 'z' })); // legacy, no version
    const loaded = loadVersioned('cfg', 2, [bump1, renameB], {});
    expect(loaded).toMatchObject({ a: 1, c: 'z' });
    expect(loaded[SCHEMA_VERSION_FIELD]).toBe(2);

    saveVersioned('cfg', 2, { a: 1, c: 'z' });
    expect(JSON.parse(localStorage.getItem('cfg'))[SCHEMA_VERSION_FIELD]).toBe(2);
  });

  it('loadVersioned returns the fallback when nothing is stored', () => {
    expect(loadVersioned('absent', 1, [], { default: true })).toEqual({ default: true });
  });

  it('loadVersioned returns the fallback (not a throw) when a migration step throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('cfg', JSON.stringify({ a: 0 }));
    const boom = () => {
      throw new Error('bad migration');
    };
    expect(loadVersioned('cfg', 1, [boom], { safe: true })).toEqual({ safe: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('qaStorage — 磁碟鏡像', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStorageMirrorForTests();
  });
  afterEach(() => {
    _resetStorageMirrorForTests();
  });

  it('非 Tauri（loadUserData reject）時安靜停用', async () => {
    const api = {
      loadUserData: vi.fn().mockRejectedValue(new Error('no tauri')),
      saveUserData: vi.fn(),
    };
    expect(await initStorageMirror(api)).toBe(false);
    saveJSON(MIRRORED_KEYS[0], { a: 1 });
    await flushMirror();
    expect(api.saveUserData).not.toHaveBeenCalled();
  });

  it('開機還原：localStorage 缺少的鏡像 key 從磁碟 blob 還原', async () => {
    const blob = { __qaMirror: 1, qa_perf_runs: '[{"ts":"t1"}]', qa_accent: 'violet' };
    const api = {
      loadUserData: vi.fn().mockResolvedValue(blob),
      saveUserData: vi.fn().mockResolvedValue({ success: true }),
    };
    expect(await initStorageMirror(api)).toBe(true);
    expect(localStorage.getItem('qa_perf_runs')).toBe('[{"ts":"t1"}]');
    expect(localStorage.getItem('qa_accent')).toBe('violet');
  });

  it('localStorage 已有的 key 不被磁碟覆寫', async () => {
    localStorage.setItem('qa_accent', 'amber');
    const blob = { __qaMirror: 1, qa_accent: 'violet' };
    const api = { loadUserData: vi.fn().mockResolvedValue(blob), saveUserData: vi.fn() };
    await initStorageMirror(api);
    expect(localStorage.getItem('qa_accent')).toBe('amber');
  });

  it('首次啟動（後端回 []，無鏡像 blob）仍啟用鏡像，flush 會寫入磁碟', async () => {
    const api = {
      loadUserData: vi.fn().mockResolvedValue([]),
      saveUserData: vi.fn().mockResolvedValue({ success: true }),
    };
    expect(await initStorageMirror(api)).toBe(true);
    localStorage.setItem('qa_perf_runs', '[1]');
    localStorage.setItem('qa_llm_cfg', '{"key":"sk-secret"}'); // 機密：不得進鏡像
    await flushMirror();
    expect(api.saveUserData).toHaveBeenCalledTimes(1);
    const written = api.saveUserData.mock.calls[0][0];
    expect(written.__qaMirror).toBe(1);
    expect(written.qa_perf_runs).toBe('[1]');
    expect(written.qa_llm_cfg).toBeUndefined();
  });

  it('鏡像 key 的 saveJSON 會排程 debounce flush', async () => {
    vi.useFakeTimers();
    try {
      const api = {
        loadUserData: vi.fn().mockResolvedValue([]),
        saveUserData: vi.fn().mockResolvedValue({ success: true }),
      };
      await initStorageMirror(api);
      saveJSON('qa_perf_runs', [1]);
      saveJSON('qa_perf_runs', [1, 2]); // debounce：只 flush 一次
      expect(api.saveUserData).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.saveUserData).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('非鏡像 key 不觸發 flush', async () => {
    vi.useFakeTimers();
    try {
      const api = {
        loadUserData: vi.fn().mockResolvedValue([]),
        saveUserData: vi.fn().mockResolvedValue({ success: true }),
      };
      await initStorageMirror(api);
      saveJSON('qa_llm_cfg', { key: 'sk-x' });
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.saveUserData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
