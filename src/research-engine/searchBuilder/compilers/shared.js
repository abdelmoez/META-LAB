/**
 * compilers/shared.js — 73.md Part 6. Pure, network-free helpers shared by every
 * per-database renderer in the Search-Builder strategy compiler. No app / DOM / I/O.
 *
 * The renderers translate ONE normalized strategy (see normalize.js) into one
 * database-specific Boolean query. This module owns the primitives every renderer
 * reuses so a new database is a thin file of a few hooks:
 *   - token building (phrase quoting, truncation with a per-db minimum stem)
 *   - special-character escaping (double- vs single-quote grammars)
 *   - concept OR-grouping + AND/OR concept chaining (byte-identical to the way
 *     SearchBuilderTab.renderSearch chains concept blocks via the PREVIOUS block's op)
 *   - the standard run loop (runRenderer) that assembles the public result contract
 *
 * We NEVER fabricate provider syntax and NEVER silently drop a feature — anything a
 * database cannot express is emitted as a warning {code,message} or an unsupported
 * {feature,detail} entry.
 */

export const S = (v) => String(v == null ? '' : v);

/** True when the (trimmed) text contains internal whitespace → a multi-word phrase. */
export const isPhrase = (t) => /\s/.test(S(t).trim());

/** Escape for a double-quote grammar: drop embedded double quotes. */
export const stripDouble = (t) => S(t).replace(/"/g, '');
/** Escape for a single-quote grammar (Embase.com): drop embedded single quotes. */
export const stripSingle = (t) => S(t).replace(/'/g, '');

/** Unique, order-preserving. */
export function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
  return out;
}

/* ── language helpers ────────────────────────────────────────────────────────── */
// The Limits panel stores ISO 639-1 codes (en, es, …). Each database wants a
// different surface form; map the ones the Limits panel offers, pass through the rest.
const LANG_NAME = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', zh: 'Chinese',
  ja: 'Japanese', pt: 'Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic',
};
const LANG_6392B = {
  en: 'eng', es: 'spa', fr: 'fre', de: 'ger', zh: 'chi',
  ja: 'jpn', pt: 'por', it: 'ita', ru: 'rus', ar: 'ara',
};
/** ISO 639-1 code → full English name (PubMed / PMC / Scopus / WoS / EBSCO). */
export function langName(code) {
  const c = S(code).trim().toLowerCase();
  return LANG_NAME[c] || S(code).trim();
}
/** ISO 639-1 code → lowercase English name (Embase.com `[english]/lim`). */
export function langNameLower(code) {
  return langName(code).toLowerCase();
}
/** ISO 639-1 code → ISO 639-2/B 3-letter code (Europe PMC `LANG:"eng"`). */
export function langIso6392b(code) {
  const c = S(code).trim().toLowerCase();
  return LANG_6392B[c] || '';
}

/* ── date helpers ────────────────────────────────────────────────────────────── */
/** YYYY (or YYYY/MM[/DD]) → PubMed slash date, padding a bare year to a full edge. */
export function toSlashDate(raw, edge) {
  const t = S(raw).trim().replace(/-/g, '/');
  if (/^\d{4}$/.test(t)) return edge === 'end' ? `${t}/12/31` : `${t}/01/01`;
  const m = t.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (m) {
    const mm = String(m[2]).padStart(2, '0');
    const dd = m[3] ? String(m[3]).padStart(2, '0') : (edge === 'end' ? '31' : '01');
    return `${m[1]}/${mm}/${dd}`;
  }
  return t;
}
/** First 4-digit year in the value, or the fallback. */
export function year(raw, fallback) {
  const m = S(raw).match(/\d{4}/);
  return m ? m[0] : fallback;
}

/* ── token building ──────────────────────────────────────────────────────────── */
// Special grouping/field characters that must never leak out of a bare single word
// (they would be parsed as operators); such a word is force-quoted instead.
const SPECIAL = /[()[\]{}]/;

/**
 * fieldBody(term, opts) — the escaped, phrase-quoted, optionally-truncated body of a
 * free-text term for a database whose phrase delimiter is `quoteChar`.
 *   opts: { quoteChar='"', wildcard='*'|null, minStem=0, warnings }
 * Truncation is applied only to a single word whose stem meets the per-db minimum;
 * a truncated multi-word phrase is impossible in every grammar here → warned, not faked.
 */
export function fieldBody(term, opts = {}) {
  const quoteChar = opts.quoteChar || '"';
  const wildcard = opts.wildcard === undefined ? '*' : opts.wildcard;
  const minStem = opts.minStem || 0;
  const warnings = opts.warnings || [];
  const esc = quoteChar === "'" ? stripSingle : stripDouble;
  let t = esc(S(term.text).trim());
  const multi = /\s/.test(t);
  let truncated = false;
  if (term.truncate) {
    if (!wildcard) {
      warnings.push({ code: 'TRUNCATION_UNSUPPORTED', message: `Truncation was requested for "${term.text}" but this database has no truncation wildcard; it was searched as an exact term.` });
    } else if (multi) {
      warnings.push({ code: 'TRUNCATION_UNSUPPORTED', message: `Truncation cannot apply to the phrase "${term.text}"; it was searched as an exact phrase.` });
    } else {
      const stem = t.replace(/\*+$/, '');
      if (minStem && stem.length < minStem) {
        warnings.push({ code: 'TRUNCATION_TOO_SHORT', message: `"${term.text}" is shorter than the ${minStem}-character minimum before a wildcard; truncation was not applied.` });
      } else {
        t = stem + wildcard;
        truncated = true;
      }
    }
  }
  const quote = (multi || term.phrase || (SPECIAL.test(t) && !truncated)) && !truncated;
  return quote ? `${quoteChar}${t}${quoteChar}` : t;
}

/**
 * ncbiToken(term) — SearchBuilderTab's exact freeTextToken (NO escaping, double
 * quotes, single-word truncation only). Kept byte-identical so the PubMed compiler
 * reproduces today's SearchBuilderTab output; reused by the PMC compiler for NCBI
 * consistency. Returns { token, field }.
 */
export function ncbiToken(term) {
  let t = S(term.text).trim();
  const trunc = term.truncate && !t.includes(' ');
  if (trunc) t = t.replace(/\*+$/, '') + '*';
  const phrase = (t.includes(' ') || term.phrase) && !trunc;
  return { token: phrase ? `"${t}"` : t, field: term.field || 'tiab' };
}

/* ── grouping + chaining ─────────────────────────────────────────────────────── */
/** OR the clauses of one concept; a single clause is returned bare, ≥2 parenthesized. */
export function orGroup(clauses) {
  const live = clauses.filter(Boolean);
  if (!live.length) return '';
  return live.length === 1 ? live[0] : `(${live.join(' OR ')})`;
}

/**
 * composeConcepts(blocks, joiner?) — chain concept blocks exactly the way
 * SearchBuilderTab.renderSearch does: skip empty-query blocks, and join each
 * surviving block to the next using the PREVIOUS surviving block's op (so concept.op
 * governs the join to the NEXT concept; default AND). `joiner(op)` overrides the
 * literal join string (Google Scholar joins AND concepts with a bare space).
 */
export function composeConcepts(blocks, joiner) {
  const surv = blocks.filter((b) => b.q);
  if (!surv.length) return '';
  let full = surv[0].q;
  for (let i = 1; i < surv.length; i++) {
    const op = surv[i - 1].op || 'AND';
    full += (joiner ? joiner(op) : ` ${op} `) + surv[i].q;
  }
  return full;
}

/* ── vocab accumulator ───────────────────────────────────────────────────────── */
/** Fresh per-compile vocabulary tally. */
export function makeVocab(system) {
  return { system: system || 'none', mapped: 0, unmapped: 0, approximate: false };
}

/* ── the standard run loop ───────────────────────────────────────────────────── */
/**
 * runRenderer(ir, cap, hooks) — the shared compile flow every renderer uses.
 * hooks:
 *   renderControlled(term, vocab, warnings, unsupported, notes) → clause | ''
 *   renderFree(term, warnings, unsupported, notes)              → clause | ''
 *   buildFilters(filters, warnings, notes, unsupported)         → { clauses:[], applied:bool }
 *   conceptJoiner?(op) → join string                             (default ` AND `/` OR `)
 *   andToken?          → filter-join token                       (default 'AND')
 *   wrapConcepts?      → wrap the concept expr in ()s before filters when >1 block (default true)
 *   postProcess?(query, warnings, notes)                         → query (length checks, …)
 * Returns { query, warnings, notes, unsupported, vocab, filtersApplied, syntaxLevel }.
 */
export function runRenderer(ir, cap, hooks) {
  const warnings = [];
  const notes = [];
  const unsupported = [];
  const vocab = makeVocab(cap.vocabSystem);

  const blocks = ir.concepts.map((c) => {
    if (!c.terms.length) return { q: '', op: c.op };
    const clauses = [];
    for (const term of c.terms) {
      const clause = term.type === 'controlled'
        ? hooks.renderControlled(term, vocab, warnings, unsupported, notes)
        : hooks.renderFree(term, warnings, unsupported, notes);
      if (clause) clauses.push(clause);
    }
    return { q: orGroup(clauses), op: c.op };
  });

  const conceptExpr = composeConcepts(blocks, hooks.conceptJoiner);
  const blockCount = blocks.filter((b) => b.q).length;

  const { clauses: filterClauses = [], applied = false } =
    hooks.buildFilters ? hooks.buildFilters(ir.filters, warnings, notes, unsupported) : {};

  const andTok = hooks.andToken || 'AND';
  const wrap = hooks.wrapConcepts !== false;
  let query = conceptExpr;
  if (filterClauses.length) {
    const base = wrap && blockCount > 1 && conceptExpr ? `(${conceptExpr})` : conceptExpr;
    query = [base, ...filterClauses].filter(Boolean).join(` ${andTok} `);
  }

  if (typeof hooks.postProcess === 'function') query = hooks.postProcess(query, warnings, notes);

  for (const label of ir.emptyConcepts) {
    notes.push(`Concept "${label}" has no usable terms and was skipped.`);
  }
  if (!blockCount) notes.push('No concepts with search terms; the compiled query is empty.');

  const syntaxLevel = (cap.syntaxLevel === 'approximate' || vocab.approximate) ? 'approximate' : 'native';
  return { query, warnings, notes, unsupported, vocab, filtersApplied: applied, syntaxLevel };
}
