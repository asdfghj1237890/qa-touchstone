// QA Touchstone — object-level authz (BOLA/IDOR) UI + page-side runner.
// Renders the config (id location + per-identity owned id), runs a reference +
// attacker×owner pass via the injected runner, and shows the result grid +
// findings. Pure engine lives in bola.js.
import React from 'react';
import './setup';
import { Icon, MethodBadge } from './components';
import { useI18n } from './useI18n';
import { qaRunSavedRequest } from './sendRequest';
import type { QaRunCookie } from './sendRequest';
import { buildReq } from './buildReq';
import type { QaRequest } from './buildReq';
import { applyIdLocation, runBola, summarizeBola } from './bola';
import type { BolaRunner } from './bola';
import { normalizeBola } from './securitySuite';
import { detectIdLocation, extractIdCandidates, applyPreset } from './bolaSetup';
import { SEVERITY_ORDER } from './oracles';
import type {
  BolaAttackCell,
  BolaConfig,
  BolaIdCandidate,
  BolaIdLocation,
  BolaPreset,
  BolaRefCell,
  BolaResults,
  BolaTest,
  BolaTestResult,
  BolaVerdict,
  Finding,
  Identity,
  UnionFinding,
} from './types';
import type { QaCookie, QaEnv } from './state/WorkspaceContext';

const { useState: useS, useEffect: useE, useMemo, useRef } = React;
// Summary chip labels: the four attack verdicts reuse `bola.verdict.*`; `total`
// has its own key. No reliance on t() returning a missing key.
const SUMMARY_LABEL: Record<'total' | BolaVerdict, string> = {
  total: 'bola.summary.total',
  vuln: 'bola.verdict.vuln',
  unconfirmed: 'bola.verdict.unconfirmed',
  pass: 'bola.verdict.pass',
  inconclusive: 'bola.verdict.inconclusive',
};
const VLABEL: Record<BolaVerdict, string> = {
  vuln: 'bola.verdict.vuln',
  unconfirmed: 'bola.verdict.unconfirmed',
  pass: 'bola.verdict.pass',
  inconclusive: 'bola.verdict.inconclusive',
};

/** collection 內可加入測試的 request 摘要。 */
type ReqOption = { reqId: string; method: string; path: string; name: string };

function allRequests(): ReqOption[] {
  return (window.QA.COLLECTIONS || []).flatMap((c: any) =>
    (c.folders || []).flatMap((f: any) =>
      (f.requests || []).map((r: any) => ({
        reqId: r.id,
        method: r.method,
        path: r.path,
        name: r.name,
      }))
    )
  );
}

let testSeq = 1;

/** 面板建立的 test 必有 reqId / idLocation（domain 型別為 optional）。 */
type BolaUiTest = BolaTest & { reqId: string; idLocation: BolaIdLocation };

/** drawer cell：ref/attack 兩種 cell 的寬鬆聯集（欄位防禦式存取）。 */
type BolaDrawerCell = Partial<BolaRefCell> & Partial<BolaAttackCell>;

export interface BolaPanelProps {
  identities: Identity[];
  bola: BolaConfig;
  setBola: React.Dispatch<React.SetStateAction<BolaConfig>>;
  onFindings?: (findings: UnionFinding[]) => void;
  results?: BolaResults | null;
  setResults?: React.Dispatch<React.SetStateAction<BolaResults>>;
  onRun?: (ctx: { runner: BolaRunner; negativeControl: boolean; signal: AbortSignal }) => unknown;
  env?: QaEnv;
  vars?: any;
  cookies?: QaCookie[];
  sslVerify?: boolean;
}

function BolaPanel({
  identities,
  bola,
  setBola,
  onFindings,
  results: resultsProp,
  setResults: setResultsProp,
  onRun,
  env = { label: 'None', baseUrl: '' },
  vars,
  cookies = [],
  sslVerify = true,
}: BolaPanelProps) {
  const { t } = useI18n();
  const tests = useMemo(() => (bola.tests || []) as BolaUiTest[], [bola.tests]);
  const [localResults, setLocalResults] = useS<BolaResults>({});
  const controlled = !!setResultsProp;
  const results = useMemo(
    () => (controlled ? resultsProp || {} : localResults),
    [controlled, resultsProp, localResults]
  );
  const setResults = (controlled ? setResultsProp : setLocalResults) as React.Dispatch<
    React.SetStateAction<BolaResults>
  >;
  const [running, setRunning] = useS(false);
  const [drawer, setDrawer] = useS<{
    testId: string;
    attackerId: string | null;
    ownerId: string;
  } | null>(null); // { testId, attackerId, ownerId }
  const [suggestions, setSuggestions] = useS<Record<string, BolaIdCandidate>>({}); // testId -> top detection candidate (dismissible)
  const [negControl, setNegControl] = useS(true);
  const [presetName, setPresetName] = useS('');
  const presets = bola.presets || [];
  const setPresets = (updater: BolaPreset[] | ((ps: BolaPreset[]) => BolaPreset[])) =>
    setBola((b) => ({
      ...b,
      presets: typeof updater === 'function' ? updater(b.presets || []) : updater,
    }));
  const abortRef = useRef<AbortController | null>(null);

  const setTests = (updater: BolaTest[] | ((ts: BolaTest[]) => BolaTest[])) =>
    setBola((b) => ({
      ...b,
      tests: typeof updater === 'function' ? updater(b.tests || []) : updater,
    }));

  const addTest = (r: ReqOption) =>
    setTests((ts) => {
      if (ts.some((x) => x.reqId === r.reqId)) return ts;
      const id = `bt_${Date.now()}_${testSeq++}`;
      let idLocation: BolaIdLocation = { kind: 'path', index: 0 };
      let top: BolaIdCandidate | null = null;
      try {
        const cands = detectIdLocation(buildReq(r.reqId));
        const first = cands[0];
        if (first && first.confidence !== 'low') {
          idLocation = first.idLocation;
          top = first;
        }
      } catch {
        /* detection is best-effort */
      }
      if (top) setSuggestions((s) => ({ ...s, [id]: top }));
      return [
        ...ts,
        { id, reqId: r.reqId, method: r.method, path: r.path, idLocation, idValues: {} },
      ];
    });
  const detectFor = (testId: string, reqId: string) => {
    try {
      const cands = detectIdLocation(buildReq(reqId));
      const first = cands[0];
      if (first) {
        patchTest(testId, { idLocation: first.idLocation });
        setSuggestions((s) => ({ ...s, [testId]: first }));
      }
    } catch {
      /* ignore */
    }
  };
  const dismissSuggestion = (testId: string) =>
    setSuggestions((s) => {
      const n = { ...s };
      delete n[testId];
      return n;
    });
  const removeTest = (id: string) => setTests((ts) => ts.filter((x) => x.id !== id));
  const patchTest = (id: string, patch: Partial<BolaTest>) =>
    setTests((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const setIdValue = (id: string, identityId: string, value: string) =>
    setTests((ts) =>
      ts.map((x) => (x.id === id ? { ...x, idValues: { ...x.idValues, [identityId]: value } } : x))
    );

  const runner: BolaRunner = (test, identity, idValue) =>
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

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults({});
    try {
      if (onRun) {
        await onRun({ runner, negativeControl: negControl, signal: controller.signal });
      } else {
        await runBola({ identities, tests }, runner, {
          signal: controller.signal,
          negativeControl: negControl,
          onControl: (testId, control) =>
            setResults((r) => ({
              ...r,
              [testId]: { ...(r[testId] || { reference: {}, attacks: {} }), control },
            })),
          onCell: (testId, attackerId, ownerId, cell) =>
            setResults((r) => {
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
        });
      }
    } finally {
      setRunning(false);
    }
  };
  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
  };

  const summary = useMemo(() => summarizeBola(results), [results]);
  const allFindings = useMemo(() => {
    const out: Finding[] = [];
    for (const test of tests) {
      const res = results[test.id];
      const atk = (res && res.attacks) || {};
      for (const a in atk)
        for (const o in atk[a]) {
          const f = atk[a][o] && atk[a][o].finding;
          if (f) out.push(f);
        }
    }
    return out.sort(
      (x, y) => SEVERITY_ORDER.indexOf(y.severity) - SEVERITY_ORDER.indexOf(x.severity)
    );
  }, [results, tests]);

  // Report normalized findings upward for cross-engine AI triage (advisory).
  useE(() => {
    if (!onFindings) return;
    const out = normalizeBola(results, tests);
    onFindings(out);
  }, [results, tests, onFindings]);

  const reqs = allRequests();
  const drawerRes = drawer && results[drawer.testId];
  const drawerCell = (drawer &&
    drawerRes &&
    (drawer.attackerId == null
      ? drawerRes.reference[drawer.ownerId]
      : (drawerRes.attacks[drawer.attackerId] || {})[drawer.ownerId])) as
    BolaDrawerCell | null | undefined | false;

  const owned = (test: BolaUiTest) =>
    identities.filter((i) => (test.idValues || {})[i.id] != null && test.idValues![i.id] !== '');

  return (
    <div className="qa-bola">
      <div className="qa-sec-head">
        <div>
          <h2>{t('security.mode.bola')}</h2>
          <p>{t('bola.subtitle')}</p>
        </div>
        <div className="qa-sec-actions">
          <label className="qa-sec-privchk" title={t('security.bola.setup.negControlHint')}>
            <input
              type="checkbox"
              checked={negControl}
              onChange={(e) => setNegControl(e.target.checked)}
            />
            {t('security.bola.setup.negControl')}
          </label>
          {running ? (
            <button className="qa-btn qa-btn--danger" onClick={stop}>
              <Icon name="stop" size={14} /> {t('security.stop')}
            </button>
          ) : (
            <button className="qa-btn qa-btn--primary" onClick={run} disabled={!tests.length}>
              <Icon name="play" size={14} /> {t('bola.run')}
            </button>
          )}
        </div>
      </div>

      <div className="qa-sec-summary">
        {(['total', 'vuln', 'unconfirmed', 'pass', 'inconclusive'] as const).map((k) => (
          <span key={k} className={`qa-sec-chip qa-sec-chip--${k}`}>
            {summary[k] || 0} {t(SUMMARY_LABEL[k])}
          </span>
        ))}
      </div>

      <div className="qa-sec-toolbar">
        <select
          className="qa-inp qa-inp--mini"
          value=""
          onChange={(e) => {
            const r = reqs.find((x) => x.reqId === e.target.value);
            if (r) addTest(r);
          }}
        >
          <option value="">{t('bola.addTest')}…</option>
          {reqs.map((r) => (
            <option key={r.reqId} value={r.reqId}>
              {r.method} {r.path}
            </option>
          ))}
        </select>
      </div>

      {!tests.length && <div className="qa-sec-empty">{t('bola.noTests')}</div>}

      {tests.map((test) => {
        const ow = owned(test);
        const suggestion = suggestions[test.id];
        const tr = results[test.id] || ({ reference: {}, attacks: {} } as BolaTestResult);
        // Probe whether the marked id location actually resolves against the built
        // request (e.g. a body path whose parent is missing won't apply, so the
        // request would run unmutated and silently read the attacker's own object).
        let idApplied: boolean | undefined = true;
        try {
          idApplied = applyIdLocation(
            buildReq(test.reqId) as any,
            test.idLocation,
            '__probe__'
          )._idApplied;
        } catch {
          idApplied = true;
        }
        return (
          <div key={test.id} className="qa-bola-test">
            <div className="qa-bola-test-head">
              <MethodBadge method={test.method} size="sm" /> <code>{test.path}</code>
              <button className="qa-sec-x" onClick={() => removeTest(test.id)}>
                <Icon name="x" size={11} />
              </button>
            </div>

            {suggestion && (
              <div className="qa-bola-suggest">
                {t('security.bola.setup.detected', {
                  where: suggestion.why,
                  confidence: t('security.bola.setup.confidence.' + suggestion.confidence),
                })}
                <button
                  className="qa-link"
                  onClick={() => {
                    patchTest(test.id, { idLocation: suggestion.idLocation });
                    dismissSuggestion(test.id);
                  }}
                >
                  {t('security.bola.setup.use')}
                </button>
                <button className="qa-link" onClick={() => dismissSuggestion(test.id)}>
                  {t('security.bola.setup.dismiss')}
                </button>
              </div>
            )}
            {!suggestions[test.id] && (
              <button
                className="qa-link qa-bola-detect"
                onClick={() => detectFor(test.id, test.reqId)}
              >
                <Icon name="search" size={12} /> {t('security.bola.setup.detect')}
              </button>
            )}

            <div className="qa-bola-loc">
              <label>{t('bola.idLocation')}:</label>
              <select
                className="qa-inp qa-inp--mini"
                value={test.idLocation.kind}
                onChange={(e) =>
                  patchTest(test.id, {
                    idLocation:
                      e.target.value === 'path'
                        ? { kind: 'path', index: 0 }
                        : e.target.value === 'query'
                          ? { kind: 'query', key: '' }
                          : { kind: 'body', path: '' },
                  })
                }
              >
                <option value="path">{t('bola.kind.path')}</option>
                <option value="query">{t('bola.kind.query')}</option>
                <option value="body">{t('bola.kind.body')}</option>
              </select>
              {test.idLocation.kind === 'path' && (
                <input
                  className="qa-inp qa-inp--mini"
                  type="number"
                  min="0"
                  placeholder={t('bola.pathIndex')}
                  value={test.idLocation.index}
                  onChange={(e) =>
                    patchTest(test.id, {
                      idLocation: { kind: 'path', index: parseInt(e.target.value, 10) || 0 },
                    })
                  }
                />
              )}
              {test.idLocation.kind === 'query' && (
                <input
                  className="qa-inp qa-inp--mini"
                  placeholder={t('bola.queryKey')}
                  value={test.idLocation.key}
                  onChange={(e) =>
                    patchTest(test.id, { idLocation: { kind: 'query', key: e.target.value } })
                  }
                />
              )}
              {test.idLocation.kind === 'body' && (
                <input
                  className="qa-inp qa-inp--mini"
                  placeholder={t('bola.bodyPath')}
                  value={test.idLocation.path}
                  onChange={(e) =>
                    patchTest(test.id, { idLocation: { kind: 'body', path: e.target.value } })
                  }
                />
              )}
              {!idApplied && <span className="qa-bola-warn">⚠ {t('bola.notApplied')}</span>}
            </div>

            <div className="qa-bola-presets">
              <span>{t('security.bola.setup.preset')}:</span>
              <select
                className="qa-inp qa-inp--mini"
                value=""
                onChange={(e) => {
                  const p = presets.find((x) => x.id === e.target.value);
                  if (p)
                    setTests((ts) => ts.map((x) => (x.id === test.id ? applyPreset(x, p) : x)));
                }}
              >
                <option value="">{t('security.bola.setup.applyPreset')}…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                className="qa-inp qa-inp--mini"
                placeholder={t('security.bola.setup.presetName')}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                className="qa-link"
                disabled={!presetName.trim()}
                onClick={() => {
                  setPresets((ps) => [
                    ...ps,
                    {
                      id: `pr_${Date.now()}_${testSeq++}`,
                      name: presetName.trim(),
                      values: { ...(test.idValues || {}) } as Record<string, string | number>,
                    },
                  ]);
                  setPresetName('');
                }}
              >
                {t('security.bola.setup.savePreset')}
              </button>
            </div>

            <div className="qa-bola-ids">
              <span className="qa-bola-ids-label">{t('bola.idValues')}:</span>
              {identities.map((i) => (
                <label key={i.id} className="qa-bola-idval">
                  {i.name || i.id}
                  <input
                    className="qa-inp qa-inp--mini"
                    value={(test.idValues || {})[i.id] || ''}
                    onChange={(e) => setIdValue(test.id, i.id, e.target.value)}
                  />
                </label>
              ))}
            </div>

            {(() => {
              let cands: Array<{ value: string; where: string }> = [];
              try {
                cands = extractIdCandidates(buildReq(test.reqId));
              } catch {
                cands = [];
              }
              const first = cands[0];
              if (!first) return null;
              return (
                <div className="qa-bola-cand qa-meta">
                  {t('security.bola.setup.foundInReq', { value: first.value })}
                  <button
                    className="qa-link"
                    onClick={() => {
                      const empty = identities.find((i) => !(test.idValues || {})[i.id]);
                      if (empty) setIdValue(test.id, empty.id, first.value);
                    }}
                  >
                    {t('security.bola.setup.fillFirst')}
                  </button>
                </div>
              );
            })()}
            {tr.control && tr.control.failed && (
              <div className="qa-bola-warn qa-bola-ctrlfail">
                {t('security.bola.setup.controlFailed')}
              </div>
            )}

            {ow.length >= 2 && (
              <table className="qa-bola-grid">
                <thead>
                  <tr>
                    <th>
                      {t('bola.attacker')} ↓ / {t('bola.owner')} →
                    </th>
                    {ow.map((o) => (
                      <th key={o.id}>{o.name || o.id}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ow.map((a) => (
                    <tr key={a.id}>
                      <th>{a.name || a.id}</th>
                      {ow.map((o) => {
                        if (a.id === o.id) {
                          const ref = tr.reference[o.id];
                          return (
                            <td key={o.id} className="qa-bola-cell qa-bola-cell--ref">
                              {ref ? `${ref.status ?? '—'} ${t('bola.reference')}` : '·'}
                            </td>
                          );
                        }
                        const cell = (tr.attacks[a.id] || {})[o.id];
                        const v = cell && cell.verdict;
                        return (
                          <td
                            key={o.id}
                            className={`qa-bola-cell qa-bola-cell--${v || 'none'} ${cell && cell.severity ? 'qa-sev--' + cell.severity : ''}`}
                            onClick={() =>
                              cell &&
                              setDrawer({ testId: test.id, attackerId: a.id, ownerId: o.id })
                            }
                          >
                            {cell
                              ? `${cell.status ?? '—'} · ${t(VLABEL[v as BolaVerdict] || 'bola.verdict.inconclusive')}`
                              : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {allFindings.length > 0 && (
        <div className="qa-sec-findpanel qa-bola-findpanel">
          <h3>
            {t('security.findings.panelTitle')} ({allFindings.length})
          </h3>
          <ul className="qa-sec-findlist">
            {allFindings.map((f, i) => (
              <li key={i} className={`qa-sev--${f.severity}`}>
                <span className="qa-sec-find-sev">{t('security.severity.' + f.severity)}</span>
                <span className="qa-sec-find-oracle">{t('security.oracle.' + f.oracle)}</span>
                <code className="qa-sec-find-path">{f.path}</code>
                {f.evidence && <span className="qa-sec-find-ev">{f.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {drawerCell && (
        <div className="qa-sec-drawer">
          <div className="qa-sec-drawer-head">
            <span>
              {drawerCell.status ?? '—'}
              {drawerCell.verdict
                ? ' · ' + t(VLABEL[drawerCell.verdict] || 'bola.verdict.inconclusive')
                : ''}
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
                  {drawerCell.request.identity} · id={drawerCell.request.idValue}
                </div>
              </div>
            </>
          )}
          {drawerCell.matched && <div className="qa-sec-drawer-id">{t('bola.matched')}</div>}
          {drawerCell.error && <div className="qa-sec-drawer-err">{drawerCell.error}</div>}
          <span className="qa-sec-drawer-label">{t('security.cell.response')}</span>
          <pre className="qa-sec-drawer-body">
            {JSON.stringify(drawerCell.response && drawerCell.response.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BolaPanel });
export { BolaPanel };
