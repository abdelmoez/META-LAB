/**
 * pecanSearch/connectors/clinicaltrials.js — ClinicalTrials.gov connector (CTG API v2).
 *
 * Flow (forward-only page-token paging, the CTG-recommended pattern):
 *   GET /studies?query.term=<essie>&pageSize=N&format=json[&countTotal=true][&pageToken=…]
 *   - First page: send countTotal=true → response carries totalCount (exact).
 *   - Each response carries nextPageToken; absent ⇒ the result set is exhausted.
 * previewCount reuses /studies with pageSize=1&countTotal=true and reads totalCount.
 *
 * CTG v2 is NOT a field-Boolean bibliographic DB. The native search expression is
 * an "Essie" expression over query.term: free-text terms combined with the
 * UPPERCASE boolean operators AND / OR / NOT, double-quoted phrases for exact
 * match, and parentheses for grouping. There are NO field tags inside query.term,
 * so canonical field semantics (mesh, journal, doi, pmid, author) cannot be
 * expressed precisely — they are approximated as free text and a clear warning is
 * pushed into warnings[] (never silently dropped). Clinical-trial records carry no
 * authors and typically no DOI/PMID, so those fields stay empty by design.
 *
 * No API key and no polite-pool contact param are required by CTG v2 (the contact
 * tool/email is still surfaced via the shared HTTP client's User-Agent path; CTG
 * does not document a mailto query param, so none is sent).
 *
 * Verified against the ClinicalTrials.gov Data API v2 docs:
 *   - https://clinicaltrials.gov/data-api/api  (REST /studies, OpenAPI 3.0)
 *   - https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html
 * Endpoint /studies; params query.term, pageSize (max 1000, default 10), pageToken,
 * countTotal, format=json; response { studies[], nextPageToken, totalCount }; each
 * study.protocolSection.{identificationModule,conditionsModule,descriptionModule,
 * statusModule,sponsorCollaboratorsModule,designModule}. Last reviewed: 2026-06.
 */
import { buildUrl, contentHashId, clampPageSize } from './base.js';
import { makeThrottle } from '../throttle.js';
import { normalizeRecord, NORMALIZATION_VERSION } from '../normalize.js';
import {
  FIELD, normalizeCanonical, validateCanonical, quoteIfPhrase, makeTranslated,
} from '../query/ast.js';
import { PecanError } from '../errors.js';

export const CLINICALTRIALS_VERSION = 'clinicaltrials-1.0.0';

/** CTG hard ceiling for a single page (documented max pageSize). */
const CTG_MAX_PAGE_SIZE = 1000;

/**
 * Canonical fields that map cleanly onto Essie free-text (the trial registry is
 * full-text over titles/conditions/interventions/summaries/eligibility). Fields
 * NOT in this set are approximated as free text + warned.
 */
const FREE_TEXT_FIELDS = new Set([
  FIELD.ALL, FIELD.TITLE, FIELD.ABSTRACT, FIELD.TIAB, FIELD.KEYWORD,
]);

/** Human label for an unsupported field, used in the approximation warning. */
const FIELD_LABEL = {
  [FIELD.MESH]: 'MeSH heading',
  [FIELD.JOURNAL]: 'journal',
  [FIELD.DOI]: 'DOI',
  [FIELD.PMID]: 'PMID',
  [FIELD.AUTHOR]: 'author',
  [FIELD.YEAR]: 'year',
};

/** Render one canonical term into an Essie clause (quoted phrase + truncation). */
function renderTerm(t, warnings, unsupported) {
  // ClinicalTrials.gov has no field tags inside query.term. Anything that is not
  // plain free text is approximated as free text and flagged — never dropped.
  if (!FREE_TEXT_FIELDS.has(t.field)) {
    const label = FIELD_LABEL[t.field] || t.field;
    unsupported.push(`${t.field}:${t.text}`);
    warnings.push(`ClinicalTrials.gov has no ${label} field search; "${t.text}" was approximated as a free-text term.`);
  }
  // Controlled-vocabulary terms (e.g. MeSH) have no registry equivalent — use the
  // human-readable heading text as free text rather than dropping the concept.
  let text = t.text;
  if (t.type === 'controlled' && t.vocab) {
    const heading = t.vocab.mesh || t.vocab.heading || t.text;
    if (heading && heading !== t.text) {
      text = String(heading);
      warnings.push(`Controlled term "${t.text}" was searched as the free-text phrase "${text}" (no trial-registry controlled vocabulary).`);
    }
  }
  let body = quoteIfPhrase(text);
  if (t.truncate) {
    // Essie has no wildcard/truncation operator inside query.term.
    warnings.push(`Truncation on "${t.text}" is not supported by ClinicalTrials.gov and was dropped.`);
  }
  return body;
}

/** Build the CTG date / filter approximations (registry has no native lang/pubtype). */
function renderFilters(filters, warnings, unsupported) {
  // CTG v2 supports structured field filters via separate query.* params and
  // advanced area expressions, but NOT inside the free-text query.term Essie
  // expression we build here. We therefore note unfilterable canonical filters
  // as warnings rather than silently honoring/ignoring them.
  if (filters.dateFrom || filters.dateTo) {
    unsupported.push(`date:${filters.dateFrom || '*'}..${filters.dateTo || '*'}`);
    warnings.push('Publication-date filtering is not applied to ClinicalTrials.gov (trial registry uses study-status dates, not publication dates).');
  }
  if (filters.languages.length) {
    unsupported.push(`language:${filters.languages.join(',')}`);
    warnings.push('Language filtering is not supported by ClinicalTrials.gov and was ignored.');
  }
  if (filters.pubTypes.length) {
    unsupported.push(`pubType:${filters.pubTypes.join(',')}`);
    warnings.push('Publication-type filtering is not supported by ClinicalTrials.gov and was ignored.');
  }
}

/** translateQuery — canonical → CTG Essie query.term string + structured diagnostics. */
function translateClinicalTrials(canonicalInput, { override } = {}) {
  const canonical = normalizeCanonical(canonicalInput);
  const warnings = [];
  const supported = [];
  const unsupported = [];

  const conceptStrings = canonical.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      if (FREE_TEXT_FIELDS.has(t.field)) supported.push(`${t.field}:${t.text}`);
      return renderTerm(t, warnings, unsupported);
    }).filter(Boolean);
    if (!parts.length) return '';
    // A concept's terms join with its own op; group so AND/OR precedence is explicit.
    return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  }).filter(Boolean);

  renderFilters(canonical.filters, warnings, unsupported);

  // Concepts always combine with AND (standard PICO intersection).
  let query = conceptStrings.join(' AND ');

  const hasOverride = typeof override === 'string' && override.trim().length > 0;
  if (hasOverride) query = override.trim();

  return makeTranslated({
    provider: 'clinicaltrials',
    version: CLINICALTRIALS_VERSION,
    query,
    supported,
    unsupported,
    warnings,
    hasOverride,
    assumptions: [
      'Query is sent as a ClinicalTrials.gov "Essie" expression on query.term (free-text terms with AND/OR/NOT + quoted phrases); there are no field tags.',
    ],
  });
}

/** First non-empty string from a list of candidate values. */
function firstStr(...vals) {
  for (const v of vals) { if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
}

/**
 * mapStudy(study) — flatten a CTG v2 study object into the partial record shape
 * normalizeRecord expects, plus a stable nctId + a small raw provenance snapshot.
 * Total + defensive: a missing/malformed module yields empty fields, never throws.
 */
function mapStudy(study) {
  const ps = (study && typeof study === 'object' && study.protocolSection) || {};
  const idm = ps.identificationModule || {};
  const cond = ps.conditionsModule || {};
  const desc = ps.descriptionModule || {};
  const status = ps.statusModule || {};
  const spons = ps.sponsorCollaboratorsModule || {};
  const design = ps.designModule || {};

  const nctId = firstStr(idm.nctId);
  const title = firstStr(idm.officialTitle, idm.briefTitle);
  const abstract = firstStr(desc.briefSummary, desc.detailedDescription);

  // Year comes from the study start date (statusModule.startDateStruct.date),
  // falling back to other registry dates; normalizeYear extracts the 4-digit year
  // from any of CTG's date encodings ("2024-01-15", "January 2024", "2024").
  const startDate = (status.startDateStruct && status.startDateStruct.date) || '';
  const completionDate = (status.completionDateStruct && status.completionDateStruct.date)
    || (status.primaryCompletionDateStruct && status.primaryCompletionDateStruct.date) || '';
  const yearSource = firstStr(startDate, completionDate);

  // Lead sponsor stands in for the "venue/source" of a registry record (no journal).
  const sponsorName = (spons.leadSponsor && firstStr(spons.leadSponsor.name)) || '';

  const conditions = Array.isArray(cond.conditions)
    ? cond.conditions.map((x) => String(x || '').trim()).filter(Boolean)
    : [];

  // Study type (e.g. INTERVENTIONAL / OBSERVATIONAL) is the closest pubType analogue.
  const studyType = firstStr(design.studyType);

  const partial = {
    nctId,
    title,
    abstract,
    year: yearSource,
    journal: sponsorName,
    pubType: studyType,
    keywords: conditions,
    url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : '',
    // No authors / DOI / PMID for trial-registry records (by design).
    authors: '',
  };

  // Compact, safe provenance snapshot capped ~15kB.
  let rawSnapshot = '';
  try {
    rawSnapshot = JSON.stringify({
      nctId,
      title,
      conditions,
      overallStatus: firstStr(status.overallStatus),
      startDate,
      leadSponsor: sponsorName,
      studyType,
    });
    if (rawSnapshot.length > 15000) rawSnapshot = rawSnapshot.slice(0, 15000);
  } catch { rawSnapshot = ''; }

  return { ...partial, providerRecordId: nctId, _raw: rawSnapshot };
}

/**
 * createClinicalTrialsConnector(providerConfig, deps)
 * deps: { http (createHttpClient), now, sleep, logger, contact, retryLimit }
 */
export function createClinicalTrialsConnector(providerConfig, deps = {}) {
  const cfg = providerConfig;
  const http = deps.http;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  // CTG has no published hard QPS; space starts politely (~3/sec) to be a good citizen.
  const slot = makeThrottle(350, { now, sleep });

  const pageCeiling = Math.min(cfg.pageSize || 100, CTG_MAX_PAGE_SIZE);

  /** GET /studies with the given extra params (handles throttle + http). */
  async function studies(params, signal) {
    await slot();
    const url = buildUrl(cfg.baseUrl, '/studies', { format: 'json', ...params });
    const { json } = await http.requestJson(url, {
      provider: 'clinicaltrials', timeoutMs: cfg.timeoutMs, retryLimit: deps.retryLimit, signal,
    });
    return json && typeof json === 'object' ? json : {};
  }

  return {
    provider: 'clinicaltrials',

    capabilities() {
      return {
        id: cfg.id, label: cfg.label, platform: cfg.platform,
        requiresCredentials: cfg.requiresCredentials, configured: cfg.configured,
        available: cfg.available, supportsCountPreview: cfg.supportsCountPreview,
        maxResults: cfg.maxResults, supportedFields: cfg.supportedFields,
      };
    },

    translateQuery(canonical, opts) { return translateClinicalTrials(canonical, opts || {}); },

    validateQuery(canonical) { return validateCanonical(canonical); },

    async previewCount(translated, { signal } = {}) {
      const at = new Date().toISOString();
      const term = translated && translated.query;
      if (!term) return { count: null, kind: 'unavailable', at };
      try {
        const json = await studies({ 'query.term': term, pageSize: 1, countTotal: 'true' }, signal);
        const total = Number(json.totalCount);
        if (Number.isFinite(total)) return { count: total, kind: 'exact', at };
        return { count: null, kind: 'unavailable', at };
      } catch {
        // previewCount must NEVER throw.
        return { count: null, kind: 'unavailable', at };
      }
    },

    /**
     * search(translated, cursor, ctx)
     * cursor (JSON string) carries { pageToken, fetched, total }.
     * pageToken=null on the first page; nextCursor=null when exhausted.
     */
    async search(translated, cursor, ctx = {}) {
      const term = translated && translated.query;
      if (!term) throw new PecanError('INVALID_QUERY', { meta: { provider: 'clinicaltrials' } });

      let state = null;
      if (cursor) { try { state = JSON.parse(cursor); } catch { state = null; } }
      const first = !state;
      state = state || { pageToken: null, fetched: 0, total: null };

      // Respect the per-source result cap (cfg.maxResults) and the run's remaining budget.
      const hardCap = Number.isFinite(cfg.maxResults) ? cfg.maxResults : Infinity;
      const capRemaining = Number.isFinite(ctx.capRemaining) ? ctx.capRemaining : Infinity;
      const budget = Math.min(hardCap - (state.fetched || 0), capRemaining);
      if (budget <= 0) {
        return { records: [], nextCursor: null, total: state.total, rateLimit: {} };
      }

      const pageSize = Math.min(clampPageSize(ctx.pageSize, pageCeiling), budget);

      const params = { 'query.term': term, pageSize };
      if (first) params.countTotal = 'true';        // exact total on the first page only
      if (state.pageToken) params.pageToken = state.pageToken;

      const json = await studies(params, ctx.signal);

      const studyList = Array.isArray(json.studies) ? json.studies : [];
      const records = studyList.map(mapStudy);

      // Exact total (first page) is sticky for the rest of the run.
      let total = state.total;
      if (Number.isFinite(Number(json.totalCount))) total = Number(json.totalCount);

      const fetched = (state.fetched || 0) + records.length;
      const nextToken = typeof json.nextPageToken === 'string' && json.nextPageToken
        ? json.nextPageToken : null;

      // Stop when: provider returns no token, the page came back empty, or we hit a cap.
      const capHit = fetched >= hardCap || fetched >= capRemaining;
      const nextCursor = (nextToken && records.length > 0 && !capHit)
        ? JSON.stringify({ pageToken: nextToken, fetched, total })
        : null;

      return { records, nextCursor, total: Number.isFinite(total) ? total : null, rateLimit: {} };
    },

    /** normalize(rawItem) — mapped study partial → canonical record. */
    normalize(rawItem) {
      const rec = normalizeRecord(rawItem, { provider: 'clinicaltrials', version: NORMALIZATION_VERSION });
      const providerRecordId = (rawItem && rawItem.providerRecordId) || rec.nctId || rec.doi || contentHashId(rec);
      return { ...rec, providerRecordId, raw: (rawItem && rawItem._raw) || '' };
    },
  };
}
