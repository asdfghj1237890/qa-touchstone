// 本機組裝 Windows 免安裝版（portable）到 dist/。
// Tauri 沒有原生 portable target，所以手工組：raw exe + 旁邊的 resources/k6.exe，
// 與 NSIS 安裝後相同的版面（讓 Rust 的 BaseDirectory::Resource 能在 exe 旁找到 k6）。
// 與 .github/workflows/release.yml 的「Package Windows portable ZIP」步驟同邏輯，
// 差別是輸出到 dist/、不上傳 release。
//
// 前置：先跑過 `npm run tauri:build`（產生 exe）與 `npm run setup:k6:release`
//       （放好 resources/k6.exe）。本腳本只組裝，不編譯。
//
// 用法：npm run package:portable
import { readFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const ver = pkg.version;

const releaseDir = path.join(root, 'src-tauri', 'target', 'release');
const k6 = path.join(root, 'src-tauri', 'resources', 'k6.exe');

function die(msg) {
  console.error('package-portable: ' + msg);
  process.exit(1);
}

if (!existsSync(releaseDir)) die(`找不到 ${releaseDir}；請先執行 \`npm run tauri:build\``);
if (!existsSync(k6)) die(`找不到 ${k6}；請先執行 \`npm run setup:k6:release\``);

// 找 release exe（排除 NSIS 安裝檔 *setup*）。
const exe = readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith('.exe') && !/setup/i.test(f))
  .map((f) => path.join(releaseDir, f))[0];
if (!exe) die(`${releaseDir} 下找不到 portable exe（請先 \`npm run tauri:build\`）`);

const dist = path.join(root, 'dist');
const stageRoot = path.join(dist, 'QA Touchstone');
const zipPath = path.join(dist, `QA.Touchstone_${ver}_x64-portable.zip`);

// 清掉上一輪的 staging 與舊 zip（保留 dist 內其他檔案）。
rmSync(stageRoot, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(path.join(stageRoot, 'resources'), { recursive: true });

copyFileSync(exe, path.join(stageRoot, 'QA Touchstone.exe'));
copyFileSync(k6, path.join(stageRoot, 'resources', 'k6.exe'));

// 壓縮：Windows 用 PowerShell 的 Compress-Archive，其他平台用 zip。
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${stageRoot}' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', zipPath, 'QA Touchstone'], { cwd: dist, stdio: 'inherit' });
}

const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ portable 已產生：${path.relative(root, zipPath)} (${mb} MB)`);
console.log(`  內容：QA Touchstone/QA Touchstone.exe + resources/k6.exe`);
