/**
 * tests/unit/pecanSearch/_harness.js — shared, deterministic test harness for the
 * Pecan Search Engine. NO real network: a mock fetch + fixed clock + no-op sleep
 * drive the connectors and the shared HTTP client.
 */
import { createHttpClient } from '../../../server/pecanSearch/httpClient.js';

/** Build a mock fetch from a route table or a function(url, opts) => responseSpec. */
export function makeMock(routes) {
  return function mockFetch(url, opts) {
    const u = String(url);
    let spec;
    if (typeof routes === 'function') spec = routes(u, opts);
    else spec = (routes || []).find((r) => (typeof r.match === 'function' ? r.match(u) : new RegExp(r.match).test(u)));
    if (!spec) spec = { status: 404, text: '' };
    if (spec.throw) return Promise.reject(spec.throw);
    return Promise.resolve(makeResponse(spec));
  };
}

function makeResponse(spec) {
  const status = spec.status != null ? spec.status : 200;
  const body = spec.text != null ? spec.text : (spec.json != null ? JSON.stringify(spec.json) : '');
  const headers = new Map(Object.entries(spec.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers.has(String(k).toLowerCase()) ? headers.get(String(k).toLowerCase()) : null) },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body || 'null')),
  };
}

/** Deterministic deps for connectors: fixed clock, instant sleep, fixed jitter. */
export function fixedDeps(overrides = {}) {
  return {
    now: () => 1700000000000,
    sleep: () => Promise.resolve(),
    random: () => 0.42,
    logger: { debug() {}, warn() {} },
    contact: { tool: 'pecanrev-test', email: 'test@pecanrev.test' },
    retryLimit: 2,
    ...overrides,
  };
}

/** A hardened HTTP client wired to a mock fetch. */
export function httpFor(mockFetch, extra = {}) {
  return createHttpClient({ fetch: mockFetch, now: () => 1700000000000, sleep: () => Promise.resolve(), random: () => 0.42, logger: { debug() {}, warn() {} }, ...extra });
}

/** Build a connector instance from its factory + a (partial) provider config + mock fetch. */
export function buildConnector(factory, providerConfig, mockFetch, depOverrides = {}) {
  const deps = fixedDeps({ http: httpFor(mockFetch), ...depOverrides });
  return factory(providerConfig, deps);
}

/** A minimal canonical query for translation tests. */
export const SAMPLE_CANONICAL = {
  concepts: [
    { id: 'p', label: 'Population', op: 'OR', terms: [{ text: 'type 2 diabetes', field: 'tiab' }, { text: 'T2DM', field: 'tiab' }] },
    { id: 'i', label: 'Intervention', op: 'OR', terms: [{ text: 'metformin', field: 'tiab', truncate: true }] },
  ],
  filters: { dateFrom: '2010', dateTo: '2020', languages: ['English'], pubTypes: [] },
};
