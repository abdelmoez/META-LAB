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

/** A concept is blocked when the WHOLE concept is a generic standalone word. */
function isGeneric(concept) {
  return GENERIC_STANDALONE.has(normalizeKeywordKey(concept));
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
function toTerms(concepts) {
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
      if (!isGeneric(syn)) push(syn);
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
function sideSuggestions(text) {
  const concepts = dropSubsumed(extractConcepts(denegateText(text)).filter(c => !isGeneric(c)));
  return { concepts, terms: toTerms(concepts) };
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
export function suggestCriteriaKeywords(picoSnapshot) {
  const pico = parseSnapshot(picoSnapshot);
  const inc = sideSuggestions(typeof pico.incl === 'string' ? pico.incl : '');
  const exc = sideSuggestions(typeof pico.excl === 'string' ? pico.excl : '');

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

  const conflicts = [];
  for (const term of inc.concepts) {
    if (!conflictKeys.has(normalizeKeywordKey(term))) continue;
    conflicts.push({
      term,
      reason: 'Appears in both inclusion and exclusion criteria — the polarity is ambiguous.',
    });
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
  const trim = (list, ownConcepts) => list
    .filter((t) => {
      const k = normalizeKeywordKey(t);
      if (conflictKeys.has(k)) return false;
      if (!incTermKeys.has(k) || !excTermKeys.has(k)) return true;
      return ownConcepts.has(k);
    })
    .slice(0, MAX_SUGGESTIONS_PER_SIDE);

  return {
    include: trim(inc.terms, includeConceptKeys),
    exclude: trim(exc.terms, excludeConceptKeys),
    conflicts,
  };
}
