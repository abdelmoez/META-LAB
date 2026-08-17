/**
 * features/manuscript/writingAssistant/engine/acronyms.js — 120.md §6
 * "Acronym intelligence".
 *
 * §6 asks for four behaviours and one prohibition:
 *   - detect acronyms that may need defining on first use;
 *   - RECOGNISE `full term (ACRONYM)` and stop asking — the §6 validation case
 *     "Inflammatory bowel disease (IBD) was assessed. Patients with IBD…" must produce
 *     no redefinition suggestion, which is why a definition is anchored to the exact
 *     occurrence inside its own parentheses;
 *   - detect inconsistent expansion of one acronym, and two acronyms for one term;
 *   - allow a configurable allowlist of universally recognised abbreviations;
 *   - "Do not automatically rewrite medical acronyms without user confirmation" —
 *     nothing here produces an auto-applicable replacement. Every finding is a
 *     SUGGESTION carrying an explanation, and none carries a suggestions[] payload
 *     that the editor could apply blind.
 *
 * A definition is only accepted when the INITIALS of the preceding words actually
 * spell the acronym (stop-words may be skipped), so "the analysis (see Table 2)" is
 * never mistaken for a definition of TABLE.
 *
 * Pure: ordered blocks in, issues out.
 */

import { CATEGORY, SEVERITY, SOURCE, makeIssue } from './issueModel.js';
import { maskNonProse, tokenize, TOKEN } from './tokenize.js';
import { isMedicalTerm } from './medicalLexicon.js';

export const UNDEFINED_RULE_ID = 'wa.acronym-undefined';
export const USED_BEFORE_RULE_ID = 'wa.acronym-used-before-definition';
export const INCONSISTENT_RULE_ID = 'wa.acronym-inconsistent-expansion';
export const DUPLICATE_TERM_RULE_ID = 'wa.acronym-duplicate-for-term';
export const REDEFINED_RULE_ID = 'wa.acronym-redefined';

/**
 * 120.md §6 — "Allow common universally recognized abbreviations to be configured."
 * This is the DEFAULT; callers pass their own set through `meta.commonAcronyms`, and
 * Wave 4b's Ops/preferences surface can extend it per project.
 */
export const COMMON_ACRONYMS = Object.freeze(new Set([
  // universal
  'DNA', 'RNA', 'HIV', 'AIDS', 'USA', 'US', 'UK', 'EU', 'WHO', 'UN', 'PDF', 'URL',
  'ID', 'IT', 'AM', 'PM', 'CEO', 'FAQ', 'TV', 'GPS', 'PC', 'AI', 'ML',
  // imaging / clinical routine
  'CT', 'MRI', 'PET', 'SPECT', 'US', 'ECG', 'EKG', 'EEG', 'EMG', 'ICU', 'NICU',
  'PICU', 'ER', 'ED', 'OR', 'BP', 'HR', 'RR', 'BMI', 'IV', 'IM', 'PO', 'SC',
  // laboratory
  'PCR', 'ELISA', 'ATP', 'LDL', 'HDL', 'CRP', 'ESR', 'GFR', 'WBC', 'RBC', 'ALT',
  'AST', 'ALP', 'GGT', 'INR', 'BUN', 'TSH', 'PSA', 'HBA1C',
  // statistics (also handled by the tokenizer, listed for belt and braces)
  'CI', 'SD', 'SE', 'SEM', 'IQR', 'OR', 'RR', 'HR', 'MD', 'SMD', 'WMD', 'AUC',
  'ROC', 'ICC', 'NNT', 'NNH', 'ITT', 'PP', 'ANOVA', 'ANCOVA', 'GEE',
  // trial / methodology basics
  'RCT', 'DOI', 'PMID', 'PMCID', 'NCT', 'CONSORT', 'FDA', 'EMA', 'NIH', 'CDC',
  'NHS', 'NICE', 'COVID', 'SARS', 'MERS', 'TB', 'COPD', 'CKD', 'CVD', 'CAD',
  'IBD', 'IBS', 'RA', 'SLE', 'MS', 'PD', 'AD', 'T1D', 'T2D',
]));

/** Words a writer may skip when forming an acronym. */
const SKIPPABLE = new Set([
  'of', 'the', 'and', 'in', 'for', 'a', 'an', 'to', 'with', 'on', 'or', 'by',
  'at', 'from', 'de', 'la', 'le',
]);

/**
 * `full term (ACRONYM)` / `ACRONYM (full term)`. The acronym group allows lower-case
 * letters so mixed-case abbreviations (HRQoL, HbA1c) are recognised; `hasTwoCaps`
 * then rejects ordinary Capitalized words in parentheses.
 */
const FORWARD_DEF_RE = /((?:[\p{L}][\p{L}\p{M}'’-]*[\s ]+){1,8}[\p{L}][\p{L}\p{M}'’-]*)[\s ]*\(([A-Z][A-Za-z0-9]{1,7})\)/gu;
const REVERSE_DEF_RE = /(?<![\p{L}\p{N}])([A-Z][A-Za-z0-9]{1,7})[\s ]*\(([^)]{4,90})\)/gu;

const hasTwoCaps = (s) => (String(s).match(/[A-Z]/g) || []).length >= 2;

const normalizeExpansion = (s) => String(s).toLowerCase().replace(/[\s ]+/g, ' ').trim();

/** Split a phrase into initial-bearing words (hyphenated compounds count separately). */
function phraseWords(phrase) {
  return String(phrase)
    .split(/[\s ]+/)
    .flatMap((w) => w.split(/[-‐-―−]/))
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

/**
 * Do the initials of `phrase` spell `acronym`? Walks backwards so the phrase may be
 * longer than the acronym (the writer's sentence continues to the left), and lets the
 * writer skip small function words. Returns the matched phrase or null.
 */
export function expansionMatches(phrase, acronym) {
  const letters = String(acronym).replace(/[^A-Z]/g, '').toLowerCase().split('');
  if (!letters.length) return null;
  const words = phraseWords(phrase);
  if (words.length < letters.length) return null;

  let li = letters.length - 1;
  let wi = words.length - 1;
  let firstWord = words.length;
  while (li >= 0 && wi >= 0) {
    const word = words[wi].toLowerCase();
    if (word[0] === letters[li]) {
      firstWord = wi;
      li -= 1;
      wi -= 1;
      continue;
    }
    // A skippable function word between initials is allowed, but only in the middle.
    if (SKIPPABLE.has(word) && li < letters.length - 1) { wi -= 1; continue; }
    return null;
  }
  if (li >= 0) return null;
  return words.slice(firstWord).join(' ');
}

/** Prepare blocks: mask non-prose, tokenize once. */
function prepare(blocks) {
  return (blocks || []).map((block) => {
    const masked = maskNonProse(String(block.text ?? ''));
    return {
      index: block.index,
      rev: block.rev ?? null,
      kind: block.kind || 'paragraph',
      text: masked,
      tokens: block.tokens || tokenize(masked, { mask: false }).tokens,
    };
  });
}

/** A block written entirely in capitals is a shouted heading, not acronym usage. */
function isShouted(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 8) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  return upper.length / letters.length > 0.8;
}

/**
 * @param {Array<{index:number, rev?:any, text:string, kind?:string, tokens?:Array}>} blocks
 * @param {Object} [meta] { docId, sectionId, createdAt, commonAcronyms:Set, isCommonWord:fn }
 */
export function analyzeAcronyms(blocks, meta = {}) {
  const prepared = prepare(blocks);
  const allow = meta.commonAcronyms instanceof Set ? meta.commonAcronyms : COMMON_ACRONYMS;
  const isCommonWord = meta.isCommonWord || (() => false);
  /**
   * 120.md §6 — MEDLINE, CENTRAL, PRISMA, PROSPERO and GRADE are proper NAMES that
   * happen to be written in capitals, not abbreviations a reader needs expanded.
   * Treating the versioned domain lexicon as an implicit allowlist is what keeps a
   * systematic-review manuscript from opening with a wall of "never defined"
   * suggestions. Overridable, because a journal may still want them spelled out.
   */
  const isKnownTerm = meta.isKnownTerm || ((word) => isMedicalTerm(word, { caseSensitive: true }));
  const issues = [];

  /** acronym → [{ blockIndex, start, end, block }] in document order. */
  const occurrences = new Map();
  /** acronym → [{ expansion, normalized, blockIndex, start, end, block }] */
  const definitions = new Map();

  for (const block of prepared) {
    if (isShouted(block.text)) continue;

    for (const token of block.tokens) {
      if (token.kind !== TOKEN.ACRONYM) continue;
      const acronym = token.text;
      if (acronym.length < 2 || acronym.length > 8) continue;
      if (!hasTwoCaps(acronym)) continue;
      // "METHODS", "RESULTS": all-caps renderings of ordinary words are not acronyms.
      if (isCommonWord(acronym.toLowerCase())) continue;
      const list = occurrences.get(acronym) || [];
      list.push({ block, blockIndex: block.index, start: token.start, end: token.end });
      occurrences.set(acronym, list);
    }

    FORWARD_DEF_RE.lastIndex = 0;
    let m;
    while ((m = FORWARD_DEF_RE.exec(block.text)) !== null) {
      if (!hasTwoCaps(m[2])) continue;
      const expansion = expansionMatches(m[1], m[2]);
      if (!expansion) continue;
      const acronymStart = m.index + m[0].lastIndexOf(`(${m[2]})`) + 1;
      const list = definitions.get(m[2]) || [];
      list.push({
        expansion,
        normalized: normalizeExpansion(expansion),
        block,
        blockIndex: block.index,
        start: acronymStart,
        end: acronymStart + m[2].length,
        defStart: m.index,
        defEnd: m.index + m[0].length,
      });
      definitions.set(m[2], list);
    }

    REVERSE_DEF_RE.lastIndex = 0;
    while ((m = REVERSE_DEF_RE.exec(block.text)) !== null) {
      if (!hasTwoCaps(m[1])) continue;
      const expansion = expansionMatches(m[2], m[1]);
      if (!expansion) continue;
      const list = definitions.get(m[1]) || [];
      if (list.some((d) => d.blockIndex === block.index && d.start === m.index)) continue;
      list.push({
        expansion,
        normalized: normalizeExpansion(expansion),
        block,
        blockIndex: block.index,
        start: m.index,
        end: m.index + m[1].length,
        defStart: m.index,
        defEnd: m.index + m[0].length,
      });
      definitions.set(m[1], list);
    }
  }

  const push = (opts) => issues.push(makeIssue({
    docId: meta.docId ?? null,
    sectionId: meta.sectionId ?? null,
    createdAt: meta.createdAt || 0,
    source: SOURCE.ACRONYM,
    severity: SEVERITY.SUGGESTION,
    ...opts,
  }));

  const before = (a, b) => a.blockIndex < b.blockIndex
    || (a.blockIndex === b.blockIndex && a.start < b.start);

  for (const [acronym, uses] of occurrences) {
    if (allow.has(acronym)) continue;
    if (isKnownTerm(acronym)) continue;
    const defs = (definitions.get(acronym) || []).slice()
      .sort((a, b) => a.blockIndex - b.blockIndex || a.start - b.start);
    const first = uses[0];

    if (!defs.length) {
      push({
        blockIndex: first.blockIndex,
        blockRev: first.block.rev,
        start: first.start,
        end: first.end,
        original: acronym,
        category: CATEGORY.ACRONYM,
        ruleId: UNDEFINED_RULE_ID,
        confidence: 0.55,
        message: `“${acronym}” is never defined.`,
        explanation: `Write the full term followed by “(${acronym})” at first use, or `
          + 'add it to the common-abbreviation list if it needs no definition.',
      });
      continue;
    }

    const firstDef = defs[0];
    if (before(first, firstDef)) {
      push({
        blockIndex: first.blockIndex,
        blockRev: first.block.rev,
        start: first.start,
        end: first.end,
        original: acronym,
        category: CATEGORY.ACRONYM,
        ruleId: USED_BEFORE_RULE_ID,
        confidence: 0.6,
        message: `“${acronym}” is used before it is defined.`,
        explanation: `It is defined later as “${firstDef.expansion}”. Move the `
          + 'definition to the first use.',
      });
    }

    for (let i = 1; i < defs.length; i += 1) {
      const def = defs[i];
      const differs = def.normalized !== firstDef.normalized;
      push({
        blockIndex: def.blockIndex,
        blockRev: def.block.rev,
        start: def.defStart,
        end: def.defEnd,
        original: def.block.text.slice(def.defStart, def.defEnd),
        category: CATEGORY.ABBREVIATION,
        ruleId: differs ? INCONSISTENT_RULE_ID : REDEFINED_RULE_ID,
        confidence: differs ? 0.7 : 0.45,
        message: differs
          ? `“${acronym}” is expanded two different ways.`
          : `“${acronym}” is already defined.`,
        explanation: differs
          ? `Earlier: “${firstDef.expansion}”. Here: “${def.expansion}”. Use one expansion.`
          : 'An abbreviation is normally defined once, at first use.',
      });
    }
  }

  // Two acronyms defined for the same expansion.
  const byExpansion = new Map();
  for (const [acronym, defs] of definitions) {
    if (!defs.length) continue;
    const key = defs[0].normalized;
    const list = byExpansion.get(key) || [];
    list.push({ acronym, def: defs[0] });
    byExpansion.set(key, list);
  }
  for (const [, list] of byExpansion) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.def.blockIndex - b.def.blockIndex || a.def.start - b.def.start);
    for (let i = 1; i < list.length; i += 1) {
      const { acronym, def } = list[i];
      push({
        blockIndex: def.blockIndex,
        blockRev: def.block.rev,
        start: def.start,
        end: def.end,
        original: acronym,
        category: CATEGORY.ABBREVIATION,
        ruleId: DUPLICATE_TERM_RULE_ID,
        confidence: 0.6,
        message: `“${acronym}” and “${list[0].acronym}” are defined for the same term.`,
        explanation: `Both expand to “${def.expansion}”. Use one abbreviation throughout.`,
      });
    }
  }

  return issues;
}

export const __internal = { phraseWords, normalizeExpansion, isShouted };
