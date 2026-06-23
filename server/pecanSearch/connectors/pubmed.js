/**
 * pecanSearch/connectors/pubmed.js — PubMed connector (NCBI E-utilities).
 *
 * Flow (history-backed paging, the NCBI-recommended pattern for large sets):
 *   1. esearch (usehistory=y) once per source run → { count, WebEnv, query_key }.
 *   2. efetch (retmode=xml, rettype=abstract, retstart, retmax) per page →
 *      full records incl. abstract + MeSH (parsed by pubmedXml.js).
 * previewCount uses esearch (rettype=count). The NCBI api_key (optional) stays
 * server-side and raises the rate limit; it is injected here and never logged
 * (the shared HTTP client redacts the api_key query param).
 *
 * Verified against NCBI E-utilities docs (esearch/efetch parameters, history
 * server WebEnv/query_key paging, field tags). Last reviewed: 2026-06.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { parseEsearch, parsePubmedXml } from './pubmedXml.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, quoteIfPhrase, makeTranslated,
} from '../query/ast.js';
import { PecanError } from '../errors.js';

export const PUBMED_VERSION = 'pubmed-1.0.0';

/** PubMed field-tag map for the canonical semantic fields. */
const FIELD_TAG = {
  [FIELD.TITLE]: 'Title',
  [FIELD.ABSTRACT]: 'Title/Abstract',
  [FIELD.TIAB]: 'Title/Abstract',
  [FIELD.AUTHOR]: 'Author',
  [FIELD.JOURNAL]: 'Journal',
  [FIELD.DOI]: 'AID',
  [FIELD.PMID]: 'PMID',
  [FIELD.KEYWORD]: 'Text Word',
  [FIELD.ALL]: 'All Fields',
};

/** Render one canonical term into a PubMed clause. */
function renderTerm(t, warnings) {
  // Controlled MeSH term → "Heading"[Mesh] (+ :NoExp when explosion is off).
  if (t.type === 'controlled' && t.field === FIELD.MESH) {
    const heading = (t.vocab && (t.vocab.mesh || t.vocab.heading)) || t.text;
    const tag = t.noExplode ? 'Mesh:NoExp' : 'Mesh';
    return `"${String(heading).replace(/"/g, '')}"[${tag}]`;
  }
  let body = quoteIfPhrase(t.text);
  if (t.truncate) {
    // PubMed truncation is `term*`; it cannot be combined with a quoted phrase.
    if (/^".*"$/.test(body)) warnings.push(`Truncation on the phrase "${t.text}" is not supported by PubMed and was dropped.`);
    else body = body.replace(/\*?$/, '*');
  }
  const tag = FIELD_TAG[t.field] || 'Title/Abstract';
  return `${body}[${tag}]`;
}

/** Build the PubMed filter clauses (date/language/pubtype). */
function renderFilters(filters, warnings) {
  const clauses = [];
  if (filters.dateFrom || filters.dateTo) {
    const from = (filters.dateFrom || '1500').replace(/-/g, '/');
    const to = (filters.dateTo || '3000').replace(/-/g, '/');
    clauses.push(`("${from}"[Date - Publication] : "${to}"[Date - Publication])`);
  }
  if (filters.languages.length) {
    clauses.push('(' + filters.languages.map((l) => `${l}[Language]`).join(' OR ') + ')');
  }
  if (filters.pubTypes.length) {
    clauses.push('(' + filters.pubTypes.map((p) => `"${p}"[Publication Type]`).join(' OR ') + ')');
  }
  return clauses;
}

/** translateQuery — canonical → PubMed term string + structured diagnostics. */
function translatePubmed(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  const conceptStrings = canonical.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      supported.push(`${t.field}:${t.text}`);
      return renderTerm(t, warnings);
    });
    return parts.length > 1 ? `(${parts.join(` ${concept.op} `)})` : parts[0];
  }).filter(Boolean);

  const filterClauses = renderFilters(canonical.filters, warnings);
  let query = [...conceptStrings, ...filterClauses].join(' AND ');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  return makeTranslated({
    provider: 'pubmed', version: PUBMED_VERSION, query,
    supported, unsupported, warnings, hasOverride,
    assumptions: ['DOI searched via the [AID] Article Identifier field.'],
  });
}

/**
 * createPubmedConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger }
 */
export function createPubmedConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Start-spacing: ~9/sec with a key, ~2.8/sec without (NCBI etiquette).
  const slot = makeThrottle(cfg.hasKey ? 120 : 360, { now, sleep });

  function commonParams(extra = {}) {
    const p = { tool: deps.contact?.tool || 'pecanrev', ...extra };
    if (deps.contact?.email) p.email = deps.contact.email;
    if (cfg.apiKey) p.api_key = cfg.apiKey;       // SECRET — redacted in logs
    return p;
  }

  async function esearch(term, { usehistory = false, retmax = 0 } = {}, signal) {
    await slot();
    const url = buildUrl(cfg.baseUrl, '/esearch.fcgi', commonParams({
      db: 'pubmed', term, retmode: 'json', retmax,
      ...(usehistory ? { usehistory: 'y' } : {}),
    }));
    const { json } = await http.requestJson(url, { provider: 'pubmed', timeoutMs: cfg.timeoutMs, retryLimit: deps.retryLimit, signal });
    return parseEsearch(json);
  }

  return {
    provider: 'pubmed',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translatePubmed(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal } = {}) {
      const term = translated && translated.query;
      if (!term) return { count: null, kind: 'unavailable', at: new Date().toISOString() };
      const r = await esearch(term, { retmax: 0 }, signal);
      return { count: r.count, kind: r.count == null ? 'unavailable' : 'exact', at: new Date().toISOString() };
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { webenv, queryKey, retstart, count }.
     * Returns { records (partial), nextCursor, total, rateLimit }.
     */
    async search(translated, cursor, ctx = {}) {
      const term = translated && translated.query;
      if (!term) throw new PecanError('INVALID_QUERY', { meta: { provider: 'pubmed' } });
      const pageSize = clampPageSize(ctx.pageSize, cfg.pageSize);
      const signal = ctx.signal;

      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }

      // First page: establish the history server entry (WebEnv/query_key + count).
      if (!state) {
        const r = await esearch(term, { usehistory: true, retmax: 0 }, signal);
        if (!r.webenv || !r.queryKey) {
          // No history handle (e.g. zero results) — return an empty page honestly.
          return { records: [], nextCursor: null, total: r.count == null ? 0 : r.count, rateLimit: {} };
        }
        state = { webenv: r.webenv, queryKey: r.queryKey, retstart: 0, count: r.count == null ? 0 : r.count };
      }

      const total = state.count;
      const retstart = state.retstart;
      if (retstart >= total) return { records: [], nextCursor: null, total, rateLimit: {} };

      await slot();
      const url = buildUrl(cfg.baseUrl, '/efetch.fcgi', commonParams({
        db: 'pubmed', WebEnv: state.webenv, query_key: state.queryKey,
        retstart, retmax: pageSize, retmode: 'xml', rettype: 'abstract',
      }));
      const res = await http.requestText(url, { provider: 'pubmed', timeoutMs: cfg.timeoutMs, retryLimit: deps.retryLimit, signal });
      const records = parsePubmedXml(res.text);

      const nextStart = retstart + pageSize;
      const nextCursor = nextStart < total
        ? JSON.stringify({ ...state, retstart: nextStart })
        : null;

      return { records, nextCursor, total, rateLimit: {} };
    },

    /** normalize(rawItem) — partial record (from pubmedXml) → canonical record. */
    normalize(rawItem) {
      const rec = normalizeRecord(rawItem, { provider: 'pubmed', version: NORMALIZATION_VERSION });
      const providerRecordId = (rawItem && rawItem.providerRecordId) || rec.pmid || contentHashId(rec);
      return { ...rec, providerRecordId, raw: (rawItem && rawItem._raw) || '' };
    },
  };
}
