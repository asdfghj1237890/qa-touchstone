// src/__tests__/schema-conformance.test.js
import { describe, it, expect } from 'vitest';
import { validateAgainstSchema, conformanceFindings } from '../qa/schemaConformance';

const userSchema = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['admin', 'user'] },
    tags: { type: 'array', items: { type: 'string' } },
    profile: { type: 'object', properties: { age: { type: 'integer' } } },
  },
};

describe('validateAgainstSchema — type checking', () => {
  it('accepts a conforming object', () => {
    expect(validateAgainstSchema({ id: 1, email: 'a@b.com', role: 'admin' }, userSchema)).toEqual(
      []
    );
  });
  it('flags a wrong scalar type', () => {
    const v = validateAgainstSchema({ id: 'oops', email: 'a@b.com' }, userSchema);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      kind: 'type',
      path: '$.id',
      expected: 'integer',
      actual: 'string',
    });
  });
  it('treats an integer-valued number as integer but rejects a fractional one', () => {
    expect(validateAgainstSchema({ id: 2, email: 'a@b.com' }, userSchema)).toEqual([]);
    const v = validateAgainstSchema({ id: 2.5, email: 'a@b.com' }, userSchema);
    expect(v[0]).toMatchObject({ kind: 'type', path: '$.id' });
  });
});

describe('validateAgainstSchema — required / nullable', () => {
  it('flags a missing required property', () => {
    const v = validateAgainstSchema({ id: 1 }, userSchema);
    expect(v).toEqual([
      {
        kind: 'required',
        path: '$.email',
        expected: 'present',
        actual: 'absent',
        message: expect.any(String),
      },
    ]);
  });
  it('allows null only when nullable or type includes null', () => {
    expect(
      validateAgainstSchema(
        { v: null },
        { type: 'object', properties: { v: { type: 'string', nullable: true } } }
      )
    ).toEqual([]);
    expect(
      validateAgainstSchema(
        { v: null },
        { type: 'object', properties: { v: { type: ['string', 'null'] } } }
      )
    ).toEqual([]);
    const v = validateAgainstSchema(
      { v: null },
      { type: 'object', properties: { v: { type: 'string' } } }
    );
    expect(v[0]).toMatchObject({ kind: 'type', path: '$.v', actual: 'null' });
  });
});

describe('validateAgainstSchema — enum / arrays / nesting', () => {
  it('flags a value outside an enum', () => {
    const v = validateAgainstSchema({ id: 1, email: 'a@b.com', role: 'superuser' }, userSchema);
    expect(v[0]).toMatchObject({ kind: 'enum', path: '$.role' });
  });
  it('validates array item types, pointing at the failing index', () => {
    const v = validateAgainstSchema({ id: 1, email: 'a@b.com', tags: ['ok', 5] }, userSchema);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'type', path: '$.tags[1]', actual: 'integer' });
  });
  it('recurses into nested objects', () => {
    const v = validateAgainstSchema(
      { id: 1, email: 'a@b.com', profile: { age: 'old' } },
      userSchema
    );
    expect(v[0]).toMatchObject({ kind: 'type', path: '$.profile.age', actual: 'string' });
  });
});

describe('validateAgainstSchema — format (advisory)', () => {
  it('flags a malformed email as a format violation', () => {
    const v = validateAgainstSchema({ id: 1, email: 'not-an-email' }, userSchema);
    expect(v[0]).toMatchObject({ kind: 'format', path: '$.email', expected: 'email' });
  });
});

describe('conformanceFindings', () => {
  it('maps violations to schema-conformance findings with sensible severities', () => {
    const fs = conformanceFindings({ id: 'x', email: 'bad', role: 'root' }, userSchema);
    const byKind = Object.fromEntries(fs.map((f) => [f.ruleId, f]));
    expect(fs.every((f) => f.oracle === 'schema-conformance')).toBe(true);
    expect(byKind['schema-conformance:type'].severity).toBe('medium');
    expect(byKind['schema-conformance:format'].severity).toBe('low');
    expect(byKind['schema-conformance:enum'].severity).toBe('medium');
  });
  it('returns no findings for a conforming body or a null schema', () => {
    expect(conformanceFindings({ id: 1, email: 'a@b.com' }, userSchema)).toEqual([]);
    expect(conformanceFindings({ anything: true }, null)).toEqual([]);
  });
  it('caps the number of findings so a hostile body cannot flood the report', () => {
    const arrSchema = { type: 'array', items: { type: 'string' } };
    const body = Array.from({ length: 500 }, () => 1); // 500 type violations
    const fs = conformanceFindings(body, arrSchema);
    expect(fs.length).toBeLessThanOrEqual(51); // capped (+1 summary)
    expect(fs.some((f) => /more/i.test(f.title))).toBe(true);
  });
});
