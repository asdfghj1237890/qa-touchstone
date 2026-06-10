import './processShim';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './qa/qa.css';
import App from './App';
import api, { initApi } from './api';
import { initStorageMirror } from './qa/storage';

const container = document.getElementById('root');
const root = createRoot(container);

// 開機順序：initApi → 磁碟鏡像還原（localStorage 被清掉時找回 findings/perf
// 歷史）→ 再 render，讓元件的同步 localStorage 初始化讀到還原後的資料。
initApi()
  .then(() => initStorageMirror(api))
  .catch(() => {})
  .finally(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
