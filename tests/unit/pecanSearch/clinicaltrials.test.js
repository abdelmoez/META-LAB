import { describe, it, expect } from 'vitest';
import { createClinicalTrialsConnector } from '../../../server/pecanSearch/connectors/clinicaltrials.js';
import { buildConnector, makeMock, SAMPLE_CANONICAL } from './_harness.js';

const PROVIDER_CFG = {
  id: 'clinicaltrials', label: 'ClinicalTrials.gov', platform: 'CTG API v2',
  baseUrl: 'https://clinicaltrials.gov/api/v2',
  apiKey: '', hasKey: false, timeoutMs: 5000, pageSize: 2, maxCap: 100, defaultCap: 50,
  requiresCredentials: false, configured: true, available: true, supportsCountPreview: true,
  maxResults: 10000, supportedFields: ['title', 'abstract', 'authors', 'year', 'nctId', 'pubType'],
};

/** Build one CTG v2 study object. */
function study(n) {
  return {
    protocolSection: {
      identificationModule: {
        nctId: `NCT0000000${n}`,
        briefTitle: `Brief title ${n}`,
        officialTitle: `Official title ${n}`,
      },
      conditionsModule: { conditions: ['Type 2 Diabetes', 'Obesity'] },
      descriptionModule: { briefSummary: `Summary of study ${n}.`, detailedDescription: 'More detail.' },
      statusModule: { overallStatus: 'COMPLETED', startDateStruct: { date: '2015-03-01' } },
      sponsorCollaboratorsModule: { leadSponsor: { name: `Sponsor ${n}` } },
      designModule: { studyType: 'INTERVENTIONAL' },
    },
  };
}

/**
 * A token-paged mock: `total` studies total, `pageSize` per page (read from URL),
 * with a nextPageToken until the set is exhausted. Honors countTotal=true.
 */
function ctgMock(total = 3) {
  return makeMock((url) => {
    if (!url.includes('/studies')) return { status: 404, text: '' };
    const u = new URL(url);
    const pageSize = Number(u.searchParams.get('pageSize') || 10);
    const token = u.searchParams.get('pageToken');
    const start = token ? Number(token) : 0;
    const slice = [];
    for (let i = start; i < Math.min(start + pageSize, total); i += 1) slice.push(study(i + 1));
    const nextStart = start + pageSize;
    const body = { studies: slice };
    if (u.searchParams.get('countTotal') === 'true') body.totalCount = total;
    if (nextStart < total && slice.length > 0) body.nextPageToken = String(nextStart);
    return { json: body };
  });
}

describe('ClinicalTrials.gov connector — contract', () => {
  it('capabilities() has the standard shape', () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock());
    const cap = c.capabilities();
    expect(cap).toMatchObject({ id: 'clinicaltrials', supportsCountPreview: true, available: true });
    expect(Array.isArray(cap.supportedFields)).toBe(true);
  });

  it('translateQuery builds an Essie query.term with AND/OR + quoted phrases', () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // Population concept: ("type 2 diabetes" OR T2DM) — phrase quoted, OR within concept.
    expect(tr.query).toContain('"type 2 diabetes"');
    expect(tr.query).toContain('T2DM');
    expect(tr.query).toContain(' OR ');
    // Concepts intersect with AND.
    expect(tr.query).toContain(' AND ');
    // metformin had truncate:true → no wildcard for CTG, warned.
    expect(tr.query).not.toContain('*');
    expect(tr.warnings.join(' ')).toMatch(/truncation/i);
    expect(tr.queryHash).toHaveLength(16);
  });

  it('warns + approximates an unsupported field (mesh/doi/journal) as free text', () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock());
    const tr = c.translateQuery({
      concepts: [{
        op: 'OR',
        terms: [
          { text: 'Diabetes Mellitus', type: 'controlled', field: 'mesh', vocab: { mesh: 'Diabetes Mellitus' } },
          { text: 'Lancet', field: 'journal' },
        ],
      }],
    });
    // Unsupported clauses are recorded, NOT silently dropped.
    expect(tr.unsupported.length).toBeGreaterThanOrEqual(2);
    expect(tr.warnings.join(' ')).toMatch(/no MeSH heading field|no journal field/i);
    // The term text still appears as free text (concept not lost).
    expect(tr.query).toContain('Lancet');
    expect(tr.query).toContain('Diabetes Mellitus');
  });

  it('override is used verbatim and sets hasOverride', () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock());
    const tr = c.translateQuery(SAMPLE_CANONICAL, { override: 'heart attack AND aspirin' });
    expect(tr.query).toBe('heart attack AND aspirin');
    expect(tr.hasOverride).toBe(true);
  });

  it('validateQuery rejects an empty query', () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock());
    expect(c.validateQuery({ concepts: [] }).ok).toBe(false);
  });

  it('previewCount returns an exact totalCount', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(137));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: 137, kind: 'exact' });
    expect(typeof pc.at).toBe('string');
  });

  it('previewCount never throws — returns unavailable on a server error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'boom' }));
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const pc = await c.previewCount(tr);
    expect(pc).toMatchObject({ count: null, kind: 'unavailable' });
  });

  it('returns a single page with an exact total + records', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(2));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeNull();   // exhausted in one page
  });

  it('paginates via nextPageToken and stops at the end', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(3));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const p1 = await c.search(tr, null, { pageSize: 2 });
    expect(p1.records).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await c.search(tr, p1.nextCursor, { pageSize: 2 });
    expect(p2.records).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();     // no further token → stop
  });

  it('empty result returns no records and no cursor', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(0));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 2 });
    expect(page.records).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  it('tolerates a malformed/partial study in a page (no throw, empty fields)', async () => {
    const mock = makeMock((url) => {
      if (!url.includes('/studies')) return { status: 404, text: '' };
      // One good study + two malformed entries (null + missing protocolSection).
      return { json: { totalCount: 3, studies: [study(1), null, { protocolSection: null }] } };
    });
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 10 });
    expect(page.records.length).toBe(3);          // did not throw on broken entries
    const good = c.normalize(page.records[0]);
    expect(good.nctId).toBe('NCT00000001');
    // The malformed entries normalize to an empty-but-stable record (hashed id).
    const bad = c.normalize(page.records[1]);
    expect(typeof bad.providerRecordId).toBe('string');
    expect(bad.providerRecordId.length).toBeGreaterThan(0);
  });

  it('normalize maps a study + sets providerRecordId(NCT) + raw provenance', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(1));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    const page = await c.search(tr, null, { pageSize: 1 });
    const n = c.normalize(page.records[0]);
    expect(n.providerRecordId).toBe('NCT00000001');
    expect(n.nctId).toBe('NCT00000001');
    expect(n.title).toBe('Official title 1');     // official preferred over brief
    expect(n.abstract).toMatch(/Summary of study 1/);
    expect(n.year).toBe('2015');                  // from startDateStruct.date
    expect(n.journal).toBe('Sponsor 1');          // lead sponsor stands in
    expect(n.authors).toBe('');                   // trial records have no authors
    expect(n.keywords).toContain('Type 2 Diabetes');
    expect(typeof n.raw).toBe('string');
    expect(n.raw).toMatch(/NCT00000001/);
  });

  it('respects ctx.capRemaining — stops paging once the budget is exhausted', async () => {
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, ctgMock(50));
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    // capRemaining of 2 with pageSize 2 → exactly one page, then stop.
    const page = await c.search(tr, null, { pageSize: 2, capRemaining: 2 });
    expect(page.records).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('classifies a 429 from the http client as a retryable rate-limit error', async () => {
    const mock = makeMock(() => ({ status: 429, text: 'slow down' }));
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED', retryable: true,
    });
  });

  it('classifies a 500 from the http client as a retryable provider-unavailable error', async () => {
    const mock = makeMock(() => ({ status: 500, text: 'oops' }));
    const c = buildConnector(createClinicalTrialsConnector, PROVIDER_CFG, mock);
    const tr = c.translateQuery(SAMPLE_CANONICAL);
    await expect(c.search(tr, null, { pageSize: 2 })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE', retryable: true,
    });
  });
});
