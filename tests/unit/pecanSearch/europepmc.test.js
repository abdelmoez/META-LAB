import { describe, it, expect } from 'vitest';
import { createEuropePmcConnector } from '../../../server/pecanSearch/connectors/europepmc.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'europepmc', label: 'Europe PMC', platform: 'EBI REST',
  baseUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pmid', 'pmcid', 'pubType'],
};

/** One Europe PMC core result item. */
function rec(n, extra = {}) {
  return {
    id: String(n), source: 'MED', pmid: String(n),
    doi: `10.1/${n}`, pmcid: '',
    title: `Title ${n}`,
    abstractText: `<h4>Background</h4>Background ${n}.`,
    authorString: `Smith J, Doe A.`,
    authorList: { author: [{ lastName: 'Smith', initials: 'J', fullName: 'Smith J' }] },
    journalInfo: { yearOfPublication: 2020, journal: { title: 'J Test' } },
    pubYear: '2020',
    language: 'eng',
    pubTypeList: { pubType: ['Journal Article'] },
    keywordList: { keyword: ['diabetes', 'metformin'] },
    ...extra,
  };
}

/**
 * Mock the /search endpoint with cursorMark paging over `total` records,
 * `pageSize` per page. nextCursorMark advances until the last page, where it
 * equals the cursor we sent (Europe PMC stops advancing the cursor at the end).
 */
function epmcMock(total = 3, pageSize = 2) {
  return makeMock((url) => {
    if (!url.includes('/search')) return { status: 404, text: '' };
    const u = new URL(url);
    const sent = u.searchParams.get('cursorMark') || '*';
    const ps = Number(u.searchParams.get('pageSize') || pageSize);
    // Decode our synthetic cursor: '*' = offset 0, 'c<offset>' = that offset.
    const offset = sent === '*' ? 0 : Number(sent.replace(/^c/, '')) || 0;
    const slice = [];
    for (let i = offset; i < Math.min(offset + ps, total); i += 1) slice.push(rec(i + 1));
    const nextOffset = offset + ps;
    // Cursor advances only if more remain; otherwise it repeats (exhaustion signal).
    const next = nextOffset < total ? `c${nextOffset}` : sent;
    return { json: { version: '6.9', hitCount: total, nextCursorMark: next, resultList: { result: slice } } };
  });
}

describe('Europe PMC connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'europepmc', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('translateQuery renders Lucene field prefixes, TIAB expansion, truncation and filters', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL); // tiab terms + truncated metformin + date/lang
    // TIAB term expands to (TITLE OR ABSTRACT).
    expect(tr.query).toContain('TITLE:"type 2 diabetes"');
    expect(tr.query).toContain('ABSTRACT:"type 2 diabetes"');
    // truncation → wildcard.
    expect(tr.query).toContain('metformin*');
    // date filter → PUB_YEAR range.
    expect(tr.query).toContain('PUB_YEAR:[2010 TO 2020]');
    // concepts joined with AND.
    expect(tr.query).toContain(' AND ');
    expect(tr.queryHash).toHaveLength(16);
  });

  it('maps a language NAME to the Europe PMC ISO 639-2/B code (English → eng, not "English")', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'sepsis' }] }], filters: { languages: ['English', 'German'] } });
    expect(tr.query).toContain('LANG:"eng"');
    expect(tr.query).toContain('LANG:"ger"');
    expect(tr.query).not.toContain('LANG:"English"');
  });

  it('drops an unmappable language + warns (never emits a 0-matching LANG clause)', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'sepsis' }] }], filters: { languages: ['Klingon'] } });
    expect(tr.query).not.toContain('LANG:');
    expect(tr.warnings.join(' ')).toMatch(/could not be mapped/i);
  });

  it('maps AUTHOR→AUTH, JOURNAL→JOURNAL, DOI→DOI and PMID→EXT_ID/SRC', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery({
      concepts: [
        { op: 'AND', terms: [
          { text: 'Smith J', field: 'author' },
          { text: 'Lancet', field: 'journal' },
          { text: '10.1/foo', field: 'doi' },
          { text: '12345678', field: 'pmid' },
        ] },
      ],
    });
    expect(tr.query).toContain('AUTH:"Smith J"');
    expect(tr.query).toContain('JOURNAL:Lancet');
    // single-token DOI has no whitespace → unquoted (quoteIfPhrase).
    expect(tr.query).toContain('DOI:10.1/foo');
    expect(tr.query).toContain('(EXT_ID:"12345678" AND SRC:MED)');
  });

  it('warns on the unsupported controlled-MeSH field (never silently dropped)', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery({
      concepts: [{ terms: [{ text: 'Diabetes Mellitus', type: 'controlled', field: 'mesh', vocab: { mesh: 'Diabetes Mellitus' }, noExplode: true }] }],
    });
    expect(tr.warnings.join(' ')).toMatch(/mesh/i);
    expect(tr.unsupported.length).toBeGreaterThan(0);
    // best-effort clause still emitted, not dropped.
    expect(tr.query).toContain('MESH:"Diabetes Mellitus"');
  });

  it('warns when truncation is applied to a phrase', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'heart failure', field: 'title', truncate: true }] }] });
    expect(tr.warnings.join(' ')).toMatch(/truncation/i);
  });

  it('uses an override query verbatim and flags hasOverride', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL, { override: 'TITLE:"my exact query"' });
    expect(tr.query).toBe('TITLE:"my exact query"');
    expect(tr.hasOverride).toBe(true);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact hitCount', async () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock(42));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 42, kind: 'exact' });
  });

  it('previewCount never throws — returns unavailable on a hard failure', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'boom' }));
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('returns one page with total and a forward cursor', async () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock(3, 2));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
  });

  it('paginates via cursorMark and stops at the end', async () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock(3, 2));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    // Cursor stopped advancing → exhausted.
    expect(p2.nextCursor).toBeNull();
  });

  it('empty result returns no records and no cursor', async () => {
    const mock = makeMock(() => ({ json: { hitCount: 0, nextCursorMark: '*', resultList: { result: [] } } }));
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  it('tolerates a malformed/partial record in a page (skips junk, keeps valid)', async () => {
    const mock = makeMock(() => ({
      json: {
        hitCount: 2, nextCursorMark: '*',
        resultList: { result: [null, 'garbage', { id: '9', source: 'MED', title: 'Only Title' }] },
      },
    }));
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 5 });
    // null + non-object are dropped; the valid one survives — did not throw.
    expect(page.records).toHaveLength(1);
    expect(page.records[0].title).toBe('Only Title');
  });

  it('normalize maps a record + sets providerRecordId + raw provenance', async () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock(1, 1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('MED:1');
    expect(n.pmid).toBe('1');
    expect(n.doi).toBe('10.1/1');
    expect(n.title).toBe('Title 1');
    expect(n.abstract).toMatch(/Background 1/);
    expect(n.journal).toBe('J Test');
    expect(n.authors).toMatch(/Smith/);
    expect(n.year).toBe('2020');
    expect(typeof n.raw).toBe('string');
    expect(n.raw.length).toBeGreaterThan(0);
  });

  it('normalize falls back to DOI/contentHash when no provider id is present', () => {
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, epmcMock());
    // partial with no providerRecordId but a DOI → providerRecordId === DOI.
    const n = c.normalize({ doi: '10.5/x', title: 'X', pmid: '' });
    expect(n.providerRecordId).toBe('10.5/x');
  });

  it('classifies a 429 from the http client as a retryable rate-limit error', async () => {
    const mock = makeMock(() => ({ status: 429, text: 'slow down' }));
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 from the http client as a retryable unavailable error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'server error' }));
    const c = buildConnector(createEuropePmcConnector, PROVIDER_CFG, mock, { retryLimit: 0 });
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });
});
