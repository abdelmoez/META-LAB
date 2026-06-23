/**
 * pecanSearch/connectors/doaj.js — DOAJ connector (Directory of Open Access Journals API v3).
 *
 * Flow (page-based paging):
 *   GET /search/articles/{url-encoded-query}?page=N&pageSize=M[&sort=...]
 *     query  = an Elasticsearch query_string (bibjson.title:"…" AND bibjson.abstract:"…")
 *     page   starts at 1; pageSize max 100 (the API silently clamps a larger value).
 *   Response: { total, page, pageSize, results: [ { id, bibjson: {...} }, ... ] }.
 * previewCount reuses the same endpoint with pageSize=1 and reads `total` (exact).
 *
 * PROVIDER LIMITS (verified live, see below):
 *   - HARD CEILING 1000 RECORDS: page*pageSize may not exceed 1000 — requesting
 *     offset >= 1000 returns HTTP 400 ("You cannot access results beyond 1000
 *     records via this API"). We cap pagination at 1000 regardless of cfg.maxResults
 *     and surface a warning. (Bulk users are pointed at the DOAJ data dump / OAI-PMH.)
 *   - WILDCARD / REGEX query_string features are DISABLED server-side, so we never
 *     emit `*` truncation — we warn and drop it instead.
 *   - DOAJ is journal-article only (no preprints/trials) — no auth, no API key.
 *
 * Field map (canonical → DOAJ query_string field):
 *   TITLE→bibjson.title, ABSTRACT→bibjson.abstract, TIAB→(title OR abstract),
 *   AUTHOR→bibjson.author.name, JOURNAL→bibjson.journal.title,
 *   DOI→bibjson.identifier.id, PMID→bibjson.identifier.id, YEAR→bibjson.year.
 *   MESH/KEYWORD have no controlled equivalent → mapped to bibjson.keywords with a warning.
 *
 * Verified against the live DOAJ API v3 (https://doaj.org/api/v3/search/articles/…):
 *   response shape {total,page,pageSize,results[].{id,bibjson{title,abstract,year,
 *   journal.title,author[].name,identifier[].{type,id},keywords[],link[].url}}},
 *   pageSize clamp to 100, the 1000-record offset ceiling, and empty-result handling.
 *   Docs: https://doaj.org/api/v3/docs  (account of disabled wildcard/regex +
 *   query_string syntax via DOAJ search docs). Last reviewed: 2026-06-22.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, makeTranslated,
} from '../query/ast.js';
import { toIso6391 } from '../query/vocab.js';
import { PecanError } from '../errors.js';

export const DOAJ_VERSION = 'doaj-1.0.0';

/** DOAJ hard ceiling: the API refuses any offset >= 1000 records. */
export const DOAJ_MAX_OFFSET = 1000;

/** Canonical field → DOAJ query_string field path. */
const FIELD_PATH = {
  [FIELD.TITLE]: 'bibjson.title',
  [FIELD.ABSTRACT]: 'bibjson.abstract',
  [FIELD.AUTHOR]: 'bibjson.author.name',
  [FIELD.JOURNAL]: 'bibjson.journal.title',
  [FIELD.DOI]: 'bibjson.identifier.id',
  [FIELD.PMID]: 'bibjson.identifier.id',
  [FIELD.YEAR]: 'bibjson.year',
  [FIELD.KEYWORD]: 'bibjson.keywords',
};

/**
 * Escape Elasticsearch query_string reserved characters inside a term so user
 * text can never break out of its clause (injection-safe). Wildcards (* ?) are
 * escaped too because DOAJ disables them — an unescaped `*` would error.
 * Reserved: + - = && || > < ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeEs(text) {
  return String(text == null ? '' : text).replace(/([+\-=&|><!(){}\[\]^"~*?:\\/])/g, '\\$1');
}

/**
 * Inside a quoted phrase, Elasticsearch query_string treats reserved characters as
 * LITERAL — escaping them (e.g. `non\-insulin`) inserts literal backslashes and the
 * phrase matches nothing. So a phrase only needs the quote and backslash escaped.
 */
function escapeEsPhrase(text) {
  return String(text == null ? '' : text).replace(/(["\\])/g, '\\$1');
}

/** Render one canonical term into a DOAJ query_string clause: field:"phrase" or field:token. */
function renderTerm(t, warnings) {
  const raw = String(t.text || '').trim();
  if (!raw) return '';

  if (t.truncate) {
    // DOAJ disables wildcard/regex query_string features — truncation is dropped.
    warnings.push(`Truncation on "${t.text}" is not supported by DOAJ (wildcards are disabled) and was dropped.`);
  }
  if (t.type === 'controlled' && t.field === FIELD.MESH) {
    warnings.push(`Controlled MeSH term "${t.text}" has no DOAJ equivalent; searched as a keyword instead.`);
  }

  const path = FIELD_PATH[t.field];
  const phrase = /\s/.test(raw);
  const value = phrase ? `"${escapeEsPhrase(raw)}"` : escapeEs(raw);

  if (t.field === FIELD.TIAB || !path) {
    // No single DOAJ field is title-or-abstract → expand to (title OR abstract).
    if (t.field !== FIELD.TIAB && !path) {
      warnings.push(`Field "${t.field}" is not directly supported by DOAJ; searched across title and abstract.`);
    }
    return `(bibjson.title:${value} OR bibjson.abstract:${value})`;
  }
  return `${path}:${value}`;
}

/** Render canonical filters (DOAJ supports a year range; language/pubType are weak). */
function renderFilters(filters, warnings) {
  const clauses = [];
  const fromY = (filters.dateFrom || '').match(/\d{4}/);
  const toY = (filters.dateTo || '').match(/\d{4}/);
  if (fromY || toY) {
    const lo = fromY ? fromY[0] : '*';
    const hi = toY ? toY[0] : '*';
    clauses.push(`bibjson.year:[${lo} TO ${hi}]`);
  }
  if (filters.languages && filters.languages.length) {
    // DOAJ indexes bibjson.journal.language as ISO 639-1 2-letter codes (verified
    // live: "en" matches, "eng"/"English" return 0). Map the label/code; drop + warn
    // on anything unmappable rather than emit a clause that matches nothing.
    const codes = [];
    for (const l of filters.languages) {
      const code = toIso6391(l);
      if (code) codes.push(code);
      else warnings.push(`Language "${l}" could not be mapped to a DOAJ ISO 639-1 code and was not applied.`);
    }
    if (codes.length) clauses.push('(' + [...new Set(codes)].map((c) => `bibjson.journal.language:${escapeEs(c)}`).join(' OR ') + ')');
  }
  if (filters.pubTypes && filters.pubTypes.length) {
    warnings.push('Publication-type filters are not supported by DOAJ and were ignored.');
  }
  return clauses;
}

/** translateQuery — canonical → DOAJ query_string + structured diagnostics. */
function translateDoaj(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  const conceptStrings = canonical.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      const clause = renderTerm(t, warnings);
      if (clause) supported.push(`${t.field}:${t.text}`);
      return clause;
    }).filter(Boolean);
    if (!parts.length) return '';
    return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  }).filter(Boolean);

  const filterClauses = renderFilters(canonical.filters, warnings);
  let query = [...conceptStrings, ...filterClauses].join(' AND ');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  return makeTranslated({
    provider: 'doaj', version: DOAJ_VERSION, query,
    supported, unsupported, warnings, hasOverride,
    assumptions: [
      'DOI and PMID both searched via bibjson.identifier.id.',
      'Title/abstract (tiab) expanded to (bibjson.title OR bibjson.abstract).',
      'DOAJ caps a single search at 1000 records.',
    ],
  });
}

/**
 * createDoajConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createDoajConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // DOAJ has no published hard rate limit; space starts politely (~3/sec).
  const slot = makeThrottle(350, { now, sleep });

  // The effective per-search ceiling is the smaller of cfg.maxResults and DOAJ's 1000.
  const hardCap = Math.min(Number(cfg.maxResults) || DOAJ_MAX_OFFSET, DOAJ_MAX_OFFSET);

  async function fetchPage(term, page, pageSize, signal, httpOpts = {}) {
    await slot();
    // The query is a PATH SEGMENT — buildUrl encodes it; never string-concatenated.
    const url = buildUrl(cfg.baseUrl, `/search/articles/${encodeURIComponent(term)}`, {
      page, pageSize,
    });
    const { json } = await http.requestJson(url, {
      provider: 'doaj',
      timeoutMs: httpOpts.timeoutMs ?? cfg.timeoutMs,
      retryLimit: httpOpts.retryLimit ?? deps.retryLimit,
      signal,
    });
    if (!json || typeof json !== 'object') {
      throw new PecanError('PROVIDER_MALFORMED_RESPONSE', { meta: { provider: 'doaj' } });
    }
    const total = Number(json.total);
    const results = Array.isArray(json.results) ? json.results : [];
    return { total: Number.isFinite(total) ? total : null, results };
  }

  return {
    provider: 'doaj',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: hardCap, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateDoaj(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal, timeoutMs, retryLimit } = {}) {
      const at = new Date().toISOString();
      const term = translated && translated.query;
      if (!term) return { count: null, kind: 'unavailable', at };
      try {
        const { total } = await fetchPage(term, 1, 1, signal, { timeoutMs, retryLimit });
        if (total == null) return { count: null, kind: 'unavailable', at };
        // DOAJ counts exactly but only 1000 are retrievable; the count itself is exact.
        return { count: total, kind: 'exact', at };
      } catch {
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { page, pageSize, total }. null = first page.
     * Stops at min(total, 1000, capRemaining) — never pages past DOAJ's ceiling.
     */
    async search(translated, cursor, ctx = {}) {
      const term = translated && translated.query;
      if (!term) throw new PecanError('INVALID_QUERY', { meta: { provider: 'doaj' } });

      const pageSize = clampPageSize(ctx.pageSize, cfg.pageSize);
      const signal = ctx.signal;

      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }

      const page = state && Number.isFinite(state.page) ? state.page : 1;
      const offset = (page - 1) * pageSize;

      // Effective ceiling: provider cap, optionally tightened by the run's remaining budget.
      let ceiling = hardCap;
      if (Number.isFinite(ctx.capRemaining)) ceiling = Math.min(ceiling, offset + Math.max(0, ctx.capRemaining));
      ceiling = Math.min(ceiling, DOAJ_MAX_OFFSET);

      // Already at/over the ceiling → honest exhaustion (don't trigger the API 400).
      if (offset >= ceiling) {
        return { records: [], nextCursor: null, total: state ? state.total : null, rateLimit: {} };
      }

      const { total, results } = await fetchPage(term, page, pageSize, signal);
      const effectiveTotal = Number.isFinite(total) ? total : (state ? state.total : null);

      // Tag each raw result with the DOAJ id so normalize() has a stable provider id.
      const records = results.map((r) => (r && typeof r === 'object' ? { ...r, _providerRecordId: r.id } : {}));

      const nextOffset = offset + pageSize;
      const limit = Number.isFinite(effectiveTotal) ? Math.min(effectiveTotal, ceiling) : ceiling;
      const nextCursor = (records.length > 0 && nextOffset < limit && nextOffset < DOAJ_MAX_OFFSET)
        ? JSON.stringify({ page: page + 1, pageSize, total: effectiveTotal })
        : null;

      return {
        records,
        nextCursor,
        total: Number.isFinite(effectiveTotal) ? effectiveTotal : null,
        rateLimit: {},
      };
    },

    /** normalize(rawItem) — DOAJ result → canonical record. Total + entity-safe. */
    normalize(rawItem) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const bib = item.bibjson && typeof item.bibjson === 'object' ? item.bibjson : {};

      const identifiers = Array.isArray(bib.identifier) ? bib.identifier : [];
      const findId = (type) => {
        const m = identifiers.find((x) => x && String(x.type || '').toLowerCase() === type);
        return m && m.id ? String(m.id) : '';
      };
      const doi = findId('doi');
      const pmid = findId('pmid');

      const authors = (Array.isArray(bib.author) ? bib.author : [])
        .map((a) => (a && (a.name || a.literal)) || '')
        .filter(Boolean);

      const journal = bib.journal && typeof bib.journal === 'object' ? bib.journal : {};
      const links = Array.isArray(bib.link) ? bib.link : [];
      const fulltext = links.find((l) => l && /fulltext/i.test(String(l.type || ''))) || links[0] || {};
      const language = Array.isArray(journal.language) ? journal.language.join('; ') : (journal.language || '');

      const partial = {
        doi,
        pmid,
        title: bib.title || '',
        abstract: bib.abstract || '',
        authors,
        year: bib.year || '',
        journal: journal.title || '',
        volume: journal.volume || bib.volume || '',
        issue: journal.number || bib.number || '',
        pages: bib.start_page ? `${bib.start_page}${bib.end_page ? `-${bib.end_page}` : ''}` : '',
        keywords: Array.isArray(bib.keywords) ? bib.keywords : [],
        language,
        url: (fulltext && fulltext.url) || '',
      };

      const rec = normalizeRecord(partial, { provider: 'doaj', version: NORMALIZATION_VERSION });

      const providerRecordId = item._providerRecordId || item.id || rec.doi || contentHashId(rec);

      // Compact provenance snapshot, capped ~15kB.
      let raw = '';
      try { raw = JSON.stringify(item).slice(0, 15000); } catch { raw = ''; }

      return { ...rec, providerRecordId, raw };
    },
  };
}
