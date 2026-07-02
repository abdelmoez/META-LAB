/**
 * server/fullText/providers.js — pluggable OA full-text provider chain (68.md P9).
 *
 * Each provider is an async lookup(record, ctx) → a normalized outcome:
 *   { provider, status, pdfUrl?, landingUrl?, oaStatus?, license?, version?, payload?, reason? }
 * where status ∈ 'found' | 'no_oa' | 'not_found' | 'failed'.
 *
 * LEGAL SAFETY (non-negotiable): a provider only ever returns a URL the OA API
 * itself hands us (Unpaywall best_oa_location, Europe PMC fullTextUrlList,
 * OpenAlex best_oa_location, a ClinicalTrials.gov registry page). We NEVER scrape
 * a publisher, guess a PDF URL, or bypass a paywall. A registry hit is a landing
 * page (version 'registry') with NO pdfUrl unless the API itself lists a document.
 *
 * ROBUSTNESS: every provider is wrapped so it can NEVER throw out — a network
 * error, timeout, or malformed payload degrades to status 'failed' with a short
 * reason. Each does at most one retry, 15s timeout, and takes an injected `fetch`
 * (ctx.fetchFn) so it is unit-testable against a mocked JSON fixture.
 */

export const FT_TIMEOUT_MS = 15000;
export const FT_RETRY = 1;

/** Bare lowercase DOI (strip https://doi.org/ prefix + trailing punctuation). */
export function normalizeDoi(doi) {
  const s = String(doi || '').trim().toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/[.,;)\]]+$/, '');
  return /^10\.\S+$/.test(s) ? s : '';
}

/** Digits-only PMID, or ''. */
export function normalizePmid(pmid) {
  const s = String(pmid || '').replace(/\D/g, '');
  return s && s.length <= 9 ? s : '';
}

/**
 * Extract an NCT id from any of a record's identifier-bearing fields. Screening
 * records carry no dedicated NCT column, so we scan rawData (the full normalized
 * record JSON — Pecan clinicaltrials records store nctId + url there), plus the
 * doi/sourceDb strings. Returns the upper-cased NCT id or ''.
 */
export function extractNctId(record) {
  const hay = [record?.rawData, record?.doi, record?.sourceDb, record?.url, record?.pmid]
    .map(v => String(v || '')).join(' ');
  const m = hay.match(/\bNCT\d{8}\b/i);
  return m ? m[0].toUpperCase() : '';
}

/** Resolve the polite-pool email from the configured fallback chain, or ''. */
export function resolveEmail(ctx = {}) {
  return String(
    ctx.email
    || process.env.UNPAYWALL_EMAIL
    || process.env.PECAN_SEARCH_CONTACT_EMAIL
    || process.env.NCBI_EMAIL
    || '',
  ).trim();
}

/** Fetch a URL with a timeout + one retry; returns the parsed JSON or throws. */
async function fetchJson(url, fetchFn, { timeoutMs = FT_TIMEOUT_MS, retry = FT_RETRY, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error(`timed out after ${timeoutMs}ms`)); }, timeoutMs);
      });
      const res = await Promise.race([
        fetchFn(url, { headers: { Accept: 'application/json', ...headers }, ...(ctrl ? { signal: ctrl.signal } : {}) }),
        timeout,
      ]);
      if (res && res.status === 404) return { _notFound: true };
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'no-response'}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error('request failed');
}

/* ── unpaywall ─────────────────────────────────────────────────────────────
 * GET https://api.unpaywall.org/v2/{doi}?email={email}
 * best_oa_location.url_for_pdf is the legal OA PDF; is_oa gates no_oa.
 */
async function unpaywallLookup(record, ctx) {
  const doi = normalizeDoi(record?.doi);
  if (!doi) return { provider: 'unpaywall', status: 'not_found', reason: 'no DOI' };
  const email = resolveEmail(ctx);
  if (!email) return { provider: 'unpaywall', status: 'failed', reason: 'no email configured' };
  const base = process.env.UNPAYWALL_API_BASE || 'https://api.unpaywall.org/v2';
  const url = `${base}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const j = await fetchJson(url, ctx.fetchFn);
  if (j && j._notFound) return { provider: 'unpaywall', status: 'not_found', reason: 'DOI unknown to Unpaywall' };
  const best = j && j.best_oa_location;
  if (!j || !j.is_oa || !best) return { provider: 'unpaywall', status: 'no_oa', oaStatus: (j && j.oa_status) || 'closed' };
  const pdfUrl = best.url_for_pdf || '';
  const landingUrl = best.url_for_landing_page || best.url || '';
  const payload = { hostType: best.host_type || '', evidence: best.evidence || '' };
  if (!pdfUrl) {
    return { provider: 'unpaywall', status: landingUrl ? 'found' : 'no_oa', landingUrl, oaStatus: j.oa_status || 'bronze', license: best.license || null, version: best.version || null, payload };
  }
  return {
    provider: 'unpaywall', status: 'found', pdfUrl, landingUrl,
    oaStatus: j.oa_status || 'gold', license: best.license || null, version: best.version || null, payload,
  };
}

/* ── europepmc ─────────────────────────────────────────────────────────────
 * GET .../search?query=EXT_ID:{pmid} AND SRC:MED&resultType=core&format=json
 * result.fullTextUrlList.fullTextUrl[] with documentStyle:'pdf' + isOpenAccess.
 */
async function europepmcLookup(record, ctx) {
  const pmid = normalizePmid(record?.pmid);
  const doi = normalizeDoi(record?.doi);
  if (!pmid && !doi) return { provider: 'europepmc', status: 'not_found', reason: 'no PMID or DOI' };
  const base = process.env.EUROPEPMC_API_BASE || 'https://www.ebi.ac.uk/europepmc/webservices/rest';
  const query = pmid ? `EXT_ID:${pmid} AND SRC:MED` : `DOI:${doi}`;
  const url = `${base}/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`;
  const j = await fetchJson(url, ctx.fetchFn);
  const result = j && j.resultList && Array.isArray(j.resultList.result) ? j.resultList.result[0] : null;
  if (!result) return { provider: 'europepmc', status: 'not_found', reason: 'no matching Europe PMC record' };
  const isOa = result.isOpenAccess === 'Y' || result.isOpenAccess === true;
  const list = result.fullTextUrlList && Array.isArray(result.fullTextUrlList.fullTextUrl)
    ? result.fullTextUrlList.fullTextUrl : [];
  const pdf = list.find(u => u && String(u.documentStyle).toLowerCase() === 'pdf' && u.url);
  const html = list.find(u => u && u.url);
  const payload = { pmcid: result.pmcid || '', source: result.source || '' };
  if (pdf) {
    return {
      provider: 'europepmc', status: 'found', pdfUrl: pdf.url, landingUrl: (html && html.url) || '',
      oaStatus: isOa ? 'green' : null, version: 'publishedVersion', payload,
    };
  }
  if (html && isOa) {
    return { provider: 'europepmc', status: 'found', landingUrl: html.url, oaStatus: 'green', payload };
  }
  return { provider: 'europepmc', status: 'no_oa', oaStatus: isOa ? 'green' : 'closed', payload };
}

/* ── openalex ──────────────────────────────────────────────────────────────
 * GET /works/doi:{doi}?select=open_access,best_oa_location
 * best_oa_location.pdf_url is the legal OA PDF.
 */
async function openalexLookup(record, ctx) {
  const doi = normalizeDoi(record?.doi);
  if (!doi) return { provider: 'openalex', status: 'not_found', reason: 'no DOI' };
  const base = process.env.OPENALEX_API_BASE || 'https://api.openalex.org';
  const email = resolveEmail(ctx);
  const mailto = email ? `&mailto=${encodeURIComponent(email)}` : '';
  const url = `${base}/works/doi:${encodeURIComponent(doi)}?select=open_access,best_oa_location${mailto}`;
  const j = await fetchJson(url, ctx.fetchFn);
  if (j && j._notFound) return { provider: 'openalex', status: 'not_found', reason: 'DOI unknown to OpenAlex' };
  const oa = j && j.open_access;
  const best = j && j.best_oa_location;
  if (!oa || !oa.is_oa || !best) return { provider: 'openalex', status: 'no_oa', oaStatus: (oa && oa.oa_status) || 'closed' };
  const pdfUrl = best.pdf_url || '';
  const landingUrl = best.landing_page_url || '';
  const payload = { hostType: best.host_type || '' };
  if (!pdfUrl) {
    return { provider: 'openalex', status: landingUrl ? 'found' : 'no_oa', landingUrl, oaStatus: oa.oa_status || 'bronze', license: best.license || null, version: best.version || null, payload };
  }
  return {
    provider: 'openalex', status: 'found', pdfUrl, landingUrl,
    oaStatus: oa.oa_status || 'gold', license: best.license || null, version: best.version || null, payload,
  };
}

/* ── clinicaltrials ────────────────────────────────────────────────────────
 * GET /studies/{nctId}?format=json (CTG API v2). A registry record is NOT a
 * journal PDF: we return a landing page (the registry study page) with
 * version:'registry' and NO pdfUrl. If the study lists result documents with a
 * direct URL, we surface the first as a landing link (never as a journal PDF).
 */
async function clinicaltrialsLookup(record, ctx) {
  const nct = extractNctId(record);
  if (!nct) return { provider: 'clinicaltrials', status: 'not_found', reason: 'no NCT id' };
  const base = process.env.CLINICALTRIALS_API_BASE || 'https://clinicaltrials.gov/api/v2';
  const url = `${base}/studies/${encodeURIComponent(nct)}?format=json`;
  const j = await fetchJson(url, ctx.fetchFn);
  if (j && j._notFound) return { provider: 'clinicaltrials', status: 'not_found', reason: 'NCT id unknown to ClinicalTrials.gov' };
  const ps = (j && j.protocolSection) || null;
  if (!ps) return { provider: 'clinicaltrials', status: 'not_found', reason: 'no protocol section' };
  const hasResults = !!(j.hasResults || j.resultsSection);
  const landingUrl = `https://clinicaltrials.gov/study/${nct}`;
  // Surface a listed large-document URL if the registry provides one (still a
  // landing/registry link, never treated as a journal PDF).
  const docs = ps.largeDocumentModule && Array.isArray(ps.largeDocumentModule.largeDocs)
    ? ps.largeDocumentModule.largeDocs : [];
  const docUrl = docs.find(d => d && d.filename)
    ? `https://clinicaltrials.gov/ProvidedDocs/${nct.slice(-2)}/${nct}/${docs.find(d => d && d.filename).filename}`
    : '';
  return {
    provider: 'clinicaltrials', status: 'found', landingUrl, version: 'registry',
    payload: { nctId: nct, hasResults, docUrl: docUrl || null },
  };
}

/** Provider registry keyed by the id used in fullTextSettings.providerOrder. */
const RAW_PROVIDERS = {
  unpaywall: unpaywallLookup,
  europepmc: europepmcLookup,
  openalex: openalexLookup,
  clinicaltrials: clinicaltrialsLookup,
};

export const PROVIDER_IDS = Object.keys(RAW_PROVIDERS);

/** Wrap a raw lookup so it NEVER throws — any error becomes status 'failed'. */
function safe(id, fn) {
  return async (record, ctx) => {
    try {
      const out = await fn(record, ctx);
      // Force the canonical provider id + a defaulted status regardless of what
      // the raw lookup returned, so callers never see a missing/foreign field.
      return { status: 'not_found', ...(out || {}), provider: id };
    } catch (e) {
      return { provider: id, status: 'failed', reason: String((e && e.message) || e).slice(0, 300) };
    }
  };
}

/** Get a single provider's safe lookup fn by id, or null when unknown. */
export function getProvider(id) {
  const fn = RAW_PROVIDERS[id];
  return fn ? safe(id, fn) : null;
}

/**
 * Resolve the ordered list of safe provider lookups for a configured order.
 * Unknown ids are dropped; unlisted known providers are NOT appended (the order
 * is authoritative). Always returns at least the known subset of the order.
 */
export function resolveProviderChain(order) {
  const ids = Array.isArray(order) && order.length ? order : PROVIDER_IDS;
  return ids
    .filter(id => RAW_PROVIDERS[id])
    .map(id => ({ id, lookup: getProvider(id) }));
}
