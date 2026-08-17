/**
 * 120.md §6 — the rule passes, as TRUE-POSITIVE / FALSE-POSITIVE matrices.
 *
 * §6 says twice that a grammar checker must not invent errors ("Do not treat
 * subjective style suggestions as definite grammatical errors"; "label confidence and
 * category appropriately"). A rule is therefore only as good as the sentences it
 * DECLINES to flag, so every rule below is tested in both directions and the negative
 * cases are drawn from real systematic-review prose.
 */
import { describe, it, expect } from 'vitest';
import { makeCtx } from './waFixture.js';
import { duplicateWord } from '../../../../src/features/manuscript/writingAssistant/engine/rules/duplicateWord.js';
import { subjectVerbAgreement, numberAgreement } from '../../../../src/features/manuscript/writingAssistant/engine/rules/agreement.js';
import { articleUsage } from '../../../../src/features/manuscript/writingAssistant/engine/rules/articles.js';
import { sentenceCapitalization } from '../../../../src/features/manuscript/writingAssistant/engine/rules/capitalization.js';
import { spacing, brackets } from '../../../../src/features/manuscript/writingAssistant/engine/rules/punctuation.js';
import { sentenceFragment, runOnSentence } from '../../../../src/features/manuscript/writingAssistant/engine/rules/fragments.js';
import { informalLanguage } from '../../../../src/features/manuscript/writingAssistant/engine/rules/informal.js';
import { scientificStyle, clarity, reportingTense } from '../../../../src/features/manuscript/writingAssistant/engine/rules/style.js';
import { repeatedSentenceOpener } from '../../../../src/features/manuscript/writingAssistant/engine/rules/repetition.js';
import { RULE_META, BLOCK_RULES, DOCUMENT_RULES } from '../../../../src/features/manuscript/writingAssistant/engine/rules/index.js';
import { CATEGORY, SEVERITY } from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';

const run = (rule, text, opts) => rule(makeCtx(text, opts));

/** `[sentence, expectedCount]` tables keep the intent visible at a glance. */
function matrix(rule, cases, opts) {
  for (const [text, expected] of cases) {
    it(`${expected ? 'flags' : 'ignores'}: ${text}`, () => {
      expect(run(rule, text, opts)).toHaveLength(expected);
    });
  }
}

describe('120.md §6 — duplicate words', () => {
  matrix(duplicateWord, [
    ['The the participants were followed for 12 months.', 1],
    ['We we searched five databases.', 1],
    ['The study study was registered.', 1],
    // Legitimate doubles and non-adjacent repeats.
    ['The trial had had two arms.', 0],
    ['We noted that that finding was robust.', 0],
    ['The result, the outcome, and the effect were reported.', 0],
    ['The study of the the cohort'.replace('the the', 'the'), 0],
  ]);

  it('reports the whole repeated span and offers the single word', () => {
    const [issue] = run(duplicateWord, 'The the participants were followed.');
    expect(issue.original).toBe('The the');
    expect(issue.suggestions).toEqual(['The']);
    expect(issue.severity).toBe(SEVERITY.ERROR);
    expect(issue.category).toBe(CATEGORY.DUPLICATE);
  });
});

describe('120.md §6 — subject–verb agreement', () => {
  matrix(subjectVerbAgreement, [
    ['The studies was included in the analysis.', 1],
    ['These trials was underpowered.', 1],
    ['Two reviewers was involved.', 1],
    ['They was excluded from the analysis.', 1],
    ['This study were conducted in 2021.', 1],
    // Singular nouns that merely END in s — the classic false positive.
    ['The analysis was restricted to adults.', 0],
    ['The consensus was that the evidence is weak.', 0],
    ['The apparatus was inadequate.', 0],
    ['The series was repeated.', 0],
    ['The bias was judged to be low.', 0],
    ['The process was piloted first.', 0],
    ['The diagnosis was confirmed histologically.', 0],
    // Correct agreement.
    ['The studies were included in the analysis.', 0],
    // A complex noun phrase: the rule declines rather than guessing.
    ['The studies of adults in the cohort was heterogeneous.', 0],
  ]);

  it('names the plural subject and offers the plural verb', () => {
    const [issue] = run(subjectVerbAgreement, 'The studies was included in the analysis.');
    expect(issue.category).toBe(CATEGORY.AGREEMENT);
    expect(issue.original).toBe('was');
    expect(issue.suggestions).toEqual(['were']);
    expect(issue.confidence).toBeGreaterThan(0.5);
  });
});

describe('120.md §6 — singular/plural agreement', () => {
  matrix(numberAgreement, [
    ['These study were analysed.', 1],
    ['Each patients was assessed.', 1],
    // Irregular plurals and uncountables must not be "corrected".
    ['These data were extracted independently.', 0],
    ['These criteria were prespecified.', 0],
    ['These analyses were exploratory.', 0],
    ['This study was registered.', 0],
    // A noun stack is not a mismatch.
    ['These patient records were reviewed.', 0],
  ]);
});

describe('120.md §6 — article usage', () => {
  matrix(articleUsage, [
    ['We used a additional cohort.', 1],
    ['There was an cohort study.', 1],
    ['a MRI was performed on Monday.', 1],
    ['We used an CT scan for imaging.', 1],
    // Vowel letters with a consonant sound.
    ['A university hospital took part.', 0],
    ['A unique identifier was assigned.', 0],
    ['A one-time dose was given.', 0],
    ['A European cohort was included.', 0],
    // Silent h.
    ['An hour later the results arrived.', 0],
    ['An honest appraisal followed.', 0],
    // Acronym pronunciation.
    ['An MRI was performed at baseline.', 0],
    ['An RCT was included.', 0],
    ['A CT scan was repeated.', 0],
  ]);

  it('treats acronym pronunciation as a suggestion, not an error', () => {
    const [issue] = run(articleUsage, 'a MRI was performed on Monday.');
    expect(issue.severity).toBe(SEVERITY.SUGGESTION);
    expect(issue.suggestions).toEqual(['an']);
  });
});

describe('120.md §6 — capitalization', () => {
  matrix(sentenceCapitalization, [
    ['patients were randomized in a 1:1 ratio.', 1],
    ['The trial ended. results were pooled.', 1],
    ['The trial ended. Results were pooled.', 0],
    // Terms that legitimately open a sentence in lower case.
    ['pH was measured at baseline.', 0],
    ['mRNA expression was quantified.', 0],
    ['iPSC lines were derived.', 0],
  ]);

  it('does not judge headings, captions or table cells', () => {
    expect(run(sentenceCapitalization, 'baseline characteristics', { blockKind: 'heading' })).toHaveLength(0);
    expect(run(sentenceCapitalization, 'remission', { blockKind: 'table-cell' })).toHaveLength(0);
  });
});

describe('120.md §6 — punctuation', () => {
  matrix(spacing, [
    ['We searched PubMed , then Embase.', 1],
    ['The result  was clear.', 1],
    ['Records were screened,then extracted.', 1],
    ['We searched PubMed, then Embase.', 0],
    // The firewall: a DOI, a URL and a unit chain contain none of these problems.
    ['See 10.1001/jama.2024.1234 for details.', 0],
    ['eGFR was 45 mL/min/1.73 m² at baseline.', 0],
    ['Significance was p < 0.05 throughout.', 0],
  ]);

  matrix(brackets, [
    ['The value was ( unbalanced.', 1],
    ['The value was unbalanced).', 1],
    ['The estimate was 1.42 (95% CI 1.11 to 1.82).', 0],
    ['Nested (brackets [work] fine).', 0],
  ]);
});

describe('120.md §6 — fragments and run-on sentences', () => {
  matrix(sentenceFragment, [
    ['Patients receiving the study intervention.', 1],
    // Complete sentences of every ordinary shape.
    ['We searched PubMed, MEDLINE, Embase, and CENTRAL.', 0],
    ['The pooled odds ratio was 1.42.', 0],
    ['Two reviewers independently screened all records.', 0],
    ['Data were extracted in duplicate.', 0],
  ]);

  it('never judges headings, captions or list items', () => {
    expect(run(sentenceFragment, 'Baseline characteristics of included studies', { blockKind: 'heading' })).toHaveLength(0);
    expect(run(sentenceFragment, 'risk of bias assessment', { blockKind: 'list-item' })).toHaveLength(0);
  });

  matrix(runOnSentence, [
    ['We searched five databases, we screened all records.', 1],
    ['The intervention was effective, it reduced pain.', 1],
    // Introductory adjuncts: a comma here is correct punctuation.
    ['In this study, we assessed the intervention.', 0],
    ['Compared with placebo, we found a reduction.', 0],
    ['In these patients, we observed a response.', 0],
    ['Although the effect was small, it was significant.', 0],
    ['Overall, we found consistent effects.', 0],
    // A coordinator or relative pronoun after the comma.
    ['Two reviewers screened records, and disagreements were resolved.', 0],
    ['We included 12 studies, which were mostly European.', 0],
  ]);

  it('reports only the comma, so applying the fix is one safe replacement', () => {
    const [issue] = run(runOnSentence, 'We searched five databases, we screened all records.');
    expect(issue.original).toBe(',');
    expect(issue.suggestions).toEqual([';']);
    expect(issue.severity).toBe(SEVERITY.SUGGESTION);
  });
});

describe('120.md §6 — informal language and scientific style', () => {
  matrix(informalLanguage, [
    ['We used a lot of different methods.', 1],
    ['The results do not support the hypothesis.', 0],
    ['We looked into the discrepancy.', 1],
  ]);

  it('expands contractions', () => {
    const issues = informalLanguage(makeCtx('The results don’t support the hypothesis.'));
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestions).toEqual(['do not']);
    expect(issues[0].category).toBe(CATEGORY.INFORMAL);
  });

  matrix(scientificStyle, [
    ['The data is presented in Table 1.', 1],
    ['This proved the hypothesis.', 1],
    ['Results were compared to placebo.', 1],
    ['The groups were different than each other.', 1],
    ['Results were compared with placebo.', 0],
    ['The data are presented in Table 1.', 0],
  ]);

  it('marks style findings as suggestions with a stated confidence', () => {
    const [issue] = run(scientificStyle, 'This proved the hypothesis.');
    expect(issue.severity).toBe(SEVERITY.SUGGESTION);
    expect(issue.category).toBe(CATEGORY.STYLE);
    expect(issue.confidence).toBeLessThan(0.6);
  });

  it('routes preposition collocations to the preposition category', () => {
    const [issue] = run(scientificStyle, 'The outcome was associated to exposure.');
    expect(issue.category).toBe(CATEGORY.PREPOSITION);
    expect(issue.suggestions).toEqual(['associated with']);
  });

  it('flags long sentences as clarity suggestions', () => {
    const long = `${'word '.repeat(50)}end.`;
    const issues = clarity(makeCtx(long));
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe(CATEGORY.CLARITY);
  });

  it('only judges reporting tense when the section kind is known', () => {
    expect(run(reportingTense, 'The intervention will be administered.')).toHaveLength(0);
    expect(run(reportingTense, 'The intervention will be administered.', { sectionKind: 'methods' })).toHaveLength(1);
    expect(run(reportingTense, 'Future work will address this.', { sectionKind: 'discussion' })).toHaveLength(0);
  });
});

describe('120.md §6 — repeated sentence openers (document rule)', () => {
  const blocks = (lines) => lines.map((text, index) => ({ index, rev: `r${index}`, text, kind: 'paragraph' }));

  it('flags three consecutive sentences with the same opener', () => {
    const issues = repeatedSentenceOpener(blocks([
      'We searched five databases.',
      'We screened all records.',
      'We extracted data in duplicate.',
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].blockIndex).toBe(2);
    expect(issues[0].category).toBe(CATEGORY.REPETITION);
  });

  it('ignores articles and short runs', () => {
    expect(repeatedSentenceOpener(blocks([
      'The first outcome was remission.',
      'The second outcome was response.',
      'The third outcome was safety.',
    ]))).toHaveLength(0);
    expect(repeatedSentenceOpener(blocks([
      'We searched five databases.',
      'We screened all records.',
      'Data were extracted in duplicate.',
    ]))).toHaveLength(0);
  });
});

describe('120.md §6 — rule registry', () => {
  it('documents every registered rule id with a category and a scope', () => {
    for (const [ruleId, meta] of Object.entries(RULE_META)) {
      expect(ruleId.startsWith('wa.'), ruleId).toBe(true);
      expect(meta.category).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.scope.length).toBeGreaterThan(10);
    }
  });

  it('keeps block and document rules disjoint and callable', () => {
    const blockIds = BLOCK_RULES.map((r) => r.id);
    const docIds = DOCUMENT_RULES.map((r) => r.id);
    expect(blockIds.some((id) => docIds.includes(id))).toBe(false);
    for (const rule of [...BLOCK_RULES, ...DOCUMENT_RULES]) {
      expect(typeof rule.run).toBe('function');
    }
  });
});
