/**
 * pecanSearch/query/ast.js — the canonical Boolean query representation and the
 * shared toolkit every provider translator uses.
 *
 * The search builder already stores a structured concept/term model (it is NOT a
 * flat string), so P1 does NOT translate via fragile string replacement. The
 * canonical query is:
 *
 *   {
 *     raw: string,                 // original user-entered text (reproducibility)
 *     version: string,             // search-builder/engine version
 *     concepts: [{
 *       id, label,
 *       op: 'AND' | 'OR',          // INTER-concept operator: joins this concept to the
 *                                  // NEXT one (default AND). A concept's own terms are
 *                                  // always synonyms (OR) — op never AND-joins terms.
 *       terms: [{
 *         text, type: 'freetext'|'controlled',
 *         field,                   // semantic field: title|abstract|tiab|author|journal|doi|pmid|mesh|keyword|all
 *         vocab,                   // controlled-vocabulary record (e.g. a MeSH descriptor)
 *         noExplode, truncate, phrase
 *       }]
 *     }],
 *     filters: { dateFrom, dateTo, languages:[], pubTypes:[] }
 *   }
 *
 * Terms within a concept are SYNONYMS and always combine with OR; concepts combine
 * with the inter-concept `op` (default AND, the standard PICO intersection — see
 * composeConcepts). AND-joining a concept's synonyms was the root cause of 0-result
 * searches. Translators walk the normalized AST and emit a provider string PLUS a
 * structured TranslatedQuery (supported/unsupported/modified clauses + warnings), so
 * the engine NEVER silently weakens a query.
 */
import crypto from 'crypto';

// KNOWN LIMITATION (documented, not silent): the canonical model represents
// concept-level AND/OR exactly as the upstream Search Builder expresses it. It does
// NOT yet model Boolean NOT / exclusion terms or arbitrary nested groups — because
// the Search Builder UI does not produce them, so nothing is silently dropped today.
// When NOT/nesting support is added to the builder, extend normalizeCanonical (a
// per-concept `negate` or a top-level exclude list) AND every translator together,
// emitting an explicit unsupported-clause warning for providers that cannot honor it
// (Crossref/OpenAlex dismax). Tracked as a P1 follow-up (pairs with AI search, P11).

export const QUERY_LIMITS = Object.freeze({
  MAX_QUERY_LEN: 12000,     // canonical raw / rendered length ceiling
  MAX_CONCEPTS: 40,
  MAX_TERMS_PER_CONCEPT: 200,
  MAX_TERM_LEN: 500,
});

/** Semantic field kinds the canonical model understands (provider-neutral). */
export const FIELD = Object.freeze({
  ALL: 'all',
  TITLE: 'title',
  ABSTRACT: 'abstract',
  TIAB: 'tiab',          // title OR abstract
  AUTHOR: 'author',
  JOURNAL: 'journal',
  DOI: 'doi',
  PMID: 'pmid',
  MESH: 'mesh',
  KEYWORD: 'keyword',
  YEAR: 'year',
});

const str = (v) => String(v == null ? '' : v);
const clampStr = (v, n) => str(v).slice(0, n);

/** Normalize a raw field string to one of FIELD.*, defaulting to TIAB. */
export function normalizeField(f) {
  const v = str(f).trim().toLowerCase();
  switch (v) {
    case 'ti': case 'title': return FIELD.TITLE;
    case 'ab': case 'abstract': return FIELD.ABSTRACT;
    case 'tiab': case 'title/abstract': case 'titleabstract': return FIELD.TIAB;
    case 'au': case 'author': case 'authors': return FIELD.AUTHOR;
    case 'ta': case 'journal': case 'so': case 'source': return FIELD.JOURNAL;
    case 'doi': return FIELD.DOI;
    case 'pmid': case 'uid': return FIELD.PMID;
    case 'mesh': case 'mh': case 'controlled': return FIELD.MESH;
    case 'kw': case 'keyword': case 'keywords': return FIELD.KEYWORD;
    case 'dp': case 'year': case 'date': return FIELD.YEAR;
    case 'all': case '': case 'tw': return FIELD.TIAB;
    default: return FIELD.TIAB;
  }
}

/** A phrase = contains internal whitespace (must be quoted in most providers). */
export function isPhrase(text) { return /\s/.test(str(text).trim()); }

/** Escape embedded double-quotes for a quoted phrase. */
export function escapeQuotes(text) { return str(text).replace(/"/g, '\\"'); }

/** Quote a term iff it is a phrase (or force-quoted). */
export function quoteIfPhrase(text, force = false) {
  const t = str(text).trim();
  return (force || isPhrase(t)) ? `"${escapeQuotes(t)}"` : t;
}

/**
 * normalizeCanonical — defensively coerce arbitrary input into the canonical
 * shape with all caps applied. Never throws; drops malformed terms/concepts.
 */
export function normalizeCanonical(input = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const conceptsIn = Array.isArray(inp.concepts) ? inp.concepts.slice(0, QUERY_LIMITS.MAX_CONCEPTS) : [];
  const concepts = [];
  for (const c of conceptsIn) {
    if (!c || typeof c !== 'object') continue;
    const termsIn = Array.isArray(c.terms) ? c.terms.slice(0, QUERY_LIMITS.MAX_TERMS_PER_CONCEPT) : [];
    const terms = [];
    for (const t of termsIn) {
      if (!t || typeof t !== 'object') continue;
      const text = clampStr(t.text, QUERY_LIMITS.MAX_TERM_LEN).trim();
      if (!text) continue;
      terms.push({
        text,
        type: t.type === 'controlled' ? 'controlled' : 'freetext',
        field: normalizeField(t.field),
        vocab: t.vocab && typeof t.vocab === 'object' ? t.vocab : null,
        noExplode: !!t.noExplode,
        truncate: !!t.truncate,
        phrase: t.phrase != null ? !!t.phrase : isPhrase(text),
      });
    }
    if (!terms.length) continue;
    concepts.push({
      id: clampStr(c.id, 64),
      label: clampStr(c.label, 120),
      // INTER-concept operator (joins to the next concept). Default AND = the PICO
      // intersection. Only an explicit 'OR' opts a concept into an OR join; a missing
      // op must NOT silently OR concepts together.
      op: c.op === 'OR' ? 'OR' : 'AND',
      terms,
    });
  }
  const f = inp.filters && typeof inp.filters === 'object' ? inp.filters : {};
  const filters = {
    dateFrom: clampStr(f.dateFrom, 10).trim(),
    dateTo: clampStr(f.dateTo, 10).trim(),
    languages: Array.isArray(f.languages) ? f.languages.map((x) => clampStr(x, 20).trim()).filter(Boolean).slice(0, 20) : [],
    pubTypes: Array.isArray(f.pubTypes) ? f.pubTypes.map((x) => clampStr(x, 60).trim()).filter(Boolean).slice(0, 40) : [],
  };
  return {
    raw: clampStr(inp.raw, QUERY_LIMITS.MAX_QUERY_LEN),
    version: clampStr(inp.version, 40),
    concepts,
    filters,
  };
}

/**
 * validateCanonical — structural validation independent of any provider.
 * @returns {{ ok:boolean, errors:string[], warnings:string[] }}
 */
export function validateCanonical(canonical) {
  const c = normalizeCanonical(canonical);
  const errors = [];
  const warnings = [];
  if (!c.concepts.length) errors.push('The query has no search terms.');
  const rendered = renderPlain(c);
  if (rendered.length > QUERY_LIMITS.MAX_QUERY_LEN) errors.push('The query is too long.');
  c.concepts.forEach((concept) => {
    if (!concept.terms.length) warnings.push(`Concept "${concept.label || concept.id}" has no terms and was ignored.`);
  });
  if (c.filters.dateFrom && !/^\d{4}(\/\d{1,2}(\/\d{1,2})?)?$/.test(c.filters.dateFrom)) warnings.push('Start date is not a recognised YYYY or YYYY/MM/DD value.');
  if (c.filters.dateTo && !/^\d{4}(\/\d{1,2}(\/\d{1,2})?)?$/.test(c.filters.dateTo)) warnings.push('End date is not a recognised YYYY or YYYY/MM/DD value.');
  for (const lt of findLiteralBooleanTerms(c)) {
    warnings.push(`The term "${lt.text}" contains "${lt.op}" as text and is searched literally, not as a Boolean operator. Split it into separate terms in the Search Builder (synonyms within a concept are already combined automatically).`);
  }
  return { ok: errors.length === 0, errors, warnings, normalized: c };
}

/**
 * findLiteralBooleanTerms — detect terms whose TEXT contains a standalone uppercase
 * Boolean operator (AND / OR / NOT). The canonical model treats every term as one
 * literal string, so "stroke OR TIA" is searched as the exact phrase "stroke OR TIA"
 * (≈ 0 hits) — almost always a sign the user meant separate terms. We only flag the
 * uppercase operator words (a real phrase like "signs and symptoms" uses lowercase),
 * so this is a high-precision hint, never a destructive rewrite.
 * @returns {Array<{text:string, op:string, conceptLabel:string}>}
 */
export function findLiteralBooleanTerms(canonical) {
  const c = normalizeCanonical(canonical);
  const out = [];
  const re = /(?:^|\s)(AND|OR|NOT)(?:\s|$)/;
  for (const concept of c.concepts) {
    for (const t of concept.terms) {
      const m = re.exec(t.text);
      // Require other words around the operator (a bare "AND" term isn't this bug).
      if (m && t.text.trim().split(/\s+/).length > 1) {
        out.push({ text: t.text, op: m[1], conceptLabel: concept.label || concept.id || '' });
      }
    }
  }
  return out;
}

/** Flatten every term across all concepts (translation diagnostics / tests). */
export function flattenTerms(canonical) {
  const c = normalizeCanonical(canonical);
  const out = [];
  for (const concept of c.concepts) for (const t of concept.terms) out.push({ ...t, conceptOp: concept.op, conceptLabel: concept.label });
  return out;
}

/**
 * renderPlain — a database-neutral, human-readable rendering of the canonical
 * query (used for canonicalText display + the report). Not a provider query.
 */
export function renderPlain(canonical) {
  const c = normalizeCanonical(canonical);
  const blocks = c.concepts.map((concept) => {
    const parts = concept.terms.map((t) => {
      const q = quoteIfPhrase(t.text) + (t.truncate ? '*' : '');
      const field = t.field && t.field !== FIELD.TIAB ? `:${t.field}` : '';
      return q + field;
    });
    // Terms within a concept are SYNONYMS → always OR (never concept.op).
    const joined = parts.join(' OR ');
    return { q: parts.length > 1 ? `(${joined})` : joined, op: concept.op };
  });
  let out = composeConcepts(blocks);
  const fl = [];
  if (c.filters.dateFrom || c.filters.dateTo) fl.push(`date ${c.filters.dateFrom || '*'}..${c.filters.dateTo || '*'}`);
  if (c.filters.languages.length) fl.push(`lang ${c.filters.languages.join('/')}`);
  if (c.filters.pubTypes.length) fl.push(`type ${c.filters.pubTypes.join('/')}`);
  if (fl.length) out = out ? `${out} [${fl.join('; ')}]` : `[${fl.join('; ')}]`;
  return out;
}

/**
 * composeConcepts(blocks) — join per-concept rendered strings using the INTER-concept
 * operator, matching the Search Builder (renderSearch): `concept.op` connects a concept
 * to the NEXT concept (default AND), and terms WITHIN a concept are synonyms the caller
 * must have already OR'd. Joining a concept's synonym terms by `concept.op` (AND by
 * default) was the cause of 0-result searches — a multi-synonym concept became
 * "syn1 AND syn2 AND …", requiring every synonym to co-occur.
 *
 * @param {Array<{q:string, op?:string}>} blocks  rendered concept strings + their op
 * @returns {string}
 */
export function composeConcepts(blocks) {
  const items = (blocks || []).filter((b) => b && b.q);
  if (!items.length) return '';
  let out = items[0].q;
  for (let i = 1; i < items.length; i++) {
    const op = items[i - 1].op === 'OR' ? 'OR' : 'AND';
    out += ` ${op} ${items[i].q}`;
  }
  return out;
}

/** Stable short hash of an executed query string (for the source-run query hash). */
export function hashQuery(queryString) {
  return crypto.createHash('sha1').update(str(queryString), 'utf8').digest('hex').slice(0, 16);
}

/**
 * makeTranslated — helper for translators to assemble the standard TranslatedQuery
 * result shape consistently (§10.2). `query` is the exact provider string.
 */
export function makeTranslated({ provider, version, query, supported = [], unsupported = [], modified = [], warnings = [], assumptions = [], hasOverride = false }) {
  return {
    provider,
    version,
    query: str(query),
    queryHash: hashQuery(query),
    supported,
    unsupported,
    modified,
    warnings,
    assumptions,
    hasOverride: !!hasOverride,
  };
}
