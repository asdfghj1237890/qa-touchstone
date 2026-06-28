// src/__tests__/download.test.js
// Guards the export routing that broke for three releases (v0.21.1): in Tauri a
// blob <a download> is silently ignored, so exports must go through the native
// save dialog + backend write; in the browser they fall back to the blob path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saveFileDialog = vi.fn();
const saveTextFile = vi.fn();
vi.mock('../api/index', () => ({
  default: {
    saveFileDialog: (...a) => saveFileDialog(...a),
    saveTextFile: (...a) => saveTextFile(...a),
  },
}));

import { downloadFile } from '../qa/download';

describe('downloadFile — Tauri native save path', () => {
  beforeEach(() => {
    saveFileDialog.mockReset();
    saveTextFile.mockReset();
    window.__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it('routes a string export through the save dialog + backend write, with an extension-derived filter', async () => {
    saveFileDialog.mockResolvedValue('/picked/report.sarif.json');
    await downloadFile('report.sarif.json', '{"runs":[]}', 'application/json');
    expect(saveFileDialog).toHaveBeenCalledWith({
      defaultPath: 'report.sarif.json',
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    expect(saveTextFile).toHaveBeenCalledWith('/picked/report.sarif.json', '{"runs":[]}');
  });

  it('writes nothing when the user cancels the dialog', async () => {
    saveFileDialog.mockResolvedValue(null);
    await downloadFile('x.json', '{}', 'application/json');
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it('swallows a backend write error (fire-and-forget export never throws)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveFileDialog.mockResolvedValue('/p/x.json');
    saveTextFile.mockRejectedValue(new Error('disk full'));
    await expect(downloadFile('x.json', '{}', 'application/json')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('downloadFile — browser blob fallback', () => {
  beforeEach(() => {
    saveFileDialog.mockReset();
    saveTextFile.mockReset();
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI__;
  });

  it('uses an <a download> blob when not in Tauri, and never calls the backend', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const realCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = click;
      return el;
    });
    try {
      await downloadFile('out.json', '{}', 'application/json');
      expect(createUrl).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(saveFileDialog).not.toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
    }
  });
});
