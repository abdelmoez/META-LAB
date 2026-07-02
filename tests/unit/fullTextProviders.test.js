/**
 * fullTextProviders.test.js — the OA full-text provider chain (68.md P9).
 *
 * Targets server/fullText/providers.js. Each provider is a pure async lookup with
 * an INJECTED fetch (ctx.fetchFn), so we drive it against mocked JSON fixtures and
 * assert both the happy path (a legal OA URL is extracted) and the failure paths
 * (no id, no OA, upstream error, malformed payload) — all of which must degrade to
 * a normalized outcome and NEVER throw out of the safe wrapper.
 */
import { describe, it, expect } from 'vitest';
import {
  getProvider, resolveProviderChain, extractNctId, normalizeDoi, normalizePmid, resolveEmail, PROVIDER_IDS,
} from '../../server/fullText/providers.js';

/** Build a fake fetch that returns the given JSON body with a status. */
function jsonFetch(body, { status = 200, contentType = 'application/json' } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
  });
}
const throwingFetch = () => { throw new Error('network down'); };

const DOI = '10.1000/xyz123';
const REC_DOI = { doi: DOI, pmid: '', rawData: '{}' };
const REC_PMID = { doi: '', pmid: '12345678', rawData: '{}' };
const CTX = { email: 'test@example.com' };

describe('helpers', () => {
  it('normalizeDoi strips prefixes + trailing punctuation', () => {
    expect(normalizeDoi('https://doi.org/10.1000/AbC.')).toBe('10.1000/abc');
    expect(normalizeDoi('doi: 10.5/x')).toBe('10.5/x');
    expect(normalizeDoi('not-a-doi')).toBe('');
  });
  it('normalizePmid keeps digits only', () => {
    expect(normalizePmid('PMID: 987654')).toBe('987654');
    expect(normalizePmid('1234567890123')).toBe(''); // too long
  });
  it('extractNctId finds an NCT id anywhere in a record', () => {
    expect(extractNctId({ rawData: '{"url":"https://clinicaltrials.gov/study/NCT01234567"}' })).toBe('NCT01234567');
    expect(extractNctId({ doi: 'nct09876543 something' })).toBe('NCT09876543');
    expect(extractNctId({ rawData: '{}', doi: '', pmid: '' })).toBe('');
  });
  it('resolveEmail honours the explicit ctx email first', () => {
    expect(resolveEmail({ email: 'a@b.co' })).toBe('a@b.co');
  });
  it('PROVIDER_IDS lists the four providers', () => {
    expect(PROVIDER_IDS).toEqual(['unpaywall', 'europepmc', 'openalex', 'clinicaltrials']);
  });
});

describe('unpaywall', () => {
  const p = getProvider('unpaywall');
  it('extracts a PDF URL from best_oa_location', async () => {
    const fetchFn = jsonFetch({ is_oa: true, oa_status: 'gold', best_oa_location: { url_for_pdf: 'https://oa.example/x.pdf', version: 'publishedVersion', license: 'cc-by' } });
    const out = await p(REC_DOI, { ...CTX, fetchFn });
    expect(out.status).toBe('found');
    expect(out.pdfUrl).toBe('https://oa.example/x.pdf');
    expect(out.oaStatus).toBe('gold');
    expect(out.provider).toBe('unpaywall');
  });
  it('reports no_oa when is_oa is false', async () => {
    const fetchFn = jsonFetch({ is_oa: false, oa_status: 'closed', best_oa_location: null });
    const out = await p(REC_DOI, { ...CTX, fetchFn });
    expect(out.status).toBe('no_oa');
  });
  it('fails cleanly with no email configured', async () => {
    const out = await p(REC_DOI, { fetchFn: jsonFetch({}), email: '' });
    // resolveEmail may pick up an env var in CI; assert it never throws and is normalized.
    expect(['failed', 'found', 'no_oa', 'not_found']).toContain(out.status);
    expect(out.provider).toBe('unpaywall');
  });
  it('not_found when the record has no DOI', async () => {
    const out = await p({ doi: '', pmid: '' }, { ...CTX, fetchFn: jsonFetch({}) });
    expect(out.status).toBe('not_found');
  });
  it('a 404 from Unpaywall is not_found, not a throw', async () => {
    const out = await p(REC_DOI, { ...CTX, fetchFn: jsonFetch({}, { status: 404 }) });
    expect(out.status).toBe('not_found');
  });
  it('an upstream error becomes failed (never throws)', async () => {
    const out = await p(REC_DOI, { ...CTX, fetchFn: throwingFetch });
    expect(out.status).toBe('failed');
    expect(out.reason).toContain('network down');
  });
});

describe('europepmc', () => {
  const p = getProvider('europepmc');
  it('extracts a PDF fullTextUrl for an open-access record', async () => {
    const fetchFn = jsonFetch({ resultList: { result: [{
      isOpenAccess: 'Y', pmcid: 'PMC123',
      fullTextUrlList: { fullTextUrl: [
        { documentStyle: 'html', url: 'https://epmc/html' },
        { documentStyle: 'pdf', url: 'https://epmc/x.pdf' },
      ] },
    }] } });
    const out = await p(REC_PMID, { ...CTX, fetchFn });
    expect(out.status).toBe('found');
    expect(out.pdfUrl).toBe('https://epmc/x.pdf');
  });
  it('no_oa when the record is not open access and has no pdf', async () => {
    const fetchFn = jsonFetch({ resultList: { result: [{ isOpenAccess: 'N', fullTextUrlList: { fullTextUrl: [] } }] } });
    const out = await p(REC_PMID, { ...CTX, fetchFn });
    expect(out.status).toBe('no_oa');
  });
  it('not_found when Europe PMC returns no results', async () => {
    const out = await p(REC_PMID, { ...CTX, fetchFn: jsonFetch({ resultList: { result: [] } }) });
    expect(out.status).toBe('not_found');
  });
  it('not_found when the record has neither PMID nor DOI', async () => {
    const out = await p({ doi: '', pmid: '' }, { ...CTX, fetchFn: jsonFetch({}) });
    expect(out.status).toBe('not_found');
  });
});

describe('openalex', () => {
  const p = getProvider('openalex');
  it('extracts a PDF URL from best_oa_location', async () => {
    const fetchFn = jsonFetch({ open_access: { is_oa: true, oa_status: 'green' }, best_oa_location: { pdf_url: 'https://oax/x.pdf', version: 'acceptedVersion' } });
    const out = await p(REC_DOI, { ...CTX, fetchFn });
    expect(out.status).toBe('found');
    expect(out.pdfUrl).toBe('https://oax/x.pdf');
    expect(out.oaStatus).toBe('green');
  });
  it('no_oa when open_access.is_oa is false', async () => {
    const fetchFn = jsonFetch({ open_access: { is_oa: false, oa_status: 'closed' }, best_oa_location: null });
    const out = await p(REC_DOI, { ...CTX, fetchFn });
    expect(out.status).toBe('no_oa');
  });
  it('a malformed payload does not throw', async () => {
    const out = await p(REC_DOI, { ...CTX, fetchFn: jsonFetch(null) });
    expect(['no_oa', 'not_found', 'failed']).toContain(out.status);
  });
});

describe('clinicaltrials', () => {
  const p = getProvider('clinicaltrials');
  const REC_NCT = { doi: '', pmid: '', rawData: '{"nctId":"NCT01234567","url":"https://clinicaltrials.gov/study/NCT01234567"}' };
  it('returns a registry landing page (never a journal PDF)', async () => {
    const fetchFn = jsonFetch({ protocolSection: { identificationModule: { nctId: 'NCT01234567' } }, hasResults: true });
    const out = await p(REC_NCT, { ...CTX, fetchFn });
    expect(out.status).toBe('found');
    expect(out.version).toBe('registry');
    expect(out.pdfUrl).toBeUndefined();
    expect(out.landingUrl).toContain('NCT01234567');
    expect(out.payload.hasResults).toBe(true);
  });
  it('not_found when the record has no NCT id', async () => {
    const out = await p({ doi: '', pmid: '', rawData: '{}' }, { ...CTX, fetchFn: jsonFetch({}) });
    expect(out.status).toBe('not_found');
  });
  it('a 404 from CTG is not_found', async () => {
    const out = await p(REC_NCT, { ...CTX, fetchFn: jsonFetch({}, { status: 404 }) });
    expect(out.status).toBe('not_found');
  });
});

describe('resolveProviderChain', () => {
  it('respects a configured order and drops unknown ids', () => {
    const chain = resolveProviderChain(['openalex', 'bogus', 'unpaywall']);
    expect(chain.map(c => c.id)).toEqual(['openalex', 'unpaywall']);
  });
  it('falls back to the full set for an empty order', () => {
    const chain = resolveProviderChain([]);
    expect(chain.map(c => c.id)).toEqual(PROVIDER_IDS);
  });
});
