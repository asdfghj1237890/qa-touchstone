import React from 'react';
import './setup';
import { Icon, MethodBadge, loadLlmCfg } from './components';
import {
  loadPrivacyCfg,
  resolvePolicy,
  classifyDestination,
  assertEgressAllowed,
} from './aiPrivacy';
import { getCachedAiPolicy } from './aiPolicy';
import { AuthEditor } from './AuthEditor';
import { useI18n } from './useI18n';
import type { I18nValue } from './i18nContext';
import { qaRunSavedRequest } from './sendRequest';
import type { QaRunCookie } from './sendRequest';
import { executeRequest } from './executor';
import { requestOAuthToken } from './oauth';
import {
  anonIdentity,
  withDefaults,
  setColumn,
  setRow,
  runMatrix,
  summarize,
  loadMatrixConfig,
  saveMatrixConfig,
  DEFAULT_DENY_SET,
  endpointPrivileged,
} from './authz';
import {
  runOracles,
  inferContract,
  summarizeFindings,
  scanSensitiveLLM,
  worstSeverity,
  SEVERITY_ORDER,
  DEFAULT_ORACLE_CONFIG,
  walkJson,
} from './oracles';
import { conformanceFindings } from './schemaConformance';
import { BolaPanel } from './BolaPanel';
import { runBola, applyIdLocation } from './bola';
import type { BolaRunner } from './bola';
import { bflaPlan, runBfla } from './bfla';
import type { BflaRunner } from './bfla';
import { FUZZ_PAYLOADS, runFuzz } from './fuzz';
import { RateLimitPanel } from './RateLimitPanel';
import type { RateLimitResultsMap } from './RateLimitPanel';
import { runBurst, detectThrottleSignal, classifyRateLimit, rlFindingFor } from './ratelimit';
import { TriagePanel } from './TriagePanel';
import { BatchReviewPanel } from './BatchReviewPanel';
import { CoveragePanel } from './CoveragePanel';
import { FindingsPanel } from './FindingsPanel';
import { SuiteRunBar } from './SuiteRunBar';
import type { ReportFormat, SuiteUiState } from './SuiteRunBar';
import { runSuite, normalizeMatrix } from './securitySuite';
import {
  loadLifecycle,
  loadSnapshots,
  saveSnapshots,
  snapshotOf,
  scopeHashOf,
  recordRun,
  pinBaseline,
} from './findings';
import {
  buildReport,
  reportToJson,
  reportToHtml,
  reportToJUnit,
  reportToSarif,
} from './securityReport';
import { buildEvidenceMap, embedEvidence } from './evidence';
import { buildCoverageModel } from './coverage';
import { downloadFile } from './download';
import { buildReq } from './buildReq';
import type { QaRequest } from './buildReq';
import type { QaCookie, QaEnv } from './state/WorkspaceContext';
import type {
  BolaAttackCell,
  BolaConfig,
  BflaResult,
  ConformanceResult,
  ConformanceTest,
  BolaRefCell,
  BolaResults,
  Contract,
  EvidenceArtifact,
  Expectation,
  Finding,
  FuzzSeed,
  FuzzSuitePlan,
  FuzzSuiteResult,
  Identity,
  MatrixCell,
  MatrixResults,
  RateLimitConfig,
  RateLimitTest,
  ReportRedaction,
  Snapshot,
  UnionFinding,
  Verdict,
} from './types';
import type { ReviewSource } from './batchReview';

const { useState: useS, useEffect: useE, useMemo, useRef, useCallback } = React;
const EXPECTS: Expectation[] = ['allow', 'deny', 'skip'];
const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'security.verdict.pass',
  fail: 'security.verdict.fail',
  vuln: 'security.verdict.vuln',
  inconclusive: 'security.verdict.inconclusive',
};

/** Security 頁的 identity：auth 必為完整 auth 形狀（blankAuth），_oauthToken 為 transient。 */
type SecIdentity = { auth: any; _oauthToken?: any } & Identity;

/** runner 掛在 cell 上的 redacted request 摘要（drawer 顯示用）。 */
type CellRequestMeta = { method: string; path: string; identity: string; authType: string };

/** endpoint picker 的一列。 */
type ReqOption = { reqId: string; method: string; path: string; name: string; folder: string };

// Build the EMPTY auth shape AuthEditor expects (mirrors buildReq.EMPTY_REQ.auth).
function blankAuth() {
  return {
    type: 'none',
    bearer: '',
    apiKey: { key: '', value: '', placement: 'header' },
    basic: { user: '', pass: '' },
    aws: { profile: '', service: '', region: '' },
    oauth2: {
      grant: 'client_credentials',
      authUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      code: '',
      redirectUri: '',
      username: '',
      password: '',
    },
  };
}

let idSeq = 1;
function newIdentity(): SecIdentity {
  return { id: `id_${Date.now()}_${idSeq++}`, name: '', auth: blankAuth() };
}

// All saved requests, folder-grouped, for the endpoint picker.
function allRequests(): ReqOption[] {
  return (window.QA.COLLECTIONS || []).flatMap((c: any) =>
    (c.folders || []).flatMap((f: any) =>
      (f.requests || []).map((r: any) => ({
        reqId: r.id,
        method: r.method,
        path: r.path,
        name: r.name,
        folder: f.name,
      }))
    )
  );
}

interface IdentityEditorProps {
  identity: SecIdentity;
  onChange: (identity: SecIdentity) => void;
  onClose: () => void;
  env: QaEnv;
  vars: any;
  sslVerify: boolean;
}

function IdentityEditor({
  identity,
  onChange,
  onClose,
  env,
  vars,
  sslVerify,
}: IdentityEditorProps) {
  const { t } = useI18n();
  // AuthEditor reads req.auth and calls patch({auth}); adapt to our identity shape.
  const fakeReq = { auth: identity.auth } as QaRequest;
  const patch = ({ auth }: { auth?: any }) => onChange({ ...identity, auth });
  const fetchOAuth = async () => {
    const map = window.qaVarMap!(vars || window.QA.VARIABLES, env.label);
    // Shared with the API client: Tauri backend vs fetch. Failures propagate so
    // AuthEditor's OAuth2Editor shows them.
    const token = await requestOAuthToken(identity.auth.oauth2, map, { sslVerify, executeRequest });
    if (token) onChange({ ...identity, _oauthToken: token });
  };
  return (
    <div className="qa-sec-idedit">
      <input
        className="qa-inp"
        placeholder={t('security.identityName')}
        value={identity.name}
        onChange={(e) => onChange({ ...identity, name: e.target.value })}
      />
      <label className="qa-sec-privchk">
        <input
          type="checkbox"
          checked={!!identity.privileged}
          onChange={(e) => onChange({ ...identity, privileged: e.target.checked })}
        />
        {t('security.priv.identity')}
      </label>
      <span className="qa-meta">{t('security.priv.identityHint')}</span>
      <AuthEditor
        req={fakeReq}
        patch={patch}
        oauthToken={identity._oauthToken}
        onFetchOAuth={fetchOAuth}
      />
      <button className="qa-link" onClick={onClose}>
        <Icon name="check" size={13} /> {t('common.done') || 'Done'}
      </button>
    </div>
  );
}

interface SecEndpoint {
  reqId: string;
  method: string;
  path: string;
  privileged?: boolean;
}

interface EndpointPickerProps {
  existing: SecEndpoint[];
  onAdd: (ep: SecEndpoint) => void;
  onClose: () => void;
}

function EndpointPicker({ existing, onAdd, onClose }: EndpointPickerProps) {
  const { t } = useI18n();
  const reqs = allRequests();
  const have = new Set(existing.map((e) => e.reqId));
  return (
    <div className="qa-sec-picker">
      <div className="qa-sec-picker-head">
        {t('security.pickEndpoints')}
        <button className="qa-iconbtn" onClick={onClose}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="qa-sec-picker-list">
        {reqs.length === 0 && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}
        {reqs.map((r) => (
          <button
            key={r.reqId}
            className="qa-sec-picker-row"
            disabled={have.has(r.reqId)}
            onClick={() => onAdd({ reqId: r.reqId, method: r.method, path: r.path })}
          >
            <MethodBadge method={r.method} size="sm" /> <code>{r.path}</code>
            {have.has(r.reqId) && <Icon name="check" size={12} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function responseSchemaFor(reqId: string): unknown | null {
  const det = (window.QA.REQUEST_DETAILS && window.QA.REQUEST_DETAILS[reqId]) || {};
  if (det.responseSchema) return det.responseSchema;
  const schemas = det.responseSchemas || {};
  for (const code of ['200', '201', '202', '204', 'default']) {
    if (schemas[code]) return schemas[code];
  }
  const first2xx = Object.keys(schemas)
    .sort()
    .find((code) => /^2\d\d$/.test(code));
  return first2xx ? schemas[first2xx] : null;
}

function preferredIdentity(
  ep: SecEndpoint,
  identities: SecIdentity[],
  expect: Record<string, Record<string, Expectation>>
): SecIdentity | null {
  const row = expect[ep.reqId] || {};
  return (
    identities.find((id) => row[id.id] === 'allow') ||
    identities.find((id) => id.privileged) ||
    identities.find((id) => id.id !== 'anon') ||
    identities[0] ||
    null
  );
}

function buildConformanceTests(
  endpoints: SecEndpoint[],
  identities: SecIdentity[],
  expect: Record<string, Record<string, Expectation>>
): ConformanceTest[] {
  return endpoints
    .map((ep) => {
      const schema = responseSchemaFor(ep.reqId);
      if (!schema) return null;
      const identity = preferredIdentity(ep, identities, expect);
      return {
        id: `schema-${ep.reqId}`,
        reqId: ep.reqId,
        method: ep.method,
        path: ep.path,
        schema,
        identityId: identity ? identity.id : undefined,
      };
    })
    .filter(Boolean) as ConformanceTest[];
}

function scalarBodySeeds(req: QaRequest, limit: number): FuzzSeed[] {
  if (!req.body || req.bodyMode !== 'json') return [];
  try {
    const body = JSON.parse(req.body);
    const seeds: FuzzSeed[] = [];
    walkJson(body, (path, key, value) => {
      if (seeds.length >= limit) return;
      if (value == null || typeof value === 'object') return;
      const name = path || key || `body-${seeds.length + 1}`;
      seeds.push({
        name: `body.${name}`,
        location: { kind: 'body', path: name },
        value: String(value),
      });
    });
    return seeds;
  } catch {
    return [];
  }
}

function pathSeeds(req: QaRequest, limit: number): FuzzSeed[] {
  const url = String(req.url || '').split('?')[0];
  if (!url || /^https?:\/\//i.test(url)) return [];
  const seeds: FuzzSeed[] = [];
  const segs = url.split('/').filter(Boolean);
  segs.forEach((seg, index) => {
    if (seeds.length >= limit) return;
    const isParam = /^\{[^}]+\}$/.test(seg) || /^:[A-Za-z0-9_]+$/.test(seg);
    const looksLikeId = /^\d+$/.test(seg) || /^[0-9a-f]{8,}/i.test(seg);
    if (!isParam && !looksLikeId) return;
    seeds.push({
      name: `path.${seg.replace(/[{}:]/g, '') || index}`,
      location: { kind: 'path', index },
      value: seg,
    });
  });
  return seeds;
}

function fuzzSeedsForRequest(reqId: string): FuzzSeed[] {
  const req = buildReq(reqId);
  const querySeeds: FuzzSeed[] = (req.params || [])
    .filter((p) => p.on !== false && p.key)
    .slice(0, 2)
    .map((p) => ({
      name: `query.${p.key}`,
      location: { kind: 'query', key: p.key },
      value: p.value,
    }));
  const seeds = [...querySeeds, ...pathSeeds(req, 2), ...scalarBodySeeds(req, 3)];
  const seen = new Set<string>();
  return seeds
    .filter((seed) => {
      const key = `${seed.location.kind}:${JSON.stringify(seed.location)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function buildFuzzPlans(endpoints: SecEndpoint[]): FuzzSuitePlan[] {
  return endpoints
    .map((ep) => {
      const seeds = fuzzSeedsForRequest(ep.reqId);
      if (!seeds.length) return null;
      return {
        id: `fuzz-${ep.reqId}`,
        reqId: ep.reqId,
        method: ep.method,
        path: ep.path,
        seeds,
      };
    })
    .filter(Boolean) as FuzzSuitePlan[];
}

export interface SecurityPageProps {
  env?: QaEnv;
  vars?: any;
  cookies?: QaCookie[];
  sslVerify?: boolean;
}

function SecurityPage({
  env = { label: 'None', baseUrl: '' },
  vars,
  cookies = [],
  sslVerify = true,
}: SecurityPageProps) {
  const { t } = useI18n();
  const [identities, setIdentities] = useS<SecIdentity[]>(() => {
    const cfg = loadMatrixConfig();
    return (
      cfg && cfg.identities && cfg.identities.length ? cfg.identities : [anonIdentity()]
    ) as SecIdentity[];
  });
  const [endpoints, setEndpoints] = useS<SecEndpoint[]>(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.endpoints) || [];
  });
  const [expect, setExpect] = useS(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.expect) || {};
  });
  const [denySet, setDenySet] = useS<number[]>(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.denySet) || DEFAULT_DENY_SET;
  });
  const [results, setResults] = useS<MatrixResults>({});
  const [running, setRunning] = useS(false);
  const [editId, setEditId] = useS<string | null>(null);
  const [picking, setPicking] = useS(false);
  const [drawer, setDrawer] = useS<{ reqId: string; idId: string } | null>(null); // { reqId, idId }
  const abortRef = useRef<AbortController | null>(null);
  const baselinesRef = useRef<Record<string, Contract>>({}); // { [reqId]: contract } — transient, per run
  const [oracleConfig] = useS(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.oracleConfig) || DEFAULT_ORACLE_CONFIG;
  });
  const [aiScan, setAiScan] = useS<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const [mode, setMode] = useS('matrix');
  const [bola, setBola] = useS<BolaConfig>(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.bola) || { tests: [] };
  });
  const [bolaResults, setBolaResults] = useS<BolaResults>({});
  const [rateLimit, setRateLimit] = useS<RateLimitConfig>(() => {
    const cfg = loadMatrixConfig();
    return (cfg && cfg.rateLimit) || { tests: [] };
  });
  const [rlResults, setRlResults] = useS<RateLimitResultsMap>({});
  const [snapshots, setSnapshots] = useS(() => loadSnapshots());
  const [suite, setSuite] = useS<SuiteUiState>({
    running: false,
    engine: null,
    done: 0,
    total: 0,
    lastRecord: null,
  });
  const suiteAbortRef = useRef<AbortController | null>(null);
  const evidenceMapRef = useRef<Map<string, EvidenceArtifact> | null>(null);
  const [evidenceReady, setEvidenceReady] = useS(false);
  const [suiteUnion, setSuiteUnion] = useS<UnionFinding[]>([]);

  // Normalize expectations to fill defaults for the current identities×endpoints.
  const state = useMemo(
    () =>
      withDefaults({
        identities,
        endpoints,
        expect,
        denySet: denySet.length ? denySet : DEFAULT_DENY_SET,
        oracleConfig,
        bola,
        rateLimit,
      }),
    [identities, endpoints, expect, denySet, oracleConfig, bola, rateLimit]
  );
  const conformanceTests = useMemo(
    () => buildConformanceTests(endpoints, identities, state.expect),
    [endpoints, identities, state.expect]
  );
  const fuzzPlans = useMemo(() => buildFuzzPlans(endpoints), [endpoints]);

  // Persist config (not results) whenever it changes.
  useE(() => {
    saveMatrixConfig(state);
  }, [state]);

  const summary = useMemo(() => summarize(results), [results]);
  const privCount = useMemo(
    () => endpoints.filter((e) => endpointPrivileged(e).privileged).length,
    [endpoints]
  );
  const findSummary = useMemo(() => summarizeFindings(results), [results]);
  const allFindings = useMemo(() => {
    const out: Array<Finding & { endpoint: string; method: string; identity: string }> = [];
    for (const ep of endpoints) {
      for (const id of identities) {
        const row = results[ep.reqId];
        const cell = row && row[id.id];
        for (const f of (cell && cell.findings) || []) {
          out.push({
            ...f,
            endpoint: ep.path,
            method: ep.method,
            identity: id.id === 'anon' ? t('security.anon') : id.name || id.id,
          });
        }
      }
    }
    return out.sort(
      (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)
    );
  }, [results, endpoints, identities, t]);

  // Cross-engine triage union. Matrix findings are normalized here (with a
  // {reqId, idId} back-ref); BOLA/rate-limit panels report their own normalized
  // lists upward via onFindings. Stable callbacks so the child effects don't loop.
  const [bolaFindings, setBolaFindings] = useS<UnionFinding[]>([]);
  const [rlFindings, setRlFindings] = useS<UnionFinding[]>([]);
  const onBolaFindings = useCallback(
    (list: UnionFinding[]) => setBolaFindings(list),
    [setBolaFindings]
  );
  const onRlFindings = useCallback((list: UnionFinding[]) => setRlFindings(list), [setRlFindings]);
  const matrixNormalized = useMemo(
    () => normalizeMatrix(results, endpoints, identities),
    [results, endpoints, identities]
  );
  const triageUnion = useMemo(
    () => (suiteUnion.length ? suiteUnion : [...matrixNormalized, ...bolaFindings, ...rlFindings]),
    [suiteUnion, matrixNormalized, bolaFindings, rlFindings]
  );
  const reviewSources = useMemo<ReviewSource[]>(() => {
    const out: ReviewSource[] = [];
    for (const ep of endpoints) {
      for (const id of identities) {
        const row = results[ep.reqId];
        const cell = row && row[id.id];
        if (!cell || !cell.response) continue;
        const expectRow = state.expect[ep.reqId];
        const expectation = expectRow && expectRow[id.id];
        out.push({
          engine: 'matrix',
          method: ep.method,
          path: ep.path,
          identity: id.id === 'anon' ? 'anon' : id.name || id.id,
          status: cell.status,
          statusText: (cell.response as any).statusText || '',
          time: cell.timeMs || cell.response.time || 0,
          verdict: cell.verdict,
          expected: [
            expectation ? `matrix expectation: ${expectation}` : '',
            cell.verdict ? `matrix verdict: ${cell.verdict}` : '',
          ].filter(Boolean),
          body: cell.response.body,
          headers: cell.response.headers,
        });
      }
    }
    return out;
  }, [results, endpoints, identities, state.expect]);
  const coverageModel = useMemo(
    () =>
      buildCoverageModel({
        requests: allRequests(),
        endpoints,
        identities,
        expect: state.expect,
        conformanceTests,
        bolaTests: bola.tests || [],
        rateLimitTests: rateLimit.tests || [],
        fuzzPlans,
      }),
    [endpoints, identities, state.expect, conformanceTests, bola, rateLimit, fuzzPlans]
  );

  const scopeDescriptor = useMemo(
    () => ({
      endpoints: endpoints.map((e) => e.reqId).sort(),
      identities: identities.map((i) => i.id).sort(),
      conformance: conformanceTests.map((x) => x.reqId).sort(),
      bfla: endpoints
        .filter((e) => endpointPrivileged(e).privileged)
        .map((e) => e.reqId)
        .sort(),
      bola: (bola.tests || []).map((x) => x.id).sort(),
      fuzz: fuzzPlans.map((x) => `${x.reqId}:${x.seeds.length}`).sort(),
      rl: (rateLimit.tests || []).map((x) => x.id).sort(),
    }),
    [endpoints, identities, conformanceTests, bola, fuzzPlans, rateLimit]
  );
  const scopeHash = useMemo(() => scopeHashOf(scopeDescriptor), [scopeDescriptor]);
  const scopeMismatch = !!(
    snapshots.baseline &&
    snapshots.baseline.scopeHash &&
    snapshots.baseline.scopeHash !== scopeHash
  );
  useE(() => {
    setSuiteUnion([]);
  }, [scopeHash]);

  const goToEngine = useCallback(
    (engine: string) => {
      if (engine === 'matrix' || engine === 'bola' || engine === 'ratelimit') setMode(engine);
      else setMode('findings');
    },
    [setMode]
  );

  const cycleCell = (reqId: string, idId: string) => {
    const cur = state.expect[reqId]?.[idId];
    const idx = cur ? EXPECTS.indexOf(cur) : -1;
    const next = EXPECTS[(idx + 1) % EXPECTS.length] ?? 'allow';
    setExpect((e) => ({ ...e, [reqId]: { ...(e[reqId] || state.expect[reqId]), [idId]: next } }));
  };
  const bulkCol = (idId: string, val: Expectation) => setExpect(setColumn(state, idId, val).expect);
  const bulkRow = (reqId: string, val: Expectation) => setExpect(setRow(state, reqId, val).expect);

  const addIdentity = () => {
    const id = newIdentity();
    setIdentities((xs) => [...xs, id]);
    setEditId(id.id);
  };
  const removeIdentity = (id: string) => {
    if (id === 'anon') return;
    setIdentities((xs) => xs.filter((x) => x.id !== id));
    // Drop this identity's cells so the summary chips don't keep counting them.
    setResults((r) =>
      Object.fromEntries(
        Object.entries(r).map(([rid, row]) => {
          const { [id]: _gone, ...rest } = row;
          return [rid, rest] as const;
        })
      )
    );
  };
  const removeEndpoint = (reqId: string) => {
    setEndpoints((xs) => xs.filter((x) => x.reqId !== reqId));
    setResults((r) => {
      const n = { ...r };
      delete n[reqId];
      return n;
    });
  };
  const togglePriv = (reqId: string, val: boolean) =>
    setEndpoints((xs) => xs.map((e) => (e.reqId === reqId ? { ...e, privileged: val } : e)));

  const runner = (ep: SecEndpoint, identity: Identity) =>
    qaRunSavedRequest(
      { id: ep.reqId },
      {
        env,
        vars,
        cookies: cookies as QaRunCookie[],
        sslVerify,
        authOverride: identity.auth as any,
        oauthToken: identity._oauthToken as any,
      }
    ).then((response) => ({
      // Redacted summary of what was sent — drives the cell drawer (and is ready
      // for a later CI export to serialize) without storing any secret.
      request: {
        method: ep.method,
        path: ep.path,
        identity: identity.id === 'anon' ? 'anon' : identity.name || identity.id,
        authType: identity.auth!.type,
      },
      response,
    }));

  // Compute a matrix cell's findings using the streaming-baseline + oracles, into `baselines`.
  const matrixCellFindings = (
    reqId: string,
    cell: MatrixCell,
    baselines: Record<string, Contract>
  ) => {
    const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
    if (is2xx && cell.response && !baselines[reqId])
      baselines[reqId] = inferContract(cell.response.body);
    return runOracles(cell, { baseline: baselines[reqId], config: oracleConfig });
  };

  const run = async (rowReqId: string | null = null) => {
    const target = rowReqId
      ? { ...state, endpoints: state.endpoints.filter((e) => e.reqId === rowReqId) }
      : state;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSuiteUnion([]);
    const partial = rowReqId ? { ...results } : {};
    setResults(partial);
    if (!rowReqId) baselinesRef.current = {}; // fresh baselines for a full run
    try {
      await runMatrix(target, runner, {
        signal: controller.signal,
        onCell: (reqId, idId, cell) => {
          const is2xx = typeof cell.status === 'number' && cell.status >= 200 && cell.status <= 299;
          if (is2xx && cell.response && !baselinesRef.current[reqId]) {
            baselinesRef.current[reqId] = inferContract(cell.response.body);
          }
          const findings = runOracles(cell, {
            baseline: baselinesRef.current[reqId],
            config: oracleConfig,
          });
          setResults((r) => ({
            ...r,
            [reqId]: { ...(r[reqId] || {}), [idId]: { ...cell, findings } },
          }));
        },
      });
    } finally {
      setRunning(false);
    }
  };
  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
  };

  const editing = identities.find((i) => i.id === editId);
  const drawerRow = drawer && results[drawer.reqId];
  const drawerCell = (drawer && drawerRow && drawerRow[drawer.idId]) as
    (MatrixCell & { request?: CellRequestMeta | null }) | null | undefined | false;

  const scanWithAI = async () => {
    if (!drawer || !drawerCell || !drawerCell.response) return;
    setAiScan({ busy: true, error: null });
    try {
      const extra = await scanSensitiveLLM({
        body: drawerCell.response.body,
        headers: drawerCell.response.headers,
      });
      const { reqId, idId } = drawer;
      // The endpoint/identity may have been removed while the scan was in flight;
      // skip the merge rather than dereferencing a now-missing cell.
      setResults((r) => {
        const cell = r[reqId] && r[reqId][idId];
        if (!cell) return r;
        return {
          ...r,
          [reqId]: {
            ...r[reqId],
            [idId]: { ...cell, findings: [...(cell.findings || []), ...extra] },
          },
        };
      });
      setAiScan({ busy: false, error: null });
    } catch (e: any) {
      setAiScan({ busy: false, error: String((e && e.message) || e) });
    }
  };

  // Is an LLM reachable AND egress-allowed for the optional AI scan?
  const cfg = loadLlmCfg();
  const policy = resolvePolicy(loadPrivacyCfg(), getCachedAiPolicy());
  const dest = classifyDestination(cfg);
  let egressOk = true;
  try {
    assertEgressAllowed(policy.effectiveMode, dest, loadPrivacyCfg());
  } catch {
    egressOk = false;
  }
  const aiReady =
    egressOk &&
    (cfg.provider === 'builtin'
      ? !!(window.claude && (window.claude as any).complete)
      : cfg.provider === 'openai'
        ? !!cfg.key
        : !!cfg.baseUrl);

  // Shared per-request runner for BOLA. The panel's onRun and the later suite
  // adapter use this SAME closure so Security owns the runner for reuse.
  const bolaRunner: BolaRunner = (test, identity, idValue) =>
    qaRunSavedRequest(
      { id: test.reqId as string },
      {
        env,
        vars,
        cookies: cookies as QaRunCookie[],
        sslVerify,
        authOverride: identity.auth as any,
        oauthToken: identity._oauthToken as any,
        mutate: (req) =>
          applyIdLocation(req as any, test.idLocation, idValue) as unknown as QaRequest,
      }
    );

  const bflaRunner: BflaRunner = (ep, identity) =>
    qaRunSavedRequest(
      { id: ep.reqId },
      {
        env,
        vars,
        cookies: cookies as QaRunCookie[],
        sslVerify,
        authOverride: identity.auth as any,
        oauthToken: identity._oauthToken as any,
      }
    );

  // Run one rate-limit test into the given results setter. `tr` is the i18n t().
  const runRlTest = async (
    test: RateLimitTest,
    runner: () => Promise<any>,
    signal: AbortSignal,
    setRes: React.Dispatch<React.SetStateAction<RateLimitResultsMap>>,
    tr: I18nValue['t']
  ) => {
    setRes((r) => ({
      ...r,
      [test.id]: { progress: { done: 0, n: test.n as number }, stats: null, verdict: null },
    }));
    const { responses, stats } = await runBurst(test, runner, {
      signal,
      onProgress: (done, n) =>
        setRes((r) => ({ ...r, [test.id]: { ...(r[test.id] || {}), progress: { done, n } } })),
    });
    const finding = rlFindingFor(
      test,
      responses,
      stats,
      tr('rl.findingTitle'),
      tr('rl.weakFindingTitle')
    );
    const verdict = classifyRateLimit(
      detectThrottleSignal(responses),
      responses.filter((x) => x.status != null).length
    );
    setRes((r) => ({
      ...r,
      [test.id]: {
        progress: { done: stats.sent, n: test.n as number },
        stats,
        verdict,
        severity: finding ? finding.severity : null,
        finding,
      },
    }));
  };

  const runFullSuite = async () => {
    const controller = new AbortController();
    suiteAbortRef.current = controller;
    setSuite({ running: true, engine: null, done: 0, total: 0, lastRecord: null });
    setResults({});
    setBolaResults({});
    setRlResults({});
    setSuiteUnion([]);
    // Evidence map is per-run and transient (never persisted unless the user opts in).
    // An aborted run leaves it null while snapshots.lastRun (the prior good report) survives;
    // exporting that report then falls back to persisted/none — by design.
    evidenceMapRef.current = null;
    setEvidenceReady(false);

    const matrixAdapter = async (cfg: any, { signal }: { signal?: AbortSignal | null }) => {
      const baselines: Record<string, Contract> = {};
      const out: MatrixResults = {};
      await runMatrix({ ...state, endpoints: cfg.endpoints, identities: cfg.identities }, runner, {
        signal,
        onCell: (reqId, idId, cell) => {
          const findings = matrixCellFindings(reqId, cell, baselines);
          const withF = { ...cell, findings };
          out[reqId] = { ...(out[reqId] || {}), [idId]: withF };
          setResults((r) => ({ ...r, [reqId]: { ...(r[reqId] || {}), [idId]: withF } }));
        },
      });
      return out;
    };
    const bolaAdapter = async (cfg: any, { signal }: { signal?: AbortSignal | null }) => {
      const out: BolaResults = {};
      await runBola({ identities: cfg.identities, tests: cfg.tests }, bolaRunner, {
        signal,
        negativeControl: true,
        onControl: (testId, control) => {
          out[testId] = { ...(out[testId] || { reference: {}, attacks: {} }), control };
          setBolaResults({ ...out });
        },
        onCell: (testId, attackerId, ownerId, cell) => {
          const tr = out[testId] || { reference: {}, attacks: {} };
          if (attackerId == null)
            out[testId] = { ...tr, reference: { ...tr.reference, [ownerId]: cell as BolaRefCell } };
          else
            out[testId] = {
              ...tr,
              attacks: {
                ...tr.attacks,
                [attackerId]: {
                  ...(tr.attacks[attackerId] || {}),
                  [ownerId]: cell as BolaAttackCell,
                },
              },
            };
          setBolaResults({ ...out });
        },
      });
      return out;
    };
    const conformanceAdapter = async (
      cfg: any,
      {
        signal,
        onProgress,
      }: { signal?: AbortSignal | null; onProgress?: (done: number, total: number) => void }
    ) => {
      const tests = (cfg.tests || []) as ConformanceTest[];
      const out: ConformanceResult[] = [];
      for (let i = 0; i < tests.length; i++) {
        if (signal && signal.aborted) break;
        const test = tests[i];
        if (!test) continue;
        const identity = identities.find((x) => x.id === test.identityId) || identities[0] || null;
        let response: any = null;
        let findings: Finding[] = [];
        let error: string | null = null;
        try {
          response = await qaRunSavedRequest(
            { id: test.reqId },
            {
              env,
              vars,
              cookies: cookies as QaRunCookie[],
              sslVerify,
              authOverride: identity && (identity.auth as any),
              oauthToken: identity && (identity._oauthToken as any),
            }
          );
          const ok =
            typeof response.status === 'number' && response.status >= 200 && response.status < 300;
          findings = ok ? conformanceFindings(response.body, test.schema as any) : [];
        } catch (e: any) {
          error = String((e && e.message) || e);
        }
        out.push({
          test,
          identity,
          status: response && typeof response.status === 'number' ? response.status : null,
          response,
          findings,
          error,
        });
        if (onProgress) onProgress(i + 1, tests.length);
      }
      return out;
    };
    const bflaAdapter = async (
      cfg: any,
      {
        signal,
        onProgress,
      }: { signal?: AbortSignal | null; onProgress?: (done: number, total: number) => void }
    ) => {
      const total = bflaPlan(cfg.endpoints || [], cfg.identities || []).length;
      let done = 0;
      const out = await runBfla(cfg.endpoints || [], cfg.identities || [], bflaRunner, {
        signal,
        denySet: cfg.denySet || denySet,
        onCell: () => {
          done++;
          if (onProgress) onProgress(done, total);
        },
      });
      return out.results as BflaResult[];
    };
    const fuzzAdapter = async (
      cfg: any,
      {
        signal,
        onProgress,
      }: { signal?: AbortSignal | null; onProgress?: (done: number, total: number) => void }
    ) => {
      const plans = (cfg.plans || []) as FuzzSuitePlan[];
      const total = plans.reduce(
        (sum, plan) => sum + (plan.seeds || []).length * FUZZ_PAYLOADS.length,
        0
      );
      let done = 0;
      const out: FuzzSuiteResult[] = [];
      for (const plan of plans) {
        if (signal && signal.aborted) break;
        const ep = endpoints.find((x) => x.reqId === plan.reqId);
        const identity = ep ? preferredIdentity(ep, identities, state.expect) : identities[0];
        const res = await runFuzz(
          plan,
          (seed, payload) =>
            qaRunSavedRequest(
              { id: plan.reqId },
              {
                env,
                vars,
                cookies: cookies as QaRunCookie[],
                sslVerify,
                authOverride: identity && (identity.auth as any),
                oauthToken: identity && (identity._oauthToken as any),
                mutate: (req) =>
                  applyIdLocation(
                    req as any,
                    seed.location as any,
                    payload.value
                  ) as unknown as QaRequest,
              }
            ),
          {
            signal,
            onCase: () => {
              done++;
              if (onProgress) onProgress(done, total);
            },
          }
        );
        out.push({ plan, ran: res.ran, findings: res.findings });
      }
      return out;
    };
    const ratelimitAdapter = async (cfg: any, { signal }: { signal?: AbortSignal | null }) => {
      const out: RateLimitResultsMap = {};
      for (const test of cfg.tests) {
        if (signal && signal.aborted) break;
        const identity = identities.find((x) => x.id === test.identityId) || identities[0];
        const reqRunner = () =>
          qaRunSavedRequest(
            { id: test.reqId },
            {
              env,
              vars,
              cookies: cookies as QaRunCookie[],
              sslVerify,
              authOverride: identity && identity.auth,
              oauthToken: identity && identity._oauthToken,
            }
          );
        const { responses, stats } = await runBurst(test, reqRunner, { signal });
        const finding = rlFindingFor(
          test,
          responses,
          stats,
          t('rl.findingTitle'),
          t('rl.weakFindingTitle')
        );
        const verdict = classifyRateLimit(
          detectThrottleSignal(responses),
          responses.filter((x) => x.status != null).length
        );
        out[test.id] = {
          progress: { done: stats.sent, n: test.n },
          stats,
          verdict,
          severity: finding ? finding.severity : null,
          finding,
        };
        setRlResults({ ...out });
      }
      return out;
    };

    const config = {
      matrix: { endpoints, identities },
      conformance: { tests: conformanceTests },
      bfla: { endpoints, identities, denySet },
      bola: { tests: bola.tests || [], identities },
      fuzz: { plans: fuzzPlans },
      rateLimit: { tests: rateLimit.tests || [], identities },
    };
    const rec = await runSuite(
      config,
      {
        matrix: matrixAdapter,
        conformance: conformanceAdapter,
        bfla: bflaAdapter,
        bola: bolaAdapter,
        fuzz: fuzzAdapter,
        ratelimit: ratelimitAdapter,
      },
      {
        signal: controller.signal,
        onProgress: (engine, done, total) => setSuite((s) => ({ ...s, engine, done, total })),
      }
    );

    if (rec.status === 'complete') {
      const scopeHash = scopeHashOf(scopeDescriptor);
      const items = snapshotOf(rec.union, loadLifecycle(), {
        runId: rec.finishedAt,
        createdAt: rec.finishedAt,
        scopeHash,
      }).items;
      evidenceMapRef.current = buildEvidenceMap(rec.union);
      setEvidenceReady(evidenceMapRef.current.size > 0);
      setSuiteUnion(rec.union);
      const record: Snapshot = {
        runId: rec.finishedAt,
        scopeHash,
        createdAt: rec.finishedAt,
        startedAt: rec.startedAt,
        finishedAt: rec.finishedAt,
        durationMs: rec.durationMs,
        status: 'complete',
        engines: rec.engines,
        items,
      };
      setSnapshots((prev) => {
        const next = recordRun(prev, record);
        saveSnapshots(next);
        return next;
      });
      setSuite({ running: false, engine: null, done: 0, total: 0, lastRecord: record });
    } else {
      setSuite((s) => ({
        ...s,
        running: false,
        lastRecord: { status: 'aborted', engines: rec.engines },
      }));
    }
  };
  const stopSuite = () => {
    if (suiteAbortRef.current) suiteAbortRef.current.abort();
  };

  const onExportReport = (format: ReportFormat, redaction: ReportRedaction) => {
    const runRec = snapshots.lastRun;
    if (!runRec) return;
    const model = buildReport(
      runRec,
      snapshots.baseline,
      loadLifecycle(),
      redaction === 'evidence' ? { redaction, evidence: evidenceMapRef.current } : { redaction }
    );
    const base = `qa-security-${String(runRec.runId || 'run').replace(/[^a-z0-9]+/gi, '-')}`;
    if (format === 'json') downloadFile(`${base}.json`, reportToJson(model), 'application/json');
    else if (format === 'html') downloadFile(`${base}.html`, reportToHtml(model), 'text/html');
    else if (format === 'junit')
      downloadFile(`${base}.junit.xml`, reportToJUnit(model), 'application/xml');
    else if (format === 'sarif')
      downloadFile(`${base}.sarif.json`, reportToSarif(model), 'application/json');
  };

  const onSaveEvidence = () => {
    const map = evidenceMapRef.current;
    if (!map || !map.size) return;
    setSnapshots((prev) => {
      if (!prev.lastRun) return prev;
      const next = {
        ...prev,
        lastRun: { ...prev.lastRun, items: embedEvidence(prev.lastRun.items, map) },
      };
      saveSnapshots(next);
      return next;
    });
  };

  return (
    <div className="qa-sec">
      <SuiteRunBar
        suite={suite}
        onRun={runFullSuite}
        onStop={stopSuite}
        canExport={!!snapshots.lastRun}
        onExport={onExportReport}
        canEvidence={evidenceReady}
        onSaveEvidence={onSaveEvidence}
      />
      <TriagePanel union={triageUnion} aiReady={aiReady} onGoToEngine={goToEngine} />
      <BatchReviewPanel responses={reviewSources} aiReady={aiReady} />
      <div className="qa-sec-tabs">
        <button
          className={`qa-seg ${mode === 'matrix' ? 'qa-seg--on' : ''}`}
          onClick={() => setMode('matrix')}
        >
          {t('security.mode.matrix')}
        </button>
        <button
          className={`qa-seg ${mode === 'bola' ? 'qa-seg--on' : ''}`}
          onClick={() => setMode('bola')}
        >
          {t('security.mode.bola')}
        </button>
        <button
          className={`qa-seg ${mode === 'ratelimit' ? 'qa-seg--on' : ''}`}
          onClick={() => setMode('ratelimit')}
        >
          {t('security.mode.ratelimit')}
        </button>
        <button
          className={`qa-seg ${mode === 'coverage' ? 'qa-seg--on' : ''}`}
          onClick={() => setMode('coverage')}
        >
          {t('security.mode.coverage')}
        </button>
        <button
          className={`qa-seg ${mode === 'findings' ? 'qa-seg--on' : ''}`}
          onClick={() => setMode('findings')}
        >
          {t('findings.tab')}
        </button>
      </div>

      {mode === 'coverage' ? (
        <CoveragePanel model={coverageModel} />
      ) : mode === 'findings' ? (
        <FindingsPanel
          union={triageUnion}
          snapshots={snapshots}
          scopeMismatch={scopeMismatch}
          onPinBaseline={
            snapshots.lastRun
              ? () => {
                  setSnapshots((prev) => {
                    const map = evidenceMapRef.current;
                    const src =
                      map && map.size
                        ? { ...prev.lastRun!, items: embedEvidence(prev.lastRun!.items, map) }
                        : prev.lastRun;
                    const next = pinBaseline(prev, src);
                    saveSnapshots(next);
                    return next;
                  });
                }
              : undefined
          }
        />
      ) : mode === 'bola' ? (
        <BolaPanel
          identities={identities}
          bola={bola}
          setBola={setBola}
          results={bolaResults}
          setResults={setBolaResults}
          onRun={({ negativeControl, signal }) =>
            runBola({ identities, tests: bola.tests }, bolaRunner, {
              signal,
              negativeControl,
              onControl: (testId, control) =>
                setBolaResults((r) => ({
                  ...r,
                  [testId]: { ...(r[testId] || { reference: {}, attacks: {} }), control },
                })),
              onCell: (testId, attackerId, ownerId, cell) =>
                setBolaResults((r) => {
                  const tr = r[testId] || { reference: {}, attacks: {} };
                  if (attackerId == null)
                    return {
                      ...r,
                      [testId]: {
                        ...tr,
                        reference: { ...tr.reference, [ownerId]: cell as BolaRefCell },
                      },
                    };
                  return {
                    ...r,
                    [testId]: {
                      ...tr,
                      attacks: {
                        ...tr.attacks,
                        [attackerId]: {
                          ...(tr.attacks[attackerId] || {}),
                          [ownerId]: cell as BolaAttackCell,
                        },
                      },
                    },
                  };
                }),
            })
          }
          env={env}
          vars={vars}
          cookies={cookies}
          sslVerify={sslVerify}
          onFindings={onBolaFindings}
        />
      ) : mode === 'ratelimit' ? (
        <RateLimitPanel
          identities={identities}
          rateLimit={rateLimit}
          setRateLimit={setRateLimit}
          results={rlResults}
          setResults={setRlResults}
          onRunTest={(test, { runner, signal }) => runRlTest(test, runner, signal, setRlResults, t)}
          env={env}
          vars={vars}
          cookies={cookies}
          sslVerify={sslVerify}
          onFindings={onRlFindings}
        />
      ) : (
        <>
          <div className="qa-sec-head">
            <div>
              <h2>{t('security.title')}</h2>
              <p>{t('security.subtitle')}</p>
            </div>
            <div className="qa-sec-actions">
              {running ? (
                <button className="qa-btn qa-btn--danger" onClick={stop}>
                  <Icon name="stop" size={14} /> {t('security.stop')}
                </button>
              ) : (
                <button
                  className="qa-btn qa-btn--primary"
                  onClick={() => run()}
                  disabled={!endpoints.length}
                >
                  <Icon name="play" size={14} /> {t('security.runAll')}
                </button>
              )}
            </div>
          </div>

          <div className="qa-sec-summary">
            {(['total', 'pass', 'fail', 'vuln', 'inconclusive'] as const).map((k) => (
              <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>
                {summary[k] || 0} {t('security.summary.' + k)}
              </span>
            ))}
          </div>

          {findSummary.total > 0 && (
            <div className="qa-sec-findsummary">
              {SEVERITY_ORDER.slice()
                .reverse()
                .filter((s) => findSummary.bySeverity[s] > 0)
                .map((s) => (
                  <span key={s} className={`qa-sec-findchip qa-sev--${s}`}>
                    {findSummary.bySeverity[s]} {t('security.severity.' + s)}
                  </span>
                ))}
            </div>
          )}

          <div className="qa-sec-toolbar">
            <button className="qa-link" onClick={addIdentity}>
              <Icon name="plus" size={13} /> {t('security.addIdentity')}
            </button>
            <button className="qa-link" onClick={() => setPicking(true)}>
              <Icon name="plus" size={13} /> {t('security.addEndpoints')}
            </button>
            <label className="qa-sec-deny">
              {t('security.denySet')}:
              <input
                className="qa-inp qa-inp--mini"
                value={denySet.join(', ')}
                onChange={(e) =>
                  setDenySet(
                    e.target.value
                      .split(',')
                      .map((s) => parseInt(s.trim(), 10))
                      .filter(Number.isFinite)
                  )
                }
              />
            </label>
            {privCount > 0 && (
              <span className="qa-sec-privcount">
                {t('security.priv.count', { count: privCount })}
              </span>
            )}
          </div>

          {!endpoints.length && <div className="qa-sec-empty">{t('security.noEndpoints')}</div>}

          {endpoints.length > 0 && (
            <div className="qa-sec-gridwrap">
              <table className="qa-sec-grid">
                <thead>
                  <tr>
                    <th className="qa-sec-corner">{t('security.endpoints')}</th>
                    {identities.map((id) => (
                      <th key={id.id} className="qa-sec-colhead">
                        <button
                          className="qa-sec-colname"
                          onClick={() => setEditId(id.id)}
                          title={id.auth.type}
                        >
                          {id.id === 'anon' ? t('security.anon') : id.name || id.id}{' '}
                          <span className="qa-sec-authtype">{id.auth.type}</span>
                        </button>
                        <div className="qa-sec-bulk">
                          {EXPECTS.map((v) => (
                            <button
                              key={v}
                              onClick={() => bulkCol(id.id, v)}
                              title={t('security.col.bulk')}
                            >
                              {t('security.expect.' + v)[0]}
                            </button>
                          ))}
                          {id.id !== 'anon' && (
                            <button
                              className="qa-sec-x"
                              onClick={() => removeIdentity(id.id)}
                              title={t('security.removeIdentity')}
                            >
                              <Icon name="x" size={11} />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep) => (
                    <tr key={ep.reqId}>
                      <th className="qa-sec-rowhead">
                        <span>
                          <MethodBadge method={ep.method} size="sm" /> <code>{ep.path}</code>
                          {(() => {
                            const pv = endpointPrivileged(ep);
                            return (
                              <button
                                type="button"
                                className={`qa-sec-priv qa-sec-priv--${pv.privileged ? 'on' : 'off'}`}
                                title={t('security.priv.title')}
                                onClick={() => togglePriv(ep.reqId, !pv.privileged)}
                              >
                                {pv.privileged
                                  ? pv.reasons.map((r) => t('security.priv.reason.' + r)).join('·')
                                  : t('security.priv.mark')}
                              </button>
                            );
                          })()}
                        </span>
                        <span className="qa-sec-rowtools">
                          <button
                            onClick={() => run(ep.reqId)}
                            disabled={running}
                            title={t('security.runRow')}
                          >
                            <Icon name="play" size={11} />
                          </button>
                          {EXPECTS.map((v) => (
                            <button
                              key={v}
                              onClick={() => bulkRow(ep.reqId, v)}
                              title={t('security.row.bulk')}
                            >
                              {t('security.expect.' + v)[0]}
                            </button>
                          ))}
                          <button
                            className="qa-sec-x"
                            onClick={() => removeEndpoint(ep.reqId)}
                            title={t('security.removeEndpoint')}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </span>
                      </th>
                      {identities.map((id) => {
                        const exp = state.expect[ep.reqId]?.[id.id];
                        const row = results[ep.reqId];
                        const cell = row && row[id.id];
                        const v = cell && cell.verdict;
                        return (
                          <td
                            key={id.id}
                            className={`qa-sec-cell qa-sec-cell--${v || 'none'}`}
                            data-expect={exp}
                            onClick={() =>
                              cell
                                ? setDrawer({ reqId: ep.reqId, idId: id.id })
                                : cycleCell(ep.reqId, id.id)
                            }
                          >
                            <span
                              className="qa-sec-exp"
                              onClick={(e) => {
                                e.stopPropagation();
                                cycleCell(ep.reqId, id.id);
                              }}
                            >
                              {t('security.expect.' + exp)}
                            </span>
                            {cell && (
                              <span className="qa-sec-verdict">
                                {cell.status ?? '—'} ·{' '}
                                {t(VERDICT_LABEL[v as Verdict] || 'security.cell.notRun')}
                              </span>
                            )}
                            {cell && cell.findings && cell.findings.length > 0 && (
                              <span
                                className={`qa-sec-findbadge qa-sev--${worstSeverity(cell.findings)}`}
                              >
                                {cell.findings.length}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {allFindings.length > 0 && (
            <div className="qa-sec-findpanel">
              <h3>
                {t('security.findings.panelTitle')} ({allFindings.length})
              </h3>
              <ul className="qa-sec-findlist">
                {allFindings.map((f, i) => (
                  <li key={i} className={`qa-sev--${f.severity}`}>
                    <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                    <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                    <MethodBadge method={f.method} size="sm" /> <code>{f.endpoint}</code>
                    <span className="qa-sec-find-id">{f.identity}</span>
                    <code className="qa-sec-find-path">{f.path}</code>
                    {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {editing && (
            <div className="qa-sec-modal" onClick={() => setEditId(null)}>
              <div className="qa-sec-modal-body" onClick={(e) => e.stopPropagation()}>
                <IdentityEditor
                  identity={editing}
                  env={env}
                  vars={vars}
                  sslVerify={sslVerify}
                  onChange={(nx) => setIdentities((xs) => xs.map((x) => (x.id === nx.id ? nx : x)))}
                  onClose={() => setEditId(null)}
                />
              </div>
            </div>
          )}

          {picking && (
            <div className="qa-sec-modal" onClick={() => setPicking(false)}>
              <div className="qa-sec-modal-body" onClick={(e) => e.stopPropagation()}>
                <EndpointPicker
                  existing={endpoints}
                  onClose={() => setPicking(false)}
                  onAdd={(ep) =>
                    setEndpoints((xs) => (xs.some((x) => x.reqId === ep.reqId) ? xs : [...xs, ep]))
                  }
                />
              </div>
            </div>
          )}

          {drawerCell && (
            <div className="qa-sec-drawer">
              <div className="qa-sec-drawer-head">
                <span>
                  {drawerCell.status ?? '—'} ·{' '}
                  {t(VERDICT_LABEL[drawerCell.verdict as Verdict] || 'security.cell.notRun')}
                </span>
                <button className="qa-iconbtn" onClick={() => setDrawer(null)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              {drawerCell.request && (
                <>
                  <span className="qa-sec-drawer-label">{t('security.cell.request')}</span>
                  <div className="qa-sec-drawer-req">
                    <div>
                      <MethodBadge method={drawerCell.request.method} size="sm" />{' '}
                      <code>{drawerCell.request.path}</code>
                    </div>
                    <div className="qa-sec-drawer-id">
                      {drawerCell.request.identity} · {drawerCell.request.authType}
                    </div>
                  </div>
                </>
              )}
              {drawerCell.error && <div className="qa-sec-drawer-err">{drawerCell.error}</div>}
              {drawerCell.findings && drawerCell.findings.length > 0 && (
                <>
                  <span className="qa-sec-drawer-label">{t('security.findings.title')}</span>
                  <ul className="qa-sec-findings">
                    {drawerCell.findings
                      .slice()
                      .sort(
                        (a, b) =>
                          SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)
                      )
                      .map((f, i) => (
                        <li key={i} className={`qa-sev--${f.severity}`}>
                          <span className="qa-sec-find-sev">
                            {t('security.severity.' + f.severity)}
                          </span>
                          <span className="qa-sec-find-oracle">
                            {t('security.oracle.' + f.oracle)}
                          </span>
                          <code>{f.path}</code>
                          {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
                        </li>
                      ))}
                  </ul>
                </>
              )}
              {drawerCell.findings && drawerCell.findings.length === 0 && (
                <span className="qa-sec-drawer-label">{t('security.findings.none')}</span>
              )}
              <button
                className="qa-link"
                onClick={scanWithAI}
                disabled={aiScan.busy || !aiReady}
                title={!aiReady ? t('security.findings.aiUnavailable') : undefined}
              >
                <Icon name="zap" size={13} />{' '}
                {aiScan.busy ? t('security.findings.aiScanning') : t('security.findings.scanAI')}
              </button>
              {!aiReady && (
                <span className="qa-sec-drawer-label">{t('security.findings.aiUnavailable')}</span>
              )}
              {aiScan.error && <div className="qa-sec-drawer-err">{aiScan.error}</div>}
              <span className="qa-sec-drawer-label">{t('security.cell.response')}</span>
              <pre className="qa-sec-drawer-body">
                {JSON.stringify(drawerCell.response && drawerCell.response.body, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

Object.assign(window, { SecurityPage });
export { SecurityPage };
