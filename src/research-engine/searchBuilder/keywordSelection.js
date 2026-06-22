/**
 * keywordSelection.js — SB3 Tab 1 ("Select Keywords"). Pure, network-free.
 *
 * Turns a research-question / PICO-field string into an ordered list of tokens the
 * UI renders as clickable chips, so a beginner can literally CLICK the important
 * ideas in their own question and have them become search terms:
 *
 *   tokenizeForSelection("In adults with obesity, do GLP-1 receptor agonists …")
 *     → [ {text:"In", kind:"filler", selectable:false},
 *         {text:"adults", kind:"word", selectable:true},
 *         {text:"with", kind:"filler", selectable:false},
 *         {text:"obesity", kind:"word", selectable:true, suggested:true}, … ]
 *
 * Rules (from the SB3 spec):
 *  - meaningful multi-word phrases stay whole ("quality of life", "heart failure
 *    with reduced ejection fraction") instead of being split into clickable words;
 *  - connector / filler words (and, or, with, of, versus, compared, …) are NOT
 *    selectable by default — but the UI's manual "add keyword" box can still force
 *    any text in;
 *  - clinically meaningful content words (e.g. "adults", "obesity") REMAIN
 *    selectable — we deliberately do NOT reuse the medical JUNK_WORDS descriptor
 *    list here, because the spec's own example selects "adults" as a keyword;
 *  - tokens that match the medical vocabulary are flagged `suggested` so the UI can
 *    pre-highlight them (helpful, not forced — the user still accepts/removes them).
 *
 * Deterministic + exported for unit tests. Reuses the shared vocabulary in
 * medicalSynonyms.js / screening keywords so the word lists live in one place.
 */
import { CONCEPT_FAMILIES } from './medicalSynonyms.js';
import { STOPWORDS } from '../screening/keywords.js';

/** Lowercase, strip wrapping punctuation/quotes, collapse whitespace. Keeps hyphens. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[“”"'’.,;:!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Connector / filler words that carry no search signal on their own. This is the
   spec's explicit list (articles, prepositions, conjunctions, comparison words) —
   intentionally NOT the whole medical JUNK_WORDS set, so content words like "adults"
   and "children" stay selectable. STOPWORDS supplies the long grammatical tail. */
const EXPLICIT_FILLER = [
  'and', 'or', 'if', 'the', 'a', 'an', 'of', 'with', 'without', 'in', 'on', 'at',
  'to', 'from', 'by', 'for', 'as', 'is', 'are', 'do', 'does', 'be', 'been',
  'versus', 'vs', 'vs.', 'compared', 'comparison', 'among', 'between', 'than',
  'after', 'before', 'during', 'per', 'via', 'into', 'onto', 'upon',
];

/* SB4 — vague verbs / adverbs / qualifiers and population-noise nouns that are not
   useful standalone search keywords (the SB4 spec's "do not suggest" list). These
   are dropped from Step-1 suggestions UNLESS the user forces them via the manual box.
   Deliberately curated (explicit words, not a broad "-ly adverb" rule) so real terms
   are never dimmed. "adults"/"children"/"men"/"women"/"elderly" are NOT here — those
   stay selectable. Multi-word phrases are matched first, so a vague word that is part
   of a real phrase (e.g. "treatment discontinuation") is preserved. */
const NOISE_WORDS = [
  // vague verbs (standalone)
  'underwent', 'undergoing', 'undergo', 'undergoes',
  'received', 'receiving', 'receive', 'receives',
  'including', 'included', 'include', 'includes',
  'using', 'used', 'use', 'uses', 'grouped', 'grouping',
  'treated', 'given', 'followed', 'following', 'performed', 'conducted',
  'assessed', 'evaluated', 'measured', 'reported', 'defined', 'considered',
  'analysed', 'analyzed', 'observed', 'investigated', 'examined',
  // vague adverbs / qualifiers
  'across', 'possibly', 'appropriately', 'approximately', 'respectively',
  'generally', 'typically', 'usually', 'mainly', 'mostly', 'particularly',
  'specifically', 'overall', 'however', 'therefore', 'thus', 'also', 'either',
  'both', 'each', 'any', 'all', 'such', 'various', 'several', 'many', 'more',
  // population-noise nouns. SB5 explicitly rejects "adults"/"patients" when alone, so
  // (unlike SB3/SB4) generic age/population nouns are dropped here too — a real disease
  // population is a condition phrase ("type 2 diabetes"), never the bare word "adults".
  'patient', 'patients', 'subject', 'subjects', 'individual', 'individuals',
  'participant', 'participants', 'people', 'person', 'persons', 'population',
  'cohort', 'cases', 'case', 'adult', 'adults', 'child', 'children', 'ill',
  // SB5 — weak clinical qualifiers that carry no search signal alone (real disease
  // names that contain them are matched as phrases first, so e.g. "early gastric
  // cancer" still yields "gastric cancer"). Deliberately conservative: clinically
  // loaded modifiers like acute/chronic/metastatic/refractory are NOT here.
  'failed', 'unsuccessful', 'suspected', 'confirmed', 'early', 'late',
  'severe', 'moderate', 'mild', 'resistant', 'critically',
];

export const FILLER_WORDS = new Set([
  ...EXPLICIT_FILLER,
  ...NOISE_WORDS,
  ...Array.from(STOPWORDS || []),
]);

/** A connector / filler / vague word that should not be auto-selectable (but can be
 *  forced via the manual "add keyword" box). */
export function isFillerWord(word) {
  const n = norm(word);
  if (!n) return true;
  if (n.length < 2 && !/[0-9]/.test(n)) return true; // stray single letters (keep 2-letter acronyms: AF, MI, HF, UC)
  return FILLER_WORDS.has(n);
}

/* Meaningful multi-word phrases that must stay whole. Curated list + every
   multi-word trigger/term already known to the concept-family vocabulary, so the
   medical phrases live in one place. Normalized, deduped, longest-first at use. */
const CURATED_PHRASES = [
  'quality of life', 'standard of care', 'body mass index',
  'heart failure with reduced ejection fraction',
  'heart failure with preserved ejection fraction',
  'randomized controlled trial', 'randomised controlled trial',
  'all-cause mortality', 'blood pressure', 'weight loss', 'adverse events',
  'length of stay', 'glycated hemoglobin', 'glycated haemoglobin',
  // SB4 — biliary / endoscopy domain + common outcome phrases the spec calls out.
  'endoscopic ultrasound', 'endoscopic ultrasonography',
  'malignant biliary obstruction', 'biliary obstruction', 'bile duct obstruction',
  'biliary drainage', 'eus-guided biliary drainage',
  'eus-guided antegrade biliary drainage', 'eus-guided transpapillary biliary drainage',
  'transpapillary biliary drainage', 'transluminal biliary drainage',
  'eus-guided transluminal biliary drainage', 'failed ercp',
  'treatment discontinuation', 'technical success', 'clinical success',
  'stent dysfunction', 'gastroesophageal reflux disease',
  'glp-1 receptor agonist', 'glp-1 receptor agonists',
];

function buildPhraseSet() {
  const set = new Set(CURATED_PHRASES.map(norm));
  for (const fam of CONCEPT_FAMILIES || []) {
    for (const t of [...(fam.triggers || []), ...(fam.terms || [])]) {
      const n = norm(t);
      if (n && n.includes(' ')) set.add(n);
    }
  }
  return set;
}
const PHRASE_SET = buildPhraseSet();

/* Norms the medical vocabulary recognizes (single words + phrases) → drives the
   `suggested` flag so the UI can pre-highlight likely keywords. */
function buildSuggestedSet() {
  const set = new Set();
  for (const fam of CONCEPT_FAMILIES || []) {
    for (const t of [...(fam.triggers || []), ...(fam.terms || [])]) {
      const n = norm(t);
      if (n) set.add(n);
    }
  }
  return set;
}
const SUGGESTED_SET = buildSuggestedSet();

/** Every phrase (normalized) detected in `text`, longest-match-first, no overlaps. */
export function extractPhrases(text) {
  return tokenizeForSelection(text)
    .filter((tok) => tok.kind === 'phrase')
    .map((tok) => tok.norm);
}

/**
 * tokenizeForSelection(text) → ordered token array describing how to render the
 * field for click-to-select. Each token:
 *   { text, norm, kind:'phrase'|'word'|'filler', selectable:boolean, suggested:boolean }
 *
 * Phrases (from the medical phrase set) are matched greedily longest-first and emit
 * a single selectable token; remaining single words are 'word' (selectable) unless
 * they are filler/connectors ('filler', not selectable). Pure + deterministic.
 */
/** Trim wrapping punctuation from a display word (keeps internal hyphens/digits). */
function cleanWord(w) {
  const c = String(w || '').replace(/^[^\w-]+|[^\w-]+$/g, '');
  return c || String(w || '');
}

export function tokenizeForSelection(text) {
  const raw = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!raw.length) return [];
  const cleaned = raw.map(cleanWord);
  const normWords = raw.map((w) => norm(w));
  const maxPhraseLen = 6;
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    // Try the longest phrase starting here (word-boundary aligned).
    let matched = null;
    for (let len = Math.min(maxPhraseLen, raw.length - i); len >= 2; len--) {
      const candidate = normWords.slice(i, i + len).filter(Boolean).join(' ');
      if (candidate && PHRASE_SET.has(candidate)) { matched = { len, candidate }; break; }
    }
    if (matched) {
      tokens.push({
        text: cleaned.slice(i, i + matched.len).join(' '),
        norm: matched.candidate,
        kind: 'phrase',
        selectable: true,
        suggested: true,
      });
      i += matched.len;
      continue;
    }
    const n = normWords[i];
    const filler = isFillerWord(raw[i]);
    tokens.push({
      text: cleaned[i],
      norm: n,
      kind: filler ? 'filler' : 'word',
      selectable: !filler && !!n,
      suggested: !filler && SUGGESTED_SET.has(n),
    });
    i += 1;
  }
  return tokens;
}

/** The selectable keywords (words + phrases) auto-suggested from a field, deduped
 *  by normalized text, in reading order. Helpful pre-highlight set for the UI. */
export function suggestedKeywords(text) {
  const seen = new Set();
  const out = [];
  for (const tok of tokenizeForSelection(text)) {
    if (!tok.selectable || !tok.suggested) continue;
    if (seen.has(tok.norm)) continue;
    seen.add(tok.norm);
    out.push(tok.text);
  }
  return out;
}
