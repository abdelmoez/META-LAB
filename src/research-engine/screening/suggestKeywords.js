/**
 * suggestKeywords.js — context-aware screening keyword SUGGESTIONS (107.md §2).
 *
 * Pure functions, no database, no side effects.
 *
 * 107.md §2: generated keywords are *semantic suggestions*, not a literal
 * extraction of every medically relevant word. The four rules this module adds on
 * top of the existing concept extractor are:
 *
 *   1. NEGATION — a fragment governed by a negation cue contributes nothing to that
 *      side. "Exclude studies without confirmed epilepsy" must NOT suggest
 *      `epilepsy` as an exclusion keyword; the word is not the exclusion concept.
 *   2. GENERIC BLOCKLIST — bare "patients" / "disease" / "studies" / "outcome" are
 *      meaningless screening filters and are never suggested on their own. A
 *      multi-word phrase that merely CONTAINS one ("randomized controlled trials",
 *      "healthy controls") is kept.
 *   3. SPECIFICITY — when the criterion says "drug-resistant epilepsy", the bare
 *      `epilepsy` is dropped in favour of the qualified phrase.
 *   4. CROSS-POLARITY CONFLICTS — a concept that lands on BOTH sides is emitted on
 *      NEITHER and is reported in `conflicts` for the review UI to arbitrate.
 *
 * DELIBERATE DIVERGENCE: this module does NOT modify `extractConcepts` /
 * `expandSynonyms` in conceptKeywords.js, even though it consumes them. Those two
 * functions also feed (a) the governed eligibility auto-decide engine
 * (server/services/screeningEligibilityService.js, which can write real
 * ScreenDecision rows) and (b) the AI cold-start prior, whose determinism and
 * byte-identical reproducibility are advertised in docs/ai-screening.md. Changing
 * them would silently change governed decisions and persisted AI scores, so the
 * 107.md suggestion rules live HERE, in the suggestion layer only.
 */
import { extractConcepts, expandSynonyms } from './conceptKeywords.js';
import { normalizeKeywordKey } from './keywordNormalize.js';

/** Hard cap per side — 107.md asks for "a small number of high-confidence concepts". */
export const MAX_SUGGESTIONS_PER_SIDE = 12;
/** Curated synonyms are useful for matching but must not flood the review list. */
const MAX_SYNONYMS_PER_CONCEPT = 2;

/**
 * Generic standalone concepts that are meaningless as screening filters (107.md §2).
 * These are blocked ONLY as a whole concept — a multi-word phrase containing one
 * ("randomized controlled trials", "healthy controls") is unaffected.
 * The tail of the list is connector residue: "…undergoing bariatric surgery" leaves
 * a bare "undergoing" behind once the protected phrase is lifted out.
 */
const GENERIC_STANDALONE = new Set([
  'patient', 'patients', 'disease', 'diseases', 'condition', 'conditions',
  'study', 'studies', 'treatment', 'treatments', 'outcome', 'outcomes',
  'population', 'populations', 'participant', 'participants', 'subject', 'subjects',
  'human', 'humans', 'adult', 'adults', 'child', 'children',
  'individual', 'individuals', 'people', 'person', 'persons', 'group', 'groups',
  'intervention', 'interventions', 'exposure', 'exposures', 'measure', 'measures',
  'data', 'result', 'results', 'finding', 'findings', 'research', 'evidence',
  // connector residue left behind by the concept extractor
  'undergoing', 'receiving', 'comparing', 'compared', 'requiring', 'presenting',
  'diagnosed', 'treated', 'combined', 'related', 'associated', 'using', 'based',
]);

/**
 * True negation cues — recognised ANYWHERE in a criterion line, including its start.
 * Everything from the cue to the end of the clause is discarded.
 */
const NEGATION_CUES = [
  'absence of', 'absent', 'lacking', 'lack of', 'free of', 'free from',
  'devoid of', 'negative for', 'other than', 'rather than', 'apart from',
  'aside from', 'exclusive of', 'unconfirmed', 'non-confirmed', 'nonconfirmed',
  'without', 'w/o', 'never', 'unless', 'not', 'no',
];

/**
 * Exclusion verbs. These are the SECTION DIRECTIVE when they open a line
 * ("Exclude studies …", "Excluding pregnant women") — the polarity is already given
 * by which box the text was typed into — but a negation when they appear mid-line
 * ("Adults with epilepsy, excluding pregnant women").
 */
const EXCLUSION_CUES = [
  'except for', 'excluding', 'excludes', 'excluded', 'exclude', 'except',
  'omitting', 'omitted', 'omit',
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const cueAlternation = list => list.map(escapeRe).join('|');
// `w/o` ends in a non-word char, so a trailing \b would never match it.
const NEGATION_RE = new RegExp(`(?:^|[^\\w-])(${cueAlternation(NEGATION_CUES)})(?![\\w-])`, 'i');
const EXCLUSION_RE = new RegExp(`(?:^|[^\\w-])(${cueAlternation(EXCLUSION_CUES)})(?![\\w-])`, 'i');
// Where a negated clause ends and normal criteria text resumes.
const CLAUSE_END_RE = /[,;]|\s+but\s+|\s+however\s+|\s+whereas\s+|\s+although\s+|\s+while\s+/i;

/** Locate the first cue in `text`; a leading exclusion verb is a directive, not a cue. */
function findCue(text, allowLeadingExclusionCue) {
  const hits = [];
  const neg = NEGATION_RE.exec(text);
  if (neg) hits.push({ index: neg.index + neg[0].length - neg[1].length, length: neg[1].length });
  const exc = EXCLUSION_RE.exec(text);
  if (exc) {
    const index = exc.index + exc[0].length - exc[1].length;
    // At the very start of the line (ignoring whitespace) this is the section
    // directive — "Exclude studies …" — not a negation of what follows.
    if (allowLeadingExclusionCue || text.slice(0, index).trim() !== '') {
      hits.push({ index, length: exc[1].length });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[0];
}

/**
 * dropNegatedClauses — remove every negation-governed clause from one criteria line.
 * The clause runs from the cue up to the next clause separator (`,` `;` `but` …) or
 * the end of the line, so "Adults with epilepsy, excluding pregnant women" keeps
 * "Adults with epilepsy" and drops only "pregnant women".
 *
 * @param {string} line
 * @returns {string}
 */
export function dropNegatedClauses(line) {
  let rest = String(line == null ? '' : line);
  let kept = '';
  let first = true;
  for (let guard = 0; guard < 24 && rest; guard += 1) {
    const cue = findCue(rest, !first);
    if (!cue) { kept += rest; break; }
    kept += rest.slice(0, cue.index);
    const after = rest.slice(cue.index + cue.length);
    const end = CLAUSE_END_RE.exec(after);
    first = false;
    if (!end) { rest = ''; break; }
    rest = after.slice(end.index); // keep the separator so fragments stay separated
  }
  return kept;
}

/** Split criteria text into lines, drop bullets, and strip negated clauses. */
function denegateText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, ''))
    .map(dropNegatedClauses)
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
   109.md §§11-13 — the Ops keyword-intelligence knobs.
   ══════════════════════════════════════════════════════════════════════════
   Every option defaults to the value this module shipped with in 107, so
   `suggestCriteriaKeywords(pico)` with no options is byte-identical to v4.13.0.
   The GENERIC blocklist above is never edited in place: additions and removals are
   applied to a COPY per call, which is what makes "Restore system defaults" in Ops
   an honest promise (109.md §13) — clearing the two lists restores the shipped
   behaviour exactly, because the shipped list was never touched. */

/** How a concept found on both sides is handled (109.md §12). */
export const CONFLICT_BEHAVIOR = Object.freeze({
  FLAG: 'flag_for_review',
  OMIT: 'omit_ambiguous',
  PREVENT_DUPLICATE: 'prevent_duplicate_activation',
});

export const SUGGESTION_DEFAULTS = Object.freeze({
  maxSuggestionsPerList: MAX_SUGGESTIONS_PER_SIDE,
  preferPhrases: true,
  allowAmbiguousSingleWords: false,
  conflictBehavior: CONFLICT_BEHAVIOR.FLAG,
  stopListAdditions: [],
  stopListRemovals: [],
});

const asList = (v) => (Array.isArray(v) ? v : []);

/**
 * resolveSuggestionOptions(opts) — clamp/normalise the Ops settings into the shape
 * the pipeline uses. Exported so the bounds are unit-tested directly; mirrors the
 * catalogue's min/max rather than trusting the caller (a stale client could hold a
 * value the server has since re-clamped).
 */
export function resolveSuggestionOptions(opts) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const rawMax = (o.maxSuggestionsPerList == null || o.maxSuggestionsPerList === '')
    ? NaN : Number(o.maxSuggestionsPerList);
  const max = Number.isFinite(rawMax)
    ? Math.min(24, Math.max(1, Math.round(rawMax)))
    : SUGGESTION_DEFAULTS.maxSuggestionsPerList;
  const behavior = Object.values(CONFLICT_BEHAVIOR).includes(o.conflictBehavior)
    ? o.conflictBehavior
    : SUGGESTION_DEFAULTS.conflictBehavior;
  return {
    maxSuggestionsPerList: max,
    preferPhrases: o.preferPhrases !== false,
    allowAmbiguousSingleWords: o.allowAmbiguousSingleWords === true,
    conflictBehavior: behavior,
    stopListAdditions: asList(o.stopListAdditions),
    stopListRemovals: asList(o.stopListRemovals),
  };
}

/**
 * The effective generic blocklist for one call: the shipped set, minus the terms this
 * installation re-allowed, plus the terms it added. Returns the SHARED frozen default
 * set when neither list contributes anything, so the common path allocates nothing.
 */
export function effectiveStopList({ stopListAdditions, stopListRemovals } = {}) {
  const add = asList(stopListAdditions).map(normalizeKeywordKey).filter(Boolean);
  const remove = asList(stopListRemovals).map(normalizeKeywordKey).filter(Boolean);
  if (!add.length && !remove.length) return GENERIC_STANDALONE;
  const next = new Set(GENERIC_STANDALONE);
  for (const t of remove) next.delete(t);
  for (const t of add) next.add(t);
  return next;
}

const EMPTY_STOP_SET = Object.freeze(new Set());

/**
 * 109 r2 review fix — the OPERATOR-ADDED half of the stop list, as its own set.
 *
 * `allowAmbiguousSingleWords` relaxes the blocklist for single-word concepts, and
 * `effectiveStopList` merges the shipped set with `stopListAdditions` into one set,
 * so turning the ambiguity knob on re-admitted every term an admin had explicitly
 * asked to suppress — and since a stop-list addition is almost always a single word,
 * that made `stopListAdditions` a no-op for exactly its own terms. It also
 * disagreed with the synonym route, which kept blocking them (`toTerms` → isGeneric
 * with no relaxation). An explicit admin block now ALWAYS wins: the relaxation is
 * scoped to the shipped GENERIC_STANDALONE set, `stopListRemovals` still re-allows a
 * shipped term outright, and both routes agree again.
 */
export function operatorStopList({ stopListAdditions } = {}) {
  // Additions win over removals here exactly as they do in effectiveStopList (which
  // applies `remove` first, then `add`), so the two never disagree about one term.
  const add = asList(stopListAdditions).map(normalizeKeywordKey).filter(Boolean);
  return add.length ? new Set(add) : EMPTY_STOP_SET;
}

/** A concept is blocked when the WHOLE concept is a generic standalone word. */
function isGeneric(concept, stopList = GENERIC_STANDALONE) {
  return stopList.has(normalizeKeywordKey(concept));
}

/**
 * dropSubsumed — 107.md §2 "prefer `drug-resistant epilepsy` over `epilepsy`".
 * A single-word concept is dropped when a longer concept on the SAME side already
 * contains it as a whole token.
 */
function dropSubsumed(concepts) {
  const tokenSets = concepts.map(c => new Set(normalizeKeywordKey(c).split(' ')));
  return concepts.filter((c, i) => {
    const words = normalizeKeywordKey(c).split(' ').filter(Boolean);
    if (words.length !== 1) return true;
    return !concepts.some((_, j) => j !== i && tokenSets[j].size > 1 && tokenSets[j].has(words[0]));
  });
}

/** Concepts → suggested display terms (concept first, then ≤2 curated synonyms). */
function toTerms(concepts, stopList) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const k = normalizeKeywordKey(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const c of concepts) {
    push(c);
    for (const syn of expandSynonyms(c).slice(0, MAX_SYNONYMS_PER_CONCEPT)) {
      if (!isGeneric(syn, stopList)) push(syn);
    }
  }
  return out;
}

/**
 * One side's suggestion material: the deduped CONCEPTS the reviewer actually wrote,
 * and the display TERMS (those concepts plus ≤2 curated synonyms each). The two are
 * kept apart because cross-polarity conflicts must be judged on the concepts only —
 * see suggestCriteriaKeywords.
 */
function sideSuggestions(text, opts) {
  const stopList = opts.stopList;
  // `allowAmbiguousSingleWords` only relaxes the SINGLE-WORD case (109.md §11's
  // wording): a multi-word phrase was never blocked, and a stop-listed word inside
  // one still is not. `preferPhrases` off keeps the bare concept next to the
  // qualified one instead of dropping it.
  const hardBlocked = opts.operatorStopList || EMPTY_STOP_SET;
  const raw = extractConcepts(denegateText(text)).filter((c) => {
    if (!isGeneric(c, stopList)) return true;
    if (!opts.allowAmbiguousSingleWords) return false;
    // An admin's stopListAdditions entry is never relaxed — see operatorStopList.
    if (hardBlocked.has(normalizeKeywordKey(c))) return false;
    return normalizeKeywordKey(c).split(' ').filter(Boolean).length === 1;
  });
  const concepts = opts.preferPhrases ? dropSubsumed(raw) : raw;
  return { concepts, terms: toTerms(concepts, stopList) };
}

function parseSnapshot(picoSnapshot) {
  let pico = picoSnapshot;
  if (typeof pico === 'string') {
    try { pico = JSON.parse(pico || '{}'); } catch { pico = {}; }
  }
  if (!pico || typeof pico !== 'object') pico = {};
  return pico;
}

/**
 * suggestCriteriaKeywords — derive a small, high-confidence set of suggested
 * screening keywords from a project's eligibility criteria (`pico.incl` /
 * `pico.excl`), with negation handling, a generic-term blocklist, specificity
 * preference and cross-polarity conflict detection.
 *
 * Suggestions are NEVER persisted and never automatically active — they are
 * re-derived on every read so editing the criteria immediately updates them, and
 * the reviewer's accept/reject decisions (ScreenProject.keywordMeta) are the only
 * thing stored.
 *
 * @param {object|string|null} picoSnapshot
 * @returns {{ include: string[], exclude: string[], conflicts: Array<{term:string, reason:string}> }}
 */
export function suggestCriteriaKeywords(picoSnapshot, options) {
  const opts = resolveSuggestionOptions(options);
  opts.stopList = effectiveStopList(opts);
  opts.operatorStopList = operatorStopList(opts);
  const pico = parseSnapshot(picoSnapshot);
  const inc = sideSuggestions(typeof pico.incl === 'string' ? pico.incl : '', opts);
  const exc = sideSuggestions(typeof pico.excl === 'string' ? pico.excl : '', opts);

  // Cross-polarity conflicts: emitted on NEITHER side, flagged for user review.
  //
  // 107.md rec — the intersection is taken over the CONCEPT lists, i.e. what the
  // reviewer literally wrote, NOT the synonym-expanded term lists. Several
  // SYNONYM_FAMILIES group members that are not clinically interchangeable
  // (bariatric surgery / sleeve gastrectomy / gastric bypass), so intersecting the
  // expanded lists reported a conflict on a concept that appears on only ONE side —
  // "Adults undergoing bariatric surgery" vs "Revision after sleeve gastrectomy"
  // dropped the verbatim inclusion concept and surfaced 'metabolic surgery', a
  // phrase in neither criterion, under "Appears in both inclusion and exclusion".
  const includeConceptKeys = new Set(inc.concepts.map(normalizeKeywordKey));
  const excludeConceptKeys = new Set(exc.concepts.map(normalizeKeywordKey));
  const conflictKeys = new Set([...includeConceptKeys].filter(k => excludeConceptKeys.has(k)));

  // 109.md §12 — `keywords.conflictBehavior`. There is deliberately no option that
  // silently activates an ambiguous term on both sides; the three legal values only
  // choose HOW the ambiguity is surfaced:
  //   flag_for_review (default)      — off both sides, reported for arbitration.
  //   omit_ambiguous                 — off both sides, reported to nobody.
  //   prevent_duplicate_activation   — offered on both sides as a SUGGESTION, still
  //                                    reported; the "not in both at once" rule is
  //                                    enforced where activation happens (the
  //                                    cross-list prompt in ScreeningTab and the
  //                                    server's keyword reducer), not here.
  const behavior = opts.conflictBehavior;
  const conflicts = [];
  if (behavior !== CONFLICT_BEHAVIOR.OMIT) {
    for (const term of inc.concepts) {
      if (!conflictKeys.has(normalizeKeywordKey(term))) continue;
      conflicts.push({
        term,
        reason: 'Appears in both inclusion and exclusion criteria — the polarity is ambiguous.',
      });
    }
  }

  // The expanded term lists are still filtered by those keys, so a genuinely
  // ambiguous concept stays off both sides along with its synonyms. A term that
  // reaches both sides ONLY through synonym expansion carries no authored polarity
  // and is not worth an arbitration card, but it must not be offered as a pending
  // suggestion on both sides at once either: keep it where the reviewer actually
  // wrote it as a concept, drop it where it is merely a synonym (and from both when
  // it is a concept on neither).
  const incTermKeys = new Set(inc.terms.map(normalizeKeywordKey));
  const excTermKeys = new Set(exc.terms.map(normalizeKeywordKey));
  const keepConflicts = behavior === CONFLICT_BEHAVIOR.PREVENT_DUPLICATE;
  const trim = (list, ownConcepts) => list
    .filter((t) => {
      const k = normalizeKeywordKey(t);
      if (!keepConflicts && conflictKeys.has(k)) return false;
      if (!incTermKeys.has(k) || !excTermKeys.has(k)) return true;
      return keepConflicts ? true : ownConcepts.has(k);
    })
    .slice(0, opts.maxSuggestionsPerList);

  return {
    include: trim(inc.terms, includeConceptKeys),
    exclude: trim(exc.terms, excludeConceptKeys),
    conflicts,
  };
}
