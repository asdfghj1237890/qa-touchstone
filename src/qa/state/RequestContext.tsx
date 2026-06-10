import React from 'react';
import { buildReq, type QaRequest } from '../buildReq';
import { executeRequest } from '../executor';
import { requestOAuthToken } from '../oauth';
import { cookieMatches } from '../cookies';
import { useWorkspace, type QaCookie, type QaAssertion, type OAuthToken } from './WorkspaceContext';
import { COOKIE_TOAST_EVENT } from './ToastHost';

// ── QA Touchstone — Request / send 流程狀態層 ────────────────────────────────
// 從 AppShell 抽出的 API client 核心：目前選取的 request、回應狀態、歷史、
// 衍生值（activeMap / reqCookies）與 send 流程（含 Set-Cookie 捕捉）。
// 行為承諾：與抽出前的 AppShell 完全一致 —— sendSeq 失效規則、RFC 6265
// 的 cookie 排序、per-hop Set-Cookie 範圍判定全部原樣搬移。
// Cookie toast 改為發 COOKIE_TOAST_EVENT 事件（ToastHost 訂閱），
// 解除 send 流程對 toast UI 的耦合。

export interface HistoryEntry {
  id: string;
  method: string;
  path: string;
  status: number;
  time: number;
  at: string;
}

export type RespState = 'empty' | 'loading' | 'done';

export interface RequestState {
  req: QaRequest;
  respState: RespState;
  response: any;
  history: HistoryEntry[];
  dataVersion: number;
  logoFlash: number;
  collectionId: string | null;
  localList: Array<{ key: string; value: string; on?: boolean }>;
  activeMap: Record<string, string>;
  reqCookies: QaCookie[];
  patch: (delta: Partial<QaRequest>) => void;
  selectRequest: (id: string) => void;
  importCollection: (payload: { collection: any; details: any; responses: any }) => string | null;
  send: () => void;
  fetchOAuthToken: (targetReq: QaRequest) => Promise<OAuthToken>;
  addTestsForCase: (method: string, path: string, assertions: QaAssertion[]) => boolean;
  setLocalForReq: (list: Array<{ key: string; value: string; on?: boolean }>) => void;
}

const RequestContext = React.createContext<RequestState | null>(null);

// Best-effort host from an env base URL, for matching cookies to a request.
function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return (url || '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0]; }
}

// Resolve which collection a request id belongs to.
function collectionOf(reqId: string): string | null {
  for (const c of window.QA.COLLECTIONS) {
    for (const f of c.folders) {
      if (f.requests.some((r: any) => r.id === reqId)) return c.id;
    }
  }
  return null;
}

export function RequestProvider({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const { env, vars, localVars, setLocalVars, cookies, setCookies, sslVerify, setTests, oauthTokens, setOauthTokens } = ws;

  const [req, setReq] = React.useState<QaRequest>(() => buildReq(null));
  const [respState, setRespState] = React.useState<RespState>('empty');
  const [response, setResponse] = React.useState<any>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>(() => window.QA.SEED_HISTORY.map((h: HistoryEntry) => ({ ...h })));
  const [dataVersion, setDataVersion] = React.useState(0); // bumps when collections are imported
  const [logoFlash, setLogoFlash] = React.useState(0); // bumps on a successful response
  const sendSeq = React.useRef(0);

  const collectionId = collectionOf(req.id);
  const localList = localVars[req.id] || [];
  const localObj: Record<string, string> = {};
  localList.forEach((v) => { if (v.on !== false && v.key) localObj[v.key] = v.value; });
  const activeMap: Record<string, string> = window.qaVarMap!(vars, env.label, collectionId, localObj);
  const setLocalForReq = (list: Array<{ key: string; value: string; on?: boolean }>) =>
    setLocalVars((m) => ({ ...m, [req.id]: list }));

  // Cookie selection: build the URL the request will actually hit so the
  // matcher can apply RFC 6265's domain/path/Secure rules. env.baseUrl is
  // substituted the same way the live executor does it — otherwise a
  // baseUrl like `{{apiHost}}` would never produce a parseable URL and we
  // would silently send no cookies on requests that the executor still
  // delivers successfully.
  const reqUrlForHost = window.qaSubstitute ? window.qaSubstitute(req.url || '', activeMap) : (req.url || '');
  const reqIsAbsolute = /^https?:\/\//i.test(reqUrlForHost);
  const envBaseSub = window.qaSubstitute ? window.qaSubstitute(String(env.baseUrl || ''), activeMap) : String(env.baseUrl || '');
  const reqUrlForCookie = reqIsAbsolute ? reqUrlForHost : (envBaseSub + reqUrlForHost);
  // RFC 6265 §5.4: cookies with longer paths must precede shorter-path ones
  // in the Cookie header. Many servers read the first occurrence of a name,
  // so without this sort our /admin cookie would lose to / when both match.
  const reqCookies = cookies
    .filter((c) => cookieMatches(c, reqUrlForCookie))
    .sort((a, b) => String(b.path || '/').length - String(a.path || '/').length);

  // Merge generated/structured assertions into a request's tests, matched by method+path.
  const addTestsForCase = (method: string, path: string, assertions: QaAssertion[]): boolean => {
    const all = window.QA.COLLECTIONS.flatMap((c: any) => c.folders.flatMap((f: any) => f.requests));
    const base = (path || '').split('?')[0];
    const match = all.find((r: any) => r.method === method && r.path.split('?')[0] === base);
    if (!match) return false;
    setTests((t) => ({ ...t, [match.id]: [...(t[match.id] || []), ...assertions] }));
    return true;
  };

  const patch = (delta: Partial<QaRequest>) => setReq((r) => ({ ...r, ...delta }));

  const selectRequest = (id: string) => {
    setReq(buildReq(id));
    setRespState('empty');
    setResponse(null);
    sendSeq.current++; // invalidate any in-flight send
  };

  // Merge an imported Postman/OpenAPI collection into the live data set.
  // 回傳第一個 request id（caller 負責路由切換），找不到回 null。
  const importCollection = ({ collection, details, responses }: { collection: any; details: any; responses: any }): string | null => {
    Object.assign(window.QA.REQUEST_DETAILS, details);
    Object.assign(window.QA.RESPONSES, responses);
    window.QA.COLLECTIONS.push(collection);
    setDataVersion((v) => v + 1);
    const first = collection.folders.flatMap((f: any) => f.requests)[0];
    if (first) { selectRequest(first.id); return first.id; }
    return null;
  };

  const showCookieToast = (detail: { name: string; domain: string }) => {
    try { window.dispatchEvent(new CustomEvent(COOKIE_TOAST_EVENT, { detail })); } catch { /* 非瀏覽器環境 */ }
  };

  const send = () => {
    if (respState === 'loading') return;
    const seq = ++sendSeq.current;
    const sentReq = req;
    setRespState('loading');
    setResponse(null);
    executeRequest(sentReq, env, activeMap, { cookies: reqCookies, sslVerify, oauthToken: oauthTokens[sentReq.id] })
      .then((resp: any) => {
        if (seq !== sendSeq.current) return; // a newer send / selection superseded this
        setResponse(resp);
        setRespState('done');
        const now = new Date();
        const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const pathWithParams = sentReq.url + (sentReq.params.filter((p) => p.on && p.key).length
          ? '?' + sentReq.params.filter((p) => p.on && p.key).map((p) => `${p.key}=${p.value}`).join('&') : '');
        setHistory((h) => [{ id: sentReq.id, method: sentReq.method, path: pathWithParams, status: resp.status, time: resp.time, at }, ...h].slice(0, 12));
        if (resp.status >= 200 && resp.status < 400) setLogoFlash(Date.now());

        // Capture Set-Cookie into the jar (auto-managed, like a browser).
        // Prefer the per-hop `setCookies` array from Rust (each entry carries
        // the URL of the response that actually set it) so a redirect chain
        // across hosts scopes each cookie to the correct host/path. Fall
        // back to the headers['set-cookie'] string when running against the
        // canned-response dev fallback that has no per-hop metadata.
        const perHop = Array.isArray(resp.setCookies) ? resp.setCookies : null;
        const sc = resp.headers && (resp.headers['set-cookie'] || resp.headers['Set-Cookie']);
        if (perHop && perHop.length) {
          let firstCk: any = null;
          perHop.forEach(({ url, line }: { url?: string; line?: string }) => {
            if (!line) return;
            let hopHost = '', hopPath = '/';
            try { const u = new URL(url || ''); hopHost = u.hostname; hopPath = u.pathname || '/'; }
            catch { hopHost = hostOf(url || ''); }
            const ck = window.qaParseSetCookie!(line, hopHost, hopPath);
            if (!ck) return;
            firstCk = firstCk || ck;
            setCookies((jar) => (window as any).qaMergeCookie(jar, ck));
          });
          if (firstCk) showCookieToast({ name: firstCk.name, domain: firstCk.domain || '' });
        } else if (sc) {
          // Legacy / canned-response path: no per-hop metadata, derive a
          // single scope URL the way executor builds the actual request.
          let fullSentUrl = resp.finalUrl || '';
          if (!fullSentUrl) {
            const sentUrlSub = window.qaSubstitute ? window.qaSubstitute(sentReq.url || '', activeMap) : (sentReq.url || '');
            const sentIsAbsolute = /^https?:\/\//i.test(sentUrlSub);
            const envBaseSubCap = window.qaSubstitute ? window.qaSubstitute(String(env.baseUrl || ''), activeMap) : String(env.baseUrl || '');
            fullSentUrl = sentIsAbsolute ? sentUrlSub : (envBaseSubCap + sentUrlSub);
          }
          let sentHost = '', sentPath = '/';
          try { const u = new URL(fullSentUrl); sentHost = u.hostname; sentPath = u.pathname || '/'; }
          catch { sentHost = hostOf(fullSentUrl); }
          const scList = Array.isArray(sc) ? sc : String(sc).split('\n').map((s: string) => s.trim()).filter(Boolean);
          let firstCk: any = null;
          scList.forEach((line: string) => {
            const ck = window.qaParseSetCookie!(line, sentHost, sentPath);
            if (!ck) return;
            firstCk = firstCk || ck;
            setCookies((jar) => (window as any).qaMergeCookie(jar, ck));
          });
          if (firstCk) showCookieToast({ name: firstCk.name, domain: firstCk.domain || sentHost });
        }
      });
  };

  // OAuth 2.0 — obtain a real token from the configured token endpoint. In
  // Tauri, route through the Rust HTTP backend to avoid browser CORS limits;
  // in browser/dev fallback, use fetch directly.
  const fetchOAuthToken = async (targetReq: QaRequest): Promise<OAuthToken> => {
    const token = await requestOAuthToken(targetReq.auth.oauth2, activeMap, { sslVerify, executeRequest });
    setOauthTokens((t) => ({ ...t, [targetReq.id]: token }));
    return token;
  };

  const value: RequestState = {
    req, respState, response, history, dataVersion, logoFlash,
    collectionId, localList, activeMap, reqCookies,
    patch, selectRequest, importCollection, send, fetchOAuthToken,
    addTestsForCase, setLocalForReq,
  };

  return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
}

export function useRequest(): RequestState {
  const ctx = React.useContext(RequestContext);
  if (!ctx) throw new Error('useRequest must be used inside <RequestProvider>');
  return ctx;
}
