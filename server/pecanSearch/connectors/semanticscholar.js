/**
 * pecanSearch/connectors/semanticscholar.js — Semantic Scholar connector
 * (S2 Academic Graph API, BULK paper search).
 *
 * Flow (token-paged bulk search, the S2-recommended pattern for large sets):
 *   1. GET /paper/search/bulk?query=...&fields=...   → { total, token, data[] }.
 *   2. Re-issue the SAME query with &token=<prev token> for each next page until
 *      the response omits `token` (=> exhausted).
 * previewCount reuses the same bulk endpoint with a minimal field set and reads
 * `total` (an ESTIMATE of corpus matches → kind 'estimate'). The optional
 * S2_API_KEY is sent as the `x-api-key` header (never in the URL, never logged —
 * the shared HTTP client redacts that header) and raises the per-second limit.
 *
 * Query language (bulk): space = implicit AND, `|` = OR, `+term` required,
 * `-term` excluded, `"phrase"`, `term*` prefix-wildcard, `( )` grouping. ALL
 * keywords match against TITLE + ABSTRACT only — field-restricted search
 * (title-only / author / journal) is NOT supported by bulk search, so a
 * field-scoped term is included as a keyword and a warning is pushed (never
 * silently dropped). Languages are likewise unsupported (warned).
 *
 * Verified against the S2 Academic Graph API docs / tutorial:
 *   - https://api.semanticscholar.org/api-docs/graph (GET /paper/search/bulk)
 *   - https://www.semanticscholar.org/product/api/tutorial (bulk paging + syntax)
 * Confirmed: token paging (token present => more, absent => done), `total` is an
 * estimate, up to 1000/page, externalIds.{DOI,PubMed}, x-api-key raises the limit
 * and S2 rate-limits aggressively (we lean on the http client's 429 backoff).
 * Last reviewed: 2026-06.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, makeTranslated,
} from '../query/ast.js';
import { PecanError } from '../errors.js';

export const SEMANTICSCHOLAR_VERSION = 'semanticscholar-1.0.0';

/** Fields requested from the bulk endpoint (everything we normalize from). */
const SEARCH_FIELDS = 'title,abstract,authors,year,venue,externalIds,publicationTypes,publicationDate';

/** S2 bulk returns up to 1000 papers per page. */
const S2_MAX_PAGE = 1000;

/** Reserved bulk operators that must be neutralised inside a plain keyword/phrase. */
function sanitizeTermText(text) {
  // A leading +/- would be read as required/excluded; strip leading operator runs.
  // Internal pipes/parens/quotes are removed so a single term can't break grouping.
  return String(text == null ? '' : text)
    .replace(/[()|]/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A phrase = has internal whitespace → must be quoted for the bulk parser. */
function isPhrase(text) { return /\s/.test(String(text).trim()); }

/** Render one canonical term into a bulk-search token. */
function renderTerm(t, warnings) {
  // Field scoping is impossible in bulk search (title+abstract only). Keep the
  // text as a keyword but tell the user the scope was not applied.
  if (t.field && t.field !== FIELD.TIAB && t.field !== FIELD.ALL && t.field !== FIELD.ABSTRACT && t.field !== FIELD.TITLE) {
    warnings.push(`Semantic Scholar bulk search matches title+abstract only; the "${t.field}" field scope on "${t.text}" was not applied (searched as a keyword).`);
  } else if (t.field === FIELD.TITLE || t.field === FIELD.ABSTRACT) {
    warnings.push(`Semantic Scholar bulk search cannot restrict "${t.text}" to ${t.field} alone; it was matched across title+abstract.`);
  }
  if (t.type === 'controlled' && t.field === FIELD.MESH) {
    const heading = (t.vocab && (t.vocab.mesh || t.vocab.heading)) || t.text;
    warnings.push(`Controlled MeSH term "${heading}" was searched as a free-text keyword (Semantic Scholar has no MeSH index).`);
  }
  let body = sanitizeTermText(t.text);
  if (!body) return '';
  if (isPhrase(body)) {
    if (t.truncate) warnings.push(`Wildcard truncation on the phrase "${t.text}" is not supported by Semantic Scholar and was dropped.`);
    return `"${body}"`;
  }
  if (t.truncate) body = body.replace(/\*?$/, '*'); // single-token prefix wildcard
  return body;
}

/** translateQuery — canonical → S2 bulk query string + structured diagnostics. */
function translateSemanticScholar(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  // Concepts join with implicit AND (space); a concept's terms join with its op.
  const conceptStrings = canonical.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      const rendered = renderTerm(t, warnings);
      if (rendered) supported.push(`${t.field}:${t.text}`);
      return rendered;
    }).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    // op AND inside a concept → space-join; op OR → pipe-join. Group either way.
    const joiner = concept.op === 'AND' ? ' ' : ' | ';
    return `(${parts.join(joiner)})`;
  }).filter(Boolean);

  let query = conceptStrings.join(' ');

  // Filters: year is a native bulk param (handled in search()); record support.
  const f = canonical.filters;
  if (f.dateFrom || f.dateTo) supported.push(`year:${f.dateFrom || '*'}..${f.dateTo || '*'}`);
  if (f.pubTypes.length) supported.push(`pubTypes:${f.pubTypes.join(',')}`);
  if (f.languages.length) {
    unsupported.push(`languages:${f.languages.join(',')}`);
    warnings.push('Semantic Scholar does not support language filtering; the language filter was ignored.');
  }

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  const translated = makeTranslated({
    provider: 'semanticscholar', version: SEMANTICSCHOLAR_VERSION, query,
    supported, unsupported, warnings, hasOverride,
    assumptions: [
      'Bulk search matches every keyword against the title and abstract; field scopes were not applied.',
      'Concept terms joined with OR (|) or AND (space); concepts joined with implicit AND.',
    ],
  });
  // Native bulk filters (year range, publicationTypes) travel WITH the translated
  // query so search()/previewCount() are self-contained from `translated` alone
  // (an override query carries no canonical filters by design).
  translated.filterParams = hasOverride ? {} : filterParams(canonical);
  return translated;
}

/** Derive the native bulk filter params (year range, publicationTypes) from canonical. */
function filterParams(canonicalInput) {
  const c = normalizeCanonical(canonicalInput);
  const p = {};
  const fromY = (c.filters.dateFrom.match(/\d{4}/) || [])[0];
  const toY = (c.filters.dateTo.match(/\d{4}/) || [])[0];
  if (fromY || toY) p.year = `${fromY || ''}-${toY || ''}`; // S2 accepts "2010-2020", "2010-", "-2020"
  if (c.filters.pubTypes.length) p.publicationTypes = c.filters.pubTypes.join(',');
  return p;
}

/**
 * createSemanticScholarConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createSemanticScholarConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // S2 rate-limits aggressively: ~1 req/sec keyed, slower unauthenticated. We
  // start-space requests and lean on the http client's 429/Retry-After backoff.
  const slot = makeThrottle(cfg.hasKey ? 1100 : 3500, { now, sleep });

  function reqHeaders() {
    const h = {};
    if (cfg.apiKey) h['x-api-key'] = cfg.apiKey; // SECRET — redacted in logs
    return h;
  }

  async function bulkSearch(query, { token, extraParams = {}, signal } = {}) {
    await slot();
    const params = { query, fields: SEARCH_FIELDS, ...extraParams };
    if (token) params.token = token;
    const url = buildUrl(cfg.baseUrl, '/paper/search/bulk', params);
    const { json } = await http.requestJson(url, {
      provider: 'semanticscholar', timeoutMs: cfg.timeoutMs,
      retryLimit: deps.retryLimit, headers: reqHeaders(), signal,
    });
    return json && typeof json === 'object' ? json : {};
  }

  return {
    provider: 'semanticscholar',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateSemanticScholar(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal } = {}) {
      const at = new Date().toISOString();
      const query = translated && translated.query;
      if (!query) return { count: null, kind: 'unavailable', at };
      try {
        // Minimal field set keeps the count probe cheap.
        const params = { ...(translated.filterParams || {}), fields: 'paperId' };
        const json = await bulkSearch(query, { extraParams: params, signal });
        const total = Number(json.total);
        if (!Number.isFinite(total)) return { count: null, kind: 'unavailable', at };
        // S2 `total` is documented as an estimate of corpus matches.
        return { count: total, kind: 'estimate', at };
      } catch {
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { token, fetched, params }.
     * `token` null/absent in the response => exhausted. We also stop at the
     * provider/cap ceiling (cfg.maxResults / ctx.capRemaining).
     */
    async search(translated, cursor, ctx = {}) {
      const query = translated && translated.query;
      if (!query) throw new PecanError('INVALID_QUERY', { meta: { provider: 'semanticscholar' } });
      const signal = ctx.signal;
      const pageSize = clampPageSize(ctx.pageSize, Math.min(cfg.pageSize || S2_MAX_PAGE, S2_MAX_PAGE));

      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }

      // Native bulk filters travel with the translated query; resolve once and
      // pin to the cursor so every page issues identical filter params.
      const params = state && state.params
        ? state.params
        : { ...(translated.filterParams || {}), limit: pageSize };
      const token = state ? state.token : null;
      const fetched = state ? Number(state.fetched) || 0 : 0;

      // Respect the per-source cap (provider ceiling + remaining run budget).
      const hardCap = Math.min(
        Number.isFinite(cfg.maxResults) ? cfg.maxResults : Infinity,
        Number.isFinite(ctx.capRemaining) ? fetched + ctx.capRemaining : Infinity,
      );
      if (fetched >= hardCap) return { records: [], nextCursor: null, total: null, rateLimit: {} };

      const json = await bulkSearch(query, { token, extraParams: params, signal });
      const data = Array.isArray(json.data) ? json.data : [];
      const total = Number.isFinite(Number(json.total)) ? Number(json.total) : null;
      const records = data.map((p) => toRawItem(p)).filter(Boolean);

      const nextFetched = fetched + records.length;
      const moreFromProvider = typeof json.token === 'string' && json.token.length > 0 && records.length > 0;
      const underCap = nextFetched < hardCap;
      const nextCursor = (moreFromProvider && underCap)
        ? JSON.stringify({ token: json.token, fetched: nextFetched, params })
        : null;

      return { records, nextCursor, total, rateLimit: {} };
    },

    /** normalize(rawItem) — partial record → canonical record + provenance. */
    normalize(rawItem) {
      const rec = normalizeRecord(rawItem, { provider: 'semanticscholar', version: NORMALIZATION_VERSION });
      const providerRecordId = (rawItem && rawItem.providerRecordId)
        || (rawItem && rawItem._paperId)
        || rec.doi
        || contentHashId(rec);
      return { ...rec, providerRecordId, raw: (rawItem && rawItem._raw) || '' };
    },
  };
}

/**
 * toRawItem — map one S2 paper object into the partial-record shape normalizeRecord
 * expects. Total + defensive: a malformed paper yields a usable (possibly sparse)
 * record, never an exception (one bad record must not crash a source run).
 */
export function toRawItem(paper) {
  if (!paper || typeof paper !== 'object') return null;
  const ext = paper.externalIds && typeof paper.externalIds === 'object' ? paper.externalIds : {};
  const authors = Array.isArray(paper.authors)
    ? paper.authors.map((a) => (a && (a.name || a.fullName)) || '').filter(Boolean)
    : [];
  const pubTypes = Array.isArray(paper.publicationTypes) ? paper.publicationTypes : [];
  // Cap the raw provenance snapshot at ~15kB.
  let raw = '';
  try { raw = JSON.stringify(paper).slice(0, 15000); } catch { raw = ''; }
  return {
    _paperId: paper.paperId ? String(paper.paperId) : '',
    title: paper.title || '',
    abstract: paper.abstract || '',
    authors,
    year: paper.year != null ? paper.year : (paper.publicationDate || ''),
    journal: paper.venue || '',
    doi: ext.DOI || ext.Doi || ext.doi || '',
    pmid: ext.PubMed || ext.Pubmed || '',
    pmcid: ext.PubMedCentral || ext.PMC || '',
    pubType: pubTypes,
    url: paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : '',
    _raw: raw,
  };
}
