// ── QA Touchstone — test-plan coverage model (pure, no React) ───────────────
// "Requirements" are represented by collection folders/tags until a first-class
// requirements model exists. OpenAPI imports already map tags to folders.
import './setup';
import { endpointPrivileged } from './authz';
import type {
  ConformanceTest,
  Endpoint,
  ExpectMap,
  FuzzSuitePlan,
  Identity,
  RateLimitTest,
  BolaTest,
} from './types';

export type CoverageRequest = {
  reqId: string;
  method: string;
  path: string;
  name?: string;
  folder?: string;
};

export type CoverageGap = {
  id: string;
  label: string;
  detail?: string;
};

export type CoverageBucket = {
  total: number;
  covered: number;
  percent: number;
  gaps: CoverageGap[];
};

export type CoverageModel = {
  requirements: CoverageBucket;
  endpoints: CoverageBucket;
  roles: CoverageBucket & {
    privileged: number;
    nonPrivileged: number;
  };
  matrixCells: CoverageBucket;
  checks: {
    conformance: CoverageBucket;
    bfla: CoverageBucket;
    bola: CoverageBucket;
    fuzz: CoverageBucket;
    rateLimit: CoverageBucket;
  };
};

function pct(covered: number, total: number): number {
  return total ? Math.round((covered / total) * 100) : 100;
}

function bucket(total: number, covered: number, gaps: CoverageGap[] = []): CoverageBucket {
  return { total, covered, percent: pct(covered, total), gaps };
}

function reqLabel(r: CoverageRequest | Endpoint | RateLimitTest | BolaTest): string {
  return `${r.method || ''} ${r.path || ''}`.trim() || String((r as any).reqId || (r as any).id);
}

export function buildCoverageModel(input: {
  requests?: CoverageRequest[];
  endpoints?: Endpoint[];
  identities?: Identity[];
  expect?: ExpectMap;
  conformanceTests?: ConformanceTest[];
  bolaTests?: BolaTest[];
  rateLimitTests?: RateLimitTest[];
  fuzzPlans?: FuzzSuitePlan[];
}): CoverageModel {
  const requests = input.requests || [];
  const endpoints = input.endpoints || [];
  const identities = input.identities || [];
  const expect = input.expect || {};
  const selected = new Set(endpoints.map((e) => e.reqId));
  const selectedEndpointIds = new Set(endpoints.map((e) => e.reqId));

  const folders = [...new Set(requests.map((r) => r.folder || 'default'))].sort();
  const coveredFolders = new Set(
    requests.filter((r) => selected.has(r.reqId)).map((r) => r.folder || 'default')
  );
  const requirementGaps = folders
    .filter((f) => !coveredFolders.has(f))
    .map((f) => ({ id: f, label: f, detail: 'No selected endpoint in this group' }));

  const endpointGaps = requests
    .filter((r) => !selected.has(r.reqId))
    .map((r) => ({ id: r.reqId, label: reqLabel(r), detail: r.folder || '' }));

  const activeRoleIds = new Set<string>();
  let coveredCells = 0;
  let totalCells = 0;
  const cellGaps: CoverageGap[] = [];
  for (const ep of endpoints) {
    let rowCovered = 0;
    for (const id of identities) {
      totalCells++;
      const exp = (expect[ep.reqId] || {})[id.id];
      if (exp && exp !== 'skip') {
        coveredCells++;
        rowCovered++;
        activeRoleIds.add(id.id);
      }
    }
    if (!rowCovered) {
      cellGaps.push({ id: ep.reqId, label: reqLabel(ep), detail: 'All identities are skipped' });
    }
  }
  const roleGaps = identities
    .filter((id) => !activeRoleIds.has(id.id))
    .map((id) => ({
      id: id.id,
      label: id.id === 'anon' ? 'anon' : id.name || id.id,
      detail: 'No non-skip matrix cell',
    }));
  const hasPrivilegedRole = identities.some((id) => id.privileged);
  const hasNonPrivilegedUserRole = identities.some((id) => id.id !== 'anon' && !id.privileged);
  if (identities.length && !hasPrivilegedRole) {
    roleGaps.push({ id: '__privileged__', label: 'Privileged/admin identity', detail: 'Missing' });
  }
  if (identities.length && !hasNonPrivilegedUserRole) {
    roleGaps.push({
      id: '__non_privileged__',
      label: 'Non-privileged user identity',
      detail: 'Missing',
    });
  }

  const conformanceReqs = new Set(
    (input.conformanceTests || []).map((t) => t.reqId).filter((id) => selectedEndpointIds.has(id))
  );
  const conformanceGaps = endpoints
    .filter((ep) => !conformanceReqs.has(ep.reqId))
    .map((ep) => ({ id: ep.reqId, label: reqLabel(ep), detail: 'No response schema available' }));

  const privilegedEndpoints = endpoints.filter((ep) => endpointPrivileged(ep).privileged);
  const nonPrivIdentities = identities.filter((id) => !id.privileged);
  const bflaTotal = privilegedEndpoints.length * nonPrivIdentities.length;
  const bflaApplicable = endpoints.length > 0 && identities.length > 0;
  const bflaGaps =
    bflaTotal > 0 || !bflaApplicable
      ? []
      : [
          {
            id: '__bfla__',
            label: 'BFLA pairs',
            detail: 'Need at least one privileged endpoint and one non-privileged identity',
          },
        ];

  const bolaReqs = new Set(
    (input.bolaTests || []).map((t) => t.reqId).filter((id) => id && selectedEndpointIds.has(id))
  );
  const bolaCandidates = endpoints.filter((ep) => /\/[:{]?\w*id\}?|[?&]\w*id=/i.test(ep.path));
  const bolaGaps = bolaCandidates
    .filter((ep) => !bolaReqs.has(ep.reqId))
    .map((ep) => ({ id: ep.reqId, label: reqLabel(ep), detail: 'No BOLA object-id test' }));

  const fuzzReqs = new Set(
    (input.fuzzPlans || []).map((p) => p.reqId).filter((id) => selectedEndpointIds.has(id))
  );
  const fuzzGaps = endpoints
    .filter((ep) => !fuzzReqs.has(ep.reqId))
    .map((ep) => ({ id: ep.reqId, label: reqLabel(ep), detail: 'No fuzzable seed detected' }));

  const rlReqs = new Set(
    (input.rateLimitTests || [])
      .map((t) => t.reqId)
      .filter((id) => id && selectedEndpointIds.has(id))
  );
  const rlCandidates = endpoints.filter(
    (ep) =>
      endpointPrivileged(ep).privileged ||
      /login|auth|token|search|create|delete|update/i.test(ep.path)
  );
  const rlGaps = rlCandidates
    .filter((ep) => !rlReqs.has(ep.reqId))
    .map((ep) => ({ id: ep.reqId, label: reqLabel(ep), detail: 'No rate-limit burst test' }));

  return {
    requirements: bucket(folders.length, coveredFolders.size, requirementGaps),
    endpoints: bucket(requests.length, selected.size, endpointGaps),
    roles: {
      ...bucket(
        identities.length ? identities.length + 2 : 0,
        identities.length
          ? activeRoleIds.size + (hasPrivilegedRole ? 1 : 0) + (hasNonPrivilegedUserRole ? 1 : 0)
          : 0,
        roleGaps
      ),
      privileged: identities.filter((id) => id.privileged).length,
      nonPrivileged: identities.filter((id) => !id.privileged).length,
    },
    matrixCells: bucket(totalCells, coveredCells, cellGaps),
    checks: {
      conformance: bucket(endpoints.length, conformanceReqs.size, conformanceGaps),
      bfla: bucket(bflaTotal || (bflaApplicable ? 1 : 0), bflaTotal, bflaGaps),
      bola: bucket(bolaCandidates.length, bolaCandidates.length - bolaGaps.length, bolaGaps),
      fuzz: bucket(endpoints.length, fuzzReqs.size, fuzzGaps),
      rateLimit: bucket(rlCandidates.length, rlCandidates.length - rlGaps.length, rlGaps),
    },
  };
}
