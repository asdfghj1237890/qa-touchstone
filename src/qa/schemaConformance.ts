// ── QA Touchstone — schema conformance engine (pure logic, no React) ─────────
// Validate a response body against a DECLARED schema (a JSON-Schema / OpenAPI 3
// subset), as opposed to the drift oracle in oracles.ts which infers a contract
// from a previous response. This answers "does the live response actually obey
// the contract the API promises?" — type, required, enum, and format.
import './setup';
import { normalizePath } from './oracles';
import type { Finding, Severity } from './types';

/** Supported JSON-Schema / OpenAPI 3 subset. */
export interface JsonSchema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  nullable?: boolean;
  format?: string;
}

export type ViolationKind = 'type' | 'required' | 'enum' | 'format';
export interface Violation {
  kind: ViolationKind;
  path: string;
  expected: string;
  actual: string;
  message: string;
}

// Cap so a hostile/huge body (e.g. a 10k-element array all of the wrong type)
// cannot flood the report; conformanceFindings adds a single summary instead.
export const MAX_VIOLATIONS = 50;

function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // 'string' | 'boolean' | 'object' | 'undefined'
}

// A value of JS-type `actual` satisfies a schema-declared `type` token. `integer`
// accepts only whole numbers; `number` accepts both integers and floats.
function typeMatches(declared: string, actual: string): boolean {
  if (declared === actual) return true;
  if (declared === 'number' && actual === 'integer') return true; // 2 satisfies number
  if (declared === 'integer' && actual === 'integer') return true;
  return false;
}

const FORMAT_RE: Record<string, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'date-time': /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  uri: /^[a-z][a-z0-9+.-]*:\S+$/i,
};

// Validate `value` against `schema` at `path`, collecting violations (no throw).
// Stops collecting once MAX_VIOLATIONS is reached so a pathological body is bounded.
export function validateAgainstSchema(value: unknown, schema: JsonSchema | null | undefined, path = '$', out: Violation[] = []): Violation[] {
  if (!schema || typeof schema !== 'object') return out;
  if (out.length >= MAX_VIOLATIONS) return out;

  const types = schema.type == null ? [] : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  const nullable = schema.nullable === true || types.includes('null');
  const actual = jsonType(value);

  if (value === null) {
    if (!nullable && types.length) out.push({ kind: 'type', path, expected: types.join('|'), actual: 'null', message: `${path}: null is not allowed` });
    return out;
  }

  if (types.length && !types.some(t => typeMatches(t, actual))) {
    out.push({ kind: 'type', path, expected: types.join('|'), actual, message: `${path}: expected ${types.join('|')}, got ${actual}` });
    return out; // a wrong container type makes deeper checks meaningless
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(e => e === value)) {
    out.push({ kind: 'enum', path, expected: schema.enum.map(String).join('|'), actual: String(value), message: `${path}: ${String(value)} is not one of ${schema.enum.map(String).join('|')}` });
  }

  if (schema.format && typeof value === 'string' && FORMAT_RE[schema.format] && !FORMAT_RE[schema.format].test(value)) {
    out.push({ kind: 'format', path, expected: schema.format, actual: 'malformed', message: `${path}: not a valid ${schema.format}` });
  }

  if (actual === 'object' && (schema.properties || schema.required)) {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required || []) {
      if (!(req in obj)) out.push({ kind: 'required', path: `${path}.${req}`, expected: 'present', actual: 'absent', message: `${path}.${req}: required property is missing` });
      if (out.length >= MAX_VIOLATIONS) return out;
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in obj) validateAgainstSchema(obj[k], sub, `${path}.${k}`, out);
      if (out.length >= MAX_VIOLATIONS) return out;
    }
  }

  if (actual === 'array' && schema.items) {
    const arr = value as unknown[];
    for (let i = 0; i < arr.length; i++) {
      validateAgainstSchema(arr[i], schema.items, `${path}[${i}]`, out);
      if (out.length >= MAX_VIOLATIONS) return out;
    }
  }

  return out;
}

const KIND_SEVERITY: Record<ViolationKind, Severity> = {
  type: 'medium', required: 'medium', enum: 'medium', format: 'low',
};

// Map violations onto schema-conformance findings. Capped at MAX_VIOLATIONS with a
// trailing summary finding so the count is honest without flooding the report.
export function conformanceFindings(body: unknown, schema: JsonSchema | null | undefined): Finding[] {
  if (!schema) return [];
  const violations = validateAgainstSchema(body, schema);
  const findings: Finding[] = violations.map(v => ({
    ruleId: `schema-conformance:${v.kind}`,
    oracle: 'schema-conformance',
    severity: KIND_SEVERITY[v.kind],
    title: `Schema ${v.kind} violation`,
    path: normalizePath(v.path),
    evidence: v.message,
    source: 'rule',
  }));
  if (violations.length >= MAX_VIOLATIONS) {
    findings.push({
      ruleId: 'schema-conformance:summary', oracle: 'schema-conformance', severity: 'low',
      title: `…and possibly more (capped at ${MAX_VIOLATIONS})`, path: '$', evidence: `Stopped after ${MAX_VIOLATIONS} violations`, source: 'rule',
    });
  }
  return findings;
}
