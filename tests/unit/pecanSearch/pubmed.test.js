import { describe, it, expect } from 'vitest';
import { createPubmedConnector } from '../../../server/pecanSearch/connectors/pubmed.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'pubmed', label: 'PubMed', platform: 'NCBI E-utilities',
  baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title'],
};

function efetchXml(ids) {
  return '<?xml version="1.0"?><PubmedArticleSet>' + ids.map((p) =>
    `<PubmedArticle><MedlineCitation><PMID Version="1">${p}</PMID>` +
    `<Article><Journal><Title>J Test</Title></Journal><ArticleTitle>Title ${p}</ArticleTitle>` +
    `<Abstract><AbstractText Label="BACKGROUND">Background ${p}.</AbstractText></Abstract>` +
    `<AuthorList><Author><LastName>Smith</LastName><ForeName>J</ForeName></Author></AuthorList>` +
    `<PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList></Article></MedlineCitation>` +
    `<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/${p}</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`
  ).join('') + '</PubmedArticleSet>';
}

function pubmedMock(total = 3) {
  return makeMock((url) => {
    if (url.includes('esearch.fcgi') && url.includes('rettype=count')) return { json: { esearchresult: { count: String(total) } } };
    if (url.includes('esearch.fcgi')) return { json: { esearchresult: { count: String(total), idlist: [], webenv: 'WE1', querykey: '1' } } };
    if (url.includes('efetch.fcgi')) {
      const u = new URL(url); const rs = Number(u.searchParams.get('retstart') || 0); const rm = Number(u.searchParams.get('retmax') || 10);
      const ids = Array.from({ length: total }, (_, i) => String(i + 1)).slice(rs, rs + rm);
      return { text: efetchXml(ids) };
    }
    return { status: 404, text: '' };
  });
}

describe('PubMed connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'pubmed', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('translateQuery renders field tags, MeSH, truncation, and filters', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock());
    const tr = c.translateQuery({
      concepts: [{ op: 'OR', terms: [{ text: 'diabetes', type: 'controlled', field: 'mesh', vocab: { mesh: 'Diabetes Mellitus' }, noExplode: true }, { text: 'metformin', field: 'tiab', truncate: true }] }],
      filters: { dateFrom: '2010', dateTo: '2020', languages: ['English'] },
    });
    expect(tr.query).toContain('"Diabetes Mellitus"[Mesh:NoExp]');
    expect(tr.query).toContain('metformin*[Title/Abstract]');
    expect(tr.query).toContain('Date - Publication');
    expect(tr.query).toContain('English[Language]');
    expect(tr.queryHash).toHaveLength(16);
  });

  it('OR-joins synonyms within a concept and AND-joins concepts (the 0-results regression)', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock());
    const tr = c.translateQuery({
      concepts: [
        { id: 'p', op: 'AND', terms: [{ text: 'diabetes', field: 'tiab' }, { text: 'T2DM', field: 'tiab' }, { text: 'hyperglycemia', field: 'tiab' }] },
        { id: 'i', op: 'AND', terms: [{ text: 'metformin', field: 'tiab' }, { text: 'glucophage', field: 'tiab' }] },
      ],
    });
    // Synonyms MUST be OR'd (requiring all of them = 0 results); concepts AND'd.
    expect(tr.query).toBe('(diabetes[Title/Abstract] OR T2DM[Title/Abstract] OR hyperglycemia[Title/Abstract]) AND (metformin[Title/Abstract] OR glucophage[Title/Abstract])');
    expect(tr.query).not.toMatch(/diabetes\[Title\/Abstract\] AND T2DM/); // never AND between synonyms
  });

  it('warns when truncation is applied to a phrase', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock());
    const tr = c.translateQuery({ concepts: [{ terms: [{ text: 'heart failure', field: 'tiab', truncate: true }] }] });
    expect(tr.warnings.join(' ')).toMatch(/truncation/i);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact count', async () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock(42));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 42, kind: 'exact' });
  });

  it('paginates via the history server and stops at the end', async () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock(3));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('normalize maps a record + sets providerRecordId + raw provenance', async () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock(1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('1');
    expect(n.pmid).toBe('1');
    expect(n.doi).toBe('10.1/1');
    expect(n.title).toBe('Title 1');
    expect(n.abstract).toMatch(/Background 1/);
    expect(typeof n.raw).toBe('string');
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, pubmedMock(0));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it('tolerates a malformed article in a page (skips it, keeps the rest)', async () => {
    const mock = makeMock((url) => {
      if (url.includes('esearch.fcgi')) return { json: { esearchresult: { count: '2', webenv: 'WE', querykey: '1' } } };
      if (url.includes('efetch.fcgi')) return { text: '<PubmedArticleSet><PubmedArticle>BROKEN</PubmedArticle>' + efetchXml(['9']).replace(/^.*?<PubmedArticle>/s, '<PubmedArticle>') };
      return { status: 404, text: '' };
    });
    const c = buildConnector(createPubmedConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records.length).toBeGreaterThanOrEqual(1); // did not throw on the broken block
  });
});
