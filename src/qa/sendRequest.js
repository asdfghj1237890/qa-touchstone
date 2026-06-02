// ── QA Touchstone — run a saved request for real (shared by Runner/Monitors) ─
// Builds the same request shape the API client sends, resolves variables,
// matches cookies, and calls executeRequest. Outside Tauri, executeRequest
// attempts browser live fetch in dev and falls back to canned responses; tests
// stay deterministic on the canned path.
import './setup.js';
import { executeRequest } from './executor.js';
import { buildReq } from './buildReq.js';
import { cookieMatches } from './cookies.js';

export async function qaRunSavedRequest(reqMeta, ctx = {}) {
  // `localVars` is the request-scoped override layer the API client applies via
  // its Options tab. Batch callers (Runner/Monitors) typically have none, so it
  // defaults to {} — but the interface exposes it rather than silently fixing it.
  const { env = { label: 'None', baseUrl: '' }, vars, cookies = [], sslVerify = true, oauthToken, collectionId, localVars = {} } = ctx;
  const req = buildReq(reqMeta.id);
  const map = window.qaVarMap(vars || window.QA.VARIABLES, env.label, collectionId, localVars);
  // Resolve the URL the same way the live executor does, for cookie matching.
  const urlSub = window.qaSubstitute(req.url || '', map);
  const isAbsolute = /^https?:\/\//i.test(urlSub);
  const fullUrl = isAbsolute ? urlSub : (window.qaSubstitute(env.baseUrl || '', map) + urlSub);
  const reqCookies = (cookies || [])
    .filter((c) => cookieMatches(c, fullUrl))
    .sort((a, b) => (b.path || '/').length - (a.path || '/').length);
  return executeRequest(req, env, map, { cookies: reqCookies, sslVerify, oauthToken });
}
