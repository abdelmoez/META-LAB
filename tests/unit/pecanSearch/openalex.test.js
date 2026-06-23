import { describe, it, expect } from 'vitest';
import { createOpenAlexConnector, reconstructAbstract } from '../../../server/pecanSearch/connectors/openalex.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'openalex', label: 'OpenAlex', platform: 'OpenAlex REST',
  baseUrl: 'https://api.openalex.org',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid', 'pubType', 'language'],
};

/** Build one OpenAlex Work object as the live API returns it (with our select). */
function work(i, { invIndex } = {}) {
  return {
    id: `https://openalex.org/W${i}`,
    doi: `https://doi.org/10.1/${i}`,
    title: `Title ${i}`,
    display_name: `Title ${i}`,
    abstract_inverted_index: invIndex || { Background: [0], abstract: [1], [`w${i}`]: [2] },
    authorships: [
      { author: { display_name: 'Jane Smith' } },
      { author: { display_name: 'John Doe' } },
    ],
    publication_year: 2021,
    publication_date: '2021-05-01',
    primary_location: { source: { display_name: 'J Test' } },
    type: 'article',
    language: 'en',
    ids: { openalex: `https://openalex.org/W${i}`, doi: `https://doi.org/10.1/${i}`, pmid: `https://pubmed.ncbi.nlm.nih.gov/${1000 + i}` },
  };
}

/**
 * Mock the /works endpoint with cursor paging over `total` works, `perPageFromUrl`
 * honored, and meta.next_cursor advancing until exhausted (null on the last page).
 */
function openAlexMock(total = 3) {
  return makeMock((url) => {
    if (!url.includes('/works')) return { status: 404, text: '' };
    const u = new URL(url);
    const perPage = Number(u.searchParams.get('per-page') || 25);
    const cursor = u.searchParams.get('cursor') || '*';
    // Decode our cursor: '*' = offset 0; otherwise 'off:<n>'.
    const offset = cursor === '*' ? 0 : Number(String(cursor).replace(/^off:/, '')) || 0;
    const slice = [];
    for (let i = offset; i < Math.min(offset + perPage, total); i += 1) slice.push(work(i + 1));
    const nextOffset = offset + perPage;
    const next_cursor = nextOffset < total ? `off:${nextOffset}` : null;
    return { json: { meta: { count: total, per_page: perPage, next_cursor, db_response_time_ms: 5 }, results: slice } };
  });
}

describe('OpenAlex connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'openalex', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('reconstructAbstract rebuilds plain text from an inverted index, in order', () => {
    const txt = reconstructAbstract({ Metformin: [0], is: [1, 3], a: [2], drug: [4] });
    expect(txt).toBe('Metformin is a is drug');
    expect(reconstructAbstract(null)).toBe('');
    expect(reconstructAbstract({})).toBe('');
  });

  it('translateQuery maps concepts to title_and_abstract.search (OR via pipe) + native filters', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // Two concepts → two comma-joined search filters; first concept's two terms OR'd via |.
    expect(tr.query).toContain('title_and_abstract.search:type 2 diabetes|T2DM');
    expect(tr.query).toContain('title_and_abstract.search:metformin');
    // Native filters present.
    expect(tr.query).toContain('from_publication_date:2010-01-01');
    expect(tr.query).toContain('to_publication_date:2020-12-31');
    expect(tr.query).toContain('language:en');
    expect(tr.queryHash).toHaveLength(16);
  });

  it('warns (does not silently drop) on an unsupported field restriction and on truncation', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const tr = c.translateQuery({
      concepts: [
        { label: 'Author', op: 'OR', terms: [{ text: 'Einstein', field: 'author' }] },
        { label: 'Drug', op: 'OR', terms: [{ text: 'metformin', field: 'tiab', truncate: true }] },
      ],
    });
    const w = tr.warnings.join(' ');
    expect(w).toMatch(/title\+abstract/i);          // author field collapse warned
    expect(w).toMatch(/truncation/i);               // truncation warned
    expect(tr.unsupported).toContain('field:author');
  });

  it('OR-joins synonym terms within a concept (op is the inter-concept operator)', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const tr = c.translateQuery({
      concepts: [{ label: 'Combo', op: 'AND', terms: [{ text: 'aspirin', field: 'tiab' }, { text: 'warfarin', field: 'tiab' }] }],
    });
    // Synonyms within a concept are OR-joined (pipe) — never AND'd, never dropped.
    expect(tr.query).toContain('title_and_abstract.search:aspirin|warfarin');
  });

  it('override is used verbatim and sets hasOverride', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL, { override: 'title.search:foo,type:article' });
    expect(tr.query).toBe('title.search:foo,type:article');
    expect(tr.hasOverride).toBe(true);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact count from meta.count and never throws on failure', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock(42));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 42, kind: 'exact' });

    // A 500 must be swallowed into { count:null, kind:'unavailable' } — never throw.
    const failing = buildConnector(createOpenAlexConnector, PROVIDER_CFG, makeMock(() => ({ status: 500, text: 'boom' })));
    const pc2 = await failing.previewCount(tr);
    expect(pc2).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('previewCount on an empty translated query is unavailable, not a crash', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock());
    const pc = await c.previewCount({ query: '' });
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('paginates via meta.next_cursor and stops when next_cursor is null', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock(3));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    expect(p2.nextCursor).toBeNull(); // exhausted — next_cursor was null on the last page
  });

  it('first page sends cursor=* and the persisted cursor is JSON page state', async () => {
    let firstCursor = null;
    const mock = makeMock((url) => {
      const u = new URL(url);
      if (firstCursor === null) firstCursor = u.searchParams.get('cursor');
      return { json: { meta: { count: 5, per_page: 2, next_cursor: 'off:2' }, results: [work(1), work(2)] } };
    });
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(firstCursor).toBe('*');
    // Our cursor is a JSON string carrying the OpenAlex next_cursor.
    expect(JSON.parse(p1.nextCursor)).toMatchObject({ next: 'off:2' });
  });

  it('respects capRemaining — stops paging when the cap is exhausted', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock(100));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // capRemaining equals the page size → no room for another page.
    const p = await c.search(tr, null, { pageSize: 2, capRemaining: 2 });
    expect(p.records).toHaveLength(2);
    expect(p.nextCursor).toBeNull();
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock(0));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  it('tolerates malformed / partial works in a page (no throw, best-effort fields)', async () => {
    const mock = makeMock(() => ({
      json: {
        meta: { count: 3, per_page: 3, next_cursor: null },
        results: [
          null,                                          // garbage entry
          { id: 'https://openalex.org/W7' },             // minimal: only an id
          work(9),                                       // full
        ],
      },
    }));
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 3 });
    expect(page.records).toHaveLength(3);
    // normalize must not throw on any of them.
    const normd = page.records.map((r) => c.normalize(r));
    expect(normd[0].providerRecordId).toBeTruthy();     // fell back to content hash
    expect(normd[1].providerRecordId).toBe('https://openalex.org/W7');
    expect(normd[2].title).toBe('Title 9');
  });

  it('normalize maps a Work + reconstructs abstract + sets providerRecordId + raw provenance', async () => {
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, openAlexMock(1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('https://openalex.org/W1'); // OpenAlex Work id
    expect(n.doi).toBe('10.1/1');                                // URL prefix stripped by normalizeRecord
    expect(n.pmid).toBe('1001');                                 // pubmed URL → digits
    expect(n.title).toBe('Title 1');
    expect(n.journal).toBe('J Test');
    expect(n.year).toBe('2021');
    expect(n.language).toBe('en');
    expect(n.authors).toBe('Jane Smith; John Doe');
    expect(n.abstract).toMatch(/Background abstract/);
    expect(typeof n.raw).toBe('string');
    expect(n.raw.length).toBeLessThanOrEqual(15000);
  });

  it('classifies a 429 from the http client as a retryable rate-limit error', async () => {
    // Exhaust retries so the 429 surfaces as a thrown PecanError.
    const mock = makeMock(() => ({ status: 429, headers: { 'retry-after': '0' }, text: 'slow down' }));
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 from the http client as a retryable provider-unavailable error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'server error' }));
    const c = buildConnector(createOpenAlexConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });
});
