import React from 'react';

// ── QA Touchstone — Workspace 狀態層 ─────────────────────────────────────────
// 從 AppShell 抽出的「工作區」狀態：environment、變數、cookie jar、SSL 開關、
// 每個 request 的測試斷言與 OAuth token。AppShell 原本 22+ 個 useState 的
// 第一刀。直接 route 子頁改用 useWorkspace()；有「直接渲染測試」鎖定 props
// 介面的元件（SecurityPage / PerfTest / MonitorsPage / ResponsePanel / 各
// Panel）仍由 AppShell 從這裡讀值後以 props 餵入，介面不變。

export interface QaEnv {
  label: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface QaCookie {
  name: string;
  value?: string;
  domain?: string;
  path?: string;
  [key: string]: unknown;
}

export interface QaLocalVar {
  key: string;
  value: string;
  on?: boolean;
}

export interface OAuthToken {
  token: string;
  type?: string;
  expiresAt?: number;
  scope?: string;
}

/** 單筆測試斷言（engine.js 的 assertion 物件；型別收斂前先保持鬆散）。 */
export type QaAssertion = Record<string, unknown>;

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface WorkspaceState {
  env: QaEnv;
  setEnv: Setter<QaEnv>;
  vars: any; // window.QA.VARIABLES 的深拷貝（global/collection/environment 槽）
  setVars: Setter<any>;
  localVars: Record<string, QaLocalVar[]>;
  setLocalVars: Setter<Record<string, QaLocalVar[]>>;
  cookies: QaCookie[];
  setCookies: Setter<QaCookie[]>;
  sslVerify: boolean;
  setSslVerify: Setter<boolean>;
  tests: Record<string, QaAssertion[]>;
  setTests: Setter<Record<string, QaAssertion[]>>;
  oauthTokens: Record<string, OAuthToken>;
  setOauthTokens: Setter<Record<string, OAuthToken>>;
}

const WorkspaceContext = React.createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [env, setEnv] = React.useState<QaEnv>(window.QA.ENVIRONMENTS[0]);
  const [vars, setVars] = React.useState<any>(() => JSON.parse(JSON.stringify(window.QA.VARIABLES)));
  const [localVars, setLocalVars] = React.useState<Record<string, QaLocalVar[]>>({});
  const [cookies, setCookies] = React.useState<QaCookie[]>(() => window.QA.COOKIES.map((c: QaCookie) => ({ ...c })));
  const [sslVerify, setSslVerify] = React.useState(true);
  const [tests, setTests] = React.useState<Record<string, QaAssertion[]>>({});
  const [oauthTokens, setOauthTokens] = React.useState<Record<string, OAuthToken>>({});

  const value = React.useMemo<WorkspaceState>(() => ({
    env, setEnv,
    vars, setVars,
    localVars, setLocalVars,
    cookies, setCookies,
    sslVerify, setSslVerify,
    tests, setTests,
    oauthTokens, setOauthTokens,
  }), [env, vars, localVars, cookies, sslVerify, tests, oauthTokens]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return ctx;
}
