import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { qaParseImport } from '../qa/ImportData.jsx';
import { buildPayload } from '../qa/executor.js';

// Multi-host imported collections (e.g. the public-apis demo) carry absolute
// request URLs. The importer must keep them whole, and the executor must run
// them as-is rather than prepending the active environment's base URL.

const baseReq = (url) => ({ method: 'GET', url, headers: [], params: [], auth: { type: 'none' } });

describe('absolute-URL imports stay callable', () => {
  it('qaParseImport keeps an absolute URL whole (object url form)', () => {
    const collection = {
      info: { name: 'Demo', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Animals',
        item: [{
          name: 'Random cat fact',
          request: { method: 'GET', header: [], url: { raw: 'https://catfact.ninja/fact', protocol: 'https', host: ['catfact', 'ninja'], path: ['fact'] } },
        }],
      }],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    expect(parsed.error).toBeUndefined();
    expect(parsed.format).toBe('Postman v2.1');
    const reqEntry = parsed.collection.folders[0].requests[0];
    expect(reqEntry.path).toBe('https://catfact.ninja/fact');
  });

  it('qaParseImport keeps an absolute URL whole (string url form)', () => {
    const collection = {
      info: { name: 'Demo', schema: 'v2.1.0' },
      item: [{ name: 'Get', request: { method: 'GET', header: [], url: 'https://api.agify.io/?name=michael' } }],
    };
    const parsed = qaParseImport(JSON.stringify(collection));
    expect(parsed.collection.folders[0].requests[0].path).toBe('https://api.agify.io/?name=michael');
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

  it('buildPayload runs an absolute URL as-is (ignores env base)', () => {
    const payload = buildPayload(baseReq('https://catfact.ninja/fact'), { baseUrl: 'https://api.acme.dev' }, {});
    expect(payload.requestDetails.request.url).toBe('https://catfact.ninja/fact');
  });

  it('buildPayload prepends env base for a relative URL', () => {
    const payload = buildPayload(baseReq('/v1/users'), { baseUrl: 'https://api.acme.dev' }, {});
    expect(payload.requestDetails.request.url).toBe('https://api.acme.dev/v1/users');
  });

  it('the shipped demo collection imports as callable absolute-URL requests', () => {
    const text = fs.readFileSync('demo/public-apis.postman_collection.json', 'utf8');
    const parsed = qaParseImport(text);
    expect(parsed.error).toBeUndefined();
    expect(parsed.format).toBe('Postman v2.1');
    expect(parsed.collection.folders).toHaveLength(11);
    const reqs = parsed.collection.folders.flatMap((f) => f.requests);
    expect(reqs).toHaveLength(37);
    expect(reqs.every((r) => /^https:\/\//.test(r.path))).toBe(true);
    // each absolute URL must execute as-is (no env base prepended)
    const sample = reqs.find((r) => r.path === 'https://api.agify.io/?name=michael');
    const payload = buildPayload({ ...baseReq(sample.path), headers: [], params: [] }, { baseUrl: 'https://ignored.example' }, {});
    expect(payload.requestDetails.request.url).toBe('https://api.agify.io/?name=michael');
    // the POST echo request carries its JSON body through import
    const post = reqs.find((r) => r.path === 'https://httpbin.org/post');
    expect(post.method).toBe('POST');
    expect(parsed.details[post.id].body).toContain('QA Companion');
  });
});
