/**
 * rules/index.js — 120.md §6. The rule registry.
 *
 * ONE table that pipeline.js runs and the UI reads. Every entry carries its ruleId,
 * category and a plain-language label, which is what makes "Ignore this rule in the
 * current manuscript" (§6) implementable without the UI hard-coding rule names, and
 * what lets the popover list categories that actually exist.
 *
 * BLOCK_RULES see one block at a time and are re-run on every incremental check.
 * DOCUMENT_RULES need the whole ordered block list and only run in the document pass.
 */

import { CATEGORY } from '../issueModel.js';
import { duplicateWord, RULE_ID as DUPLICATE_RULE_ID } from './duplicateWord.js';
import {
  subjectVerbAgreement, numberAgreement, SUBJECT_VERB_RULE_ID, NUMBER_RULE_ID,
} from './agreement.js';
import { articleUsage, RULE_ID as ARTICLE_RULE_ID } from './articles.js';
import { sentenceCapitalization, RULE_ID as CAPITAL_RULE_ID } from './capitalization.js';
import {
  spacing, brackets, DOUBLE_SPACE_RULE_ID, SPACE_BEFORE_PUNCT_RULE_ID,
  MISSING_SPACE_RULE_ID, BRACKET_RULE_ID,
} from './punctuation.js';
import {
  sentenceFragment, runOnSentence, FRAGMENT_RULE_ID, RUNON_RULE_ID,
} from './fragments.js';
import { informalLanguage, RULE_ID as INFORMAL_RULE_ID } from './informal.js';
import {
  scientificStyle, clarity, reportingTense,
  STYLE_RULE_ID, PREPOSITION_RULE_ID, CLARITY_RULE_ID, TENSE_RULE_ID,
} from './style.js';
import { repeatedSentenceOpener, RULE_ID as REPETITION_RULE_ID } from './repetition.js';

/** Rules that run per block. Order is irrelevant — pipeline.js dedupes and sorts. */
export const BLOCK_RULES = Object.freeze([
  { id: 'duplicateWord', run: duplicateWord },
  { id: 'subjectVerbAgreement', run: subjectVerbAgreement },
  { id: 'numberAgreement', run: numberAgreement },
  { id: 'articleUsage', run: articleUsage },
  { id: 'sentenceCapitalization', run: sentenceCapitalization },
  { id: 'spacing', run: spacing },
  { id: 'brackets', run: brackets },
  { id: 'sentenceFragment', run: sentenceFragment },
  { id: 'runOnSentence', run: runOnSentence },
  { id: 'informalLanguage', run: informalLanguage },
  { id: 'scientificStyle', run: scientificStyle },
  { id: 'clarity', run: clarity },
  { id: 'reportingTense', run: reportingTense },
]);

/** Rules that need every block of the section/document at once. */
export const DOCUMENT_RULES = Object.freeze([
  { id: 'repeatedSentenceOpener', run: repeatedSentenceOpener },
]);

/**
 * ruleId → metadata. The UI's "ignore this rule" list, the Ops-facing description of
 * what the engine actually checks, and the honest statement of each rule's scope.
 */
export const RULE_META = Object.freeze({
  [DUPLICATE_RULE_ID]: {
    category: CATEGORY.DUPLICATE,
    label: 'Repeated word',
    scope: 'Two identical words separated only by spaces.',
  },
  [SUBJECT_VERB_RULE_ID]: {
    category: CATEGORY.AGREEMENT,
    label: 'Subject–verb agreement',
    scope: 'Determiner + plural noun + singular verb (and the reverse). Complex noun phrases are not analysed.',
  },
  [NUMBER_RULE_ID]: {
    category: CATEGORY.AGREEMENT,
    label: 'Singular/plural agreement',
    scope: 'Determiner and noun disagree in number.',
  },
  [ARTICLE_RULE_ID]: {
    category: CATEGORY.ARTICLE,
    label: 'a / an',
    scope: 'Article chosen by sound, with acronym pronunciation treated as uncertain.',
  },
  [CAPITAL_RULE_ID]: {
    category: CATEGORY.CAPITALIZATION,
    label: 'Sentence capitalization',
    scope: 'First word of a sentence, excluding terms such as pH and mRNA.',
  },
  [DOUBLE_SPACE_RULE_ID]: {
    category: CATEGORY.PUNCTUATION,
    label: 'Double space',
    scope: 'Two or more spaces between words.',
  },
  [SPACE_BEFORE_PUNCT_RULE_ID]: {
    category: CATEGORY.PUNCTUATION,
    label: 'Space before punctuation',
    scope: 'A space before , . ; : ! ?',
  },
  [MISSING_SPACE_RULE_ID]: {
    category: CATEGORY.PUNCTUATION,
    label: 'Missing space after punctuation',
    scope: 'A comma or semicolon between two letters.',
  },
  [BRACKET_RULE_ID]: {
    category: CATEGORY.PUNCTUATION,
    label: 'Unbalanced brackets',
    scope: 'Brackets that do not pair within a block.',
  },
  [FRAGMENT_RULE_ID]: {
    category: CATEGORY.FRAGMENT,
    label: 'Sentence fragment',
    scope: 'Sentences with no verb at all, or only a bare participle. Conservative by design.',
  },
  [RUNON_RULE_ID]: {
    category: CATEGORY.RUNON,
    label: 'Run-on sentence',
    scope: 'Comma splice with a pronoun subject on both sides. Other run-ons are not detected.',
  },
  [INFORMAL_RULE_ID]: {
    category: CATEGORY.INFORMAL,
    label: 'Informal language',
    scope: 'A closed list of informal phrases and contractions.',
  },
  [STYLE_RULE_ID]: {
    category: CATEGORY.STYLE,
    label: 'Scientific style',
    scope: 'Conventions of medical writing (prove/demonstrate, data are plural, wordiness).',
  },
  [PREPOSITION_RULE_ID]: {
    category: CATEGORY.PREPOSITION,
    label: 'Preposition usage',
    scope: 'A closed list of verb/adjective + preposition collocations.',
  },
  [CLARITY_RULE_ID]: {
    category: CATEGORY.CLARITY,
    label: 'Long sentence',
    scope: 'Sentences longer than 45 words.',
  },
  [TENSE_RULE_ID]: {
    category: CATEGORY.TENSE,
    label: 'Reporting tense',
    scope: 'Future tense inside Methods or Results. Requires the section kind to be known.',
  },
  [REPETITION_RULE_ID]: {
    category: CATEGORY.REPETITION,
    label: 'Repeated sentence opener',
    scope: 'Three or more consecutive sentences beginning with the same word.',
  },
});

export const ALL_RULE_IDS = Object.freeze(Object.keys(RULE_META));

export {
  duplicateWord, subjectVerbAgreement, numberAgreement, articleUsage,
  sentenceCapitalization, spacing, brackets, sentenceFragment, runOnSentence,
  informalLanguage, scientificStyle, clarity, reportingTense, repeatedSentenceOpener,
};
