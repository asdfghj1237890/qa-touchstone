// src/qa/aiPolicy.js  (full impl in a later task)
let _cached = null;
export function getCachedAiPolicy() { return _cached; }
export function setCachedAiPolicy(p) { _cached = p; }
export async function loadAiPolicy() { return _cached; }
