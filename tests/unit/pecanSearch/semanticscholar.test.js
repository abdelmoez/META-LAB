import { describe, it, expect } from 'vitest';
import { createSemanticScholarConnector } from '../../../server/pecanSearch/connectors/semanticscholar.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'semanticscholar', label: 'Semantic Scholar', platform: 'S2 Graph API',
  baseUrl: 'https://api.semanticscholar.org/graph/v1',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid'],
};

/** One S2 paper object as the bulk endpoint returns it. */
function paper(id) {
  return {
    paperId: `pid${id}`,
    title: `Title ${id}`,
    abstract: `Background ${id}.`,
    authors: [{ authorId: `a${id}`, name: 'J Smith' }],
    year: 2015,
    venue: 'J Test',
    externalIds: { DOI: `10.1/${id}`, PubMed: `${id}` },
    publicationTypes: ['JournalArticle'],
  };
}

/**
 * Token-paged bulk mock. `ids` is the full result set; `pageSize` controls how
 * many come back per page. The token is the next start index (string), absent
 * once the set is exhausted — exactly the S2 bulk contract.
 */
function s2Mock(ids = ['1', '2', '3'], { total = ids.length, pageSize = 2 } = {}) {
  return makeMock((url) => {
    if (!url.includes('/paper/search/bulk')) return { status: 404, text: '' };
    const u = new URL(url);
    const start = Number(u.searchParams.get('token') || 0);
    const slice = ids.slice(start, start + pageSize);
    const next = start + pageSize;
    const body = { total };
    body.data = slice.map((id) => paper(id));
    if (next < ids.length) body.token = String(next); // token present => more pages
    return { json: body };
  });
}

describe('Semantic Scholar connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'semanticscholar', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('translateQuery joins terms with | (OR) and concepts with space (AND)', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // Concept 1 (OR) → ("type 2 diabetes" | T2DM); concept 2 → metformin*
    expect(tr.query).toContain('"type 2 diabetes" | T2DM');
    expect(tr.query).toContain('metformin*');
    // two concepts space-joined (implicit AND)
    expect(tr.query).toMatch(/\)\s+metformin\*/);
    expect(tr.queryHash).toHaveLength(16);
  });

  it('warns that a field-restricted (author) term cannot be scoped in bulk search', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'Smith J', field: 'author' }] }] });
    expect(tr.warnings.join(' ')).toMatch(/title\+abstract only/i);
    expect(tr.warnings.join(' ')).toMatch(/author/i);
  });

  it('warns that language filtering is unsupported', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const tr = c.translateQuery(SAMPLE_CANONICAL); // SAMPLE has languages:['English']
    expect(tr.warnings.join(' ')).toMatch(/language/i);
    expect(tr.unsupported.join(' ')).toMatch(/languages/);
  });

  it('maps publication types to the S2 enum (review→Review, RCT→ClinicalTrial) and drops/warns unknown', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const tr = c.translateQuery({
      concepts: [{ terms: [{ text: 'aspirin' }] }],
      filters: { pubTypes: ['review', 'randomized controlled trial', 'nonsense'] },
    });
    expect(tr.filterParams.publicationTypes).toBe('Review,ClinicalTrial');
    expect(tr.warnings.join(' ')).toMatch(/not Semantic Scholar publication types/i);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an estimate from total', async () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock(['1', '2'], { total: 4242 }));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 4242, kind: 'estimate' });
  });

  it('previewCount never throws — returns unavailable on a server error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'boom' }));
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('paginates via the response token and stops when the token is gone', async () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock(['1', '2', '3'], { pageSize: 2 }));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    expect(p2.nextCursor).toBeNull(); // token absent => exhausted
  });

  it('stops paging at the per-source cap even when the provider has more', async () => {
    // 10 results available, 2/page, but capRemaining=2 → stop after the first page.
    const c = buildConnector(
      createSemanticScholarConnector, PROVIDER_CFG,
      s2Mock(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], { pageSize: 2 }),
    );
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2, capRemaining: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.nextCursor).toBeNull(); // cap reached → no further paging
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock([], { total: 0 }));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  it('tolerates a malformed/partial paper in a page (keeps usable fields, no throw)', async () => {
    const mock = makeMock((url) => {
      if (!url.includes('/paper/search/bulk')) return { status: 404, text: '' };
      // One good paper, one missing externalIds/authors/title — must not throw.
      return { json: { total: 2, data: [paper('7'), { paperId: 'pidX', authors: 'not-an-array' }] } };
    });
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(2);
    const partial = c.normalize(page.records[1]);
    expect(partial.providerRecordId).toBe('pidX'); // falls back to paperId
    expect(partial.title).toBe('');
  });

  it('normalize maps a record + sets providerRecordId + raw provenance', async () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock(['1']));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('pid1'); // S2 paperId
    expect(n.pmid).toBe('1');
    expect(n.doi).toBe('10.1/1');
    expect(n.title).toBe('Title 1');
    expect(n.abstract).toMatch(/Background 1/);
    expect(n.journal).toBe('J Test');
    expect(n.authors).toMatch(/Smith/);
    expect(typeof n.raw).toBe('string');
    expect(n.raw).toMatch(/pid1/);
  });

  it('falls back to DOI then content hash for providerRecordId when paperId is absent', () => {
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, s2Mock());
    const viaDoi = c.normalize({ doi: '10.5/abc', title: 'X' });
    expect(viaDoi.providerRecordId).toBe('10.5/abc');
    const viaHash = c.normalize({ title: 'Only a title' });
    expect(viaHash.providerRecordId).toMatch(/^h:/);
  });

  it('classifies a 429 from the http client as a retryable rate-limit error', async () => {
    const mock = makeMock(() => ({ status: 429, text: 'slow down', headers: { 'retry-after': '0' } }));
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 from the http client as a retryable provider-unavailable error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'boom' }));
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });

  it('sends the canonical year range as the native bulk year param', async () => {
    let seenUrl = null;
    const mock = makeMock((url) => {
      seenUrl = url;
      if (!url.includes('/paper/search/bulk')) return { status: 404, text: '' };
      return { json: { total: 0, data: [] } };
    });
    const c = buildConnector(createSemanticScholarConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL); // dateFrom 2010, dateTo 2020
    await c.search(tr, null, { pageSize: 2 });
    expect(decodeURIComponent(new URL(seenUrl).searchParams.get('year'))).toBe('2010-2020');
  });

  it('sends the x-api-key header only when a key is configured', async () => {
    let seenHeaders = null;
    const mock = (url, opts) => {
      seenHeaders = opts && opts.headers;
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ total: 0, data: [] })),
        json: () => Promise.resolve({ total: 0, data: [] }),
      });
    };
    const keyed = buildConnector(createSemanticScholarConnector, { ...PROVIDER_CFG, apiKey: 'SECRET123', hasKey: true }, mock);
    await keyed.search(keyed.translateQuery(SAMPLE_CANONICAL), null, { pageSize: 1 });
    expect(seenHeaders && seenHeaders['x-api-key']).toBe('SECRET123');
  });
});
