/* global browser */
// e2e/wdio.conf.mjs
// Desktop E2E smoke harness: WebdriverIO ⇄ tauri-driver ⇄ 原生 WebDriver
// （Linux: WebKitWebDriver / Windows: msedgedriver）⇄ release binary。
// 完整驗證需要 built app + WebDriver + display server —— 亦即 CI 的
// e2e-smoke job；本機能驗的只有「設定可解析」。詳見 README.md。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const appBinary = join(
  here,
  '..',
  'src-tauri',
  'target',
  'release',
  isWindows ? 'qa-touchstone.exe' : 'qa-touchstone'
);
const logsDir = join(here, 'logs');

let tauriDriver = null;

export const config = {
  runner: 'local',
  // tauri-driver 聽 4444，並在 4445 起原生 driver。
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  specs: ['./specs/**/*.e2e.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': { application: appBinary },
    },
  ],
  logLevel: 'warn',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 180000,
    // 冒煙步驟彼此依賴（import → send → scan → export）；前一步倒了，
    // 之後只會是噪音 —— 直接 bail。
    bail: true,
  },

  onPrepare() {
    // Preflight：binary 沒 build 就直接把原因講清楚，別讓錯誤埋在
    // WebDriver 連線失敗底下（這個 harness 首跑就在 CI，除錯預算珍貴）。
    if (!existsSync(appBinary)) {
      console.error(
        `[e2e] app binary not found: ${appBinary}\n` +
          '[e2e] build it first: npx tauri build --no-bundle (repo root)'
      );
      process.exit(1);
    }
    mkdirSync(logsDir, { recursive: true });
    const env = { ...process.env };
    if (!isWindows) {
      // 把 app 的設定/資料/快取目錄指到臨時目錄，與真實使用者資料隔離。
      // Windows 走 known-folder API、無法用環境變數覆寫 —— 本機在
      // Windows 跑會碰真實 %APPDATA%（見 README 的備份步驟）。
      const isolated = mkdtempSync(join(tmpdir(), 'qa-e2e-home-'));
      env.XDG_CONFIG_HOME = join(isolated, 'config');
      env.XDG_DATA_HOME = join(isolated, 'data');
      env.XDG_CACHE_HOME = join(isolated, 'cache');
    }
    const args = [];
    // Windows 必填：對版的 msedgedriver 路徑。Linux 上 tauri-driver 會自己
    // 從 PATH 找 WebKitWebDriver（apt: webkit2gtk-driver）。
    if (process.env.E2E_NATIVE_DRIVER) {
      args.push('--native-driver', process.env.E2E_NATIVE_DRIVER);
    }
    tauriDriver = spawn('tauri-driver', args, { stdio: 'inherit', env });
    tauriDriver.on('error', (err) => {
      console.error(
        '[e2e] failed to start tauri-driver (install with: cargo install tauri-driver --locked):',
        err
      );
      process.exit(1);
    });
  },

  // 失敗自動截圖到 e2e/logs/（CI 失敗時上傳成 artifact）。
  async afterTest(test, _context, { passed }) {
    if (!passed) {
      const name = `${test.parent} ${test.title}`.replace(/[^\w]+/g, '-').slice(0, 80);
      try {
        await browser.saveScreenshot(join(logsDir, `${name}.png`));
      } catch (e) {
        console.error('[e2e] screenshot failed:', e);
      }
    }
  },

  onComplete() {
    if (tauriDriver) tauriDriver.kill();
  },
};
