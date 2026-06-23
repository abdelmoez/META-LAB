import { describe, it, expect } from 'vitest';
import { createDoajConnector } from '../../../server/pecanSearch/connectors/doaj.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'doaj', label: 'DOAJ', platform: 'DOAJ API v3',
  baseUrl: 'https://doaj.org/api/v3',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 1000, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi'],
};

/** Build a DOAJ-shaped result object. */
function doajResult(i) {
  return {
    id: `doaj-${i}`,
    bibjson: {
      title: `Title ${i}`,
      abstract: `Abstract body ${i}.`,
      year: '2018',
      author: [{ name: 'Smith J', affiliation: 'Uni' }, { name: 'Doe A' }],
      journal: { title: 'J Open Access', volume: '12', number: '3', language: ['EN'], publisher: 'OA Press' },
      identifier: [{ type: 'doi', id: `10.5/${i}` }, { type: 'eissn', id: '2708-5481' }],
      keywords: ['diabetes', 'metformin'],
      link: [{ type: 'fulltext', url: `https://example.org/${i}` }],
      start_page: '1', end_page: '14',
    },
  };
}

/**
 * Mock the DOAJ /search/articles/{q}?page&pageSize endpoint with `total` results,
 * honoring page/pageSize paging and the 1000-record ceiling (400 beyond offset 1000).
 */
function doajMock(total = 3) {
  return makeMock((url) => {
    if (!url.includes('/search/articles/')) return { status: 404, text: '' };
    const u = new URL(url);
    const page = Number(u.searchParams.get('page') || 1);
    const pageSize = Number(u.searchParams.get('pageSize') || 10);
    const offset = (page - 1) * pageSize;
    if (offset >= 1000) {
      return { status: 400, json: { status: 'bad_request', error: 'You cannot access results beyond 1000 records via this API.' } };
    }
    const ids = Array.from({ length: total }, (_, i) => i + 1).slice(offset, offset + pageSize);
    return { json: { total, page, pageSize, query: 'q', results: ids.map(doajResult) } };
  });
}

describe('DOAJ connector — contract', () => {
  it('capabilities() has the standard shape (maxResults capped at 1000)', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'doaj', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
    expect(cap.maxResults).toBe(1000); // DOAJ ceiling overrides the larger cfg.maxResults
  });

  it('translateQuery maps fields and joins concepts with AND, terms with op', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery({
      concepts: [
        { op: 'OR', terms: [{ text: 'heart failure', field: 'title' }, { text: 'cardiomyopathy', field: 'title' }] },
        { op: 'OR', terms: [{ text: 'Smith J', field: 'author' }] },
      ],
      filters: { dateFrom: '2010', dateTo: '2020', languages: ['EN'] },
    });
    expect(tr.query).toContain('bibjson.title:"heart failure"');
    expect(tr.query).toContain('bibjson.title:cardiomyopathy');
    expect(tr.query).toContain('bibjson.author.name:"Smith J"');
    expect(tr.query).toContain('bibjson.year:[2010 TO 2020]');
    // Language is mapped to a DOAJ ISO 639-1 code (verified live: DOAJ matches "en", not "EN"/"English").
    expect(tr.query).toContain('bibjson.journal.language:en');
    expect(tr.query).toMatch(/ AND /); // concepts AND-joined
    expect(tr.query).toMatch(/ OR /);  // terms OR-joined within a concept
    expect(tr.queryHash).toHaveLength(16);
  });

  it('expands tiab to (title OR abstract) and searches DOI via identifier.id', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery({
      concepts: [
        { terms: [{ text: 'sepsis', field: 'tiab' }] },
        { terms: [{ text: '10.1/abc', field: 'doi' }] },
      ],
    });
    expect(tr.query).toContain('(bibjson.title:sepsis OR bibjson.abstract:sepsis)');
    expect(tr.query).toContain('bibjson.identifier.id:');
  });

  it('warns and DROPS truncation (DOAJ disables wildcards)', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'metformin', field: 'title', truncate: true }] }] });
    expect(tr.warnings.join(' ')).toMatch(/truncation/i);
    expect(tr.query).not.toContain('*'); // no wildcard emitted
  });

  it('warns on an unsupported field (mesh) instead of silently dropping it', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery({
      concepts: [{ terms: [{ text: 'Diabetes Mellitus', type: 'controlled', field: 'mesh', vocab: { mesh: 'Diabetes Mellitus' } }] }],
    });
    expect(tr.warnings.join(' ')).toMatch(/mesh/i);
  });

  it('escapes Elasticsearch reserved characters in a term (injection-safe)', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'a:b(c)/d', field: 'title' }] }] });
    expect(tr.query).toContain('\\:');
    expect(tr.query).toContain('\\(');
    expect(tr.query).toContain('\\)');
    expect(tr.query).toContain('\\/');
  });

  it('uses an override query verbatim and sets hasOverride', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL, { override: 'bibjson.title:custom' });
    expect(tr.query).toBe('bibjson.title:custom');
    expect(tr.hasOverride).toBe(true);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact count from total', async () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(76384));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 76384, kind: 'exact' });
  });

  it('previewCount never throws — returns unavailable on a server error', async () => {
    const mock = makeMock(() => ({ status: 500, json: { error: 'boom' } }));
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('paginates by page and stops at the end', async () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(3));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('respects capRemaining and stops early', async () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(100));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2, capRemaining: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.nextCursor).toBeNull(); // cap reached after one page
  });

  it('never pages past the DOAJ 1000-record ceiling', async () => {
    // Use a realistic provider pageSize (100) so the ceiling math is exercised.
    const cfg100 = { ...PROVIDER_CFG, pageSize: 100 };
    const c = buildConnector(createDoajConnector, cfg100, doajMock(5000));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // page 10 @ pageSize 100 → offset 900; next would be offset 1000 (forbidden).
    const page = await c.search(tr, JSON.stringify({ page: 10, pageSize: 100, total: 5000 }), { pageSize: 100, capRemaining: 5000 });
    expect(page.records.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBeNull(); // refuses to step to offset 1000
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(0));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it('normalize maps a record + sets providerRecordId + raw provenance', async () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('doaj-1');
    expect(n.doi).toBe('10.5/1');
    expect(n.title).toBe('Title 1');
    expect(n.abstract).toMatch(/Abstract body 1/);
    expect(n.authors).toMatch(/Smith J/);
    expect(n.year).toBe('2018');
    expect(n.journal).toBe('J Open Access');
    expect(n.url).toBe('https://example.org/1');
    expect(typeof n.raw).toBe('string');
    expect(n.raw.length).toBeGreaterThan(0);
  });

  it('tolerates a malformed/partial record (missing bibjson) without throwing', () => {
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, doajMock(1));
    const n1 = c.normalize({ id: 'bare-1' });           // no bibjson at all
    expect(n1.providerRecordId).toBe('bare-1');
    expect(n1.title).toBe('');
    const n2 = c.normalize(null);                        // totally malformed
    expect(typeof n2.providerRecordId).toBe('string');   // falls back to contentHashId
    const n3 = c.normalize({ bibjson: { title: 'Only title', identifier: 'not-an-array', author: null } });
    expect(n3.title).toBe('Only title');
    expect(n3.authors).toBe('');
  });

  it('classifies a 429 from the http client as a retryable rate-limit error', async () => {
    // Exhaust retries so the typed error surfaces (retryLimit=2 in fixedDeps).
    const mock = makeMock(() => ({ status: 429, headers: { 'retry-after': '0' }, json: { error: 'slow down' } }));
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 from the http client as a retryable provider-unavailable error', async () => {
    const mock = makeMock(() => ({ status: 500, json: { error: 'boom' } }));
    const c = buildConnector(createDoajConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });
});
