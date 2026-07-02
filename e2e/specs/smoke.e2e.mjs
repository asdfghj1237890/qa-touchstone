/* global document, window -- browser.execute 回呼被序列化後在 app 的 WebView 內執行，不在 Node */
// e2e/specs/smoke.e2e.mjs
// 唯一冒煙路徑：launch → import demo collection → send → security suite →
// export 報告並斷言檔案真的落地（v0.21.1「打包版匯出全滅」bug class 的回歸
// 守門）。send/scan 打的是 demo collection 的真實公開 API，只做寬鬆斷言
// （流程完成即可）；硬斷言只有「匯出檔案出現在磁碟上」—— 純本地、確定性。
import { browser, $, expect } from '@wdio/globals';
import { readFileSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoCollection = readFileSync(
  join(here, '..', '..', 'demo', 'rest-countries.postman_collection.json'),
  'utf8'
);
// 匯入 rest-countries 而非 public-apis：後者開機就自動載入（src/qa/setup.ts），
// 用前者才能斷言「匯入 UI 真的新增了本來不存在的 collection」。
const COLLECTION_NAME = 'OpenNet REST Countries — QA Touchstone Collection';

// 匯出目的資料夾：Node 端建立、注入給 app 的 E2E seam。統一 forward slash —
// seam 只做字串串接，Rust 端兩種分隔符都接受。
const saveDir = mkdtempSync(join(tmpdir(), 'qa-e2e-exports-')).replace(/\\/g, '/');

const exportedReports = () => readdirSync(saveDir).filter((f) => /^qa-security-.*\.json$/.test(f));

describe('desktop smoke', () => {
  it('launches to the app shell', async () => {
    await $('.qa-app').waitForExist({ timeout: 30000 });
  });

  it('imports the rest-countries demo collection through the UI', async () => {
    await $('[data-testid="nav-api"]').click();
    await $('[data-testid="import-open"]').waitForClickable();
    await $('[data-testid="import-open"]').click();
    await $('[data-testid="import-text"]').waitForExist();
    // React 受控 textarea：setValue 會逐鍵慢速打完整份 collection、又慢又脆；
    // value setter + input 事件（WebDriver execute 在自動化 session 執行，
    // 不受頁面 CSP script-src 'self' 限制）。
    await browser.execute((text) => {
      const el = document.querySelector('[data-testid="import-text"]');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, demoCollection);
    await $('.qa-import-preview').waitForExist();
    await $('[data-testid="import-submit"]').click();
    // 硬斷言（純本地）：側欄出現剛匯入的 collection 名稱。
    await expect(
      $(`//span[contains(@class,"qa-col-name")][normalize-space(text())="${COLLECTION_NAME}"]`)
    ).toBeDisplayed();
  });

  it('sends a request from the imported collection (tolerant)', async () => {
    // 匯入的 collection 預設展開（Sidebar isOpen fallback 到 !!col.source）；
    // 顯式點一條「葉節點 request」，不依賴匯入時的 auto-select。
    // 注意：TC1/TC2/TC3 是 Postman 資料夾名，.qa-req 只渲染葉節點名 ——
    // 用真實 request 名（Search name: japan …）才點得到（review 攔到的 bug）。
    await $('//button[contains(@class,"qa-req")][contains(.,"Search name: japan")]').click();
    const send = $('[data-testid="send-request"]');
    await send.click();
    // 寬鬆斷言：流程完成（按鈕解除 disabled）即可，不驗 HTTP 成敗 ——
    // 這一步打真實公開 API（restcountries.com）。
    await browser.waitUntil(async () => (await send.getAttribute('disabled')) === null, {
      timeout: 60000,
      timeoutMsg: 'send never completed (tolerant step — likely network, NOT the 0.21.1 gate)',
    });
    // 次要寬鬆斷言：response panel 離開 empty（done 或 error 都會渲染 bar）。
    await expect($('.qa-resp-bar')).toBeExisting();
  });

  it('runs the security suite to completion', async () => {
    await $('[data-testid="nav-security"]').click();
    await $('[data-testid="suite-run"]').waitForClickable();
    await $('[data-testid="suite-run"]').click();
    // run complete 的訊號：export 選單解鎖（= snapshots.lastRun 已記錄）。
    // 零 matrix config 下引擎記為 skipped:'no-config'，run 仍 complete ——
    // 這是設計決策 #4（確定性 > 深度）。
    await $('[data-testid="report-export"]').waitForExist({ timeout: 120000 });
  });

  it('exports the JSON report and the file actually lands on disk (0.21.1 gate)', async () => {
    expect(exportedReports()).toHaveLength(0);
    // 啟用 save-dialog seam：跳過原生對話框；後端 save_text_file 真實寫檔照跑。
    await browser.execute((dir) => {
      window.__QA_E2E_SAVE_DIR__ = dir;
    }, saveDir);
    await $('[data-testid="report-export"]').click();
    await $('[data-testid="report-export-json"]').waitForClickable();
    await $('[data-testid="report-export-json"]').click();
    // 硬斷言：檔案出現在磁碟、非空、可 parse、長得像 ReportModel。
    await browser.waitUntil(() => exportedReports().length === 1, {
      timeout: 15000,
      timeoutMsg: `no qa-security-*.json appeared in ${saveDir} — the 0.21.1 export path is broken`,
    });
    const file = join(saveDir, exportedReports()[0]);
    expect(statSync(file).size).toBeGreaterThan(0);
    const report = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of ['meta', 'engines', 'summary', 'findings']) {
      expect(report).toHaveProperty(key);
    }
  });
});
