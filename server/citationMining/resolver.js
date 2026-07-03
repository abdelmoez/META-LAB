/**
 * citationMining/resolver.js — thin connector-fetch helpers for P15 citation
 * mining, built on the SAME engine context the Pecan Search Engine uses
 * (createEngineContext → shared hardened HTTP client + provider connectors +
 * polite-pool contact). The per-record fetch shapes the pecanSearch connectors
 * keep private (OpenAlex getWorks, forward `cites:` chasing) are re-exposed here
 * as thin helpers on top of the reused, injectable transport.
 *
 * Two modes, one code path:
 *   - LIVE   — hits public bibliographic providers (OpenAlex `/works`, Crossref
 *              `query.bibliographic`) through the reused connectors + http client.
 *              Only legal metadata / open-access sources; API keys never leave the
 *              server; every external call degrades gracefully (never throws up to
 *              a durable job). Enabled by CITATION_MINING_LIVE_RESOLVE=1 (or an
 *              explicit `live:true` override) so operators opt into external fan-out.
 *   - OFFLINE (default) — makes NO external calls. A reference that already carries
 *              a DOI/PMID is resolved from its own parsed metadata; backward edges
 *              are read from the locally-cached CitationMetadata the caller passes
 *              in. Deterministic → the integration test needs no network and the
 *              feature is still useful with external fan-out disabled.
 *
 * The whole module is dependency-injected (fetch/now/sleep/random) so a stub fetch
 * OR a stub resolver object makes resolution + chasing fully deterministic in tests.
 */
import { createEngineContext } from '../pecanSearch/connectors/registry.js';
import { buildUrl } from '../pecanSearch/connectors/urlUtil.js';
import { normalizeDoi, normalizePmid } from '../pecanSearch/normalize.js';
import { reconstructAbstract } from '../pecanSearch/connectors/openalex.js';
import { normalizeCanonical } from '../pecanSearch/query/ast.js';

/** Strip the OpenAlex URL prefix from a work id (→ bare "W…"). */
export function bareOaId(u) {
  return String(u == null ? '' : u).replace(/^https?:\/\/openalex\.org\//i, '').trim();
}

const clampInt = (v, dflt, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(Math.floor(n), max));
};

const numOr = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

/** Normalize an authors value (array | "A; B" string) to a clean string[]. */
function authorsArray(a) {
  if (Array.isArray(a)) return a.map((x) => String(x || '').trim()).filter(Boolean);
  return String(a || '').split(/;|\band\b/i).map((x) => x.trim()).filter(Boolean);
}

/** Map a raw OpenAlex work → the compact candidate shape we persist. */
export function mapWorkToCandidate(work) {
  const w = work && typeof work === 'object' ? work : {};
  const ids = w.ids && typeof w.ids === 'object' ? w.ids : {};
  const source = (w.primary_location && w.primary_location.source) || {};
  const authors = Array.isArray(w.authorships)
    ? w.authorships.map((a) => (a && a.author && a.author.display_name) || (a && a.raw_author_name) || '').filter(Boolean)
    : [];
  return {
    openAlexId: bareOaId(w.id),
    doi: normalizeDoi(w.doi || ids.doi || ''),
    pmid: normalizePmid(ids.pmid || ''),
    title: String(w.title || w.display_name || '').slice(0, 1000),
    abstract: reconstructAbstract(w.abstract_inverted_index).slice(0, 6000),
    year: w.publication_year ? String(w.publication_year) : '',
    journal: String(source.display_name || '').slice(0, 300),
    authors,
    publicationType: String(w.type || ''),
    citedByCount: Number.isFinite(w.cited_by_count) ? w.cited_by_count : null,
    referencedWorks: Array.isArray(w.referenced_works) ? w.referenced_works.map(bareOaId).filter(Boolean) : [],
  };
}

// Lean projection for candidate LISTS (forward/backward) — abstracts are heavy and
// unnecessary at list scale; a full abstract is only pulled for a single resolve.
const SELECT_LIST = 'id,doi,ids,title,display_name,publication_year,primary_location,type,authorships';
const SELECT_ONE = SELECT_LIST + ',abstract_inverted_index,cited_by_count,referenced_works';

/**
 * createResolver(overrides) — build a citation-mining resolver.
 * @param {object} overrides
 *   fetch/now/sleep/random — DI transport (passed to createEngineContext)
 *   env      — process.env (default)
 *   settings — parsed `searchProviderSettings` block (provider policy)
 *   live     — force live/offline (default: env CITATION_MINING_LIVE_RESOLVE === '1')
 */
export function createResolver(overrides = {}) {
  const env = overrides.env || process.env;
  const settings = overrides.settings || {};
  const live = overrides.live != null
    ? !!overrides.live
    : String(env.CITATION_MINING_LIVE_RESOLVE || '') === '1';

  const engine = createEngineContext(env, settings, {
    fetch: overrides.fetch, now: overrides.now, sleep: overrides.sleep, random: overrides.random,
  });
  const http = engine.http;
  const contact = engine.contact || {};
  const oaCfg = engine.config.providers.openalex || {};
  const oaBase = oaCfg.baseUrl || 'https://api.openalex.org';
  const timeoutMs = engine.config.engine.requestTimeoutMs;
  const retryLimit = engine.config.engine.retryLimit;

  /** One OpenAlex /works GET (mailto polite pool). Returns {} on any failure. */
  async function oaWorks(filter, { perPage = 25, select = SELECT_LIST, cursor } = {}) {
    try {
      const url = buildUrl(oaBase, '/works', {
        filter, 'per-page': perPage, select,
        ...(cursor ? { cursor } : {}),
        ...(contact.email ? { mailto: contact.email } : {}),
        ...(oaCfg.apiKey ? { api_key: oaCfg.apiKey } : {}),
      });
      const { json } = await http.requestJson(url, { provider: 'openalex', timeoutMs, retryLimit });
      return json && typeof json === 'object' ? json : {};
    } catch { return {}; }
  }

  /** First work from a single-record OpenAlex filter, or null. */
  async function oaOne(filter, select = SELECT_ONE) {
    const j = await oaWorks(filter, { perPage: 1, select });
    const r = Array.isArray(j.results) ? j.results : [];
    return r.length ? r[0] : null;
  }

  /** Encode a value for an OpenAlex filter (strip the comma/pipe separators). */
  const oaVal = (s) => String(s == null ? '' : s).replace(/[,|]/g, ' ').trim();

  /** Compose a free-text reference string for a Crossref bibliographic query. */
  function refString(ref) {
    const raw = String(ref.raw || '').trim();
    if (raw) return raw.slice(0, 500);
    return [ref.title, Array.isArray(ref.authors) ? ref.authors.join(' ') : ref.authors, ref.journal, ref.year]
      .map((x) => String(x || '').trim()).filter(Boolean).join(' ').slice(0, 500);
  }

  const resolved = (source, o = {}, confidence = 0.5) => ({
    status: 'resolved', source,
    doi: normalizeDoi(o.doi || ''), pmid: normalizePmid(o.pmid || ''),
    openAlexId: bareOaId(o.openAlexId || ''),
    title: String(o.title || '').slice(0, 1000), year: o.year ? String(o.year) : '',
    journal: String(o.journal || '').slice(0, 300), authors: authorsArray(o.authors),
    abstract: String(o.abstract || '').slice(0, 6000),
    referencedWorks: Array.isArray(o.referencedWorks) ? o.referencedWorks : [],
    citedByCount: Number.isFinite(o.citedByCount) ? o.citedByCount : null,
    confidence: numOr(confidence, 0.5),
  });
  const notFound = (source = '') => ({
    status: 'not_found', source, doi: '', pmid: '', openAlexId: '', title: '', year: '',
    journal: '', authors: [], abstract: '', referencedWorks: [], citedByCount: null, confidence: 0,
  });

  /** Resolve one parsed reference to a canonical record (DOI→PMID→Crossref→title). */
  async function resolveReference(ref = {}) {
    const doi = normalizeDoi(ref.doi || '');
    const pmid = normalizePmid(ref.pmid || '');
    const baseConf = numOr(ref.confidence != null ? ref.confidence : ref.parseConfidence, 0.4);

    if (!live) {
      // OFFLINE: resolve from the reference's own identifiers; never call out.
      if (doi || pmid) {
        return resolved('reference', {
          doi, pmid, title: ref.title, year: ref.year, journal: ref.journal, authors: ref.authors,
        }, Math.max(baseConf, 0.5));
      }
      return notFound('');
    }

    try {
      // 1. DOI → OpenAlex work (authoritative identity).
      if (doi) {
        const w = await oaOne(`doi:${oaVal(doi)}`);
        if (w) return resolved('openalex', mapWorkToCandidate(w), 0.97);
        return resolved('reference', { doi, title: ref.title, year: ref.year, journal: ref.journal, authors: ref.authors }, Math.max(baseConf, 0.6));
      }
      // 2. PMID → OpenAlex work.
      if (pmid) {
        const w = await oaOne(`ids.pmid:${oaVal(pmid)}`);
        if (w) return resolved('openalex', mapWorkToCandidate(w), 0.95);
        return resolved('reference', { pmid, title: ref.title, year: ref.year, journal: ref.journal, authors: ref.authors }, Math.max(baseConf, 0.6));
      }
      // 3. Free-text → Crossref bibliographic (reuse the real Crossref connector).
      const rs = refString(ref);
      if (rs) {
        const cr = engine.connectors.crossref;
        if (cr) {
          try {
            const translated = cr.translateQuery(normalizeCanonical({}), { override: rs });
            const page = await cr.search(translated, null, { pageSize: 3, capRemaining: 3 });
            const item = Array.isArray(page.records) && page.records.length ? page.records[0] : null;
            if (item) {
              const rec = cr.normalize(item);
              // Enrich with OpenAlex for the work id + reference list when a DOI came back.
              let enrich = {};
              if (rec.doi) { const w = await oaOne(`doi:${oaVal(rec.doi)}`); if (w) enrich = mapWorkToCandidate(w); }
              return resolved('crossref', {
                doi: rec.doi, pmid: rec.pmid, openAlexId: enrich.openAlexId,
                title: rec.title, year: rec.year, journal: rec.journal, authors: rec.authors, abstract: rec.abstract,
                referencedWorks: enrich.referencedWorks, citedByCount: enrich.citedByCount,
              }, 0.6);
            }
          } catch { /* fall through to title search */ }
        }
      }
      // 4. Title → OpenAlex title.search.
      if (ref.title) {
        const w = await oaOne(`title.search:${oaVal(ref.title)}`);
        if (w) return resolved('openalex', mapWorkToCandidate(w), 0.5);
      }
      return notFound('');
    } catch { return { ...notFound(''), status: 'error' }; }
  }

  /** Fetch a single OpenAlex work by bare id / doi: / pmid: key (live only), or null. */
  async function fetchOpenAlexWork(id) {
    if (!live || !id) return null;
    const s = String(id).trim();
    let filter;
    if (/^W\d+/i.test(bareOaId(s))) filter = `openalex_id:${bareOaId(s)}`;
    else if (s.startsWith('pmid:')) filter = `ids.pmid:${oaVal(s.slice(5))}`;
    else if (s.startsWith('doi:')) filter = `doi:${oaVal(s.slice(4))}`;
    else filter = `doi:${oaVal(normalizeDoi(s))}`;
    return oaOne(filter);
  }

  /**
   * forwardCitingWorks(openAlexId, {limit}) — works that CITE the given work
   * (OpenAlex `filter=cites:W…`). This is the forward edge that is NOT cached
   * anywhere else. Offline → [] (needs the provider). Never throws.
   */
  async function forwardCitingWorks(openAlexId, { limit = 50 } = {}) {
    const oa = bareOaId(openAlexId);
    if (!live || !oa) return [];
    const perPage = clampInt(limit, 50, 1, 200);
    const j = await oaWorks(`cites:${oa}`, { perPage, select: SELECT_LIST });
    const results = Array.isArray(j.results) ? j.results : [];
    return results.slice(0, perPage).map(mapWorkToCandidate);
  }

  /**
   * backwardReferences(node, {limit}) — the works the given node CITES (its
   * reference list). Reuses the caller-supplied cached edges (CitationMetadata.refs)
   * when present; otherwise (live) fetches referenced_works from the work. Offline
   * emits id-only candidates from the cache (no network). Never throws.
   * @param {{openAlexId?, doi?, pmid?, cachedRefs?:string[]}} node
   */
  async function backwardReferences(node = {}, { limit = 50 } = {}) {
    const cap = clampInt(limit, 50, 1, 300);
    const cached = Array.isArray(node.cachedRefs) ? node.cachedRefs.map(bareOaId).filter(Boolean) : [];

    if (!live) {
      // OFFLINE: surface the locally-cached backward edges as id-only candidates.
      return cached.slice(0, cap).map((id) => ({
        openAlexId: id, doi: '', pmid: '', title: '', abstract: '', year: '', journal: '',
        authors: [], publicationType: '', citedByCount: null, referencedWorks: [],
      }));
    }

    try {
      // Determine the reference-work id list: cached edges win; else fetch the work.
      let refIds = cached;
      if (!refIds.length && (node.openAlexId || node.doi || node.pmid)) {
        const w = await fetchOpenAlexWork(node.openAlexId || (node.doi ? `doi:${node.doi}` : `pmid:${node.pmid}`));
        refIds = Array.isArray(w && w.referenced_works) ? w.referenced_works.map(bareOaId).filter(Boolean) : [];
      }
      refIds = refIds.slice(0, cap);
      if (!refIds.length) return [];
      // Batch-fetch metadata for the referenced works (best-effort; degrade to ids).
      const out = [];
      const seen = new Set();
      for (let i = 0; i < refIds.length; i += 50) {
        const slice = refIds.slice(i, i + 50);
        const j = await oaWorks(`openalex_id:${slice.join('|')}`, { perPage: 50, select: SELECT_LIST });
        const results = Array.isArray(j.results) ? j.results : [];
        for (const w of results) { const c = mapWorkToCandidate(w); if (c.openAlexId) seen.add(c.openAlexId); out.push(c); }
      }
      // Any id we could not enrich still becomes an id-only candidate (honest).
      for (const id of refIds) if (!seen.has(id)) out.push({ openAlexId: id, doi: '', pmid: '', title: '', abstract: '', year: '', journal: '', authors: [], publicationType: '', citedByCount: null, referencedWorks: [] });
      return out.slice(0, cap);
    } catch { return cached.slice(0, cap).map((id) => ({ openAlexId: id, doi: '', pmid: '', title: '', abstract: '', year: '', journal: '', authors: [], publicationType: '', citedByCount: null, referencedWorks: [] })); }
  }

  return { live, resolveReference, fetchOpenAlexWork, forwardCitingWorks, backwardReferences, mapWorkToCandidate };
}
