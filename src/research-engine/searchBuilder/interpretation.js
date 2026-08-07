/**
 * interpretation.js — 100.md §§6-10. "What this search means", as pure data.
 *
 * ONE function turns the SAME canonical strategy the compilers consume
 * ({ concepts, filters }) into a plain-language reading of it. There is deliberately
 * no second state atom (100.md §9): the panel renders whatever `interpretStrategy`
 * returns for the live in-memory strategy, so adding a term, flipping AND↔OR,
 * reordering concepts or attaching a subject heading updates the explanation in the
 * same React commit that updates the compiled query. Nothing to save, nothing to
 * refresh, nothing that can drift.
 *
 * The output is READ-ONLY by construction (100.md §8): it is a description, it carries
 * no ids the UI could write back through, and the panel that renders it has no editing
 * affordances. All editing stays on the concept board above.
 *
 * Vocabulary wording comes from the vocabulary layer (../vocabulary), so the sentence
 * the user reads matches what the compilers actually emit: a subject heading is used
 * where the database indexes that thesaurus, and the concept's natural-language form
 * everywhere else (100.md §3).
 *
 * PURE — no React, no DOM, no I/O.
 */
import { liveTermsOf } from './termLiveness.js';
import { toCanonicalConcept } from './vocabulary/canonical.js';

const S = (v) => String(v == null ? '' : v);

/** Term kinds the panel styles differently. */
export const TERM_KIND = Object.freeze({
  PHRASE: 'phrase', WORD: 'word', PREFIX: 'prefix', SUBJECT: 'subject',
});

/** Where a free-text term is looked for, in words.
 *  The alias folding MUST match compilers/normalize.js FIELD_ALIAS: a legacy term
 *  saved with field:'title' compiles to a TITLE-ONLY search, so describing it as
 *  "title or abstract" would explain a different search than the one that runs. */
const FIELD_ALIAS = { ti: 'ti', title: 'ti', ab: 'ab', abstract: 'ab', tiab: 'tiab', all: 'all' };
function whereText(field) {
  const f = FIELD_ALIAS[S(field).trim().toLowerCase()] || 'tiab';
  if (f === 'ti') return 'in the title';
  if (f === 'ab') return 'in the abstract';
  if (f === 'all') return 'anywhere in the record';
  return 'in the title or abstract';
}

/**
 * describeTerm(term) → { kind, text, reading, where } | null
 *   `text`    the quotable term itself (what the user typed / the heading)
 *   `reading` the full plain-language line, e.g.
 *             'any word starting with “diabet” in the title or abstract'
 */
export function describeTerm(term) {
  const raw = S(term && term.text).trim();
  if (!raw) return null;

  if (term.type === 'controlled') {
    const concept = toCanonicalConcept(term);
    // The TOPIC is the heading as it is actually indexed; the WORDS are the exact form a
    // database without that subject list receives (vocabulary/canonical.js decides it,
    // and declines to de-invert an enumeration such as "Health Knowledge, Attitudes,
    // Practice"). Showing one string for both would misdescribe either the index or the
    // query, so the sentence names both when they differ.
    const topic = concept.preferredLabel || raw;
    const words = concept.freeTextForms[0] || topic;
    const n = concept.narrower.length;
    const narrower = concept.explode && n ? `, plus the ${n} more specific topic${n === 1 ? '' : 's'} under it` : '';
    return {
      kind: TERM_KIND.SUBJECT,
      text: topic,
      where: '',
      // 100.md §3 — say what actually happens across databases, without naming any
      // syntax: the official heading where the database indexes this thesaurus, the
      // plain words everywhere else.
      reading: `articles the database's own indexers filed under the topic “${topic}”${narrower} — or simply the words “${words}” where a database has no subject list`,
    };
  }

  const where = whereText(term.field);
  if (term.truncate && !/\s/.test(raw)) {
    const stem = raw.replace(/\*+$/, '');
    return { kind: TERM_KIND.PREFIX, text: stem, where, reading: `any word starting with “${stem}” ${where}` };
  }
  const phrase = /\s/.test(raw) || term.phrase;
  return phrase
    ? { kind: TERM_KIND.PHRASE, text: raw, where, reading: `the exact phrase “${raw}” ${where}` }
    : { kind: TERM_KIND.WORD, text: raw, where, reading: `the word “${raw}” ${where}` };
}

/* ── limits ──────────────────────────────────────────────────────────────────── */

const LANG_NAME = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', zh: 'Chinese',
  ja: 'Japanese', pt: 'Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic',
};
const langWord = (c) => LANG_NAME[S(c).trim().toLowerCase()] || S(c).trim();

/** Join a list in English: a · a and b · a, b and c (or 'or'). */
export function joinWords(list, conjunction = 'and') {
  const items = (Array.isArray(list) ? list : []).map(S).filter(Boolean);
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** describeLimits(filters) → plain sentences for the date / language / type limits. */
export function describeLimits(filters) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const out = [];
  const from = S(f.dateFrom).trim();
  const to = S(f.dateTo).trim();
  if (from && to) out.push(`Published between ${from} and ${to}.`);
  else if (from) out.push(`Published in ${from} or later.`);
  else if (to) out.push(`Published up to ${to}.`);

  const langs = Array.isArray(f.languages) ? f.languages.map(langWord).filter(Boolean) : [];
  if (langs.length) out.push(`Written in ${joinWords(langs, 'or')}.`);

  const types = Array.isArray(f.pubTypes) ? f.pubTypes.map((t) => S(t).trim()).filter(Boolean) : [];
  if (types.length) out.push(`Only ${joinWords(types, 'or')} articles.`);
  return out;
}

/* ── the whole strategy ──────────────────────────────────────────────────────── */

/** A concept's display name, falling back to its position. */
function conceptName(concept, index) {
  return S(concept && concept.label).trim() || `Concept ${index + 1}`;
}

/**
 * interpretStrategy({ concepts, filters }) →
 * {
 *   isEmpty,        // nothing to explain yet
 *   summary,        // one natural sentence describing the whole search
 *   groups: [{
 *     id, name,
 *     join,         // null for the first group, else 'AND' | 'OR' — how it attaches
 *                   //   to the PREVIOUS group (matching composeConcepts' rule: the
 *                   //   PREVIOUS surviving concept's `op` governs the join)
 *     joinReading,  // 'the article must ALSO discuss:' / '…can instead discuss:'
 *     anyReading,   // 'The article can use any one of these:' (or the single-term form)
 *     terms: [describeTerm()],
 *   }],
 *   skipped: [name],  // concepts with no usable terms — not part of the search
 *   limits: [string],
 * }
 *
 * The group chain mirrors compilers/shared.js `composeConcepts` exactly: only concepts
 * with live terms take part, and each surviving concept's `op` decides how the NEXT
 * one attaches. Any other rule here would explain a search the engine is not running.
 */
export function interpretStrategy(strategy) {
  const src = strategy && typeof strategy === 'object' ? strategy : {};
  const concepts = Array.isArray(src.concepts) ? src.concepts : [];

  const live = [];
  const skipped = [];
  concepts.forEach((c, i) => {
    const terms = liveTermsOf(c).map(describeTerm).filter(Boolean);
    // A legacy PICO time-frame group normally carries only a `note` (96.md) and is not
    // part of the query — listing it as "no terms yet" would invite the user to fill in
    // a retired group. But normalize.js does NOT special-case it: a T group that DOES
    // hold live terms compiles like any other concept and owns an operator in the
    // chain, so it must be explained like any other concept. Skipping it unconditionally
    // shifted every following join and could describe an AND search as OR.
    if (!terms.length) { if (!c || c.picoField !== 'T') skipped.push(conceptName(c, i)); return; }
    live.push({ concept: c, index: i, terms });
  });

  // 100.md §19 — the compilers refuse to apply limits to an empty strategy
  // (runRenderer: `filterClauses.length && blockCount > 0`, and filtersApplied follows).
  // Announcing "Narrowed to 2010-2025" over a search that does not exist would be the
  // same misstatement in the plain-language layer.
  const limits = live.length ? describeLimits(src.filters) : [];

  if (!live.length) {
    return { isEmpty: true, summary: '', groups: [], skipped, limits };
  }

  const groups = live.map((entry, i) => {
    // STRICT equality, exactly like compilers/normalize.js (`c.op === 'OR' ? 'OR' : 'AND'`).
    // Reading it case-insensitively would describe a hand-edited `op:'or'` as OR while
    // every compiler ANDs it.
    const op = i === 0 ? null : (live[i - 1].concept.op === 'OR' ? 'OR' : 'AND');
    return {
      id: S(entry.concept.id) || `c${entry.index + 1}`,
      name: conceptName(entry.concept, entry.index),
      join: op,
      // The AND/OR chip is rendered right before this, so the sentence COMPLETES it
      // ("AND — the article must ALSO be about:") instead of repeating the word.
      joinReading: op === 'OR'
        ? 'the article can INSTEAD be about:'
        : 'the article must ALSO be about:',
      anyReading: entry.terms.length === 1
        ? 'The article has to match:'
        : 'The article can match any one of these:',
      terms: entry.terms,
    };
  });

  // The one-sentence summary. Deliberately plain and always grammatical rather than
  // clever: every extra concept is appended with the operator that actually joins it.
  const names = groups.map((g) => g.name);
  let summary = `Find articles about ${names[0]}`;
  for (let i = 1; i < groups.length; i++) {
    summary += groups[i].join === 'OR' ? `, or about ${names[i]}` : `, and also about ${names[i]}`;
  }
  summary += '.';

  return { isEmpty: false, summary, groups, skipped, limits };
}

export default interpretStrategy;
