/**
 * pecanSearch/connectors/europepmc.js — Europe PMC connector (EBI REST).
 *
 * Flow (cursorMark paging, the Europe-PMC-recommended pattern for deep result
 * sets — required past the first 10k results):
 *   1. GET /search?query=...&format=json&resultType=core&pageSize=N&cursorMark=*
 *      → { hitCount, nextCursorMark, resultList: { result: [...] } }.
 *      hitCount is the total; resultList.result[] are full (core) records with
 *      abstractText, authorString/authorList, journalInfo, doi, pmid, pmcid,
 *      pubYear, pubTypeList, language, keywordList.
 *   2. Each subsequent page re-issues /search with cursorMark set to the prior
 *      response's nextCursorMark; paging is exhausted when the cursor stops
 *      advancing (nextCursorMark === the cursor we sent) or no records return.
 * previewCount uses the same /search with pageSize=1 and reads hitCount (exact).
 * No credentials/key; the polite-pool `email` is sent as the &email contact param
 * (Europe PMC asks tools to identify) and never logged.
 *
 * Query syntax is Lucene-like: TITLE:"...", ABSTRACT:"...", AUTH:"...", DOI:"...",
 * JOURNAL:"...", combined with AND/OR and parentheses. PMID is searched via
 * (EXT_ID:"<pmid>" AND SRC:MED). Field map: TITLE→TITLE, ABSTRACT→ABSTRACT,
 * TIAB→(TITLE OR ABSTRACT), AUTHOR→AUTH, JOURNAL→JOURNAL, DOI→DOI, PMID→EXT_ID/SRC,
 * KEYWORD→KW, ALL→bare term. MeSH (controlled) has no native field tag in the
 * search grammar → rendered as MESH:"..." with a warning (best-effort).
 *
 * Verified against the live Europe PMC REST API + Articles RESTful docs
 * (https://europepmc.org/RestfulWebService, /search params, cursorMark/
 * nextCursorMark paging, resultType=core JSON field names: hitCount,
 * nextCursorMark, resultList.result[].{title,abstractText,authorString,
 * authorList.author[],journalInfo.journal.title,doi,pmid,pmcid,id,source,pubYear,
 * pubTypeList.pubType[],language,keywordList}; pageSize range 0–1000).
 * Last reviewed: 2026-06-22.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, quoteIfPhrase, makeTranslated,
} from '../query/ast.js';
import { toIso6392b } from '../query/vocab.js';
import { PecanError } from '../errors.js';

export const EUROPEPMC_VERSION = 'europepmc-1.0.0';

/** Europe PMC field-prefix map for the canonical semantic fields. */
const FIELD_PREFIX = {
  [FIELD.TITLE]: 'TITLE',
  [FIELD.ABSTRACT]: 'ABSTRACT',
  [FIELD.AUTHOR]: 'AUTH',
  [FIELD.JOURNAL]: 'JOURNAL',
  [FIELD.DOI]: 'DOI',
  [FIELD.KEYWORD]: 'KW',
};

/** Render one canonical term into a Europe PMC clause. */
function renderTerm(t, warnings) {
  // PMID → (EXT_ID:"<id>" AND SRC:MED) — Europe PMC's external-id lookup.
  if (t.field === FIELD.PMID) {
    if (t.truncate) warnings.push(`Truncation on the PMID "${t.text}" is not supported by Europe PMC and was ignored.`);
    const id = String(t.text).replace(/[^0-9]/g, '');
    return `(EXT_ID:"${id}" AND SRC:MED)`;
  }
  // TIAB → (TITLE OR ABSTRACT) for the same term.
  if (t.field === FIELD.TIAB) {
    const body = renderBody(t, warnings);
    return `(TITLE:${body} OR ABSTRACT:${body})`;
  }
  // Controlled MeSH has no native search-grammar field → best-effort MESH: prefix.
  if (t.type === 'controlled' && t.field === FIELD.MESH) {
    const heading = (t.vocab && (t.vocab.mesh || t.vocab.heading)) || t.text;
    warnings.push(`MeSH term "${heading}" was mapped to a best-effort MESH: query; Europe PMC does not expose a controlled MeSH explosion field, so coverage may differ from PubMed.`);
    if (t.noExplode) warnings.push(`MeSH no-explosion was requested for "${heading}" but Europe PMC does not support explosion control; the heading was searched as-is.`);
    return `MESH:"${String(heading).replace(/"/g, '')}"`;
  }
  const body = renderBody(t, warnings);
  const prefix = FIELD_PREFIX[t.field];
  // FIELD.ALL (and any unmapped field) → bare term against all fields.
  return prefix ? `${prefix}:${body}` : body;
}

/** Render the term body (phrase-quoting + truncation), shared by field renders. */
function renderBody(t, warnings) {
  let body = quoteIfPhrase(t.text);
  if (t.truncate) {
    // Europe PMC wildcard is `term*`; it cannot be applied to a quoted phrase.
    if (/^".*"$/.test(body)) warnings.push(`Truncation on the phrase "${t.text}" is not supported by Europe PMC and was dropped.`);
    else body = body.replace(/\*?$/, '*');
  }
  return body;
}

/** Build the Europe PMC filter clauses (date/language/pubtype). */
function renderFilters(filters, warnings) {
  const clauses = [];
  if (filters.dateFrom || filters.dateTo) {
    // PUB_YEAR range, inclusive; coerce to 4-digit years.
    const yFrom = (filters.dateFrom.match(/\d{4}/) || ['1500'])[0];
    const yTo = (filters.dateTo.match(/\d{4}/) || ['3000'])[0];
    clauses.push(`(PUB_YEAR:[${yFrom} TO ${yTo}])`);
  }
  if (filters.languages.length) {
    // Europe PMC LANG expects ISO 639-2/B 3-letter codes (e.g. "eng"). Map the
    // canonical label/code; drop + warn on anything unmappable so a full name like
    // "English" can never silently zero the source (it did before this mapping).
    const codes = [];
    for (const l of filters.languages) {
      const code = toIso6392b(l);
      if (code) codes.push(code);
      else warnings.push(`Language "${l}" could not be mapped to an Europe PMC ISO 639-2 code and was not applied.`);
    }
    if (codes.length) clauses.push('(' + [...new Set(codes)].map((c) => `LANG:"${c}"`).join(' OR ') + ')');
  }
  if (filters.pubTypes.length) {
    clauses.push('(' + filters.pubTypes.map((p) => `PUB_TYPE:"${String(p).replace(/"/g, '')}"`).join(' OR ') + ')');
  }
  return clauses;
}

/** translateQuery — canonical → Europe PMC query string + structured diagnostics. */
function translateEuropePmc(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  const conceptStrings = canonical.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      if (t.type === 'controlled' && t.field === FIELD.MESH) unsupported.push(`mesh:${t.text}`);
      else supported.push(`${t.field}:${t.text}`);
      return renderTerm(t, warnings);
    });
    return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  }).filter(Boolean);

  const filterClauses = renderFilters(canonical.filters, warnings);
  let query = [...conceptStrings, ...filterClauses].join(' AND ');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  return makeTranslated({
    provider: 'europepmc', version: EUROPEPMC_VERSION, query,
    supported, unsupported, warnings, hasOverride,
    assumptions: [
      'PMID is searched via the EXT_ID external-id field scoped to SRC:MED.',
      'Title/abstract terms are expanded to (TITLE OR ABSTRACT).',
    ],
  });
}

/** Pluck a clean string from a possibly-nested Europe PMC core record field. */
function pickPmcid(r) {
  const v = r.pmcid || (r.fullTextIdList && Array.isArray(r.fullTextIdList.fullTextId)
    ? r.fullTextIdList.fullTextId.find((x) => /^PMC/i.test(String(x))) : '');
  return v || '';
}

/** Map a Europe PMC core result item into a normalize() partial. */
function toPartial(r) {
  if (!r || typeof r !== 'object') return null;
  const journalInfo = r.journalInfo && typeof r.journalInfo === 'object' ? r.journalInfo : {};
  const journal = (journalInfo.journal && (journalInfo.journal.title || journalInfo.journal.medlineAbbreviation)) || '';
  // Prefer the structured authorList; fall back to the flat authorString.
  let authors = '';
  if (r.authorList && Array.isArray(r.authorList.author) && r.authorList.author.length) {
    authors = r.authorList.author.map((a) => {
      if (!a || typeof a !== 'object') return '';
      const last = a.lastName || '';
      const init = a.initials || a.firstName || '';
      if (last) return init ? `${last} ${init}` : last;
      return a.fullName || '';
    }).filter(Boolean).join('; ');
  }
  if (!authors) authors = String(r.authorString || '');
  const pubType = (r.pubTypeList && Array.isArray(r.pubTypeList.pubType)) ? r.pubTypeList.pubType : [];
  const keywords = (r.keywordList && Array.isArray(r.keywordList.keyword)) ? r.keywordList.keyword : [];
  const year = r.pubYear || journalInfo.yearOfPublication || '';
  return {
    providerRecordId: r.source && r.id ? `${r.source}:${r.id}` : (r.id || ''),
    title: r.title || '',
    abstract: r.abstractText || '',
    authors,
    journal,
    year,
    doi: r.doi || '',
    pmid: r.pmid || '',
    pmcid: pickPmcid(r),
    pubType,
    language: r.language || '',
    keywords,
    _source: r.source || '',
    _id: r.id || '',
  };
}

/**
 * createEuropePmcConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createEuropePmcConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Europe PMC has no published hard per-second cap; ~10/sec start-spacing is polite.
  const slot = makeThrottle(100, { now, sleep });

  function searchParams(query, cursorMark, pageSize) {
    const p = {
      query, format: 'json', resultType: 'core',
      pageSize, cursorMark: cursorMark || '*',
    };
    // Polite-pool identification — Europe PMC asks tools to send a contact email.
    if (deps.contact && deps.contact.email) p.email = deps.contact.email;
    return p;
  }

  async function callSearch(query, cursorMark, pageSize, signal, httpOpts = {}) {
    await slot();
    const url = buildUrl(cfg.baseUrl, '/search', searchParams(query, cursorMark, pageSize));
    const { json } = await http.requestJson(url, {
      provider: 'europepmc',
      timeoutMs: httpOpts.timeoutMs ?? cfg.timeoutMs,
      retryLimit: httpOpts.retryLimit ?? deps.retryLimit,
      signal,
    });
    if (!json || typeof json !== 'object') {
      throw new PecanError('PROVIDER_MALFORMED_RESPONSE', { meta: { provider: 'europepmc' } });
    }
    const hitCount = Number(json.hitCount);
    const result = (json.resultList && Array.isArray(json.resultList.result)) ? json.resultList.result : [];
    return {
      total: Number.isFinite(hitCount) ? hitCount : null,
      nextCursorMark: typeof json.nextCursorMark === 'string' ? json.nextCursorMark : null,
      result,
    };
  }

  return {
    provider: 'europepmc',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateEuropePmc(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal, timeoutMs, retryLimit } = {}) {
      const at = new Date().toISOString();
      const query = translated && translated.query;
      if (!query) return { count: null, kind: 'unavailable', at };
      try {
        const r = await callSearch(query, '*', 1, signal, { timeoutMs, retryLimit });
        if (r.total == null) return { count: null, kind: 'unavailable', at };
        return { count: r.total, kind: 'exact', at };
      } catch {
        // previewCount must never throw.
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { cursorMark, fetched, total }.
     * nextCursor=null => exhausted (cursor stopped advancing, cap reached,
     * or an empty/last page).
     */
    async search(translated, cursor, ctx = {}) {
      const query = translated && translated.query;
      if (!query) throw new PecanError('INVALID_QUERY', { meta: { provider: 'europepmc' } });
      const pageSize = clampPageSize(ctx.pageSize, cfg.pageSize);
      const signal = ctx.signal;

      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }
      const sentCursor = state && typeof state.cursorMark === 'string' ? state.cursorMark : '*';
      const fetchedSoFar = state && Number.isFinite(state.fetched) ? state.fetched : 0;

      const r = await callSearch(query, sentCursor, pageSize, signal);
      const total = r.total;
      const records = r.result.map(toPartial).filter(Boolean);
      const fetched = fetchedSoFar + records.length;

      // Respect the provider ceiling + the caller's remaining cap.
      const hardCap = Math.min(cfg.maxResults || Infinity, total == null ? Infinity : total);
      const capRemaining = Number.isFinite(ctx.capRemaining) ? ctx.capRemaining : Infinity;

      // Exhaustion: no records, no cursor, cursor did not advance, or cap hit.
      const cursorAdvanced = r.nextCursorMark && r.nextCursorMark !== sentCursor;
      const moreAvailable = records.length > 0 && cursorAdvanced
        && fetched < hardCap && (fetched - fetchedSoFar) <= capRemaining && fetched < fetchedSoFar + capRemaining;

      const nextCursor = moreAvailable
        ? JSON.stringify({ cursorMark: r.nextCursorMark, fetched, total })
        : null;

      return { records, nextCursor, total, rateLimit: {} };
    },

    /** normalize(rawItem) — Europe PMC partial → canonical record. */
    normalize(rawItem) {
      const rec = normalizeRecord(rawItem, { provider: 'europepmc', version: NORMALIZATION_VERSION });
      const providerRecordId = (rawItem && rawItem.providerRecordId)
        || rec.doi || rec.pmid || contentHashId(rec);
      let raw = '';
      try {
        raw = JSON.stringify(rawItem || {}).slice(0, 15 * 1024);
      } catch { raw = ''; }
      return { ...rec, providerRecordId, raw };
    },
  };
}
