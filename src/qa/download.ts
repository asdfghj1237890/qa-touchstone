// src/qa/download.ts
// 單一下載入口，所有匯出（perf 報告、security JSON/HTML/JUnit/SARIF、docs、
// collections、response/history）都走這裡。
//
// 為什麼不只用 <a download>：Tauri 的 WebView 不會觸發 blob 的 <a download>
// 下載，點了完全沒反應。所以在 Tauri 下改用原生存檔對話框（plugin-dialog
// save）+ 後端寫檔（save_text_file），讓使用者選位置、真的存到檔。
// 純瀏覽器 / vite dev / vitest 沒有 Tauri，沿用 blob 的 <a download> fallback。
import api from '../api/index';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && !!((window as Window).__TAURI_INTERNALS__ || (window as Window).__TAURI__);

// 由副檔名推一個對話框 filter（"report.sarif.json" → json）。
function filtersFor(name: string): Array<{ name: string; extensions: string[] }> {
  const ext = (name.split('.').pop() || 'txt').toLowerCase();
  return [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }];
}

function blobDownload(name: string, content: BlobPart, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * 存下一個文字檔。Tauri：存檔對話框 → 後端寫檔；其他環境：blob <a download>。
 * 非同步，但呼叫端不需 await（fire-and-forget）；失敗時 console.error。
 */
export async function downloadFile(name: string, content: BlobPart, mime: string): Promise<void> {
  if (isTauri() && typeof content === 'string') {
    try {
      const path = await api.saveFileDialog({ defaultPath: name, filters: filtersFor(name) });
      if (!path) return; // 使用者取消
      await api.saveTextFile(path, content);
    } catch (e) {
      console.error('downloadFile (tauri) failed', e);
    }
    return;
  }
  blobDownload(name, content, mime);
}
