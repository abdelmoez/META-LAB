/**
 * pecanSearch/connectors/openalex.js — OpenAlex connector (OpenAlex REST API).
 *
 * Flow (cursor paging, the OpenAlex-recommended pattern for deep result sets):
 *   GET /works?filter=...&per-page=N&cursor=*&select=...&mailto=<contact>
 *   First page sends cursor=*; each response carries meta.next_cursor (an opaque
 *   base64 string) used as the cursor for the next page. meta.next_cursor === null
 *   (or empty results) => the result set is exhausted. meta.count is the exact total.
 *
 * Query model: each canonical CONCEPT (its terms OR'd) becomes ONE
 * `title_and_abstract.search:"a|b|c"` filter value; multiple concepts are
 * comma-joined filters (OpenAlex combines comma-separated filters with AND). This
 * approximates strict Boolean: OpenAlex .search is a ranked, analyzed phrase match,
 * NOT exact field Boolean — we WARN whenever a nuance is approximated (per-field
 * tags collapse to title+abstract, intra-concept AND can't live inside one search
 * value, MeSH/truncation are unsupported). Date/language/type map to native filters.
 *
 * Politeness: the polite-pool `mailto=<deps.contact.email>` is sent on every call
 * (OpenAlex etiquette → faster, more reliable pool). No API key is required.
 *
 * Abstracts are returned as an INVERTED INDEX (word -> [positions]); reconstructAbstract()
 * rebuilds the plain text. PMIDs arrive as full pubmed URLs (ids.pmid) and are
 * digit-extracted by normalizeRecord.
 *
 * Verified live against the OpenAlex API + developers.openalex.org docs (GET /works
 * cursor paging meta.next_cursor/meta.count, per-page max 200, select=, filter comma=AND
 * / pipe=OR, from_publication_date/to_publication_date=YYYY-MM-DD, language:<code>,
 * type:<type>, title_and_abstract.search, abstract_inverted_index, ids.pmid URL form).
 * Doc: https://docs.openalex.org/how-to-use-the-api/get-lists-of-entities/paging
 *      https://docs.openalex.org/api-entities/works/filter-works
 * Last reviewed: 2026-06-22.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, makeTranslated,
} from '../query/ast.js';
import { PecanError } from '../errors.js';

export const OPENALEX_VERSION = 'openalex-1.0.0';

// OpenAlex /works hard ceiling for per-page; we never request more.
const OPENALEX_MAX_PER_PAGE = 200;

// Compact field projection — only what normalize() consumes (keeps responses small).
const SELECT_FIELDS = [
  'id', 'doi', 'title', 'display_name', 'abstract_inverted_index',
  'authorships', 'publication_year', 'publication_date',
  'primary_location', 'type', 'language', 'ids',
].join(',');

/**
 * Canonical semantic fields OpenAlex's `.search` filter cannot honor individually.
 * OpenAlex offers title.search / abstract.search but NOT author/journal/doi/pmid as
 * part of a free-text Boolean concept; we collapse everything in a concept to
 * title_and_abstract.search and warn where that loses precision.
 */
const FIELD_NOTE = {
  [FIELD.AUTHOR]: 'author',
  [FIELD.JOURNAL]: 'journal',
  [FIELD.DOI]: 'doi',
  [FIELD.PMID]: 'pmid',
  [FIELD.MESH]: 'mesh',
};

/** Escape characters that would break a single OpenAlex filter value. */
function sanitizeSearchTerm(text) {
  // OpenAlex filter values are comma/pipe-delimited; a literal comma or pipe in a
  // term would be mis-parsed as a separator. Quotes are also stripped — .search is
  // a phrase-aware analyzer, not a quoted-phrase grammar, so quotes add no value.
  return String(text == null ? '' : text)
    .replace(/[,|]/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reconstruct plain abstract text from OpenAlex's abstract_inverted_index. */
export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  let maxPos = -1;
  const slots = [];
  for (const word of Object.keys(invertedIndex)) {
    const positions = invertedIndex[word];
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      const i = Number(pos);
      if (!Number.isInteger(i) || i < 0 || i > 200000) continue; // guard pathological indices
      slots[i] = word;
      if (i > maxPos) maxPos = i;
    }
  }
  if (maxPos < 0) return '';
  const out = [];
  for (let i = 0; i <= maxPos; i += 1) if (slots[i] != null) out.push(slots[i]);
  return out.join(' ');
}

/**
 * translateQuery — canonical → OpenAlex filter string + structured diagnostics.
 * Returns `query` as the `filter=` value (comma-joined). Concept terms join with
 * `|` (OR) inside one title_and_abstract.search; concepts comma-join (AND).
 */
function translateOpenAlex(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];
  const assumptions = [
    'Each concept maps to one title_and_abstract.search filter; OpenAlex .search is a ranked, analyzed match, not strict field Boolean.',
    'Multiple concepts are comma-joined OpenAlex filters (AND); a concept\'s terms are pipe-joined (OR).',
  ];

  const filterParts = [];

  for (const concept of canonical.concepts) {
    const termTexts = [];
    let conceptHadFieldCollapse = false;
    let conceptHadTruncate = false;

    for (const t of concept.terms) {
      const clean = sanitizeSearchTerm(t.text);
      if (!clean) continue;
      supported.push(`${t.field}:${t.text}`);
      // No silent weakening (§2.2): disclose when reserved characters were removed.
      const origText = String(t.text || '').trim();
      if (clean !== origText) warnings.push(`Term "${origText}" contained characters reserved by OpenAlex (comma, pipe, quote) that were removed; it was searched as "${clean}".`);

      // Per-field precision is lost: OpenAlex search filter spans title+abstract.
      if (FIELD_NOTE[t.field]) {
        conceptHadFieldCollapse = true;
        unsupported.push(`field:${t.field}`);
      }
      // OpenAlex .search has no wildcard/right-truncation operator.
      if (t.truncate) conceptHadTruncate = true;
      // Controlled MeSH vocabulary has no OpenAlex equivalent in a text concept.
      if (t.type === 'controlled') unsupported.push(`controlled:${t.text}`);

      termTexts.push(clean);
    }

    if (!termTexts.length) continue;

    // Terms within a concept are synonyms (OR) — pipe-joined below — and concepts
    // are AND'd as separate comma-joined filters. (concept.op is the inter-concept
    // operator, default AND; OpenAlex joins filters with AND.)
    if (conceptHadFieldCollapse) {
      warnings.push(`A field restriction (author/journal/doi/pmid/mesh) in concept "${concept.label || concept.id || 'unnamed'}" was searched across title+abstract instead, as OpenAlex's text search does not scope those fields.`);
    }
    if (conceptHadTruncate) {
      warnings.push(`Right-truncation (term*) in concept "${concept.label || concept.id || 'unnamed'}" is not supported by OpenAlex search and was applied as a whole-word match.`);
    }

    // Value: pipe-join the OR terms inside one search filter.
    filterParts.push(`title_and_abstract.search:${termTexts.join('|')}`);
  }

  // Native filters: dates, language, type.
  const f = canonical.filters;
  const fromDate = toOpenAlexDate(f.dateFrom, 'from');
  const toDate = toOpenAlexDate(f.dateTo, 'to');
  if (f.dateFrom && !fromDate) warnings.push(`Start date "${f.dateFrom}" was not a recognised date and was ignored.`);
  if (f.dateTo && !toDate) warnings.push(`End date "${f.dateTo}" was not a recognised date and was ignored.`);
  if (fromDate) filterParts.push(`from_publication_date:${fromDate}`);
  if (toDate) filterParts.push(`to_publication_date:${toDate}`);

  if (f.languages.length) {
    const codes = f.languages.map(toLanguageCode).filter(Boolean);
    const dropped = f.languages.filter((l) => !toLanguageCode(l));
    if (dropped.length) warnings.push(`Language value(s) ${dropped.join(', ')} could not be mapped to an OpenAlex ISO-639-1 code and were ignored.`);
    if (codes.length) filterParts.push(`language:${[...new Set(codes)].join('|')}`); // OR across languages
  }

  if (f.pubTypes.length) {
    const types = f.pubTypes.map(toWorkType).filter(Boolean);
    const dropped = f.pubTypes.filter((p) => !toWorkType(p));
    if (dropped.length) warnings.push(`Publication type(s) ${dropped.join(', ')} are not OpenAlex work types and were ignored.`);
    if (types.length) filterParts.push(`type:${[...new Set(types)].join('|')}`); // OR across types
  }

  let query = filterParts.join(',');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  return makeTranslated({
    provider: 'openalex', version: OPENALEX_VERSION, query,
    supported, unsupported, warnings, assumptions, hasOverride,
  });
}

/** Coerce a canonical date (YYYY | YYYY-MM-DD | YYYY/MM/DD) to YYYY-MM-DD. */
function toOpenAlexDate(value, edge) {
  const s = String(value == null ? '' : value).trim().replace(/\//g, '-');
  if (!s) return '';
  const ym = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!ym) return '';
  const year = ym[1];
  const month = ym[2] ? String(Math.min(12, Math.max(1, parseInt(ym[2], 10)))).padStart(2, '0') : (edge === 'to' ? '12' : '01');
  const day = ym[3] ? String(Math.min(31, Math.max(1, parseInt(ym[3], 10)))).padStart(2, '0') : (edge === 'to' ? '31' : '01');
  return `${year}-${month}-${day}`;
}

/** Map a language label/code to an OpenAlex ISO-639-1 code (subset), else ''. */
function toLanguageCode(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  if (/^[a-z]{2}$/.test(v)) return v; // already a 2-letter code
  const map = {
    english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
    portuguese: 'pt', dutch: 'nl', russian: 'ru', chinese: 'zh', japanese: 'ja',
    korean: 'ko', arabic: 'ar', polish: 'pl', turkish: 'tr', swedish: 'sv',
  };
  return map[v] || '';
}

/** Map a publication-type label to an OpenAlex work `type` (subset), else ''. */
function toWorkType(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  const map = {
    article: 'article', 'journal article': 'article',
    review: 'review',
    book: 'book', 'book-chapter': 'book-chapter', 'book chapter': 'book-chapter',
    dataset: 'dataset', preprint: 'preprint',
    dissertation: 'dissertation', thesis: 'dissertation',
    'conference paper': 'article', proceedings: 'article',
    editorial: 'editorial', letter: 'letter', report: 'report',
  };
  return map[v] || (/^[a-z-]+$/.test(v) ? v : '');
}

/**
 * createOpenAlexConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createOpenAlexConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Polite-pool start-spacing: ~10/sec is the documented courteous ceiling.
  const slot = makeThrottle(100, { now, sleep });

  function commonParams(extra = {}) {
    const p = { ...extra };
    // mailto enters the polite pool (faster, more reliable). Tool id is optional.
    if (deps.contact && deps.contact.email) p.mailto = deps.contact.email;
    if (cfg.apiKey) p.api_key = cfg.apiKey; // SECRET — redacted in logs (OpenAlex Premium)
    return p;
  }

  async function getWorks(filter, { perPage, cursor, select, timeoutMs, retryLimit }, signal) {
    await slot();
    const url = buildUrl(cfg.baseUrl, '/works', commonParams({
      filter,
      'per-page': perPage,
      cursor,
      ...(select ? { select } : {}),
    }));
    const { json } = await http.requestJson(url, {
      provider: 'openalex',
      timeoutMs: timeoutMs ?? cfg.timeoutMs,
      retryLimit: retryLimit ?? deps.retryLimit,
      signal,
    });
    return json && typeof json === 'object' ? json : {};
  }

  return {
    provider: 'openalex',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateOpenAlex(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal, timeoutMs, retryLimit } = {}) {
      const at = new Date().toISOString();
      const filter = translated && translated.query;
      if (!filter) return { count: null, kind: 'unavailable', at };
      try {
        // per-page=1 + select=id keeps the count probe cheap; meta.count is exact.
        const json = await getWorks(filter, { perPage: 1, cursor: '*', select: 'id', timeoutMs, retryLimit }, signal);
        const count = json.meta && Number.isFinite(Number(json.meta.count)) ? Number(json.meta.count) : null;
        return { count, kind: count == null ? 'unavailable' : 'exact', at };
      } catch {
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { next: '<openalex cursor>' }. null/first page → '*'.
     * Returns { records (raw works), nextCursor, total, rateLimit }.
     */
    async search(translated, cursor, ctx = {}) {
      const filter = translated && translated.query;
      if (!filter) throw new PecanError('INVALID_QUERY', { meta: { provider: 'openalex' } });
      const pageSize = clampPageSize(ctx.pageSize, Math.min(cfg.pageSize || OPENALEX_MAX_PER_PAGE, OPENALEX_MAX_PER_PAGE));
      const signal = ctx.signal;

      let oaCursor = '*';
      if (cursor) {
        try {
          const state = JSON.parse(cursor);
          if (state && typeof state.next === 'string' && state.next) oaCursor = state.next;
          else return { records: [], nextCursor: null, total: null, rateLimit: {} };
        } catch { oaCursor = '*'; }
      }

      const json = await getWorks(filter, { perPage: pageSize, cursor: oaCursor, select: SELECT_FIELDS }, signal);
      const results = Array.isArray(json.results) ? json.results : [];
      const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
      const total = Number.isFinite(Number(meta.count)) ? Number(meta.count) : null;

      // Cap-aware exhaustion: OpenAlex deep-cursor ceiling AND our configured cap.
      const next = typeof meta.next_cursor === 'string' && meta.next_cursor ? meta.next_cursor : null;
      const capRemaining = Number.isFinite(ctx.capRemaining) ? ctx.capRemaining : Infinity;
      const moreRoom = capRemaining > results.length;
      const nextCursor = (next && results.length > 0 && moreRoom)
        ? JSON.stringify({ next })
        : null;

      return { records: results, nextCursor, total, rateLimit: {} };
    },

    /** normalize(rawWork) — OpenAlex Work → canonical record. */
    normalize(rawItem) {
      const w = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const ids = w.ids && typeof w.ids === 'object' ? w.ids : {};
      const source = w.primary_location && w.primary_location.source && typeof w.primary_location.source === 'object'
        ? w.primary_location.source : {};
      const authors = Array.isArray(w.authorships)
        ? w.authorships.map((a) => (a && a.author && a.author.display_name) || (a && a.raw_author_name) || '').filter(Boolean)
        : [];

      const partial = {
        doi: w.doi || ids.doi || '',
        pmid: ids.pmid || '',                 // URL form → normalizeRecord strips to digits
        title: w.title || w.display_name || '',
        abstract: reconstructAbstract(w.abstract_inverted_index),
        authors,
        year: w.publication_year || w.publication_date || '',
        journal: source.display_name || '',
        pubType: w.type || '',
        language: w.language || '',
        url: w.doi || w.id || '',             // cleanUrl keeps only http(s)
      };

      const rec = normalizeRecord(partial, { provider: 'openalex', version: NORMALIZATION_VERSION });

      // Stable id: OpenAlex Work id (e.g. https://openalex.org/W123…), else DOI, else content hash.
      const oaId = typeof w.id === 'string' && w.id ? w.id : '';
      const providerRecordId = oaId || rec.doi || contentHashId(rec);

      // Small provenance snapshot (cap ~15kB) — do NOT carry the full inverted index.
      const snapshot = {
        id: w.id, doi: w.doi, title: w.title || w.display_name,
        publication_year: w.publication_year, type: w.type, language: w.language,
        ids, primary_location_source: source.display_name || undefined,
        authorships_count: authors.length,
      };
      let raw = '';
      try { raw = JSON.stringify(snapshot).slice(0, 15000); } catch { raw = ''; }

      return { ...rec, providerRecordId, raw };
    },
  };
}
