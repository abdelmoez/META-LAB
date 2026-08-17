/**
 * features/manuscript/writingAssistant/engine/consistency.js — 120.md §6
 * "Terminology consistency".
 *
 * A DOCUMENT-level pass. §6 names the cases: `meta analysis` vs `meta-analysis`,
 * `randomized` vs `randomised`, `follow up` vs `follow-up`, `P value` / `p-value` /
 * `p value`, and different capitalization of the same database.
 *
 * The design rule that keeps this useful instead of noisy: A FAMILY ONLY FIRES WHEN
 * THE MANUSCRIPT ACTUALLY DISAGREES WITH ITSELF. `follow up` is a perfectly correct
 * verb phrase ("patients were followed up") and `meta analysis` is defensible house
 * style; neither is wrong on its own. Only the presence of two spellings of the same
 * thing in one manuscript is evidence, and even then §6 requires the finding to be
 * presented "as consistency suggestions, not unquestionable corrections" — so
 * everything here is SEVERITY.SUGGESTION and the majority usage is what gets
 * recommended, not the engine's opinion.
 *
 * Pure. Takes the ordered block list, returns issues.
 */

import { CATEGORY, SEVERITY, SOURCE, makeIssue } from './issueModel.js';
import { maskNonProse, tokenize, TOKEN } from './tokenize.js';
import { canonicalCase } from './medicalLexicon.js';
import { US_UK_PAIRS, normalizeVariant, VARIANT } from './spellcheck.js';

export const TERM_RULE_ID = 'wa.consistency-term';
export const VARIANT_RULE_ID = 'wa.consistency-variant';
export const PROPER_CASE_RULE_ID = 'wa.consistency-proper-case';

/**
 * Hyphenation / spacing / capitalization families. Each family is a list of GROUPS,
 * and the groups are PARALLEL: index i in one group corresponds to index i in every
 * other, so the engine can turn a matched `meta analyses` into `meta-analyses` rather
 * than guessing at the singular.
 */
export const TERM_FAMILIES = Object.freeze([
  { id: 'meta-analysis', groups: [['meta-analysis', 'meta-analyses'], ['meta analysis', 'meta analyses'], ['metaanalysis', 'metaanalyses']] },
  { id: 'meta-regression', groups: [['meta-regression', 'meta-regressions'], ['meta regression', 'meta regressions']] },
  { id: 'follow-up', groups: [['follow-up'], ['follow up'], ['followup']], note: '“follow up” is correct as a verb; “follow-up” is the noun and adjective.' },
  { id: 'p-value', caseSensitive: true, groups: [['p-value', 'p-values'], ['p value', 'p values'], ['P value', 'P values'], ['P-value', 'P-values']] },
  { id: 'subgroup', groups: [['subgroup', 'subgroups'], ['sub-group', 'sub-groups'], ['sub group', 'sub groups']] },
  { id: 'healthcare', groups: [['healthcare'], ['health care'], ['health-care']] },
  { id: 'long-term', groups: [['long-term'], ['long term']] },
  { id: 'short-term', groups: [['short-term'], ['short term']] },
  { id: 'cross-sectional', groups: [['cross-sectional'], ['cross sectional']] },
  { id: 'case-control', groups: [['case-control'], ['case control']] },
  { id: 'decision-making', groups: [['decision-making'], ['decision making']] },
  { id: 'well-being', groups: [['well-being'], ['wellbeing'], ['well being']] },
  { id: 'risk-of-bias', groups: [['risk-of-bias'], ['risk of bias']] },
  { id: 'odds-ratio', groups: [['odds ratio', 'odds ratios'], ['odds-ratio', 'odds-ratios']] },
  { id: 'dataset', groups: [['dataset', 'datasets'], ['data set', 'data sets'], ['data-set', 'data-sets']] },
  { id: 'comorbidity', groups: [['comorbidity', 'comorbidities'], ['co-morbidity', 'co-morbidities']] },
  { id: 'multicentre', groups: [['multicentre'], ['multi-centre'], ['multicenter'], ['multi-center']] },
  { id: 'post-hoc', groups: [['post hoc'], ['post-hoc'], ['posthoc']] },
  { id: 'in-vitro', groups: [['in vitro'], ['in-vitro']] },
  { id: 'nonsignificant', groups: [['nonsignificant'], ['non-significant'], ['non significant']] },
  { id: 'intention-to-treat', groups: [['intention-to-treat'], ['intention to treat']] },
  { id: 'double-blind', groups: [['double-blind'], ['double blind']] },
]);

/**
 * The closed list of -ize/-ise verbs a medical manuscript actually uses. This is a
 * CURATED LIST ON PURPOSE: a morphological `-ise$` rule would classify `exercise`,
 * `comprise`, `supervise`, `precise` and `expertise` as British variants, which is
 * exactly the false positive §6 forbids. Every entry below is a real US/UK pair.
 */
const IZE_VERBS = [
  'randomize', 'organize', 'summarize', 'standardize', 'normalize', 'categorize',
  'characterize', 'hospitalize', 'minimize', 'maximize', 'optimize', 'utilize',
  'recognize', 'emphasize', 'generalize', 'prioritize', 'harmonize', 'synthesize',
  'visualize', 'realize', 'authorize', 'immunize', 'sterilize', 'metabolize',
  'nebulize', 'anonymize', 'digitize', 'computerize', 'modernize', 'formalize',
  'finalize', 'legalize', 'localize', 'mobilize', 'neutralize', 'stabilize',
  'sensitize', 'desensitize', 'polarize', 'homogenize', 'pasteurize', 'oxidize',
  'ionize', 'crystallize', 'centralize', 'specialize', 'subsidize', 'apologize',
  'criticize', 'equalize', 'familiarize', 'hypothesize', 'individualize',
  'initialize', 'institutionalize', 'internalize', 'itemize', 'jeopardize',
  'memorize', 'operationalize', 'penalize', 'personalize', 'popularize',
  'publicize', 'rationalize', 'revolutionize', 'scrutinize', 'socialize',
  'symbolize', 'sympathize', 'systematize', 'theorize', 'vaporize', 'vocalize',
  'characterize', 'colonize', 'immobilize', 'stigmatize', 'traumatize',
];

/** `-yze`/`-yse` behaves the same way but with its own spelling. */
const YZE_VERBS = ['analyze', 'catalyze', 'hydrolyze', 'paralyze', 'dialyze', 'paralyze'];

/** form (lowercase) → { us, gb } — every inflection of every pair, both directions. */
const VARIANT_FORMS = new Map();

function addVariantPair(us, gb) {
  VARIANT_FORMS.set(us.toLowerCase(), { us, gb });
  VARIANT_FORMS.set(gb.toLowerCase(), { us, gb });
}

for (const verb of IZE_VERBS) {
  const stem = verb.slice(0, -3); // drop "ize"
  addVariantPair(`${stem}ize`, `${stem}ise`);
  addVariantPair(`${stem}izes`, `${stem}ises`);
  addVariantPair(`${stem}ized`, `${stem}ised`);
  addVariantPair(`${stem}izing`, `${stem}ising`);
  addVariantPair(`${stem}ization`, `${stem}isation`);
  addVariantPair(`${stem}izations`, `${stem}isations`);
}
/**
 * 120.md r2 — stems whose `-ysis` NOUN exists, so `-yses` is that noun's PLURAL and
 * not the UK form of the `-yzes` verb.
 *
 * Two defects were pinned to this loop by the r2 review, both firing on essentially
 * every systematic-review manuscript:
 *
 *   · `addVariantPair('analysis','analysis')` registered `analysis` as a variant pair
 *     of ITSELF, classified US because `lower === entry.us`. A GB-variant manuscript
 *     therefore got "Mixed English variants; 'analysis' is the UK spelling" on every
 *     `analysis`, with a suggestion BYTE-IDENTICAL to the text — an underline that no
 *     Apply could ever satisfy. The line is gone; there is no such pair.
 *   · `analyses` is the correct US plural of `analysis`, so pairing it as the GB side
 *     of `analyzes` made a US-variant manuscript underline "sensitivity analyses" and
 *     offer "sensitivity analyzes" — a noun corrupted into a third-person verb by
 *     clicking Apply. Ambiguous forms are not classified at all (§6: never guess).
 */
const YSIS_NOUN_STEMS = new Set(['anal', 'catal', 'hydrol', 'paral', 'dial', 'electrol']);

for (const verb of YZE_VERBS) {
  const stem = verb.slice(0, -3); // drop "yze"
  addVariantPair(`${stem}yze`, `${stem}yse`);
  if (!YSIS_NOUN_STEMS.has(stem)) addVariantPair(`${stem}yzes`, `${stem}yses`);
  addVariantPair(`${stem}yzed`, `${stem}ysed`);
  addVariantPair(`${stem}yzing`, `${stem}ysing`);
}
for (const [us, gb] of US_UK_PAIRS) {
  addVariantPair(us, gb);
  addVariantPair(`${us}s`, `${gb}s`);
  if (us.endsWith('y')) addVariantPair(`${us.slice(0, -1)}ies`, `${gb.slice(0, -1)}ies`);
}

/** The US/UK classification of a word, or null when it is not a variant pair at all. */
export function variantPairOf(word) {
  const entry = VARIANT_FORMS.get(String(word || '').toLowerCase());
  if (!entry) return null;
  const lower = String(word).toLowerCase();
  return { ...entry, side: lower === entry.us.toLowerCase() ? VARIANT.US : VARIANT.GB };
}

/* ----------------------------------------------------------------- helpers --- */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Preserve the source's capitalization when swapping one form for another. */
function applyCase(source, replacement) {
  if (!source || !replacement) return replacement;
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** A block, with its mask and tokens computed once and reused by every pass. */
function prepareBlocks(blocks) {
  return blocks.map((block) => {
    const text = String(block.text ?? '');
    const masked = maskNonProse(text);
    return {
      index: block.index,
      rev: block.rev ?? null,
      kind: block.kind || 'paragraph',
      text: masked,
      tokens: block.tokens || tokenize(masked, { mask: false }).tokens,
    };
  });
}

/* -------------------------------------------------------------- term pass ---- */

function checkTermFamilies(blocks, meta, issues, maxPerFamily) {
  // One lowercase haystack for the whole section, built once. A family can only fire
  // when TWO of its groups are present, so a cheap substring test skips most of the
  // 22 families outright and saves several thousand regex scans on a long manuscript
  // (measured: full-document pass 631 ms → 340 ms on a 186-block, 52 KB draft).
  const haystack = blocks.map((b) => b.text).join('\n').toLowerCase();

  for (const family of TERM_FAMILIES) {
    const groupsSeen = family.groups.filter(
      (variants) => variants.some((v) => haystack.includes(v.toLowerCase())),
    ).length;
    if (groupsSeen < 2) continue;

    const flags = family.caseSensitive ? 'g' : 'gi';
    /** groupIndex → { count, hits: [{block, start, end, variantIndex}] } */
    const groups = family.groups.map(() => ({ count: 0, hits: [] }));

    family.groups.forEach((variants, groupIndex) => {
      variants.forEach((variant, variantIndex) => {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(variant)}(?![\\p{L}\\p{N}])`, `${flags}u`);
        for (const block of blocks) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(block.text)) !== null) {
            if (block.text.slice(m.index, m.index + m[0].length).includes('￼')) continue;
            groups[groupIndex].count += 1;
            groups[groupIndex].hits.push({
              block, start: m.index, end: m.index + m[0].length, variantIndex,
            });
          }
        }
      });
    });

    const present = groups.map((g, i) => ({ ...g, i })).filter((g) => g.count > 0);
    if (present.length < 2) continue;
    present.sort((a, b) => b.count - a.count || a.i - b.i);
    const winner = present[0];

    let emitted = 0;
    for (const group of present.slice(1)) {
      for (const hit of group.hits) {
        if (emitted >= maxPerFamily) break;
        const preferred = family.groups[winner.i][hit.variantIndex]
          ?? family.groups[winner.i][0];
        const original = hit.block.text.slice(hit.start, hit.end);
        issues.push(makeIssue({
          docId: meta.docId ?? null,
          sectionId: meta.sectionId ?? null,
          blockIndex: hit.block.index,
          blockRev: hit.block.rev,
          start: hit.start,
          end: hit.end,
          original,
          category: CATEGORY.CONSISTENCY,
          severity: SEVERITY.SUGGESTION,
          confidence: 0.6,
          message: `This manuscript mostly writes “${preferred}”.`,
          explanation: family.note
            ? `${family.note} Both spellings appear in this manuscript.`
            : 'Both spellings appear in this manuscript; pick one.',
          suggestions: [applyCase(original, preferred)],
          ruleId: TERM_RULE_ID,
          source: SOURCE.CONSISTENCY,
          createdAt: meta.createdAt || 0,
          meta: { family: family.id },
        }));
        emitted += 1;
      }
      if (emitted >= maxPerFamily) break;
    }
  }
}

/* ----------------------------------------------------------- variant pass ---- */

function checkEnglishVariant(blocks, meta, issues, maxPerFamily) {
  const preferred = normalizeVariant(meta.variant);
  const hits = { [VARIANT.US]: [], [VARIANT.GB]: [] };

  for (const block of blocks) {
    for (const token of block.tokens) {
      if (token.kind !== TOKEN.WORD) continue;
      const pair = variantPairOf(token.text);
      if (!pair) continue;
      hits[pair.side].push({ block, token, pair });
    }
  }
  const usCount = hits[VARIANT.US].length;
  const gbCount = hits[VARIANT.GB].length;
  if (!usCount || !gbCount) return;

  // 120.md §6 — the user's preference decides; the manuscript's own majority is the
  // tie-breaker only when no preference has been expressed.
  const target = preferred || (usCount >= gbCount ? VARIANT.US : VARIANT.GB);
  const offenders = target === VARIANT.US ? hits[VARIANT.GB] : hits[VARIANT.US];
  const label = target === VARIANT.US ? 'US' : 'UK';

  let emitted = 0;
  for (const hit of offenders) {
    if (emitted >= maxPerFamily) break;
    const replacement = target === VARIANT.US ? hit.pair.us : hit.pair.gb;
    issues.push(makeIssue({
      docId: meta.docId ?? null,
      sectionId: meta.sectionId ?? null,
      blockIndex: hit.block.index,
      blockRev: hit.block.rev,
      start: hit.token.start,
      end: hit.token.end,
      original: hit.token.text,
      category: CATEGORY.CONSISTENCY,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.6,
      message: `Mixed English variants; “${replacement}” is the ${label} spelling.`,
      explanation: 'Both US and UK spellings appear in this manuscript. Neither is '
        + 'wrong, but journals expect one variant throughout.',
      suggestions: [applyCase(hit.token.text, replacement)],
      ruleId: VARIANT_RULE_ID,
      source: SOURCE.CONSISTENCY,
      createdAt: meta.createdAt || 0,
      meta: { variant: target },
    }));
    emitted += 1;
  }
}

/* ------------------------------------------------------- proper-case pass ---- */

function checkProperCase(blocks, meta, issues, maxPerTerm) {
  const emittedPerTerm = new Map();
  for (const block of blocks) {
    for (const token of block.tokens) {
      if (token.kind !== TOKEN.WORD && token.kind !== TOKEN.ACRONYM) continue;
      if (token.text.length < 3) continue;
      const canonical = canonicalCase(token.text);
      if (!canonical || canonical === token.text) continue;
      // An ordinary English word that happens to share a name with a tool (grade,
      // care, sign, central, nice) must never be "corrected" into the tool's casing.
      if (meta.isCommonWord && meta.isCommonWord(token.text.toLowerCase())) continue;
      const seen = emittedPerTerm.get(canonical) || 0;
      if (seen >= maxPerTerm) continue;
      emittedPerTerm.set(canonical, seen + 1);
      issues.push(makeIssue({
        docId: meta.docId ?? null,
        sectionId: meta.sectionId ?? null,
        blockIndex: block.index,
        blockRev: block.rev,
        start: token.start,
        end: token.end,
        original: token.text,
        category: CATEGORY.CONSISTENCY,
        severity: SEVERITY.SUGGESTION,
        confidence: 0.65,
        message: `“${canonical}” is normally written this way.`,
        explanation: 'Database, registry and instrument names have a conventional '
          + 'capitalization.',
        suggestions: [canonical],
        ruleId: PROPER_CASE_RULE_ID,
        source: SOURCE.CONSISTENCY,
        createdAt: meta.createdAt || 0,
      }));
    }
  }
}

/* -------------------------------------------------------------- entry point -- */

/**
 * @param {Array<{index:number, rev?:any, text:string, kind?:string, tokens?:Array}>} blocks
 * @param {Object} [meta] { docId, sectionId, createdAt, variant, isCommonWord, maxPerFamily }
 * @returns {Array} issues
 */
export function checkConsistency(blocks, meta = {}) {
  const prepared = prepareBlocks(blocks || []);
  const issues = [];
  const maxPerFamily = Number.isFinite(meta.maxPerFamily) ? meta.maxPerFamily : 12;
  checkTermFamilies(prepared, meta, issues, maxPerFamily);
  checkEnglishVariant(prepared, meta, issues, maxPerFamily);
  checkProperCase(prepared, meta, issues, meta.maxPerTerm ?? 6);
  return issues;
}

export const __internal = { VARIANT_FORMS, IZE_VERBS, applyCase };
