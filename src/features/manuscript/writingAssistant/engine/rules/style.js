/**
 * rules/style.js — 120.md §6 "Scientific style", "Clarity or awkward phrasing",
 * "Preposition usage" and "Verb tense".
 *
 * A closed collocation table plus two shape rules. Everything here is a SUGGESTION
 * with a stated confidence: §6 draws a hard line between grammar and taste, and every
 * item below is taste informed by medical-journal convention (`compared with`, not
 * `compared to`; results are demonstrated, not proved).
 *
 * The tense rule is the only section-aware rule in the engine. It needs
 * `ctx.sectionKind` to be 'methods' or 'results' and stays silent otherwise, because
 * future tense is perfectly correct in a protocol, a discussion or a limitations
 * paragraph.
 */

import { CATEGORY, SEVERITY } from '../issueModel.js';
import { emit, isProse } from './ruleUtils.js';
import { splitSentences } from '../tokenize.js';

export const STYLE_RULE_ID = 'wa.scientific-style';
export const PREPOSITION_RULE_ID = 'wa.preposition-collocation';
export const CLARITY_RULE_ID = 'wa.long-sentence';
export const TENSE_RULE_ID = 'wa.reporting-tense';

/** [regex source, category, message, suggestions, confidence]. */
const COLLOCATIONS = [
  ['\\bdifferent than\\b', CATEGORY.PREPOSITION, 'Use “different from”.', ['different from'], 0.75],
  ['\\bassociated to\\b', CATEGORY.PREPOSITION, 'Use “associated with”.', ['associated with'], 0.8],
  ['\\bcorrelated to\\b', CATEGORY.PREPOSITION, 'Use “correlated with”.', ['correlated with'], 0.75],
  ['\\bcompared to\\b', CATEGORY.PREPOSITION, 'Medical style prefers “compared with” for comparisons between groups.', ['compared with'], 0.5],
  ['\\bcomprised of\\b', CATEGORY.PREPOSITION, 'Use “composed of” or “comprising”.', ['composed of', 'comprising'], 0.7],
  ['\\bconsists in\\b', CATEGORY.PREPOSITION, 'Use “consists of”.', ['consists of'], 0.7],
  ['\\bsuperior than\\b', CATEGORY.PREPOSITION, 'Use “superior to”.', ['superior to'], 0.85],
  ['\\binferior than\\b', CATEGORY.PREPOSITION, 'Use “inferior to”.', ['inferior to'], 0.85],
  ['\\bregardless to\\b', CATEGORY.PREPOSITION, 'Use “regardless of”.', ['regardless of'], 0.85],
  ['\\bcapable to\\b', CATEGORY.PREPOSITION, 'Use “capable of”.', ['capable of'], 0.8],
  ['\\bdepends? of\\b', CATEGORY.PREPOSITION, 'Use “depend(s) on”.', ['depends on'], 0.8],
  ['\\bin contrast of\\b', CATEGORY.PREPOSITION, 'Use “in contrast to”.', ['in contrast to'], 0.8],
  ['\\bprove[ds]?\\b', CATEGORY.STYLE, 'Studies demonstrate or support rather than prove.', ['demonstrated', 'showed'], 0.45],
  ['\\bproven\\b', CATEGORY.STYLE, 'Studies demonstrate or support rather than prove.', ['demonstrated'], 0.45],
  ['\\bobviously\\b', CATEGORY.STYLE, 'Avoid asserting that a finding is obvious.', [], 0.5],
  ['\\bclearly\\b', CATEGORY.STYLE, 'Avoid asserting that a finding is clear; give the evidence.', [], 0.4],
  ['\\bvery\\b', CATEGORY.STYLE, 'Vague intensifier; prefer a quantity.', [], 0.4],
  ['\\bquite\\b', CATEGORY.STYLE, 'Vague intensifier; prefer a quantity.', [], 0.4],
  ['\\bthe data is\\b', CATEGORY.STYLE, '“Data” is plural in scientific writing.', ['the data are'], 0.6],
  ['\\bthis data\\b', CATEGORY.STYLE, '“Data” is plural in scientific writing.', ['these data'], 0.5],
  ['\\bin order to\\b', CATEGORY.STYLE, '“to” is enough.', ['to'], 0.5],
  ['\\bdue to the fact that\\b', CATEGORY.STYLE, 'Use “because”.', ['because'], 0.7],
  ['\\bin spite of the fact that\\b', CATEGORY.STYLE, 'Use “although”.', ['although'], 0.7],
  ['\\butiliz(?:e|es|ed|ing)\\b', CATEGORY.STYLE, '“Use” is simpler.', ['use'], 0.5],
  ['\\butilis(?:e|es|ed|ing)\\b', CATEGORY.STYLE, '“Use” is simpler.', ['use'], 0.5],
  ['\\bat this point in time\\b', CATEGORY.STYLE, 'Use “now” or “currently”.', ['currently'], 0.65],
  ['\\bthe majority of\\b', CATEGORY.STYLE, 'Use “most”.', ['most'], 0.45],
  ['\\ba total number of\\b', CATEGORY.STYLE, 'Use “a total of”.', ['a total of'], 0.6],
];

const COLLOCATION_RE = new RegExp(`(?:${COLLOCATIONS.map(([re]) => re).join('|')})`, 'gi');

export function scientificStyle(ctx) {
  const issues = [];
  const { text, proseMask } = ctx;
  COLLOCATION_RE.lastIndex = 0;
  let m;
  while ((m = COLLOCATION_RE.exec(text)) !== null) {
    const matched = m[0];
    if (!isProse(proseMask, m.index, m.index + matched.length)) continue;
    const entry = COLLOCATIONS.find(([re]) => new RegExp(`^(?:${re})$`, 'i').test(matched));
    if (!entry) continue;
    const [, category, message, suggestions, confidence] = entry;
    issues.push(emit(ctx, {
      start: m.index,
      end: m.index + matched.length,
      category,
      ruleId: category === CATEGORY.PREPOSITION ? PREPOSITION_RULE_ID : STYLE_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence,
      message,
      explanation: category === CATEGORY.PREPOSITION
        ? 'This verb or adjective normally takes a different preposition.'
        : 'A convention of scientific writing, not a grammatical error.',
      suggestions,
    }));
  }
  return issues;
}

/** 120.md §6 "Clarity or awkward phrasing" — the one shape we can measure honestly. */
const LONG_SENTENCE_WORDS = 45;

export function clarity(ctx) {
  const issues = [];
  for (const sentence of ctx.sentences) {
    const words = sentence.text.split(/[\s ]+/).filter((w) => /\p{L}/u.test(w));
    if (words.length <= LONG_SENTENCE_WORDS) continue;
    issues.push(emit(ctx, {
      start: sentence.start,
      end: sentence.end,
      category: CATEGORY.CLARITY,
      ruleId: CLARITY_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.4,
      message: `This sentence is ${words.length} words long.`,
      explanation: 'Long sentences are harder to read; consider splitting it.',
    }));
  }
  return issues;
}

const FUTURE_RE = /\b(?:will|shall)\s+(?:be\s+)?\p{L}+/giu;

/** 120.md §6 "Verb tense" — completed work is reported in the past tense. */
export function reportingTense(ctx) {
  const kind = String(ctx.sectionKind || '').toLowerCase();
  if (kind !== 'methods' && kind !== 'results') return [];
  const issues = [];
  const { text, proseMask } = ctx;
  FUTURE_RE.lastIndex = 0;
  let m;
  while ((m = FUTURE_RE.exec(text)) !== null) {
    if (!isProse(proseMask, m.index, m.index + m[0].length)) continue;
    issues.push(emit(ctx, {
      start: m.index,
      end: m.index + m[0].length,
      category: CATEGORY.TENSE,
      ruleId: TENSE_RULE_ID,
      severity: SEVERITY.SUGGESTION,
      confidence: 0.45,
      message: 'Completed work is usually reported in the past tense.',
      explanation: `Future tense in ${kind} normally belongs to a protocol rather than `
        + 'a report. Ignore this if the manuscript is a protocol.',
    }));
  }
  return issues;
}

export const __internal = { COLLOCATIONS, splitSentences };
