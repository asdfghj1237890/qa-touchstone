// Pure serializer: projects the desktop's live matrix state into the Rust core's
// CI-config JSON (src-tauri/core/src/config.rs). Emits ONLY the fields the core's
// serde(deny_unknown_fields) model accepts. Templates ({{var}}) are left intact —
// the core performs variable substitution, matching the CLI exactly.
import type { QaAuth, QaRequest } from './buildReq';
import type { Endpoint, ExpectMap, Identity, OracleConfig } from './types';

export type CoreAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' }
  | { type: 'basic'; username: string; password: string };

export interface CoreConfigInput {
  /** Matrix endpoints (reqId, method, path, privileged?). */
  endpoints: Endpoint[];
  /** buildReq(reqId) output per endpoint — templates intact, secrets resolved. */
  requestsById: Record<string, QaRequest>;
  identities: Identity[];
  /** Flattened global variables (window.QA.VARIABLES → {key: value}). */
  globals: Record<string, string>;
  environments: Array<{ name: string; variables: Record<string, string> }>;
  expect: ExpectMap;
  denySet?: number[];
  oracleConfig?: OracleConfig | null;
}

/**
 * Map the desktop QaAuth (+ runtime-resolved oauth token) → core Auth.
 * Returns null for auth the core matrix path cannot represent (aws) — the caller
 * drops such identities.
 *
 * `oauthToken` is the transient `_oauthToken` an identity carries after a fetch.
 * At runtime it is an OAuthTokenResult object `{ token, type, ... }` (see
 * Security.tsx:193 and executor.ts:162, which reads `.token`), NOT a bare string —
 * so we read `.token` off the object. A plain string is also accepted for
 * back-compat / direct callers.
 */
export function mapAuth(
  auth: QaAuth | null | undefined,
  oauthToken?: { token?: string } | string | null
): CoreAuth | null {
  const a = auth || ({ type: 'none' } as QaAuth);
  switch (a.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: String(a.bearer ?? '') };
    case 'oauth2': {
      const tok = typeof oauthToken === 'string' ? oauthToken : (oauthToken?.token ?? '');
      return { type: 'bearer', token: tok };
    }
    case 'basic':
      return {
        type: 'basic',
        username: String(a.basic?.user ?? ''),
        password: String(a.basic?.pass ?? ''),
      };
    case 'apiKey':
      return {
        type: 'apikey',
        key: String(a.apiKey?.key ?? ''),
        value: String(a.apiKey?.value ?? ''),
        in: a.apiKey?.placement === 'query' ? 'query' : 'header',
      };
    case 'aws':
      return null; // core Auth has no awsv4; aws identities stay on the TS fallback
    default:
      // Unknown/future auth type: drop the identity (same as aws) rather than
      // coerce it to an authenticated-as-anonymous `none`, which would be riskier.
      return null;
  }
}

type CoreBody = null | { mode: 'none' | 'json' | 'raw'; content: string };

function mapBody(r: QaRequest): CoreBody {
  if (r.bodyMode === 'none' || !r.body) return null;
  if (r.bodyMode === 'json') return { mode: 'json', content: r.body };
  // graphql/form are not first-class in the core matrix path; send as raw (Slice 1
  // limitation — matrix scans are rarely bodied). Refine in a later slice.
  return { mode: 'raw', content: r.body };
}

function mapRequest(reqId: string, r: QaRequest, ep: Endpoint): unknown {
  // QaKVRow carries an `on` flag; the desktop executor drops disabled rows
  // (executor.ts filters `h.on && h.key` / `p.on && p.key`). Mirror that here so a
  // row the user toggled off is dropped by the TS path and never reaches the core.
  // `on !== false` keeps rows where `on` is absent (buildReq always sets it true).
  return {
    id: reqId,
    method: r.method,
    url: r.url,
    headers: (r.headers || [])
      .filter((h) => h.on !== false && h.key)
      .map((h) => ({ key: h.key, value: h.value })),
    query: (r.params || [])
      .filter((p) => p.on !== false && p.key)
      .map((p) => ({ key: p.key, value: p.value })),
    body: mapBody(r),
    assertions: [],
    privileged: typeof ep.privileged === 'boolean' ? ep.privileged : null,
  };
}

/** Build the core CI-config JSON object (matrix subset). */
export function buildCoreConfig(input: CoreConfigInput): unknown {
  const identities = input.identities
    .map((id) => {
      const auth = mapAuth(
        id.auth as unknown as QaAuth,
        (id as Record<string, unknown>)._oauthToken as { token?: string } | string | undefined
      );
      return auth ? { id: id.id, auth, privileged: !!id.privileged } : null;
    })
    .filter((x): x is { id: string; auth: CoreAuth; privileged: boolean } => x !== null);
  const includedIds = new Set(identities.map((i) => i.id));

  const requests = input.endpoints
    .map((ep) => {
      const r = input.requestsById[ep.reqId];
      return r ? mapRequest(ep.reqId, r, ep) : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Prune expect cells that reference dropped identities (else core validate() rejects).
  const expect: ExpectMap = {};
  for (const [reqId, row] of Object.entries(input.expect || {})) {
    const kept: Record<string, (typeof row)[string]> = {};
    for (const [idId, exp] of Object.entries(row)) {
      if (includedIds.has(idId)) kept[idId] = exp;
    }
    if (Object.keys(kept).length) expect[reqId] = kept;
  }

  const oracles = input.oracleConfig
    ? {
        sensitive: input.oracleConfig.sensitive !== false,
        schema: input.oracleConfig.schema !== false,
      }
    : undefined;

  // Emit denySet ONLY when the caller set it (pass through as-is, including an
  // explicit []). The core's MatrixConfig.deny_set has serde(default) → omitting
  // the key applies [401,403,404], while an explicit [] is honored verbatim
  // (config.rs: default_deny_set + the bfla_config_empty_deny_set_honored test).
  const matrix: Record<string, unknown> = {
    endpoints: input.endpoints.map((e) => e.reqId),
    expect,
  };
  if (input.denySet !== undefined) matrix.denySet = input.denySet;

  const security: Record<string, unknown> = { matrix };
  if (oracles) security.oracles = oracles;

  return {
    version: 1,
    globals: { variables: input.globals || {} },
    environments: input.environments || [],
    identities,
    requests,
    security,
  };
}
