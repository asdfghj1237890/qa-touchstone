import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { qaParseImport } from '../qa/ImportData';
import { buildReq } from '../qa/buildReq';
import { buildPayload } from '../qa/executor';

// Multi-host imported collections (e.g. the public-apis demo) carry absolute
// request URLs. The importer must keep them whole, and the executor must run
// them as-is rather than prepending the active environment's base URL.

const baseReq = (url) => ({ method: 'GET', url, headers: [], params: [], auth: { type: 'none' } });

describe('absolute-URL imports stay callable', () => {
  it('qaParseImport keeps an absolute URL whole (object url form)', () => {
    const collection = {
      info: {
        name: 'Demo',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Animals',
          item: [
            {
              name: 'Random cat fact',
              request: {
                method: 'GET',
                header: [],
                url: {
                  raw: 'https://catfact.ninja/fact',
                  protocol: 'https',
                  host: ['catfact', 'ninja'],
                  path: ['fact'],
                },
              },
            },
          ],
        },
      ],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    expect(parsed.error).toBeUndefined();
    expect(parsed.format).toBe('Postman v2.1');
    const reqEntry = parsed.collection.folders[0].requests[0];
    expect(reqEntry.path).toBe('https://catfact.ninja/fact');
  });

  it('qaParseImport parses inline query from an absolute object raw URL when query[] is absent', () => {
    const collection = {
      info: { name: 'Demo', schema: 'v2.1.0' },
      item: [
        {
          name: 'Lookup',
          request: {
            method: 'GET',
            header: [],
            url: { raw: 'https://api.example.test/search?q=coffee&sort=desc' },
          },
        },
      ],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    const reqEntry = parsed.collection.folders[0].requests[0];
    expect(reqEntry.path).toBe('https://api.example.test/search?q=coffee&sort=desc');
    expect(parsed.details[reqEntry.id].params).toEqual([
      { key: 'q', value: 'coffee', on: true },
      { key: 'sort', value: 'desc', on: true },
    ]);

    window.QA.COLLECTIONS = [parsed.collection];
    window.QA.REQUEST_DETAILS = parsed.details;
    const req = buildReq(reqEntry.id);
    const payload = buildPayload(req, { baseUrl: 'https://ignored.example' }, {});
    expect(payload.requestDetails.request.url).toBe(
      'https://api.example.test/search?q=coffee&sort=desc'
    );
  });

  it('qaParseImport keeps an absolute URL whole (string url form)', () => {
    const collection = {
      info: { name: 'Demo', schema: 'v2.1.0' },
      item: [
        {
          name: 'Get',
          request: { method: 'GET', header: [], url: 'https://api.agify.io/?name=michael' },
        },
      ],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    expect(parsed.collection.folders[0].requests[0].path).toBe(
      'https://api.agify.io/?name=michael'
    );
    // The query must also be parsed into details.params so buildReq strips it
    // from the URL without losing it, and the executor re-emits it once.
    const id = parsed.collection.folders[0].requests[0].id;
    expect(parsed.details[id].params).toEqual([{ key: 'name', value: 'michael', on: true }]);
  });

  it('qaParseImport parses query when request itself is a string URL', () => {
    // Postman tolerates `request: "<url string>"` shorthand. Make sure path
    // and details.params both pick up the ?... portion.
    const collection = {
      info: { name: 'Demo', schema: 'v2.1.0' },
      item: [{ name: 'Short', request: 'https://x.test/a?b=c&d=e' }],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    const entry = parsed.collection.folders[0].requests[0];
    expect(entry.path).toBe('https://x.test/a?b=c&d=e');
    expect(parsed.details[entry.id].params).toEqual([
      { key: 'b', value: 'c', on: true },
      { key: 'd', value: 'e', on: true },
    ]);
  });

  it('qaParseImport captures Swagger 2 response schemas', () => {
    const spec = {
      swagger: '2.0',
      info: { title: 'Legacy Pets', version: '1.0.0' },
      host: 'api.example.test',
      basePath: '/v1',
      schemes: ['https'],
      paths: {
        '/pets': {
          get: {
            tags: ['pets'],
            summary: 'List pets',
            responses: {
              200: {
                description: 'OK',
                schema: { type: 'array', items: { $ref: '#/definitions/Pet' } },
              },
            },
          },
        },
      },
      definitions: {
        Pet: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
      },
    };

    const parsed = qaParseImport(JSON.stringify(spec));
    expect(parsed.error).toBeUndefined();
    expect(parsed.format).toBe('Swagger 2.0');
    const entry = parsed.collection.folders[0].requests[0];
    const schemas = parsed.details[entry.id].responseSchemas;
    expect(schemas['200']).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    });
    expect(parsed.details[entry.id].responseSchema).toEqual(schemas['200']);
  });

  it('buildPayload runs an absolute URL as-is (ignores env base)', () => {
    const payload = buildPayload(
      baseReq('https://catfact.ninja/fact'),
      { baseUrl: 'https://api.acme.dev' },
      {}
    );
    expect(payload.requestDetails.request.url).toBe('https://catfact.ninja/fact');
  });

  it('buildPayload prepends env base for a relative URL', () => {
    const payload = buildPayload(baseReq('/v1/users'), { baseUrl: 'https://api.acme.dev' }, {});
    expect(payload.requestDetails.request.url).toBe('https://api.acme.dev/v1/users');
  });

  it('buildPayload marks API key style headers as redirect-sensitive', () => {
    const payload = buildPayload(
      {
        ...baseReq('https://api.test/thing'),
        headers: [{ key: 'X-Api-Key', value: '{{apiKey}}', on: true }],
        auth: {
          type: 'apiKey',
          apiKey: { key: 'X-Tenant-Token', value: '{{tenantToken}}', placement: 'header' },
        },
      },
      { baseUrl: '' },
      { apiKey: 'ak', tenantToken: 'tk' }
    );
    expect(payload.sensitiveHeaderNames).toEqual(['X-Api-Key', 'X-Tenant-Token']);
  });

  it('buildPayload substitutes API key auth names for header and query placement', () => {
    const headerPayload = buildPayload(
      {
        ...baseReq('https://api.test/thing'),
        auth: {
          type: 'apiKey',
          apiKey: { key: '{{tenantHeader}}', value: '{{tenantToken}}', placement: 'header' },
        },
      },
      { baseUrl: '' },
      { tenantHeader: 'X-Tenant-Token', tenantToken: 'tk' }
    );
    expect(headerPayload.requestDetails.request.header).toContainEqual({
      key: 'X-Tenant-Token',
      value: 'tk',
    });
    expect(headerPayload.requestDetails.request.header).not.toContainEqual({
      key: '{{tenantHeader}}',
      value: 'tk',
    });
    expect(headerPayload.sensitiveHeaderNames).toEqual(['X-Tenant-Token']);

    const queryPayload = buildPayload(
      {
        ...baseReq('https://api.test/thing'),
        auth: {
          type: 'apiKey',
          apiKey: { key: '{{apiKeyParam}}', value: '{{apiKeyValue}}', placement: 'query' },
        },
      },
      { baseUrl: '' },
      { apiKeyParam: 'api_key', apiKeyValue: 'tk' }
    );
    expect(queryPayload.requestDetails.request.url).toBe('https://api.test/thing?api_key=tk');
  });

  it('buildReq preserves imported request headers', () => {
    window.QA.COLLECTIONS = [
      {
        id: 'c1',
        name: 'C',
        count: 1,
        folders: [
          {
            name: 'F',
            requests: [
              { id: 'r1', method: 'GET', name: 'With header', path: 'https://api.test/thing' },
            ],
          },
        ],
      },
    ];
    window.QA.REQUEST_DETAILS = {
      r1: {
        params: [],
        headers: [{ key: 'X-Api-Key', value: '{{apiKey}}', on: true }],
        body: null,
        auth: 'none',
      },
    };

    const req = buildReq('r1');
    expect(req.headers).toEqual([
      { key: 'Accept', value: 'application/json', on: true },
      { key: 'X-Api-Key', value: '{{apiKey}}', on: true },
    ]);
  });

  it('the shipped demo collection imports as callable absolute-URL requests', () => {
    const text = fs.readFileSync('demo/public-apis.postman_collection.json', 'utf8');
    const parsed = qaParseImport(text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.format).toBe('Postman v2.1');
    expect(parsed.collection.folders).toHaveLength(7);
    const reqs = parsed.collection.folders.flatMap((f) => f.requests);
    expect(reqs).toHaveLength(26);
    expect(reqs.every((r) => /^https:\/\//.test(r.path))).toBe(true);
    // each absolute URL must execute as-is (no env base prepended)
    const sample = reqs.find(
      (r) =>
        r.path ===
        'https://api.open-meteo.com/v1/forecast?latitude=25.0330&longitude=121.5654&current_weather=true'
    );
    const payload = buildPayload(
      { ...baseReq(sample.path), headers: [], params: [] },
      { baseUrl: 'https://ignored.example' },
      {}
    );
    expect(payload.requestDetails.request.url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=25.0330&longitude=121.5654&current_weather=true'
    );
    // the POST request carries its JSON body through import
    const post = reqs.find((r) => r.path === 'https://jsonplaceholder.typicode.com/posts');
    expect(post.method).toBe('POST');
    expect(parsed.details[post.id].body).toContain('QA Touchstone');
  });
});
