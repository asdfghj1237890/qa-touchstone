import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadJSON, saveJSON, loadString, saveString,
  initStorageMirror, flushMirror, MIRRORED_KEYS,
  STORAGE_ERROR_EVENT, _resetStorageMirrorForTests,
} from '../qa/storage.js';

describe('qaStorage — JSON 存取', () => {
  beforeEach(() => { localStorage.clear(); _resetStorageMirrorForTests(); });

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
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
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

describe('qaStorage — 磁碟鏡像', () => {
  beforeEach(() => { localStorage.clear(); _resetStorageMirrorForTests(); });
  afterEach(() => { _resetStorageMirrorForTests(); });

  it('非 Tauri（loadUserData reject）時安靜停用', async () => {
    const api = { loadUserData: vi.fn().mockRejectedValue(new Error('no tauri')), saveUserData: vi.fn() };
    expect(await initStorageMirror(api)).toBe(false);
    saveJSON(MIRRORED_KEYS[0], { a: 1 });
    await flushMirror();
    expect(api.saveUserData).not.toHaveBeenCalled();
  });

  it('開機還原：localStorage 缺少的鏡像 key 從磁碟 blob 還原', async () => {
    const blob = { __qaMirror: 1, qa_perf_runs: '[{"ts":"t1"}]', qa_accent: 'violet' };
    const api = { loadUserData: vi.fn().mockResolvedValue(blob), saveUserData: vi.fn().mockResolvedValue({ success: true }) };
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
    const api = { loadUserData: vi.fn().mockResolvedValue([]), saveUserData: vi.fn().mockResolvedValue({ success: true }) };
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
      const api = { loadUserData: vi.fn().mockResolvedValue([]), saveUserData: vi.fn().mockResolvedValue({ success: true }) };
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
      const api = { loadUserData: vi.fn().mockResolvedValue([]), saveUserData: vi.fn().mockResolvedValue({ success: true }) };
      await initStorageMirror(api);
      saveJSON('qa_llm_cfg', { key: 'sk-x' });
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.saveUserData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
