import './processShim';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './qa/qa.css';
import App from './App';
import api from './api';
import { initStorageMirror } from './qa/storage';

const container = document.getElementById('root');
if (!container) throw new Error('#root container not found');
const root = createRoot(container);

// 開機只等磁碟鏡像還原（localStorage 被清掉時找回 findings/perf 歷史），
// 讓元件的同步 localStorage 初始化讀到還原後的資料，再 render。
initStorageMirror(api)
  .catch(() => {})
  .finally(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
