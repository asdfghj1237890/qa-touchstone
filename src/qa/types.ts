// src/qa/types.ts
// ── QA Touchstone — security-domain 共用型別 ────────────────────────────────
// 安全測試核心（oracles / findings / authz / bola / bolaSetup / ratelimit /
// evidence / securitySuite / securityReport / triage）共用的領域型別。
// 純型別檔：不得含任何 runtime 程式碼（永遠以 `import type` 引用）。

// ── 嚴重度 / 裁決 ────────────────────────────────────────────────────────────
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingSource = 'rule' | 'llm';

/** matrix 引擎：HTTP 狀態分類結果。 */
export type Outcome = 'allowed' | 'denied' | 'other';
/** matrix 引擎：每格的期望。 */
export type Expectation = 'allow' | 'deny' | 'skip';
/** matrix 引擎的格子裁決（expectation 為 skip 時為 null）。 */
export type Verdict = 'pass' | 'fail' | 'vuln' | 'inconclusive';
export type BolaVerdict = 'pass' | 'vuln' | 'unconfirmed' | 'inconclusive';
export type RateLimitVerdict = 'pass' | 'vuln' | 'inconclusive';

// ── HTTP 擷取（transient，不落地）────────────────────────────────────────────
/** 跑測時擷取的 HTTP 回應；body 可能是已解析 JSON、原始字串或缺漏。 */
export type QaResponse = {
  status?: number | null;
  headers?: Record<string, unknown> | null;
  body?: unknown;
  time?: number;
};

// ── Finding ──────────────────────────────────────────────────────────────────
/** 引擎輸出的單筆 finding（BOLA / rate-limit 無 ruleId，僅靠 oracle）。 */
export type Finding = {
  ruleId?: string;
  oracle: string;
  severity: Severity;
  title: string;
  path: string;
  evidence: string;
  source: FindingSource;
};

/** union item 回導 UI 的 per-engine 參照。 */
export type FindingRef = {
  reqId?: string;
  idId?: string;
  testId?: string;
  attackerId?: string;
  ownerId?: string;
  seedName?: string;
};

export type EngineId = 'matrix' | 'conformance' | 'bfla' | 'bola' | 'fuzz' | 'ratelimit';

/** raw 證據的 request 摘要（transient，never persisted）。 */
export type RawRequest = {
  method?: string;
  url?: string;
  path?: string;
  identity?: string;
  headers?: Record<string, unknown>;
};

/** rate-limit raw 統計（burst stats 或 evidence 端摘要兩種形狀並存）。 */
export type RawStats = {
  sent?: number | null;
  completed?: number | null;
  throttleSeen?: unknown;
  [k: string]: unknown;
};

/** union item 上掛的 transient 原始證據（buildEvidenceArtifact 的輸入）。 */
export type RawEvidence = {
  request?: RawRequest | null;
  response?: {
    status?: number | null;
    headers?: Record<string, unknown> | null;
    body?: unknown;
  } | null;
  stats?: RawStats | null;
};

/** 統一 suite run 的 union item（normalizeMatrix / Bola / RateLimit 輸出）。 */
export type UnionFinding = {
  engine: EngineId;
  ruleId: string;
  severity: Severity;
  oracle: string;
  title: string;
  path: string;
  evidence: string;
  method?: string;
  endpoint?: string;
  identityLabel?: string;
  ref: FindingRef;
  raw: RawEvidence | null;
};

/** findings.ts 身分/指紋運算的寬鬆輸入（欄位全 optional，防禦式存取）。 */
export type FindingLike = {
  engine?: string;
  ruleId?: string;
  oracle?: string;
  severity?: Severity;
  title?: string;
  path?: string;
  evidence?: string;
  method?: string;
  endpoint?: string;
  identityLabel?: string;
  ref?: FindingRef | null;
  raw?: RawEvidence | null;
};

// ── findings 生命週期 / 快照 ─────────────────────────────────────────────────
export type FindingStatus = 'open' | 'acknowledged';

/** 單一 fp 的生命週期紀錄（upsertRecord 寫入時必為完整形狀）。 */
export type LifecycleRecord = {
  suppressed: boolean;
  suppressReason: string;
  status: FindingStatus;
  owner: string;
  note: string;
  severityOverride: Severity | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  seenCount: number;
};

/** 舊版 fpVersion 紀錄的隔離區。 */
export type LegacyLifecycle = { fpVersion: unknown; records: Record<string, unknown> };

export type LifecycleState = {
  fpVersion: number;
  records: Record<string, LifecycleRecord>;
  legacy?: LegacyLifecycle | null;
};

/** 讀取端的寬鬆 lifecycle 輸入：只需要 records（且容許部分欄位）。 */
export type LifecycleLike =
  | { records?: Record<string, Partial<LifecycleRecord>> | null }
  | null
  | undefined;

/** 壓縮後的 snapshot item（identity，非 finding）。 */
export type SnapshotItem = {
  fp: string;
  effectiveSeverity: Severity;
  engine: string;
  ruleId: string;
  path: string;
  locationLabel: string;
  title: string;
  evidence: string;
  count: number;
  /** title+evidence 內容漂移雜湊：身分相同（同 fp）但證據變動時可被偵測。 */
  dfp: string;
  /** embedEvidence 之後才存在（opt-in 持久化）。 */
  evidenceArtifact?: EvidenceArtifact;
};

/** 一次掃描的彙整快照；suite run 完成時頁面會再帶上統計欄位（report 讀取）。 */
export type Snapshot = {
  runId: string;
  createdAt: string;
  scopeHash: string;
  items: SnapshotItem[];
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  engines?: EngineRunSummary[];
};

export type SnapshotsState = {
  fpVersion: number;
  baseline: Snapshot | null;
  lastRun: Snapshot | null;
};

/** fp 在 current vs baseline 的出席狀態（永遠重新推導，不持久化）。 */
export type Presence = 'new' | 'carried' | 'resolved';

// ── 統一 suite run ───────────────────────────────────────────────────────────
/** 單一引擎在 suite run 的執行摘要。 */
export type EngineRunSummary = {
  engine: EngineId;
  ran: boolean;
  skipped?: string;
  durationMs: number;
  findingCount: number;
  error: string | null;
};

/** runSuite 的回傳：一次完整 suite run 的紀錄。 */
export type RunRecord = {
  status: 'complete' | 'aborted';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  engines: EngineRunSummary[];
  union: UnionFinding[];
};

// ── matrix（RBAC）engine ─────────────────────────────────────────────────────
/** identity 的 auth 設定（引擎只關心 type；其餘欄位由 UI/executor 解讀）。 */
export type IdentityAuth = { type: string; [k: string]: unknown };

/** matrix / BOLA 共用的測試身分。執行期可能掛 `_` 開頭的 transient 欄位。 */
export type Identity = {
  id: string;
  name?: string;
  auth?: IdentityAuth | null;
  privileged?: boolean;
  [k: string]: unknown;
};

export type Endpoint = {
  reqId: string;
  method: string;
  path: string;
  /** 手動覆寫；未設定時用 classifyEndpoint 啟發式。 */
  privileged?: boolean;
};

/** expect[reqId][identityId] = expectation。 */
export type ExpectMap = Record<string, Record<string, Expectation>>;

export type MatrixState = {
  identities: Identity[];
  endpoints: Endpoint[];
  expect: ExpectMap;
  denySet?: number[];
  oracleConfig?: OracleConfig | null;
  bola?: BolaConfig | null;
  rateLimit?: RateLimitConfig | null;
};

/** localStorage 持久化的 matrix 設定（results 永不落地）。 */
export type MatrixConfig = {
  identities?: Identity[];
  endpoints?: Endpoint[];
  expect?: ExpectMap;
  denySet?: number[];
  oracleConfig?: OracleConfig;
  bola?: BolaConfig;
  rateLimit?: RateLimitConfig;
};

export type MatrixCell = {
  status: number | null;
  outcome: Outcome;
  verdict: Verdict | null;
  timeMs: number;
  request: unknown;
  response: QaResponse | null;
  error: string | null;
  /** oracles 跑完後由頁面掛上。 */
  findings?: Finding[];
};

export type MatrixResults = Record<string, Record<string, MatrixCell>>;

// ── oracles ──────────────────────────────────────────────────────────────────
export type OracleConfig = {
  sensitive?: boolean;
  schema?: boolean;
  llm?: boolean;
  /** rule group → 覆寫嚴重度。 */
  severityOverrides?: Record<string, Severity>;
};

export type ContractEntry = { type: string; required: boolean };
/** normalized path → 期望型別（schema oracle 的 baseline contract）。 */
export type Contract = Record<string, ContractEntry>;

/** 注入式 LLM 送出函式（qaAiSend 的最小介面）。 */
export type AiSendFn = (request: {
  site: string;
  kind: string;
  payload: unknown;
}) => Promise<unknown>;

// ── BOLA / IDOR engine ───────────────────────────────────────────────────────
export type BolaIdLocation =
  | { kind: 'path'; index: number }
  | { kind: 'query'; key: string }
  | { kind: 'body'; path: string };

export type BolaTest = {
  id: string;
  reqId?: string;
  method: string;
  path: string;
  idLocation?: BolaIdLocation | null;
  /** identityId → 該 identity 擁有的物件 id。 */
  idValues?: Record<string, string | number | null | undefined>;
};

/** 跨租戶 preset：identity → id 對照表。 */
export type BolaPreset = {
  id?: string;
  name?: string;
  values?: Record<string, string | number> | null;
};

export type BolaConfig = {
  tests?: BolaTest[];
  identities?: Identity[];
  presets?: BolaPreset[];
  denySet?: number[];
};

/** detectIdLocation 的排序候選。 */
export type BolaIdCandidate = {
  idLocation: BolaIdLocation;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  why: string;
};

export type BolaRequestMeta = { method: string; path: string; identity: string; idValue: string };

export type BolaRefCell = {
  phase: 'ref';
  status: number | null;
  response: QaResponse | null;
  request: BolaRequestMeta | null;
  error: string | null;
};

/** 負向控制（synthetic id probe）的結果。 */
export type BolaControl = {
  status: number | null;
  matched: boolean;
  response: QaResponse | null;
  syntheticId: string;
  error: string | null;
  failed?: boolean;
};

export type BolaAttackCell = {
  phase: 'attack';
  status: number | null;
  matched: boolean;
  verdict: BolaVerdict;
  severity: Severity | null;
  finding: Finding | null;
  controlFailed: boolean;
  response: QaResponse | null;
  request: BolaRequestMeta | null;
  error: string | null;
};

export type BolaTestResult = {
  reference: Record<string, BolaRefCell>;
  attacks: Record<string, Record<string, BolaAttackCell>>;
  control?: BolaControl;
};

export type BolaResults = Record<string, BolaTestResult>;

// ── rate-limit engine ────────────────────────────────────────────────────────
export type RateLimitTest = {
  id: string;
  reqId?: string;
  method: string;
  path: string;
  identityId?: string;
  n?: number | string;
  concurrency?: number | string;
  /** 'sensitive' 時 vuln 升為 high，否則 low。 */
  sensitivity?: string;
};

export type RateLimitConfig = { tests?: RateLimitTest[]; identities?: Identity[] };

export type BurstResponse = {
  status: number | null;
  headers: Record<string, unknown>;
  timeMs: number;
  error: string | null;
};

export type ThrottleSignal = { throttled: boolean; saw429: boolean; headerHit: boolean };

export type ThrottleStrength = 'none' | 'weak' | 'strong';
export type BurstStats = {
  sent: number;
  ok2xx: number;
  c429: number;
  c4xx: number;
  c5xx: number;
  net: number;
  avgMs: number;
  maxMs: number;
  throttled: boolean;
  headerHit: boolean;
  /** 第一個 429 在收集序列中的索引；-1 表示整輪沒有 429。 */
  firstThrottledIndex: number;
  /** 第一個 429 之前成功（2xx）的請求數——量化「漏過多少」。 */
  allowedBeforeThrottle: number;
  /** 節流強度等級：none（全無）/ weak（很晚才擋或只有 header）/ strong（早期就擋）。 */
  strength: ThrottleStrength;
};

/** rate-limit 面板 / suite 每個 test 的結果（findings 來源）。 */
export type RateLimitResult = {
  verdict?: RateLimitVerdict | null;
  severity?: Severity | null;
  finding?: Finding | null;
  stats?: BurstStats | null;
};

// ── schema conformance / fuzz / BFLA suite results ──────────────────────────
export type ConformanceTest = {
  id: string;
  reqId: string;
  method: string;
  path: string;
  schema: unknown;
  identityId?: string;
};

export type ConformanceResult = {
  test: ConformanceTest;
  identity?: Identity | null;
  status: number | null;
  response: QaResponse | null;
  findings: Finding[];
  error: string | null;
};

export type BflaResult = {
  endpoint: Endpoint;
  identity: Identity;
  status: number | null;
  verdict: Verdict;
  severity: Severity | null;
  finding: Finding | null;
  response: QaResponse | null;
  error: string | null;
};

export type FuzzLocation =
  | { kind: 'path'; index: number }
  | { kind: 'query'; key: string }
  | { kind: 'body'; path: string };

export type FuzzSeed = {
  name: string;
  location: FuzzLocation;
  value?: string;
};

export type FuzzSuitePlan = {
  id: string;
  reqId: string;
  method: string;
  path: string;
  seeds: FuzzSeed[];
};

export type FuzzSuiteResult = {
  plan: FuzzSuitePlan;
  ran: number;
  findings: Finding[];
};

// ── evidence artifact（mask-by-default）──────────────────────────────────────
/** 遮罩後的樹：葉子是 type token / redact() 預覽字串。 */
export type ScrubbedNode = string | ScrubbedNode[] | { [k: string]: ScrubbedNode };

export type EvidenceResponse = {
  status: number | null;
  headers: Record<string, string>;
  snippetPath: string;
  snippet: ScrubbedNode | null;
  nonJson: { contentType: string; length: number } | null;
  truncated: boolean;
};

/** 一筆 redacted 證據 artifact（可 opt-in 持久化到 snapshot item）。 */
export type EvidenceArtifact = {
  engine: string;
  request: { method: string; url: string; identity: string; headers: Record<string, string> };
  response: EvidenceResponse | null;
  stats?: { sent: number | null; completed: number | null; throttleSeen: boolean };
};

// ── security report ──────────────────────────────────────────────────────────
export type ReportRedaction = 'redacted' | 'strict' | 'evidence';

export type ReportFinding = {
  fp: string;
  presence: Presence;
  severity: Severity;
  engine: string;
  ruleId: string;
  title: string;
  location: string;
  path: string;
  count: number;
  suppressed: boolean;
  suppressReason: string;
  status: string;
  owner: string;
  note: string;
  evidence?: string;
  evidenceArtifact?: EvidenceArtifact;
};

export type ReportMeta = {
  tool: string;
  schema: string;
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scopeHash: string;
  baseline: { runId: string; scopeHash: string } | null;
  scopeMismatch: boolean;
  redaction: ReportRedaction;
};

export type ReportSummary = {
  total: number;
  bySeverity: Record<Severity, number>;
  new: number;
  carried: number;
  resolved: number;
  newHighCritical: number;
};

export type ReportModel = {
  meta: ReportMeta;
  engines: EngineRunSummary[];
  summary: ReportSummary;
  findings: ReportFinding[];
};

// ── batch AI triage ──────────────────────────────────────────────────────────
/** 跨引擎正規化後的 triage finding（扁平 + 回導 ref）。 */
export type TriageFinding = {
  engine: string;
  severity: Severity;
  oracle: string;
  title: string;
  path: string;
  evidence: string;
  ref?: unknown;
};

export type TriageInputItem = {
  i: number;
  engine: string;
  severity: Severity;
  oracle: string;
  title: string;
  path: string;
  evidence: string;
};

export type TriagePriority = 'p1' | 'p2' | 'p3';

export type TriageItem = {
  title: string;
  category: string;
  priority: TriagePriority;
  rationale: string;
  likelyFalsePositive: boolean;
  findings: TriageFinding[];
};

export type TriageResult = { headline: string; items: TriageItem[] };
