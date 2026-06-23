/**
 * pecanSearch/connectors/crossref.js — Crossref connector (Crossref REST API).
 *
 * Endpoint: GET https://api.crossref.org/works
 *   - Free-text concept search → query.bibliographic (titles/authors/ISSNs/years).
 *   - Field-targeted hints     → query.title / query.author / query.container-title.
 *   - Dates / work type        → filter=from-pub-date:…,until-pub-date:…,type:…
 *   - Result fields            → select=DOI,title,author,container-title,issued,…
 *   - Deep paging              → cursor=* (first page) then message.next-cursor.
 *   - Polite pool              → &mailto=<contact email> (raises us to the polite
 *                                pool; recommended by Crossref etiquette).
 *
 * IMPORTANT — Crossref is a DISMAX relevance engine, NOT a strict Boolean index.
 * `query.*` parameters RANK results by similarity; they do NOT filter to an exact
 * Boolean expression. So canonical AND/OR/NOT between concepts/terms and per-field
 * restrictions are APPROXIMATED (all term text is unioned into the free-text query
 * and ranked). The connector pushes explicit warnings whenever it does this so the
 * engine never silently presents an approximated query as an exact Boolean search.
 * Only date + work-type map to real `filter=` constraints (those are exact).
 *
 * `translated.query` is a JSON-encoded params object ({ params, summary }) — the
 * connector owns its own translated shape; downstream only ever round-trips it back
 * into this connector's search()/previewCount(), so the JSON form is internal.
 *
 * Verified against the Crossref REST API documentation
 *   - https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/
 *   - https://github.com/CrossRef/rest-api-doc  (api_format.md — Work object)
 * Confirmed live: message envelope { status, message-type, message:{ total-results,
 * items[], next-cursor, items-per-page } }; rows max 1000; cursor=* deep paging;
 * issued.date-parts=[[Y,M,D]]; author=[{family,given,sequence}]; abstract is a JATS
 * XML snippet in a JSON string. Last reviewed: 2026-06-22.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, makeTranslated,
} from '../query/ast.js';
import { PecanError } from '../errors.js';

export const CROSSREF_VERSION = 'crossref-1.0.0';

/** Crossref hard ceiling for `rows` in a single request. */
const CROSSREF_MAX_ROWS = 1000;

/** Result fields we request (keeps payloads small + stable; select speeds queries). */
const SELECT_FIELDS = [
  'DOI', 'title', 'author', 'container-title', 'issued',
  'abstract', 'type', 'volume', 'issue', 'page', 'published-print', 'published-online',
];

/**
 * Strip JATS/HTML tags from a Crossref abstract (which arrives as a JATS XML
 * snippet inside a JSON string). Pure + total — normalizeRecord then decodes
 * entities and collapses whitespace. We only remove tags here.
 */
export function stripJats(abstract) {
  if (abstract == null) return '';
  return String(abstract)
    .replace(/<jats:title[^>]*>.*?<\/jats:title>/gis, ' ') // drop "Abstract" headers
    .replace(/<[^>]+>/g, ' ')                              // strip all remaining tags
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a canonical filters block → a Crossref `filter=` value (real constraints). */
function renderFilters(filters, warnings) {
  const parts = [];
  // Crossref pub-date filters take YYYY, YYYY-MM, or YYYY-MM-DD (use the value as-is).
  if (filters.dateFrom) parts.push(`from-pub-date:${filters.dateFrom.replace(/\//g, '-')}`);
  if (filters.dateTo) parts.push(`until-pub-date:${filters.dateTo.replace(/\//g, '-')}`);
  // pubTypes → type:<id>. Crossref uses ids like journal-article/proceedings-article.
  if (filters.pubTypes.length) {
    for (const t of filters.pubTypes) {
      const id = String(t).trim().toLowerCase().replace(/\s+/g, '-');
      parts.push(`type:${id}`);
    }
  }
  if (filters.languages.length) {
    warnings.push('Crossref does not support a language filter; the language restriction was not applied.');
  }
  return parts;
}

/**
 * translateQuery — canonical AST → Crossref params + structured diagnostics.
 *
 * Crossref is dismax/ranked: we collect ALL term text into query.bibliographic and
 * additionally seed query.title / query.author / query.container-title from terms
 * carrying those semantic fields (as relevance hints, not filters). Every Boolean
 * approximation and every dropped field-restriction is recorded as a warning.
 */
function translateCrossref(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  const biblioTerms = [];
  const titleTerms = [];
  const authorTerms = [];
  const containerTerms = [];
  let usedFieldHint = false;
  let multiConceptOrTerm = false;

  for (const concept of canonical.concepts) {
    if (concept.terms.length > 1 && concept.op === 'OR') multiConceptOrTerm = true;
    for (const t of concept.terms) {
      const text = String(t.text || '').trim();
      if (!text) continue;
      supported.push(`${t.field}:${t.text}`);
      // Truncation/MeSH explosion are PubMed-style features Crossref cannot honor.
      if (t.truncate) warnings.push(`Truncation on "${t.text}" is not supported by Crossref (free-text relevance ranking is used instead).`);
      if (t.type === 'controlled' || t.field === FIELD.MESH) {
        warnings.push(`Controlled-vocabulary term "${t.text}" was searched as free text — Crossref has no MeSH/controlled index.`);
      }
      // All term text always feeds the bibliographic relevance query.
      biblioTerms.push(text);
      // Seed field-targeted relevance hints where the semantic field maps cleanly.
      if (t.field === FIELD.TITLE) { titleTerms.push(text); usedFieldHint = true; }
      else if (t.field === FIELD.AUTHOR) { authorTerms.push(text); usedFieldHint = true; }
      else if (t.field === FIELD.JOURNAL) { containerTerms.push(text); usedFieldHint = true; }
      else if (t.field === FIELD.DOI || t.field === FIELD.PMID || t.field === FIELD.KEYWORD) {
        // No exact field index for these in /works free-text — note the approximation.
        unsupported.push(`${t.field}:${t.text}`);
        warnings.push(`The "${t.field}" field has no exact Crossref index; "${t.text}" was searched as free text instead.`);
      }
    }
  }

  // The Boolean structure itself is approximated by relevance ranking.
  if (canonical.concepts.length > 1) {
    warnings.push('Crossref ranks by relevance and does not enforce Boolean AND between concepts; results are ordered by similarity, not strictly filtered.');
  }
  if (multiConceptOrTerm) {
    warnings.push('Crossref does not enforce Boolean OR within a concept; alternative terms are blended into a single relevance query.');
  }

  const params = {};
  if (biblioTerms.length) params['query.bibliographic'] = biblioTerms.join(' ');
  if (titleTerms.length) params['query.title'] = titleTerms.join(' ');
  if (authorTerms.length) params['query.author'] = authorTerms.join(' ');
  if (containerTerms.length) params['query.container-title'] = containerTerms.join(' ');

  const filterParts = renderFilters(canonical.filters, warnings);
  if (filterParts.length) params.filter = filterParts.join(',');

  const assumptions = [
    'Crossref /works is a relevance (dismax) search; Boolean operators and field restrictions are approximated, not enforced.',
  ];
  if (usedFieldHint) assumptions.push('Title/author/journal terms were additionally sent as query.title/query.author/query.container-title relevance hints.');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  // The canonical `query` string carries the JSON-encoded params the connector owns.
  // For an override we treat the verbatim string as the free-text bibliographic query.
  const queryObj = hasOverride
    ? { params: { 'query.bibliographic': override.trim() }, override: override.trim() }
    : { params };

  return makeTranslated({
    provider: 'crossref',
    version: CROSSREF_VERSION,
    query: JSON.stringify(queryObj),
    supported,
    unsupported,
    warnings,
    assumptions,
    hasOverride,
  });
}

/** Decode the connector-owned translated.query JSON back into a params object. */
function decodeParams(translated) {
  if (!translated || !translated.query) return null;
  try {
    const obj = JSON.parse(translated.query);
    if (obj && obj.params && typeof obj.params === 'object') return obj.params;
  } catch { /* fall through */ }
  return null;
}

/** True when a params object would produce a non-empty Crossref query. */
function hasSearchableParams(params) {
  if (!params) return false;
  return ['query.bibliographic', 'query.title', 'query.author', 'query.container-title']
    .some((k) => params[k] && String(params[k]).trim().length > 0)
    || (params.filter && String(params.filter).trim().length > 0);
}

/**
 * createCrossrefConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createCrossrefConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Polite-pool etiquette: space starts modestly (~2/sec). The polite pool is
  // granted by &mailto=; spacing keeps us well-behaved regardless.
  const slot = makeThrottle(500, { now, sleep });

  /** Compose the common identification params (mailto raises to the polite pool). */
  function withContact(params = {}) {
    const p = { ...params };
    if (deps.contact?.email) p.mailto = deps.contact.email; // polite pool, not a secret
    return p;
  }

  /** A User-Agent string identifying the tool + contact (Crossref etiquette). */
  function userAgentHeader() {
    const tool = deps.contact?.tool || 'pecanrev';
    const email = deps.contact?.email;
    return email ? `${tool} (https://pecanrev.com; mailto:${email})` : `${tool} (https://pecanrev.com)`;
  }

  /** One GET /works request. Returns the parsed `message` object. */
  async function fetchWorks(params, signal) {
    await slot();
    const url = buildUrl(cfg.baseUrl, '/works', withContact(params));
    const { json } = await http.requestJson(url, {
      provider: 'crossref',
      timeoutMs: cfg.timeoutMs,
      retryLimit: deps.retryLimit,
      headers: { 'User-Agent': userAgentHeader() },
      signal,
    });
    if (!json || typeof json !== 'object' || !json.message || typeof json.message !== 'object') {
      throw new PecanError('PROVIDER_MALFORMED_RESPONSE', { meta: { provider: 'crossref' } });
    }
    return json.message;
  }

  return {
    provider: 'crossref',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateCrossref(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    /** previewCount — rows=0 → message.total-results. Exact. Never throws. */
    async previewCount(translated, { signal } = {}) {
      const at = new Date().toISOString();
      const params = decodeParams(translated);
      if (!hasSearchableParams(params)) return { count: null, kind: 'unavailable', at };
      try {
        const message = await fetchWorks({ ...params, rows: 0 }, signal);
        const total = Number(message['total-results']);
        if (!Number.isFinite(total)) return { count: null, kind: 'unavailable', at };
        return { count: total, kind: 'exact', at };
      } catch {
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { token, fetched }. null = first page (cursor=*).
     * Returns { records (raw Crossref items), nextCursor, total, rateLimit }.
     */
    async search(translated, cursor, ctx = {}) {
      const params = decodeParams(translated);
      if (!hasSearchableParams(params)) throw new PecanError('INVALID_QUERY', { meta: { provider: 'crossref' } });
      const signal = ctx.signal;
      const pageSize = Math.min(clampPageSize(ctx.pageSize, cfg.pageSize), CROSSREF_MAX_ROWS);

      // Decode our own cursor state. First page uses the literal Crossref cursor "*".
      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }
      const token = state && state.token ? state.token : '*';
      const fetchedSoFar = state && Number.isFinite(state.fetched) ? state.fetched : 0;

      // Respect the engine result cap: shrink the last page so we never overshoot.
      const cap = Math.min(
        cfg.maxResults || CROSSREF_MAX_ROWS * 1000,
        Number.isFinite(ctx.capRemaining) ? fetchedSoFar + Math.max(0, ctx.capRemaining) : Infinity,
      );
      const room = cap - fetchedSoFar;
      if (room <= 0) return { records: [], nextCursor: null, total: null, rateLimit: {} };
      const rows = Math.min(pageSize, room);

      const message = await fetchWorks({ ...params, rows, cursor: token }, signal);

      const items = Array.isArray(message.items) ? message.items : [];
      const totalRaw = Number(message['total-results']);
      const total = Number.isFinite(totalRaw) ? totalRaw : null;
      const nextToken = message['next-cursor'];
      const fetched = fetchedSoFar + items.length;

      // Exhausted when: Crossref returns fewer items than asked (documented end
      // signal), there is no next-cursor, we've drained total, or we've hit the cap.
      const exhausted =
        items.length === 0 ||
        items.length < rows ||
        !nextToken ||
        (total != null && fetched >= total) ||
        fetched >= cap;

      const nextCursor = exhausted
        ? null
        : JSON.stringify({ token: nextToken, fetched });

      return { records: items, nextCursor, total, rateLimit: {} };
    },

    /** normalize(rawItem) — a raw Crossref work item → canonical record + provenance. */
    normalize(rawItem) {
      const it = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const doi = it.DOI || it.doi || '';
      const title = Array.isArray(it.title) ? it.title[0] : it.title;
      const journal = Array.isArray(it['container-title']) ? it['container-title'][0] : it['container-title'];
      const authors = Array.isArray(it.author)
        ? it.author.map((a) => ({ family: a && (a.family || a.name), given: a && a.given }))
        : [];
      const year = extractYear(it);
      const partial = {
        doi,
        title,
        abstract: stripJats(it.abstract),
        authors,
        year,
        journal,
        volume: it.volume,
        issue: it.issue,
        pages: it.page,
        pubType: it.type,
        url: doi ? `https://doi.org/${doi}` : '',
      };
      const rec = normalizeRecord(partial, { provider: 'crossref', version: NORMALIZATION_VERSION });
      const providerRecordId = rec.doi || (typeof doi === 'string' && doi.trim()) || contentHashId(rec);
      return { ...rec, providerRecordId, raw: snapshotRaw(it) };
    },
  };
}

/** Pull a 4-digit year from issued/published-print/published-online date-parts. */
function extractYear(it) {
  const fromParts = (d) => {
    const dp = d && d['date-parts'];
    if (Array.isArray(dp) && Array.isArray(dp[0]) && dp[0][0] != null) return String(dp[0][0]);
    return '';
  };
  return fromParts(it.issued) || fromParts(it['published-print']) || fromParts(it['published-online']) || '';
}

/** A small, capped JSON snapshot of the raw item for provenance (~15kB ceiling). */
function snapshotRaw(it) {
  try {
    const s = JSON.stringify(it);
    return s.length > 15000 ? s.slice(0, 15000) : s;
  } catch {
    return '';
  }
}
