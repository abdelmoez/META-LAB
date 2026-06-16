/**
 * oaPdfResolver.test.js — Open-Access PDF resolution (roadmap 1.4).
 * Fully mocked: an injected fetch + fixed clock → NO live network in CI.
 */
import { describe, it, expect, vi } from 'vitest';
import { createOaResolver, loadOaConfig, OA_STATUS, OA_PROVIDERS }
  from '../../server/services/oaPdfResolver.js';

const baseCfg = {
  enabled: true,
  unpaywallEmail: 'me@example.org',
  openalexEmail: 'me@example.org',
  crossrefMailto: 'me@example.org',
  providerPriority: OA_PROVIDERS,
  cacheTtlMs: 3600 * 1000,
  rateLimitPerMinute: 30,
};

// Build a fetch mock from a URL-substring → response-body map. A value of
// Error throws (provider error); a body becomes { ok:true, json:()=>body }.
function mockFetch(routes) {
  return vi.fn(async (url) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        if (body instanceof Error) throw body;
        if (body === '__404__') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

const fixedNow = () => 1_000_000;

describe('createOaResolver — provider resolution (OA only)', () => {
  it('Unpaywall OA PDF → FOUND', async () => {
    const fetch = mockFetch({
      'api.unpaywall.org': { is_oa: true, best_oa_location: { url_for_pdf: 'https://oa.org/x.pdf', license: 'cc-by' } },
    });
    const { resolve } = createOaResolver(baseCfg, { fetch, now: fixedNow });
    const r = await resolve('10.1000/aaa');
    expect(r.status).toBe(OA_STATUS.FOUND);
    expect(r.provider).toBe('unpaywall');
    expect(r.url).toBe('https://oa.org/x.pdf');
  });

  it('falls through to OpenAlex when Unpaywall is not OA', async () => {
    const fetch = mockFetch({
      'api.unpaywall.org': { is_oa: false },
      'api.openalex.org': { open_access: { is_oa: true }, best_oa_location: { pdf_url: 'https://oa.org/y.pdf' } },
    });
    const { resolve } = createOaResolver(baseCfg, { fetch, now: fixedNow });
    const r = await resolve('10.1000/bbb');
    expect(r.status).toBe(OA_STATUS.FOUND);
    expect(r.provider).toBe('openalex');
  });

  it('CrossRef returns a PDF ONLY with an explicit open licence', async () => {
    const open = mockFetch({
      'api.unpaywall.org': { is_oa: false }, 'api.openalex.org': { open_access: { is_oa: false } },
      'api.crossref.org': { message: { license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }], link: [{ 'content-type': 'application/pdf', URL: 'https://oa.org/cr.pdf' }] } },
    });
    const r1 = await createOaResolver(baseCfg, { fetch: open, now: fixedNow }).resolve('10.1000/ccc');
    expect(r1.status).toBe(OA_STATUS.FOUND);
    expect(r1.provider).toBe('crossref');

    const closed = mockFetch({
      'api.unpaywall.org': { is_oa: false }, 'api.openalex.org': { open_access: { is_oa: false } },
      'api.crossref.org': { message: { link: [{ 'content-type': 'application/pdf', URL: 'https://paywall.example/locked.pdf' }] } },
    });
    const r2 = await createOaResolver(baseCfg, { fetch: closed, now: fixedNow }).resolve('10.1000/ddd');
    expect(r2.status).toBe(OA_STATUS.NOT_FOUND); // no licence → never attach a paywalled link
  });

  it('NOT_FOUND when no provider has an OA PDF', async () => {
    const fetch = mockFetch({
      'api.unpaywall.org': { is_oa: false }, 'api.openalex.org': { open_access: { is_oa: false } }, 'api.crossref.org': { message: {} },
    });
    const r = await createOaResolver(baseCfg, { fetch, now: fixedNow }).resolve('10.1000/eee');
    expect(r.status).toBe(OA_STATUS.NOT_FOUND);
  });

  it('a provider error is swallowed; resolution continues', async () => {
    const fetch = mockFetch({
      'api.unpaywall.org': new Error('network down'),
      'api.openalex.org': { open_access: { is_oa: true }, best_oa_location: { pdf_url: 'https://oa.org/z.pdf' } },
    });
    const r = await createOaResolver(baseCfg, { fetch, now: fixedNow }).resolve('10.1000/fff');
    expect(r.status).toBe(OA_STATUS.FOUND);
    expect(r.provider).toBe('openalex');
  });
});

describe('createOaResolver — guards, cache, rate limit', () => {
  it('feature disabled → SKIPPED_FEATURE_DISABLED, no fetch', async () => {
    const fetch = mockFetch({});
    const r = await createOaResolver({ ...baseCfg, enabled: false }, { fetch, now: fixedNow }).resolve('10.1000/aaa');
    expect(r.status).toBe(OA_STATUS.SKIPPED_FEATURE_DISABLED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('missing DOI → SKIPPED_NO_DOI', async () => {
    const fetch = mockFetch({});
    const r = await createOaResolver(baseCfg, { fetch, now: fixedNow }).resolve('');
    expect(r.status).toBe(OA_STATUS.SKIPPED_NO_DOI);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a cache hit avoids a second provider call', async () => {
    const fetch = mockFetch({ 'api.unpaywall.org': { is_oa: true, best_oa_location: { url_for_pdf: 'https://oa.org/x.pdf' } } });
    const resolver = createOaResolver(baseCfg, { fetch, now: fixedNow });
    await resolver.resolve('10.1000/aaa');
    const second = await resolver.resolve('10.1000/AAA'); // same DOI, different case
    expect(second.cached).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rate limit returns RATE_LIMITED once the bucket is empty', async () => {
    const fetch = mockFetch({ 'api.unpaywall.org': { is_oa: false }, 'api.openalex.org': { open_access: { is_oa: false } }, 'api.crossref.org': { message: {} } });
    const resolver = createOaResolver({ ...baseCfg, rateLimitPerMinute: 1 }, { fetch, now: fixedNow });
    const first = await resolver.resolve('10.1000/aaa');
    const second = await resolver.resolve('10.1000/bbb'); // distinct DOI, bucket empty, clock frozen
    expect(first.status).toBe(OA_STATUS.NOT_FOUND);
    expect(second.status).toBe(OA_STATUS.RATE_LIMITED);
  });
});

describe('per-call email + enabled overrides (1.4 follow-up — user email)', () => {
  it("sends the caller's email to the provider (polite-pool identifier)", async () => {
    const fetch = mockFetch({ 'api.unpaywall.org': { is_oa: true, best_oa_location: { url_for_pdf: 'https://oa.org/x.pdf' } } });
    const r = await createOaResolver(baseCfg, { fetch, now: fixedNow }).resolve('10.1000/aaa', { email: 'reviewer@uni.edu' });
    expect(r.status).toBe(OA_STATUS.FOUND);
    expect(fetch.mock.calls[0][0]).toContain('email=reviewer%40uni.edu');
  });

  it('opts.enabled=false short-circuits even when cfg.enabled=true', async () => {
    const fetch = mockFetch({});
    const r = await createOaResolver(baseCfg, { fetch, now: fixedNow }).resolve('10.1000/aaa', { enabled: false });
    expect(r.status).toBe(OA_STATUS.SKIPPED_FEATURE_DISABLED);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opts.enabled=true proceeds even when cfg.enabled=false (controller gates)', async () => {
    const fetch = mockFetch({ 'api.unpaywall.org': { is_oa: false }, 'api.openalex.org': { open_access: { is_oa: false } }, 'api.crossref.org': { message: {} } });
    const r = await createOaResolver({ ...baseCfg, enabled: false }, { fetch, now: fixedNow }).resolve('10.1000/aaa', { email: 'u@x.org', enabled: true });
    expect(r.status).toBe(OA_STATUS.NOT_FOUND);
  });
});

describe('loadOaConfig', () => {
  it('defaults to disabled with no env/settings', () => {
    expect(loadOaConfig({}, {}).enabled).toBe(false);
  });
  it('admin setting enables it; env supplies emails + tuning', () => {
    const cfg = loadOaConfig(
      { UNPAYWALL_EMAIL: 'a@b.org', OA_PDF_CACHE_TTL_HOURS: '12', OA_PDF_RATE_LIMIT_PER_MINUTE: '5' },
      { autoPdfRetrieval: true },
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.unpaywallEmail).toBe('a@b.org');
    expect(cfg.cacheTtlMs).toBe(12 * 3600 * 1000);
    expect(cfg.rateLimitPerMinute).toBe(5);
  });
  it('env flag alone can enable it (OA_PDF_RETRIEVAL_ENABLED=true)', () => {
    expect(loadOaConfig({ OA_PDF_RETRIEVAL_ENABLED: 'true' }, {}).enabled).toBe(true);
  });
});
