/**
 * features/manuscript/writingAssistant/engine/rules/ruleUtils.js — 120.md §6.
 *
 * Shared vocabulary and helpers for the rule passes. Every rule in this directory is
 * a PURE function `(ctx) => issue[]` carrying its own ruleId, so it can be tested in
 * isolation and muted individually ("Ignore this rule in the current manuscript").
 *
 * The closed word lists below are the reason the grammar rules can be honest about
 * their confidence. 120.md §6 is explicit — "Do not treat subjective style
 * suggestions as definite grammatical errors" — so a rule that cannot prove its case
 * with a closed class either declines to fire or fires as a low-confidence
 * 'suggestion'. There is no part-of-speech tagger here and pretending otherwise
 * would produce exactly the false positives §6 spends a page warning about.
 */

import { TOKEN } from '../tokenize.js';
import { makeIssue, SEVERITY, SOURCE } from '../issueModel.js';

/* -------------------------------------------------------------- vocabulary --- */

/** Auxiliaries, copulas and modals — the only verbs the rules can name with certainty. */
export const FINITE_VERBS = new Set([
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'has', 'have', 'had', 'having',
  'do', 'does', 'did', 'done',
  'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must',
  'remains', 'remain', 'remained', 'seems', 'seem', 'seemed', 'appears', 'appear',
  'shows', 'show', 'showed', 'shown', 'includes', 'include', 'included',
  'reports', 'report', 'reported', 'suggests', 'suggest', 'suggested',
  'found', 'finds', 'find', 'used', 'uses', 'use', 'made', 'makes', 'make',
  'became', 'becomes', 'become', 'gets', 'get', 'got',
]);

/** Singular present/past verb forms with their plural counterparts. */
export const SINGULAR_TO_PLURAL_VERB = Object.freeze({
  was: 'were', is: 'are', has: 'have', does: 'do',
  seems: 'seem', appears: 'appear', shows: 'show', includes: 'include',
  remains: 'remain', reports: 'report', suggests: 'suggest', indicates: 'indicate',
  demonstrates: 'demonstrate', provides: 'provide', supports: 'support',
  reveals: 'reveal', varies: 'vary', differs: 'differ', consists: 'consist',
});

/** Plural verb forms with their singular counterparts (for the reverse mismatch). */
export const PLURAL_TO_SINGULAR_VERB = Object.freeze({
  were: 'was', are: 'is', have: 'has', do: 'does',
});

/** Determiners that can head a plural noun phrase. */
export const PLURAL_DETERMINERS = new Set([
  'the', 'these', 'those', 'both', 'several', 'many', 'few', 'all', 'most', 'some',
  'various', 'numerous', 'multiple', 'other', 'such', 'certain', 'our', 'their',
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand',
]);

/** Determiners that force a singular head noun. */
export const SINGULAR_DETERMINERS = new Set([
  'this', 'that', 'each', 'every', 'a', 'an', 'one', 'another', 'either', 'neither',
]);

/** Pronouns that take a plural verb. */
export const PLURAL_PRONOUNS = new Set(['we', 'they', 'these', 'those', 'both', 'you']);

/**
 * Nouns that END IN `s` but are SINGULAR (or invariant). Without this list every
 * "The analysis was…" and "The consensus was…" would be reported as a subject–verb
 * disagreement, which is the classic naive-checker failure §6 warns about.
 */
export const SINGULAR_S_NOUNS = new Set([
  'analysis', 'basis', 'bias', 'crisis', 'diagnosis', 'prognosis', 'thesis',
  'hypothesis', 'synthesis', 'emphasis', 'paralysis', 'metastasis', 'stasis',
  'apparatus', 'status', 'census', 'consensus', 'campus', 'corpus', 'focus',
  'virus', 'sinus', 'fetus', 'foetus', 'uterus', 'thrombus', 'bolus', 'locus',
  'nucleus', 'radius', 'stimulus', 'meniscus', 'oesophagus', 'esophagus',
  'series', 'species', 'facies', 'scabies', 'rabies', 'ascites', 'herpes', 'means',
  'news', 'ethics', 'physics', 'mathematics', 'statistics', 'genetics', 'economics',
  'pediatrics', 'paediatrics', 'obstetrics', 'orthopedics', 'orthopaedics',
  'diabetes', 'measles', 'mumps', 'shingles', 'gas', 'alias', 'atlas', 'pancreas',
  'canvas', 'lens', 'access', 'process', 'progress', 'success', 'address', 'stress',
  'this', 'his', 'its', 'us', 'thus', 'plus', 'versus', 'vs', 'yes', 'less', 'was',
  'has', 'is', 'does', 'as', 'perhaps', 'always', 'sometimes', 'across', 'unless',
  'whereas', 'nevertheless',
]);

/** Plurals that do not end in `s`. */
export const IRREGULAR_PLURALS = new Set([
  'data', 'criteria', 'phenomena', 'media', 'bacteria', 'mitochondria', 'strata',
  'foci', 'loci', 'nuclei', 'stimuli', 'radii', 'fungi', 'bronchi', 'emboli',
  'indices', 'matrices', 'appendices', 'vertices', 'apices', 'cortices',
  'children', 'men', 'women', 'people', 'mice', 'feet', 'teeth', 'geese',
  'analyses', 'diagnoses', 'prognoses', 'hypotheses', 'syntheses', 'metastases',
  'sera', 'ova', 'septa', 'genera', 'viscera',
]);

/** Coordinating conjunctions — a comma before one of these is not a comma splice. */
export const COORDINATORS = new Set(['and', 'but', 'or', 'nor', 'for', 'so', 'yet']);

/** Subordinators/relatives that make the following clause dependent. */
export const SUBORDINATORS = new Set([
  'which', 'who', 'whom', 'whose', 'that', 'where', 'when', 'while', 'whereas',
  'although', 'though', 'because', 'since', 'if', 'unless', 'until', 'after',
  'before', 'as', 'whether', 'given', 'once', 'whenever', 'wherever',
]);

/** Subjects that make a comma splice recognisable without a parser. */
export const SPLICE_SUBJECTS = new Set([
  'we', 'it', 'they', 'this', 'these', 'those', 'there', 'he', 'she', 'i', 'one',
]);

/**
 * Words that open an INTRODUCTORY phrase rather than an independent clause. A comma
 * after one of these is standard punctuation, not a splice: "Compared with placebo,
 * we found…", "In these patients, we observed…", "Although the effect was small, it
 * was significant." Without this list the run-on rule fires on half the sentences in
 * a Results section.
 */
export const LEADING_ADJUNCTS = new Set([
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'to', 'of', 'after', 'before',
  'during', 'among', 'between', 'across', 'within', 'without', 'unlike', 'despite',
  'compared', 'given', 'based', 'using', 'following', 'according', 'regarding',
  'although', 'though', 'while', 'whereas', 'since', 'because', 'if', 'when',
  'as', 'once', 'unless', 'until', 'whether', 'overall', 'additionally',
  'moreover', 'furthermore', 'however', 'therefore', 'thus', 'hence', 'first',
  'firstly', 'second', 'secondly', 'third', 'finally', 'notably', 'importantly',
  'interestingly', 'similarly', 'conversely', 'specifically', 'briefly',
  'initially', 'subsequently', 'ultimately', 'together', 'taken', 'consequently',
  'nevertheless', 'nonetheless', 'accordingly', 'meanwhile', 'instead', 'indeed',
]);

/** Words legitimately starting a sentence in lower case in scientific prose. */
export const LOWERCASE_SENTENCE_STARTS = new Set([
  'ph', 'mrna', 'trna', 'rrna', 'sirna', 'mirna', 'cdna', 'ipsc', 'mab', 'egfr',
  'p', 'n', 'r', 'k', 'e.g', 'i.e', 'von', 'van', 'de', 'del', 'della', 'da', 'di',
  'al', 'et', 'alpha', 'beta', 'gamma', 'delta', 'kappa', 'tau', 'chi',
]);

/** Acronyms conventionally read as words, which changes a/an selection. */
export const WORD_ACRONYMS = new Set([
  'NATO', 'NASA', 'NICE', 'UNICEF', 'UNESCO', 'AIDS', 'SARS', 'MERS', 'COVID',
  'RAND', 'SCOWL', 'GRADE', 'PRISMA', 'PROSPERO', 'MOOSE', 'CONSORT', 'STROBE',
  'CARE', 'SPIRIT', 'STARD', 'TRIPOD', 'ROBIS', 'QUADAS', 'CASP', 'SIGN',
]);

/** Letters whose SPOKEN NAME starts with a vowel sound (so the article is "an"). */
export const VOWEL_SOUNDING_LETTERS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);

/** Words starting with a written vowel but a consonant /j/ or /w/ sound → "a". */
const CONSONANT_SOUND_VOWEL_START = /^(?:uni(?!nt)|use|usu|util|utili|ubiq|uran|urin|urol|ureth|uro|euro|eu|ufo|one|onc)/i;
/** Words starting with a silent `h` → "an". */
const VOWEL_SOUND_H_START = /^(?:hour|honest|honou?r|heir|homage)/i;

/* ----------------------------------------------------------------- helpers --- */

/** Is the word shaped like a plural noun? Conservative — see SINGULAR_S_NOUNS. */
export function looksPlural(word) {
  const w = String(word || '').toLowerCase();
  if (!w) return false;
  if (IRREGULAR_PLURALS.has(w)) return true;
  if (SINGULAR_S_NOUNS.has(w)) return false;
  if (!w.endsWith('s')) return false;
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return false;
  if (w.length < 4) return false;
  return true;
}

/** Is the word shaped like a singular noun? (Not merely "not plural".) */
export function looksSingular(word) {
  const w = String(word || '').toLowerCase();
  if (!w || w.length < 3) return false;
  if (IRREGULAR_PLURALS.has(w)) return false;
  if (SINGULAR_S_NOUNS.has(w)) return true;
  return !w.endsWith('s');
}

/** Does the article before this word have to be "an"? */
export function startsWithVowelSound(word) {
  const w = String(word || '');
  if (!w) return false;
  if (VOWEL_SOUND_H_START.test(w)) return true;
  if (CONSONANT_SOUND_VOWEL_START.test(w)) return false;
  return /^[aeiou]/i.test(w);
}

/** Article selection for an acronym, from how the acronym is normally spoken. */
export function acronymTakesAn(acronym) {
  const a = String(acronym || '');
  if (!a) return false;
  if (WORD_ACRONYMS.has(a)) return startsWithVowelSound(a);
  return VOWEL_SOUNDING_LETTERS.has(a[0]);
}

/** Tokens that carry lexical content (the rules ignore spacing and punctuation). */
export const LEXICAL_KINDS = new Set([
  TOKEN.WORD, TOKEN.ACRONYM, TOKEN.GENE, TOKEN.CHEMICAL, TOKEN.NUMBER,
  TOKEN.UNIT, TOKEN.STAT, TOKEN.IDENTIFIER, TOKEN.PLACEHOLDER, TOKEN.RANGE,
  TOKEN.URL, TOKEN.EMAIL, TOKEN.FILENAME, TOKEN.VERSION, TOKEN.GREEK,
]);

export function lexicalTokens(tokens) {
  return tokens.filter((t) => LEXICAL_KINDS.has(t.kind));
}

/** Only whitespace between two tokens? (No comma, no bracket, no dash.) */
export function adjacent(text, a, b) {
  if (!a || !b) return false;
  return /^[\s ]*$/.test(text.slice(a.end, b.start));
}

/** Lowercased token text, for the closed-class lookups. */
export const lower = (token) => (token ? token.text.toLowerCase() : '');

/**
 * A per-character mask of "this is ordinary prose". Punctuation rules consult it so
 * they never fire inside a DOI, a URL, a unit expression or a statistic — the same
 * firewall the spelling pass gets, applied to the regex-shaped rules.
 */
export function buildProseMask(text, tokens) {
  const mask = new Uint8Array(text.length).fill(1);
  for (const token of tokens) {
    if (token.kind === TOKEN.WORD || token.kind === TOKEN.ACRONYM) continue;
    if (LEXICAL_KINDS.has(token.kind) || token.kind === TOKEN.PLACEHOLDER
        || token.kind === TOKEN.SUPERSCRIPT) {
      if (token.kind === TOKEN.NUMBER) continue;
      for (let i = token.start; i < token.end; i += 1) mask[i] = 0;
    }
  }
  return mask;
}

/** Is every character of [start,end) ordinary prose? */
export function isProse(mask, start, end) {
  for (let i = start; i < end && i < mask.length; i += 1) if (!mask[i]) return false;
  return true;
}

/**
 * Does the sentence contain something that could be a finite verb? Used only to
 * SUPPRESS the fragment and run-on rules, so it is deliberately over-generous:
 * a false "yes" costs a missed fragment, a false "no" costs a false positive.
 */
export function hasVerbEvidence(tokens) {
  for (const token of tokens) {
    if (token.kind !== TOKEN.WORD) continue;
    const w = token.text.toLowerCase();
    if (FINITE_VERBS.has(w)) return true;
    if (w.length >= 4 && (w.endsWith('ed') || w.endsWith('ing'))) return true;
    // A word ending in -s MIGHT be a third-person verb ("reports", "shows") or a
    // plural noun; since this predicate only ever SUPPRESSES a rule, ambiguity is
    // resolved generously. The exclusions are the function words and singular-s
    // nouns that are never verbs — "this", "consensus", "analysis".
    if (w.length >= 4 && w.endsWith('s') && !SINGULAR_S_NOUNS.has(w)) return true;
  }
  return false;
}

/**
 * The STRICT verb test used by the run-on rule: only an auxiliary/copula or a clear
 * -ed/-ing form counts. "In these patients," must not read as a clause just because
 * "patients" ends in an s.
 */
export function hasClauseVerb(tokens) {
  for (const token of tokens) {
    if (token.kind !== TOKEN.WORD) continue;
    const w = token.text.toLowerCase();
    if (FINITE_VERBS.has(w)) return true;
    if (w.length >= 5 && (w.endsWith('ed') || w.endsWith('ing'))) return true;
  }
  return false;
}

/** Build an issue with the block coordinates already filled in from the context. */
export function emit(ctx, {
  start, end, category, ruleId, message, explanation = '', suggestions = [],
  severity = SEVERITY.SUGGESTION, confidence = 0.5, source = SOURCE.RULE, meta = null,
}) {
  return makeIssue({
    docId: ctx.docId,
    sectionId: ctx.sectionId,
    blockIndex: ctx.blockIndex,
    blockRev: ctx.blockRev,
    start,
    end,
    original: ctx.text.slice(start, end),
    category,
    severity,
    confidence,
    message,
    explanation,
    suggestions,
    ruleId,
    source,
    createdAt: ctx.createdAt || 0,
    meta,
  });
}

/** Block kinds where prose-shaped rules do not apply (mirrors blocks.js SKIPPED_KINDS). */
export const NON_PROSE_BLOCKS = new Set([
  'separator', 'code', 'reference-entry', 'numeric-cell', 'blank',
]);

/**
 * Block kinds that are not full sentences, so sentence-shaped rules (capitalization,
 * fragment, run-on, repeated opener) stay quiet. `table-row` is here for a concrete
 * reason: a row of "| Smith 2020 | 120 | remission |" is eight "sentences" starting
 * with the same surname, and without this the repetition rule reports every table.
 */
export const SENTENCE_EXEMPT_BLOCKS = new Set([
  'heading', 'caption-title', 'table-row', 'table-cell', 'list-item', 'title',
  'separator', 'code', 'reference-entry', 'numeric-cell', 'blank',
]);
