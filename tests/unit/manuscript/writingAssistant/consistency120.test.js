/**
 * 120.md §6 — "Terminology consistency" and "Acronym intelligence".
 *
 * The design property under test is restraint: a consistency family only fires when
 * the MANUSCRIPT ITSELF disagrees, because `follow up` and `meta analysis` are not
 * errors on their own. And an acronym is only "already defined" when the initials of
 * the preceding words genuinely spell it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkConsistency, variantPairOf, TERM_FAMILIES,
  TERM_RULE_ID, VARIANT_RULE_ID, PROPER_CASE_RULE_ID,
} from '../../../../src/features/manuscript/writingAssistant/engine/consistency.js';
import {
  analyzeAcronyms, expansionMatches, COMMON_ACRONYMS,
  UNDEFINED_RULE_ID, USED_BEFORE_RULE_ID, INCONSISTENT_RULE_ID, DUPLICATE_TERM_RULE_ID,
} from '../../../../src/features/manuscript/writingAssistant/engine/acronyms.js';
import { SEVERITY, CATEGORY } from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';
import { blocksOf, usChecker } from './waFixture.js';

const meta = () => ({ docId: 'd1', sectionId: 's1', isCommonWord: (w) => usChecker().isKnown(w) });
const ruleIds = (issues) => issues.map((i) => i.ruleId);
const originals = (issues, ruleId) => issues.filter((i) => i.ruleId === ruleId).map((i) => i.original);

describe('120.md §6 — inconsistent terminology', () => {
  it('flags meta analysis when meta-analysis dominates', () => {
    const issues = checkConsistency(blocksOf([
      'We performed a meta-analysis of 14 trials.',
      'A second meta-analysis was prespecified.',
      'The meta analysis used a random-effects model.',
    ]), meta());
    expect(originals(issues, TERM_RULE_ID)).toEqual(['meta analysis']);
    expect(issues[0].suggestions).toEqual(['meta-analysis']);
    expect(issues[0].severity).toBe(SEVERITY.SUGGESTION);
  });

  it('stays SILENT when only one spelling is used', () => {
    // "follow up" alone is a correct verb phrase and must never be "corrected".
    const issues = checkConsistency(blocksOf([
      'Patients were followed up for 24 months.',
      'We could not follow up two participants.',
    ]), meta());
    expect(ruleIds(issues)).not.toContain(TERM_RULE_ID);
  });

  it('flags the minority form of follow-up when both appear', () => {
    const issues = checkConsistency(blocksOf([
      'Median follow-up was 24 months.',
      'The follow-up rate was 92%.',
      'Follow up was complete for most participants.',
    ]), meta());
    expect(originals(issues, TERM_RULE_ID)).toEqual(['Follow up']);
    expect(issues.find((i) => i.ruleId === TERM_RULE_ID).suggestions).toEqual(['Follow-up']);
  });

  it('treats the three §6 p-value spellings as a case-sensitive family', () => {
    const issues = checkConsistency(blocksOf([
      'The p-value was 0.03.',
      'A second p-value was 0.10.',
      'The P value for interaction was 0.4.',
    ]), meta());
    expect(originals(issues, TERM_RULE_ID)).toEqual(['P value']);
  });

  it('maps plural forms across groups', () => {
    const issues = checkConsistency(blocksOf([
      'Two meta-analyses were identified.',
      'A third meta-analysis was found.',
      'Both meta analyses were underpowered.',
    ]), meta());
    const issue = issues.find((i) => i.ruleId === TERM_RULE_ID);
    expect(issue.original).toBe('meta analyses');
    expect(issue.suggestions).toEqual(['meta-analyses']);
  });

  it('keeps every family well formed (parallel groups)', () => {
    for (const family of TERM_FAMILIES) {
      const width = family.groups[0].length;
      for (const group of family.groups) expect(group.length, family.id).toBe(width);
      expect(family.groups.length).toBeGreaterThan(1);
    }
  });
});

describe('120.md §6 — US/UK variants are never spelling errors', () => {
  it('classifies both sides of a real variant pair', () => {
    expect(variantPairOf('randomised').side).toBe('en-GB');
    expect(variantPairOf('randomized').side).toBe('en-US');
    expect(variantPairOf('analyse').side).toBe('en-GB');
    expect(variantPairOf('tumour').side).toBe('en-GB');
  });

  it('refuses to treat ordinary -ise words as British variants', () => {
    // The trap a morphological "-ise$" rule falls into.
    for (const word of ['exercise', 'comprise', 'supervise', 'precise', 'expertise', 'promise', 'otherwise']) {
      expect(variantPairOf(word), word).toBeNull();
    }
  });

  it('recommends consistency only when both variants appear', () => {
    const consistent = checkConsistency(blocksOf([
      'Patients were randomised centrally.',
      'Allocation was randomised in blocks.',
    ]), { ...meta(), variant: 'en-US' });
    expect(ruleIds(consistent)).not.toContain(VARIANT_RULE_ID);

    const mixed = checkConsistency(blocksOf([
      'Patients were randomised centrally.',
      'Randomized allocation was concealed.',
    ]), { ...meta(), variant: 'en-US' });
    const issue = mixed.find((i) => i.ruleId === VARIANT_RULE_ID);
    expect(issue.original).toBe('randomised');
    expect(issue.suggestions).toEqual(['randomized']);
    expect(issue.category).toBe(CATEGORY.CONSISTENCY);
    expect(issue.severity).toBe(SEVERITY.SUGGESTION);
  });

  it('follows the user preference when it is UK', () => {
    const issues = checkConsistency(blocksOf([
      'Patients were randomised centrally.',
      'Randomized allocation was concealed.',
    ]), { ...meta(), variant: 'en-GB' });
    const issue = issues.find((i) => i.ruleId === VARIANT_RULE_ID);
    expect(issue.original).toBe('Randomized');
    expect(issue.suggestions).toEqual(['Randomised']);
  });
});

describe('120.md §6 — capitalization of known proper nouns', () => {
  it('suggests the conventional casing of a database name', () => {
    const issues = checkConsistency(blocksOf(['We searched Pubmed and embase.']), meta());
    expect(originals(issues, PROPER_CASE_RULE_ID).sort()).toEqual(['Pubmed', 'embase']);
  });

  it('never "corrects" an ordinary word that shares a tool name', () => {
    // GRADE, CARE, SIGN, NICE and CENTRAL are all ordinary English words too.
    const issues = checkConsistency(blocksOf([
      'The central estimate was of low grade, and we take care with the sign.',
    ]), meta());
    expect(ruleIds(issues)).not.toContain(PROPER_CASE_RULE_ID);
  });
});

describe('120.md §6 — acronym intelligence', () => {
  it('accepts a definition only when the initials match', () => {
    expect(expansionMatches('Inflammatory bowel disease', 'IBD')).toBe('Inflammatory bowel disease');
    expect(expansionMatches('body mass index', 'BMI')).toBe('body mass index');
    expect(expansionMatches('Health related quality of life', 'HRQoL')).toBe('Health related quality of life');
    expect(expansionMatches('the analysis was repeated see', 'TABLE')).toBeNull();
  });

  it('does NOT ask to redefine an acronym already defined (the §6 case)', () => {
    const issues = analyzeAcronyms(blocksOf([
      'Inflammatory bowel disease (IBD) was assessed. Patients with IBD had higher scores.',
    ]), meta());
    expect(issues).toHaveLength(0);
  });

  it('flags an acronym that is never defined', () => {
    const issues = analyzeAcronyms(blocksOf(['The XYZ score was calculated.']), meta());
    expect(ruleIds(issues)).toEqual([UNDEFINED_RULE_ID]);
    expect(issues[0].category).toBe(CATEGORY.ACRONYM);
    expect(issues[0].severity).toBe(SEVERITY.SUGGESTION);
    expect(issues[0].suggestions).toEqual([]); // §6: never auto-rewrite an acronym
  });

  it('flags use before definition at the FIRST use', () => {
    const issues = analyzeAcronyms(blocksOf([
      'Patients with UC were enrolled at baseline.',
      'Ulcerative colitis (UC) is a chronic disease.',
    ]), meta());
    expect(ruleIds(issues)).toEqual([USED_BEFORE_RULE_ID]);
    expect(issues[0].blockIndex).toBe(0);
  });

  it('flags two different expansions of one acronym', () => {
    const issues = analyzeAcronyms(blocksOf([
      'Health related quality of life (HRQL) improved.',
      'Health reported quality of living (HRQL) was measured.',
    ]), meta());
    expect(ruleIds(issues)).toContain(INCONSISTENT_RULE_ID);
  });

  it('flags two acronyms defined for the same term', () => {
    const issues = analyzeAcronyms(blocksOf([
      'Health related quality of life (HRQL) improved.',
      'Health related quality of life (HRQOL) was measured.',
    ]), meta());
    expect(ruleIds(issues)).toContain(DUPLICATE_TERM_RULE_ID);
  });

  it('respects the configurable common-abbreviation allowlist', () => {
    expect(COMMON_ACRONYMS.has('MRI')).toBe(true);
    const noisy = blocksOf(['An MRI and a CT scan were performed.']);
    expect(analyzeAcronyms(noisy, meta())).toHaveLength(0);
    // A caller may narrow the allowlist and then MRI does need defining.
    const strict = analyzeAcronyms(noisy, { ...meta(), commonAcronyms: new Set() });
    expect(ruleIds(strict)).toContain(UNDEFINED_RULE_ID);
  });

  it('does not treat database and instrument names as undefined acronyms', () => {
    const issues = analyzeAcronyms(blocksOf([
      'We searched MEDLINE and CENTRAL and followed PRISMA and used GRADE.',
    ]), meta());
    expect(issues).toHaveLength(0);
  });

  it('ignores an all-capitals heading', () => {
    const issues = analyzeAcronyms([{ index: 0, rev: 'r0', text: 'MATERIALS AND METHODS SECTION', kind: 'paragraph' }], meta());
    expect(issues).toHaveLength(0);
  });
});
