// ── QA Touchstone — run a saved request for real (shared by Runner/Monitors) ─
// Builds the same request shape the API client sends, resolves variables,
// matches cookies, and calls executeRequest. Outside Tauri, executeRequest
// attempts browser live fetch in dev and falls back to canned responses; tests
// stay deterministic on the canned path.
import './setup';
import { executeRequest } from './executor';
import { buildReq } from './buildReq';
import { cookieMatches } from './cookies';
import type { QaAuth, QaRequest } from './buildReq';
import type { StoredCookie } from './cookies';

/** Cookie jar 內的一筆 cookie（比對用欄位 + 送出時的 name/value）。 */
export interface QaRunCookie extends StoredCookie {
  name: string;
  value?: string;
}

/** qaRunSavedRequest 的 ctx（呼叫端皆可省略，預設值與 API client 一致）。 */
export interface QaRunContext {
  env?: { label?: string; baseUrl?: string };
  vars?: any;
  cookies?: QaRunCookie[];
  sslVerify?: boolean;
  oauthToken?: { token: string; type?: string } | null;
  collectionId?: string | null;
  localVars?: Record<string, string>;
  authOverride?: QaAuth | null;
  mutate?: (req: QaRequest) => QaRequest;
}

export async function qaRunSavedRequest(reqMeta: { id: string }, ctx: QaRunContext = {}) {
  // `localVars` is the request-scoped override layer the API client applies via
  // its Options tab. Batch callers (Runner/Monitors) typically have none, so it
  // defaults to {} — but the interface exposes it rather than silently fixing it.
  const {
    env = { label: 'None', baseUrl: '' },
    vars,
    cookies = [],
    sslVerify = true,
    oauthToken,
    collectionId,
    localVars = {},
    authOverride,
    mutate,
  } = ctx;
  let req = buildReq(reqMeta.id);
  if (authOverride) req.auth = authOverride;
  // Optional last-mile rewrite (e.g. BOLA id substitution) before var-substitution.
  if (mutate) req = mutate(req);
  const map = window.qaVarMap!(vars || window.QA.VARIABLES, env.label, collectionId, localVars);
  // Resolve the URL the same way the live executor does, for cookie matching.
  const urlSub = window.qaSubstitute!(req.url || '', map);
  const isAbsolute = /^https?:\/\//i.test(urlSub);
  const fullUrl = isAbsolute ? urlSub : window.qaSubstitute!(env.baseUrl || '', map) + urlSub;
  const reqCookies = (cookies || [])
    .filter((c) => cookieMatches(c, fullUrl))
    .sort((a, b) => (b.path || '/').length - (a.path || '/').length);
  return executeRequest(req, env, map, { cookies: reqCookies, sslVerify, oauthToken });
}
