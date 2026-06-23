import { describe, it, expect } from 'vitest';
import { createCrossrefConnector, stripJats } from '../../../server/pecanSearch/connectors/crossref.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'crossref', label: 'Crossref', platform: 'Crossref REST',
  baseUrl: 'https://api.crossref.org',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'journal', 'doi', 'pubType'],
};

/** Build one Crossref work item. */
function workItem(n) {
  return {
    DOI: `10.1/${n}`,
    title: [`Title ${n}`],
    author: [{ family: 'Smith', given: 'J', sequence: 'first' }, { family: 'Doe', given: 'A' }],
    'container-title': ['J Test'],
    issued: { 'date-parts': [[2015 + (n % 5), 3, 1]] },
    abstract: `<jats:p><jats:title>Abstract</jats:title>Background ${n} &amp; more.</jats:p>`,
    type: 'journal-article',
    volume: String(n),
    issue: '2',
    page: `${n}-${n + 5}`,
  };
}

/**
 * Crossref /works mock with cursor deep-paging semantics.
 * total = number of available works; each request returns up to `rows` items
 * starting after the cursor offset encoded as cur:<offset> (first page = "*").
 */
function crossrefMock(total = 3) {
  return makeMock((url) => {
    if (!url.includes('/works')) return { status: 404, text: '' };
    const u = new URL(url);
    const rows = Number(u.searchParams.get('rows') || 20);
    const cursor = u.searchParams.get('cursor');

    if (rows === 0 || cursor == null) {
      // previewCount path (rows=0) OR a non-cursor query → just total-results.
      return { json: { status: 'ok', 'message-type': 'work-list', message: { 'total-results': total, items: rows === 0 ? [] : [], 'items-per-page': rows } } };
    }

    // Decode the offset our nextCursor encodes; first page cursor "*" => offset 0.
    const offset = cursor === '*' ? 0 : Number(String(cursor).replace(/^cur:/, '')) || 0;
    const slice = [];
    for (let i = offset; i < Math.min(offset + rows, total); i += 1) slice.push(workItem(i + 1));
    const nextOffset = offset + slice.length;
    const message = {
      'total-results': total,
      items: slice,
      'items-per-page': rows,
    };
    // Crossref always returns a next-cursor token; the connector stops on the
    // documented short-page / drained-total signal, not on a missing token.
    message['next-cursor'] = `cur:${nextOffset}`;
    return { json: { status: 'ok', 'message-type': 'work-list', message } };
  });
}

describe('Crossref connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'crossref', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('translateQuery builds query.bibliographic + field hints + real date/type filters', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const tr = c.translateQuery({
      concepts: [
        { op: 'OR', terms: [{ text: 'metformin', field: 'title' }, { text: 'diabetes', field: 'tiab' }] },
        { op: 'OR', terms: [{ text: 'Smith', field: 'author' }] },
      ],
      filters: { dateFrom: '2010', dateTo: '2020', pubTypes: ['journal-article'] },
    });
    const params = JSON.parse(tr.query).params;
    expect(params['query.bibliographic']).toContain('metformin');
    expect(params['query.bibliographic']).toContain('diabetes');
    expect(params['query.title']).toBe('metformin');
    expect(params['query.author']).toBe('Smith');
    expect(params.filter).toContain('from-pub-date:2010');
    expect(params.filter).toContain('until-pub-date:2020');
    expect(params.filter).toContain('type:journal-article');
    expect(tr.queryHash).toHaveLength(16);
  });

  it('warns that Boolean structure is approximated (not silently dropped)', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const tr = c.translateQuery({
      concepts: [
        { op: 'OR', terms: [{ text: 'a', field: 'tiab' }, { text: 'b', field: 'tiab' }] },
        { op: 'OR', terms: [{ text: 'c', field: 'tiab' }] },
      ],
    });
    const w = tr.warnings.join(' ');
    expect(w).toMatch(/Boolean AND/i);   // multi-concept AND approximation
    expect(w).toMatch(/Boolean OR/i);    // intra-concept OR approximation
  });

  it('warns on an unsupported feature (truncation + controlled vocab + doi field)', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const tr = c.translateQuery({
      concepts: [{ terms: [
        { text: 'cardio', field: 'tiab', truncate: true },
        { text: 'Diabetes Mellitus', type: 'controlled', field: 'mesh' },
        { text: '10.1/x', field: 'doi' },
      ] }],
    });
    const w = tr.warnings.join(' ');
    expect(w).toMatch(/truncation/i);
    expect(w).toMatch(/controlled-vocabulary/i);
    expect(w).toMatch(/has no exact Crossref index/i);
    expect(tr.unsupported.join(' ')).toMatch(/doi:/);
  });

  it('language filter is unsupported and warned about, not silently dropped', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const tr = c.translateQuery({
      concepts: [{ terms: [{ text: 'x', field: 'tiab' }] }],
      filters: { languages: ['English'] },
    });
    expect(tr.warnings.join(' ')).toMatch(/language/i);
    expect(JSON.parse(tr.query).params.filter).toBeUndefined();
  });

  it('honors a verbatim override and sets hasOverride', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL, { override: 'crispr gene editing' });
    expect(tr.hasOverride).toBe(true);
    expect(JSON.parse(tr.query).params['query.bibliographic']).toBe('crispr gene editing');
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact total-results count', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(137));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 137, kind: 'exact' });
  });

  it('previewCount returns unavailable (never throws) on a malformed response', async () => {
    const mock = makeMock(() => ({ json: { status: 'ok' } })); // no message envelope
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('returns a single page with records + total', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(2));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 5 });
    expect(page.records).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeNull(); // short page => exhausted
  });

  it('paginates via next-cursor and STOPS at the end', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(3));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);  // final partial page
    expect(p2.nextCursor).toBeNull();    // drained total => stop
  });

  it('respects capRemaining and never overshoots the cap', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(100));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // capRemaining (1) is the binding constraint, below the configured page size (2).
    const page = await c.search(tr, null, { pageSize: 50, capRemaining: 1 });
    expect(page.records).toHaveLength(1); // page shrunk to the cap
    expect(page.nextCursor).toBeNull();   // cap reached => stop
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(0));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it('tolerates malformed/partial items (missing title/author/issued)', async () => {
    const mock = makeMock(() => ({
      json: {
        status: 'ok',
        message: {
          'total-results': 2,
          items: [
            { DOI: '10.5/partial' }, // no title, author, issued, abstract
            { title: [], author: 'not-an-array', issued: { 'date-parts': [] } },
          ],
          'next-cursor': 'cur:2',
        },
      },
    }));
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 5 });
    expect(page.records).toHaveLength(2);
    // normalize must not throw on either partial record
    const n0 = c.normalize(page.records[0]);
    const n1 = c.normalize(page.records[1]);
    expect(n0.providerRecordId).toBe('10.5/partial');
    expect(typeof n1.providerRecordId).toBe('string'); // content-hash fallback
  });

  it('normalize maps fields, strips JATS, sets providerRecordId (DOI) + raw', async () => {
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, crossrefMock(1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('10.1/1');
    expect(n.doi).toBe('10.1/1');
    expect(n.title).toBe('Title 1');
    expect(n.journal).toBe('J Test');
    expect(n.authors).toBe('Smith J; Doe A');
    expect(n.year).toBe('2016'); // 2015 + (1 % 5)
    expect(n.abstract).toBe('Background 1 & more.'); // JATS tags stripped, entity decoded
    expect(n.abstract).not.toMatch(/jats:|<|>/);
    expect(n.pubType).toBe('journal-article');
    expect(typeof n.raw).toBe('string');
    expect(JSON.parse(n.raw).DOI).toBe('10.1/1');
  });

  it('classifies a 429 rate-limit through the http client (retryable)', async () => {
    const mock = makeMock(() => ({ status: 429, headers: { 'retry-after': '0' }, text: 'slow down' }));
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 server error through the http client (retryable)', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'boom' }));
    const c = buildConnector(createCrossrefConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });

  it('stripJats is a pure tag-stripper', () => {
    expect(stripJats('<jats:p>Hello <i>world</i></jats:p>')).toBe('Hello world');
    expect(stripJats(null)).toBe('');
  });
});
