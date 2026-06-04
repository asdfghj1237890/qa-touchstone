// src/qa/PromptPreview.jsx
// ── QA Touchstone — prompt preview host + imperative approval bridge ────────
import './setup.js';

let _host = null;                 // single mounted host callback
const _skip = new Set();          // session-scoped skip keys (memory only)

function skipKey(meta) {
  const d = meta && meta.destination;
  return `${meta && meta.site}|${meta && meta.mode}|${d && d.provider}`;
}

// Imperative API used by qaAiSend. Resolves true=send, false=cancel/deny.
export function requestPromptApproval(promptText, meta) {
  if (_skip.has(skipKey(meta))) return Promise.resolve(true);
  if (!_host) return Promise.resolve(false);   // no UI mounted → deny (CI/non-interactive)
  return new Promise((resolve) => { _host({ promptText, meta, resolve }); });
}

// Test/host helpers.
export function __registerHost(fn) { _host = fn; return () => { if (_host === fn) _host = null; }; }
export function __unregisterHost() { _host = null; }
export function __addSessionSkip(meta) { _skip.add(skipKey(meta)); }
export function __resetPreviewState() { _host = null; _skip.clear(); }

// Real modal arrives in the next task; null stub keeps the App mount import valid.
export function PromptPreviewHost() { return null; }
