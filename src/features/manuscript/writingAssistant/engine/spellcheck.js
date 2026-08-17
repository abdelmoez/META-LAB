/**
 * features/manuscript/writingAssistant/engine/spellcheck.js — 120.md §6.
 *
 * The base-dictionary layer. §6: "Use a comprehensive English lexicon rather than a
 * small hand-maintained word list" — so this wraps a real Hunspell engine (nspell)
 * over the SCOWL-derived en-US / en-GB dictionaries.
 *
 * LICENSING (verified before install, 120.md §6 "Licensing" selection criterion):
 *   nspell           2.1.5  MIT                    (Titus Wormer)
 *   dictionary-en    4.0.0  (MIT AND BSD)          SCOWL / Kevin Atkinson en_US
 *   dictionary-en-gb 3.0.0  (MIT AND BSD)          SCOWL / Marco A.G.Pinto en_GB
 * All three are permissive and redistributable; the BSD half is the SCOWL word-list
 * notice, which requires the copyright notice to travel with the data — it does,
 * inside the installed package. No typo-js fallback was needed.
 *
 * PRIVACY (§6): everything here runs locally, in the browser, inside a Web Worker.
 * No manuscript text is ever sent anywhere — there is no network call in this module
 * or anything it imports. The dictionaries are bundled assets, not a service.
 *
 * This module stays PURE in the sense that matters: it takes dictionary BYTES as
 * input and never touches fs, network or DOM, so Node tests feed it the same buffers
 * the worker fetches.
 */

import nspellFactory from 'nspell';
import {
  isMedicalTerm, nearestTerms, personalDictionaryWords, LEXICON_VERSION,
} from './medicalLexicon.js';

export const VARIANT = Object.freeze({ US: 'en-US', GB: 'en-GB' });
export const DEFAULT_VARIANT = VARIANT.US;

/** Normalize whatever the preference layer stored into one of the two variants. */
export function normalizeVariant(value) {
  const v = String(value || '').toLowerCase().replace('_', '-');
  if (v === 'en-gb' || v === 'gb' || v === 'uk' || v === 'en-uk') return VARIANT.GB;
  return VARIANT.US;
}

/* ------------------------------------------------------- US ⇄ UK bridge ------ */

/**
 * 120.md §6 — "The selected English variant should guide recommendations without
 * marking the other variant as nonsensical."
 *
 * DEVIATION FROM THE BRIEF, deliberate: the brief suggested loading BOTH dictionaries
 * so the other variant could be recognised. Two nspell instances cost ~2× the parse
 * time and ~2× the memory (measured: ~250 ms and ~25 MB each) for a job a compact
 * transform table does better. The bridge generates the counterpart spelling and asks
 * the ALREADY-LOADED dictionary about it — so a hit is proof the word is the other
 * variant of a real word, and a miss leaves it a genuine spelling error. It also
 * yields the exact replacement to offer, which a second dictionary would not.
 *
 * The second dictionary is still supported (`secondary` in `createSpellChecker`) for
 * callers that want it; the worker leaves it off by default.
 *
 * 120.md r2 — WHAT A RULE IS ALLOWED TO BE. A transform here is applied to an
 * ARBITRARY unknown word and a dictionary hit is then treated as proof that the word
 * is the other English variant, so a rule whose left side is not a variant-specific
 * MORPHEME silently accepts whole classes of real typos. The r2 review proved
 * exactly that for five of them: `[/re\b/,'er']` accepted `othre`, `papre`, `numbre`,
 * `chaptre`, `considre`; `[/ense\b/,'ence']` accepted `evidense`, `sciense`,
 * `prevalense`; `[/lled\b/,'led']` accepted `controled` and `enroled` (misspellings
 * in BOTH variants); `[/lling/,'ling']` accepted `samplling`. Every one produced no
 * underline at all, because the host always sends `flagOtherVariant:false`.
 *
 * The five generic stem rules are therefore GONE. `-re`/`-ense` and the `-ll-`
 * doubling family are closed sets in real English, so they are enumerated in
 * VARIANT_PAIRS (and, for the doubling verbs, generated from a stem list) instead —
 * the same doctrine consistency.js's IZE_VERBS already follows. What survives here
 * is only what a misspelling cannot plausibly imitate: -ize/-ise, -yze/-yse, -our/-or,
 * -ogue/-og and the ae/oe medical family.
 */
const VARIANT_RULES = [
  [/ization\b/, 'isation'], [/isation\b/, 'ization'],
  [/izations\b/, 'isations'], [/isations\b/, 'izations'],
  [/ize\b/, 'ise'], [/ise\b/, 'ize'],
  [/ized\b/, 'ised'], [/ised\b/, 'ized'],
  [/izes\b/, 'ises'], [/ises\b/, 'izes'],
  [/izing\b/, 'ising'], [/ising\b/, 'izing'],
  [/yze\b/, 'yse'], [/yse\b/, 'yze'],
  [/yzed\b/, 'ysed'], [/ysed\b/, 'yzed'],
  [/yzing\b/, 'ysing'], [/ysing\b/, 'yzing'],
  [/our\b/, 'or'], [/or\b/, 'our'],
  [/ours\b/, 'ors'], [/ors\b/, 'ours'],
  [/oured\b/, 'ored'], [/ored\b/, 'oured'],
  [/ogue\b/, 'og'], [/og\b/, 'ogue'],
  [/ogues\b/, 'ogs'], [/ogs\b/, 'ogues'],
  [/^ae/, 'e'], [/ae/, 'e'], [/oe/, 'e'],
  [/^e/, 'ae'],
  [/haem/, 'hem'], [/hem/, 'haem'],
  [/paed/, 'ped'], [/ped/, 'paed'],
  [/oedem/, 'edem'], [/edem/, 'oedem'],
  [/oesoph/, 'esoph'], [/esoph/, 'oesoph'],
  [/aemia\b/, 'emia'], [/emia\b/, 'aemia'],
  [/aemic\b/, 'emic'], [/emic\b/, 'aemic'],
  [/llment\b/, 'lment'], [/lment\b/, 'llment'],
  [/lfil\b/, 'lfill'], [/lfill\b/, 'lfil'],
];

/**
 * 120.md r2 — the `-l` DOUBLING verbs, enumerated because the rule cannot be.
 *
 * British English doubles a final `l` before `-ed`/`-ing` when the last syllable is
 * UNSTRESSED (travel → travelled), American English does not. Verbs whose last
 * syllable is stressed (control, enrol, patrol, fulfil, propel) double in BOTH
 * variants, which is why the old `[/lled\b/,'led']` rule was pure damage: it turned
 * `controled` — a misspelling on both sides of the Atlantic — into an accepted word.
 * Only unstressed-final-syllable stems belong below.
 */
const L_DOUBLING_STEMS = [
  'travel', 'label', 'model', 'cancel', 'counsel', 'signal', 'total', 'level',
  'dial', 'marvel', 'quarrel', 'channel', 'funnel', 'tunnel', 'panel', 'fuel',
  'refuel', 'equal', 'rival', 'pedal', 'spiral', 'revel', 'shovel', 'libel',
  'unravel', 'grovel', 'initial', 'parcel', 'jewel', 'duel', 'stencil',
];

/** Pairs the regex rules cannot reach; both directions are generated automatically. */
const VARIANT_PAIRS = [
  ['program', 'programme'], ['aluminum', 'aluminium'], ['sulfur', 'sulphur'],
  ['sulfate', 'sulphate'], ['sulfide', 'sulphide'], ['gray', 'grey'],
  ['fetal', 'foetal'], ['fetus', 'foetus'], ['celiac', 'coeliac'],
  ['diarrhea', 'diarrhoea'], ['maneuver', 'manoeuvre'], ['mold', 'mould'],
  ['practice', 'practise'], ['license', 'licence'], ['defense', 'defence'],
  ['offense', 'offence'], ['pediatric', 'paediatric'], ['orthopedic', 'orthopaedic'],
  ['anesthesia', 'anaesthesia'], ['etiology', 'aetiology'], ['estrogen', 'oestrogen'],
  ['fecal', 'faecal'], ['leukemia', 'leukaemia'], ['ischemia', 'ischaemia'],
  ['gynecology', 'gynaecology'], ['hematology', 'haematology'], ['tumor', 'tumour'],
  ['color', 'colour'], ['behavior', 'behaviour'], ['favor', 'favour'],
  ['labor', 'labour'], ['odor', 'odour'], ['vapor', 'vapour'], ['humor', 'humour'],
  ['rigor', 'rigour'], ['vigor', 'vigour'], ['center', 'centre'], ['fiber', 'fibre'],
  ['liter', 'litre'], ['meter', 'metre'], ['theater', 'theatre'],
  ['catalog', 'catalogue'], ['dialog', 'dialogue'], ['analog', 'analogue'],
  ['enrollment', 'enrolment'], ['fulfill', 'fulfil'], ['modeling', 'modelling'],
  ['labeled', 'labelled'], ['labeling', 'labelling'], ['traveled', 'travelled'],
  ['aging', 'ageing'], ['edema', 'oedema'], ['esophagus', 'oesophagus'],
  ['anemia', 'anaemia'], ['hemoglobin', 'haemoglobin'], ['hemorrhage', 'haemorrhage'],
  /* 120.md r2 — the `-re` and `-ense` families, enumerated now that the generic
     `[/re\b/,'er']` and `[/ense\b/,'ence']` transforms are gone (they accepted
     `othre`, `numbre`, `evidense` and every other transposition/s-for-c typo). Both
     families are closed sets in real English, and these are the members a medical
     manuscript actually uses — the metric spellings especially. */
  ['caliber', 'calibre'], ['saber', 'sabre'], ['somber', 'sombre'],
  ['specter', 'spectre'], ['luster', 'lustre'], ['scepter', 'sceptre'],
  ['titer', 'titre'], ['goiter', 'goitre'], ['ocher', 'ochre'], ['miter', 'mitre'],
  ['kilometer', 'kilometre'], ['centimeter', 'centimetre'],
  ['millimeter', 'millimetre'], ['micrometer', 'micrometre'],
  ['nanometer', 'nanometre'], ['milliliter', 'millilitre'],
  ['microliter', 'microlitre'], ['deciliter', 'decilitre'],
  ['pretense', 'pretence'],
];

/** `traveled ⇄ travelled`, `traveling ⇄ travelling` — both directions, per stem. */
for (const stem of L_DOUBLING_STEMS) {
  VARIANT_PAIRS.push([`${stem}ed`, `${stem}led`], [`${stem}ing`, `${stem}ling`]);
}

/** Re-exported so consistency.js can build the same US/UK families from one table. */
export const US_UK_PAIRS = Object.freeze(VARIANT_PAIRS.map((p) => Object.freeze([...p])));

const PAIR_MAP = new Map();
for (const [us, gb] of VARIANT_PAIRS) {
  PAIR_MAP.set(us, gb);
  PAIR_MAP.set(gb, us);
}

/** All plausible counterpart spellings of `word` (never the word itself). */
export function variantCandidates(word) {
  const w = String(word || '');
  if (!w || !/^[A-Za-z'’-]+$/.test(w)) return [];
  const lower = w.toLowerCase();
  const out = new Set();
  const paired = PAIR_MAP.get(lower);
  if (paired) out.add(paired);
  for (const suffix of ['', 's', 'd', 'ed', 'ing']) {
    if (!suffix) continue;
    if (!lower.endsWith(suffix)) continue;
    const stem = lower.slice(0, lower.length - suffix.length);
    const stemPair = PAIR_MAP.get(stem);
    if (stemPair) out.add(stemPair + suffix);
  }
  for (const [re, replacement] of VARIANT_RULES) {
    if (!re.test(lower)) continue;
    const candidate = lower.replace(re, replacement);
    if (candidate !== lower) out.add(candidate);
  }
  out.delete(lower);
  return [...out];
}

/* ------------------------------------------------------------- checker ------- */

/** Restore the input's capitalization pattern on a suggestion. */
export function matchCase(source, candidate) {
  if (!source || !candidate) return candidate;
  if (source === source.toUpperCase() && source.length > 1) return candidate.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return candidate[0].toUpperCase() + candidate.slice(1);
  }
  return candidate;
}

/**
 * Build the checker.
 *
 * @param {Object} config
 * @param {string|Uint8Array} config.aff  the primary dictionary's affix file
 * @param {string|Uint8Array} config.dic  the primary dictionary's word list
 * @param {string} [config.variant]       'en-US' | 'en-GB'
 * @param {string[]} [config.extraWords]  additional words to teach the engine
 * @param {{aff,dic}} [config.secondary]  optional second variant (off by default)
 * @param {boolean} [config.teachMedical] feed the domain lexicon to nspell (default
 *   true) — 120.md §6 needs `suggest('hepatocelular')` to be able to REACH
 *   `hepatocellular`, and nspell can only suggest words it holds.
 */
export function createSpellChecker({
  aff, dic, variant = DEFAULT_VARIANT, extraWords = [], secondary = null,
  teachMedical = true, factory = nspellFactory,
} = {}) {
  const resolved = normalizeVariant(variant);
  const primary = factory(aff, dic);
  const other = secondary ? factory(secondary.aff, secondary.dic) : null;

  const taught = new Set();
  const teach = (words) => {
    for (const word of words || []) {
      const w = String(word || '').trim();
      if (!w || taught.has(w)) continue;
      taught.add(w);
      primary.add(w);
    }
  };
  if (teachMedical) teach(personalDictionaryWords());
  teach(extraWords);

  const knownRaw = (word) => {
    if (!word) return false;
    if (primary.correct(word)) return true;
    // Sentence-initial capitals and shouty headings are not spelling problems.
    const lower = word.toLowerCase();
    if (lower !== word && primary.correct(lower)) return true;
    if (word === word.toUpperCase() && word.length > 1) {
      const title = word[0] + word.slice(1).toLowerCase();
      if (primary.correct(title)) return true;
    }
    return false;
  };

  return {
    variant: resolved,
    lexiconVersion: LEXICON_VERSION,

    /** Known to the base English dictionary (case-tolerant). */
    isKnown: knownRaw,

    /** Known to the optional second dictionary, when one was loaded. */
    isKnownInOther(word) {
      if (!other) return false;
      return other.correct(word) || other.correct(String(word).toLowerCase());
    },

    /**
     * 120.md §6 — is this the OTHER English variant of a real word rather than a
     * misspelling? Returns the preferred-variant spelling, or null.
     */
    otherVariantOf(word) {
      for (const candidate of variantCandidates(word)) {
        if (primary.correct(candidate)) return matchCase(word, candidate);
      }
      if (other) {
        const lower = String(word).toLowerCase();
        if ((other.correct(word) || other.correct(lower)) && !knownRaw(word)) {
          const candidates = variantCandidates(word);
          return candidates.length ? matchCase(word, candidates[0]) : null;
        }
      }
      return null;
    },

    /**
     * Ranked suggestions. Domain near-misses come FIRST: a manuscript that misspells
     * `hepatocelular` wants `hepatocellular`, not `hepatocellulose`. §6's example
     * validation depends on this ordering.
     */
    suggest(word, { limit = 5 } = {}) {
      const w = String(word || '');
      if (!w) return [];
      const out = [];
      const seen = new Set();
      const push = (s) => {
        const cased = matchCase(w, s);
        if (!cased || seen.has(cased.toLowerCase()) || cased === w) return;
        seen.add(cased.toLowerCase());
        out.push(cased);
      };
      for (const term of nearestTerms(w.toLowerCase(), { maxDistance: 2, limit: 3 })) push(term);
      const variantForm = this.otherVariantOf(w);
      if (variantForm) push(variantForm);
      if (out.length < limit) {
        for (const s of primary.suggest(w) || []) {
          push(s);
          if (out.length >= limit) break;
        }
      }
      return out.slice(0, limit);
    },

    /** Teach the engine more words (user/project dictionaries, project lexicon). */
    addWords: teach,

    /** Rough accounting for the worker's `ready` message and the perf report. */
    stats() {
      return { variant: resolved, taught: taught.size, secondary: Boolean(other) };
    },
  };
}

/**
 * The full lexicon chain for ONE word, in 120.md §6's order:
 *   base dictionary → medical lexicon → project lexicon → project/user dictionaries.
 * Returns a verdict object rather than a boolean so pipeline.js can tell "accepted"
 * from "accepted, but it is the other English variant" without re-deriving anything.
 */
export function lookupWord(word, {
  spellChecker, projectLexicon, userDictionary, projectDictionary, ignoredTerms,
} = {}) {
  const w = String(word || '');
  if (!w) return { known: true, via: 'empty' };

  const lower = w.toLowerCase();
  if (ignoredTerms && (ignoredTerms.has(w) || ignoredTerms.has(lower))) {
    return { known: true, via: 'ignored' };
  }
  if (userDictionary && dictionaryHas(userDictionary, w)) return { known: true, via: 'user' };
  if (projectDictionary && dictionaryHas(projectDictionary, w)) {
    return { known: true, via: 'project-dictionary' };
  }
  if (spellChecker && spellChecker.isKnown(w)) return { known: true, via: 'base' };
  if (isMedicalTerm(w)) return { known: true, via: 'medical' };
  if (projectLexicon && projectLexicon.has(w)) return { known: true, via: 'project-lexicon' };

  if (spellChecker) {
    const preferred = spellChecker.otherVariantOf(w);
    if (preferred) return { known: true, via: 'variant', preferred };
  }
  return { known: false, via: null };
}

/** A dictionary may be a Set, a Map keyed by lowercase term, or an array of entries. */
export function dictionaryHas(dictionary, word) {
  if (!dictionary) return false;
  const w = String(word);
  const lower = w.toLowerCase();
  if (dictionary instanceof Set) return dictionary.has(w) || dictionary.has(lower);
  if (dictionary instanceof Map) {
    const entry = dictionary.get(lower);
    if (!entry) return false;
    return entry.caseSensitive ? entry.term === w : true;
  }
  if (Array.isArray(dictionary)) {
    return dictionary.some((e) => {
      const term = typeof e === 'string' ? e : e?.term;
      if (!term) return false;
      const cs = typeof e === 'object' && e?.caseSensitive;
      return cs ? term === w : term.toLowerCase() === lower;
    });
  }
  return false;
}

/**
 * Build the Map shape `dictionaryHas` prefers from the server's entry rows
 * (UserDictionaryEntry / ProjectDictionaryEntry — Wave 4b's endpoints).
 */
export function indexDictionary(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    const term = typeof entry === 'string' ? entry : entry?.term;
    if (!term) continue;
    map.set(String(term).toLowerCase(), {
      term: String(term),
      caseSensitive: Boolean(typeof entry === 'object' && entry?.caseSensitive),
      preferredSpelling: (typeof entry === 'object' && entry?.preferredSpelling) || null,
      category: (typeof entry === 'object' && entry?.category) || null,
    });
  }
  return map;
}
