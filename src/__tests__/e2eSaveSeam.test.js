// src/__tests__/e2eSaveSeam.test.js
// Guards the desktop-E2E save-dialog seam in src/api/index.ts: with
// window.__QA_E2E_SAVE_DIR__ set, the native dialog is skipped and a
// deterministic destination path is returned (the Rust write that follows is
// what the E2E asserts on disk); without the global the real plugin dialog is
// called — the seam must be inert in normal runs.
import { describe, it, expect, vi, afterEach } from 'vitest';

const { saveDialogMock } = vi.hoisted(() => ({ saveDialogMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: saveDialogMock,
}));

import api from '../api/index';

describe('saveFileDialog — E2E seam', () => {
  afterEach(() => {
    delete window.__QA_E2E_SAVE_DIR__;
    saveDialogMock.mockReset();
  });

  it('returns dir + defaultPath and skips the native dialog when the seam is set', async () => {
    window.__QA_E2E_SAVE_DIR__ = '/tmp/qa-e2e';
    await expect(api.saveFileDialog({ defaultPath: 'r.json' })).resolves.toBe('/tmp/qa-e2e/r.json');
    expect(saveDialogMock).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash (and backslash) on the seam dir', async () => {
    window.__QA_E2E_SAVE_DIR__ = 'C:/tmp/qa-e2e/';
    await expect(api.saveFileDialog({ defaultPath: 'r.json' })).resolves.toBe(
      'C:/tmp/qa-e2e/r.json'
    );
  });

  it('stays inert (calls the real dialog, passes its result through) without the global', async () => {
    saveDialogMock.mockResolvedValue('/picked/x.json');
    const opts = { defaultPath: 'x.json' };
    await expect(api.saveFileDialog(opts)).resolves.toBe('/picked/x.json');
    expect(saveDialogMock).toHaveBeenCalledWith(opts);
  });
});
