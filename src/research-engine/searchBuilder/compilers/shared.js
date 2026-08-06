/**
 * compilers/shared.js — 73.md Part 6. Pure, network-free helpers shared by every
 * per-database renderer in the Search-Builder strategy compiler. No app / DOM / I/O.
 *
 * The renderers translate ONE normalized strategy (see normalize.js) into one
 * database-specific Boolean query. This module owns the primitives every renderer
 * reuses so a new database is a thin file of a few hooks:
 *   - token building (phrase quoting, truncation with a per-db minimum stem)
 *   - special-character escaping (double- vs single-quote grammars)
 *   - concept OR-grouping + AND/OR concept chaining (concept.op governs the join
 *     to the NEXT concept; 98.md §12 — this is THE one renderer, the legacy
 *     SearchBuilderTab copy is deleted)
 *   - 100.md §§3-4: CONTROLLED-VOCABULARY TRANSLATION. Renderers no longer read
 *     `term.vocab` at all. runRenderer resolves every controlled term through the
 *     vocabulary layer (../vocabulary) and then either calls the adapter's
 *     `renderHeading` hook (the database indexes the concept's vocabulary) or
 *     composes a free-text fallback out of the adapter's own `renderFree` hook.
 *     No renderer can paste a PubMed heading into another database's syntax again.
 *   - the standard run loop (runRenderer) that assembles the public result contract
 *
 * We NEVER fabricate provider syntax and NEVER silently drop a feature — anything a
 * database cannot express is emitted as a warning {code,message} or an unsupported
 * {feature,detail} entry.
 */
import { planControlledTerm, FALLBACK_REASON } from '../vocabulary/index.js';

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
  const raw = S(term.text).trim();
  let t = esc(raw);
  // recs round — never SILENTLY alter a user's term: dropping the phrase delimiter
  // from inside a term ("Parkinson's" → "Parkinsons") changes what is searched, so
  // say so explicitly (once per affected term).
  if (t !== raw) {
    const ch = quoteChar === "'" ? 'apostrophes' : 'double quotes';
    warnings.push({ code: 'CHARS_REMOVED', message: `${ch[0].toUpperCase()}${ch.slice(1)} cannot appear inside this database's ${quoteChar === "'" ? 'single' : 'double'}-quoted phrases — "${raw}" was searched as "${t}". Check the database's own handling if the term relies on it.` });
  }
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
/** OR the clauses of one concept; a single clause is returned bare, ≥2 parenthesized.
 *  98.md §12 — exact duplicate clauses (case-insensitive) are collapsed: legacy
 *  saves can carry in-group exact duplicates (the UI now prevents new ones), and
 *  `x[tiab] OR x[tiab]` adds nothing but noise to the compiled strategy.
 *  Cross-group duplicates are untouched (semantically meaningful under AND). */
export function orGroup(clauses) {
  const live = clauses.filter(Boolean);
  if (!live.length) return '';
  const seen = new Set();
  const deduped = [];
  for (const cl of live) {
    const key = String(cl).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cl);
  }
  return deduped.length === 1 ? deduped[0] : `(${deduped.join(' OR ')})`;
}

/**
 * composeConcepts(blocks, joiner?) — chain concept blocks: skip empty-query
 * blocks, and join each
 * surviving block to the next using the PREVIOUS surviving block's op (so concept.op
 * governs the join to the NEXT concept; default AND). `joiner(op)` overrides the
 * literal join string (Google Scholar joins AND concepts with a bare space).
 */
export function composeConcepts(blocks, joiner) {
  const surv = blocks.filter((b) => b.q);
  if (!surv.length) return '';
  // When the chain MIXES AND and OR, make the intended left-to-right evaluation
  // EXPLICIT with left-associative parentheses: `G1 AND G2 OR G3` becomes
  // `((G1 AND G2) OR G3)`. PubMed evaluates strictly left-to-right so this is
  // identical there — but Scopus/WoS/EBSCO/etc. apply their own AND-before-OR
  // precedence, under which the bare string silently means `G1 AND (G2 OR G3)`.
  // A single-operator chain (the overwhelmingly common all-AND case) stays
  // unwrapped, byte-for-byte as the legacy renderer produced it.
  const ops = surv.slice(0, -1).map((b) => b.op || 'AND');
  const mixed = new Set(ops).size > 1;
  let full = surv[0].q;
  for (let i = 1; i < surv.length; i++) {
    const op = surv[i - 1].op || 'AND';
    const joined = (joiner ? joiner(op) : ` ${op} `) + surv[i].q;
    full = mixed ? `(${full}${joined})` : full + joined;
  }
  return full;
}

/** True when the whole expression is a single balanced (...) group (so a
 *  mixed-operator concept chain, already fully parenthesized by composeConcepts,
 *  is not double-wrapped before its filter limits are appended). */
export function isFullyParenthesized(q) {
  const s = String(q || '');
  if (s.length < 2 || s[0] !== '(' || s[s.length - 1] !== ')') return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0 && i < s.length - 1) return false; }
  }
  return depth === 0;
}

/* ── vocab accumulator ───────────────────────────────────────────────────────── */
/** Fresh per-compile vocabulary tally.
 *  `mapped`      subject headings rendered in the database's OWN vocabulary
 *  `unmapped`    concepts with no verified equivalent (→ free-text fallback)
 *  `fallback`    100.md §3 — how many of those became free-text clauses
 *  `approximate` legacy flag: true only when a heading was emitted WITHOUT a verified
 *                basis. Nothing sets it any more (that is the whole point of 100.md
 *                §3) — it is retained so the public result contract is unchanged. */
export function makeVocab(system) {
  return { system: system || 'none', mapped: 0, unmapped: 0, fallback: 0, approximate: false };
}

/* ── controlled-vocabulary translation (100.md §§3-4) ────────────────────────── */

/** Human names for the vocabulary systems the capability table can declare. */
const SYSTEM_LABEL = {
  mesh: 'MeSH', emtree: 'Emtree', cinahl: 'CINAHL Headings',
  apa: 'the APA Thesaurus of Psychological Index Terms', decs: 'DeCS', none: 'no subject headings',
};
const systemLabel = (id) => SYSTEM_LABEL[S(id).toLowerCase()] || S(id) || 'subject headings';

/** The field a free-text fallback is scoped to: title + abstract (each adapter's own
 *  `tiab` rendering, which is title/abstract — and keywords where the database's
 *  tiab-equivalent field already includes them). Deliberately NOT `all`: a subject
 *  heading stands for the topic of the paper, not for a mention anywhere in it. */
const FALLBACK_FIELD = 'tiab';

/** One free-text form → the term object an adapter's renderFree hook expects. */
function fallbackTerm(term, text) {
  return {
    ...term,
    text,
    type: 'freetext',
    field: FALLBACK_FIELD,
    vocab: null,
    noExplode: false,
    truncate: false,          // a de-inverted heading is a phrase, never a stem
    phrase: /\s/.test(text),  // multi-word forms are quoted; single words stay bare
  };
}

/**
 * controlledClause(term, cap, hooks, sink) — render ONE controlled term for one
 * database, and record honestly what happened. `sink` is
 * { vocab, warnings, notes, unsupported }.
 *
 * Two outcomes, and only two:
 *   native   — the database indexes this concept's vocabulary, so the adapter's
 *              `renderHeading(plan, term, sink)` emits real subject-heading syntax;
 *   freetext — no verified equivalent exists, so the concept is searched as properly
 *              formatted free text through the adapter's OWN `renderFree` hook
 *              (100.md §3: never invent a subject heading).
 *
 * An adapter may still supply a bespoke `renderControlled` (the pre-100 hook) — it
 * wins, and is the escape hatch for a database whose heading syntax cannot be
 * expressed as `renderHeading`. Nothing in the catalogue uses it today.
 */
export function controlledClause(term, cap, hooks, sink) {
  const { vocab, warnings, notes, unsupported } = sink;
  if (typeof hooks.renderControlled === 'function') {
    return hooks.renderControlled(term, vocab, warnings, unsupported, notes);
  }

  const plan = planControlledTerm(term, cap);
  const label = S(cap.label) || S(cap.id);
  const concept = plan.concept;
  const heading = concept.preferredLabel;
  const sourceName = systemLabel(concept.sourceSystem);

  if (plan.status === 'native' && typeof hooks.renderHeading === 'function') {
    vocab.mapped++;
    if (plan.explosionUnsupported) {
      warnings.push({
        code: 'VOCAB_EXPLOSION_UNSUPPORTED',
        message: plan.explosionMismatch === 'lost'
          ? `${label} indexes ${sourceName} but offers no explosion control, so “${heading}” was searched WITHOUT its narrower topics.`
          : `${label} indexes ${sourceName} but offers no explosion control, so “${heading}” was searched WITH its narrower topics even though you switched explosion off.`,
      });
    }
    return hooks.renderHeading(plan, term, warnings, notes, unsupported);
  }

  // ── free-text fallback ────────────────────────────────────────────────────
  vocab.unmapped++;
  vocab.fallback++;
  const forms = plan.forms && plan.forms.length ? plan.forms : [heading].filter(Boolean);
  if (!forms.length) {
    warnings.push({ code: 'VOCAB_EMPTY', message: 'A subject-heading term carried no heading text and was skipped.' });
    return '';
  }
  const shown = forms.map((f) => `"${f}"`).join(' OR ');

  if (plan.reason === FALLBACK_REASON.NO_VOCABULARY) {
    unsupported.push({
      feature: 'controlled-vocabulary',
      detail: `${label} indexes no subject headings, so the ${sourceName} concept “${heading}” was searched as free text (${shown}) rather than as invented ${label} syntax.`,
    });
  } else if (plan.reason === FALLBACK_REASON.NO_SOURCE_HEADING) {
    warnings.push({
      code: 'VOCAB_NO_EQUIVALENT',
      message: `A term marked as a subject heading carried no heading text; it was searched as free text (${shown}).`,
    });
  } else {
    const targetName = systemLabel(plan.databaseSystem || cap.vocabSystem);
    warnings.push({
      code: 'VOCAB_NO_EQUIVALENT',
      message: `${label} is indexed with ${targetName}, and no public crosswalk maps the ${sourceName} heading “${heading}” to it. Rather than invent a heading, the concept was searched as free text (${shown}) — look the term up in ${label} and paste its own heading in through Edit if you need heading-level recall.`,
    });
  }

  if (concept.explode && concept.narrower.length) {
    notes.push(`“${heading}” includes its narrower topics in ${sourceName}; a free-text phrase cannot explode, so ${concept.narrower.length} narrower topic${concept.narrower.length === 1 ? '' : 's'} (e.g. ${concept.narrower.slice(0, 2).join(', ')}) are not automatically covered in ${label}. Add the ones that matter as synonyms.`);
  }

  return orGroup(forms.map((f) => hooks.renderFree(fallbackTerm(term, f), warnings, unsupported, notes)));
}

/* ── the standard run loop ───────────────────────────────────────────────────── */
/**
 * runRenderer(ir, cap, hooks) — the shared compile flow every renderer uses.
 * hooks:
 *   renderFree(term, warnings, unsupported, notes)              → clause | ''
 *   renderHeading?(plan, term, warnings, notes, unsupported)    → clause | ''
 *        100.md §4 — called ONLY when the vocabulary layer resolved a database-native
 *        heading (plan.heading / plan.explode). Omit the hook on a database that
 *        indexes no subject headings: every controlled term then falls back to
 *        free text through renderFree, which is the honest behaviour.
 *   renderControlled?(term, vocab, warnings, unsupported, notes) → clause | ''
 *        pre-100 escape hatch; when present it OWNS controlled terms entirely.
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
  const sink = { vocab, warnings, notes, unsupported };

  const blocks = ir.concepts.map((c) => {
    if (!c.terms.length) return { q: '', op: c.op };
    const clauses = [];
    for (const term of c.terms) {
      const clause = term.type === 'controlled'
        ? controlledClause(term, cap, hooks, sink)
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
  // 98.md §12 — an EMPTY strategy must never compile to a runnable string: with
  // zero live concepts, persisted filters used to produce a bare filters-only
  // query (e.g. a date range with no search terms) while the note below claimed
  // the query was empty. Filters apply only when there is something to filter.
  if (filterClauses.length && blockCount > 0) {
    // A mixed-operator chain is already one fully-parenthesized group; don't
    // double-wrap it before appending the filter limits.
    const needsWrap = wrap && blockCount > 1 && conceptExpr && !isFullyParenthesized(conceptExpr);
    const base = needsWrap ? `(${conceptExpr})` : conceptExpr;
    query = [base, ...filterClauses].filter(Boolean).join(` ${andTok} `);
  }

  if (typeof hooks.postProcess === 'function') query = hooks.postProcess(query, warnings, notes);

  for (const label of ir.emptyConcepts) {
    notes.push(`Concept "${label}" has no usable terms and was skipped.`);
  }
  if (!blockCount) notes.push('No concepts with search terms; the compiled query is empty.');

  const syntaxLevel = (cap.syntaxLevel === 'approximate' || vocab.approximate) ? 'approximate' : 'native';
  // 100.md §19 — `filtersApplied` must describe the string we actually returned. The
  // 98.md §12 fix stopped an empty strategy compiling to a bare filters-only query,
  // but left this flag reading `true` — so the UI told a user with no terms that their
  // date/language limits "ride inside the query" when the query was empty.
  return { query, warnings, notes, unsupported, vocab, filtersApplied: applied && blockCount > 0, syntaxLevel };
}
