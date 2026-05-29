import './processShim';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { getCurrentWindow } from '@tauri-apps/api/window';
import api, { initApi } from './api';

// 方案 A：把 api 掛到 window.electronAPI，既有 31 個呼叫點無需改動
window.electronAPI = api;

// 以 Tauri window label 判定視窗身分（main / settings），供 App.jsx 讀取
try {
  window.__WINDOW_LABEL__ = getCurrentWindow().label;
} catch (e) {
  // 非 Tauri 環境（如測試）忽略
}

const container = document.getElementById('root');
const root = createRoot(container);

initApi().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
