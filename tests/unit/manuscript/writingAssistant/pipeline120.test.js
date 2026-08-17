/**
 * 120.md §6 — the EXAMPLE VALIDATION CASES, end to end through the real pipeline
 * with the real SCOWL dictionary.
 *
 * §6 ends with a list of sentences and the behaviour each must produce. That list is
 * reproduced verbatim below, one `it` per case, because it is the specification's own
 * acceptance test and the only honest way to claim the feature works. The remaining
 * blocks cover the pipeline's own contracts: block classification, deduplication,
 * muting, stale-text protection, and the privacy property that nothing leaves.
 */
import { describe, it, expect } from 'vitest';
import { createPipeline, mergeIssues, SPELLING_RULE_ID } from '../../../../src/features/manuscript/writingAssistant/engine/pipeline.js';
import { buildProjectLexicon } from '../../../../src/features/manuscript/writingAssistant/engine/projectLexicon.js';
import { indexDictionary } from '../../../../src/features/manuscript/writingAssistant/engine/spellcheck.js';
import {
  CATEGORY, SEVERITY, dedupeIssues, issueMatchesText, filterMuted, countByCategory,
  makeIssue, issueId, CATEGORY_GROUP, ALL_CATEGORIES,
} from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';
import { splitBlocks, blockRevision, BLOCK_KIND } from '../../../../src/features/manuscript/writingAssistant/engine/blocks.js';
import { usChecker, blocksOf } from './waFixture.js';

const pipeline = (config = {}) => createPipeline({ spellChecker: usChecker(), ...config });

/** Issues for a single paragraph, through the full block pipeline. */
function checkOne(text, opts = {}, config = {}) {
  return pipeline(config).checkBlock({ index: 0, rev: 'r0', text, kind: 'paragraph' }, opts);
}

describe('120.md §6 — example validation cases (verbatim)', () => {
  it('"The studies was included in the analysis." → detects subject–verb disagreement', () => {
    const issues = checkOne('The studies was included in the analysis.');
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe(CATEGORY.AGREEMENT);
    expect(issues[0].suggestions).toContain('were');
  });

  it('"We searched PubMed, MEDLINE, Embase, and CENTRAL." → does not mark database names as misspellings', () => {
    expect(checkOne('We searched PubMed, MEDLINE, Embase, and CENTRAL.')).toEqual([]);
  });

  it('"The hepatocelular injury was assessed." → suggests hepatocellular', () => {
    const issues = checkOne('The hepatocelular injury was assessed.');
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe(CATEGORY.SPELLING);
    expect(issues[0].severity).toBe(SEVERITY.ERROR);
    expect(issues[0].original).toBe('hepatocelular');
    expect(issues[0].suggestions).toContain('hepatocellular');
  });

  it('"The the participants were followed for 12 months." → detects the repeated word', () => {
    const issues = checkOne('The the participants were followed for 12 months.');
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe(CATEGORY.DUPLICATE);
  });

  it('"Heterogeneity was assessed using I², and p < 0.05 was considered significant." → does not corrupt statistical notation', () => {
    expect(checkOne('Heterogeneity was assessed using I², and p < 0.05 was considered significant.')).toEqual([]);
  });

  it('"The Newcastle–Ottawa Scale was used to evaluate cohort studies." → recognizes the tool name and the en dash', () => {
    expect(checkOne('The Newcastle–Ottawa Scale was used to evaluate cohort studies.')).toEqual([]);
  });

  it('"The intervention was administered at 5 mg/kg." → preserves dosage formatting', () => {
    expect(checkOne('The intervention was administered at 5 mg/kg.')).toEqual([]);
  });

  it('"Inflammatory bowel disease (IBD) was assessed. Patients with IBD..." → recognizes the acronym as defined', () => {
    const blocks = blocksOf(['Inflammatory bowel disease (IBD) was assessed. Patients with IBD had higher scores.']);
    const result = pipeline().check(blocks, { mode: 'document' });
    expect(mergeIssues(result)).toEqual([]);
  });

  it('a new drug or trial acronym stored in the project references is learned, not flagged', () => {
    const projectLexicon = buildProjectLexicon({
      studyTitles: ['Efficacy of quixadrol in Crohn disease: the ZORBTRIAL randomized study'],
    });
    const text = 'Patients received quixadrol during induction.';
    // Without the project lexicon it is an unknown word to every other layer...
    expect(checkOne(text).map((i) => i.original)).toContain('quixadrol');
    // ...and with it, the project's own trusted reference metadata vouches for it.
    expect(checkOne(text, {}, { projectLexicon })).toEqual([]);
    // A monoclonal-antibody name needs no project at all — suffix morphology carries
    // the whole `-mab`/`-inib` class, which is the scalable half of the strategy.
    expect(checkOne('Patients received zorblimab during induction.')).toEqual([]);
  });
});

describe('120.md §6 — additional token-firewall cases end to end', () => {
  const CLEAN = [
    'Records were identified from 2019–2021 across five databases.',
    'The record is indexed as PMID: 38123456 and doi:10.1136/bmj.n71.',
    'The protocol is registered as NCT04512345 and CRD42021234567.',
    'Full text is at https://example.org/article?id=7 for readers.',
    'The pooled estimate was 1.42 (95% CI 1.11 to 1.82).',
    'Body mass index was 27.4 kg/m² and eGFR 68 mL/min/1.73 m².',
    'Expression of TP53 and serum IL-6 were measured.',
    'The α level was 0.05 and power was 1 − β.',
    'Between-study variance was τ² = 0.08 with I² = 46%.',
  ];
  for (const text of CLEAN) {
    it(`reports nothing for: ${text}`, () => { expect(checkOne(text)).toEqual([]); });
  }
});

describe('120.md §6 — block classification and exclusion rules', () => {
  it('splits committed markdown the way mdToHtml sees it, and keeps offsets aligned', () => {
    const md = [
      '# Methods', '', 'We searched PubMed.', '',
      '| Study | n | Outcome |', '| --- | --- | --- |', '| Smith 2020 | 120 | remission |', '',
      '- first item', '', '[[tblcap:t1]] Baseline characteristics', '',
      '```', 'notprose here', '```',
    ].join('\n');
    const blocks = splitBlocks(md, { sectionKind: 'methods' });
    expect(blocks.map((b) => b.kind)).toEqual([
      BLOCK_KIND.HEADING, BLOCK_KIND.PARAGRAPH, BLOCK_KIND.TABLE_ROW,
      BLOCK_KIND.SEPARATOR, BLOCK_KIND.TABLE_ROW, BLOCK_KIND.LIST_ITEM,
      BLOCK_KIND.CAPTION_TITLE, BLOCK_KIND.CODE, BLOCK_KIND.CODE, BLOCK_KIND.CODE,
    ]);
    // The single invariant the decoration layer depends on.
    for (const block of blocks) expect(block.checkText).toHaveLength(block.text.length);
    // Numeric table cells and separators carry no checkable text.
    const numericRow = blocks.find((b) => b.text.includes('Smith 2020'));
    expect(numericRow.checkText).toContain('Smith 2020');
    expect(numericRow.checkText).not.toContain('120');
    expect(blocks.find((b) => b.kind === BLOCK_KIND.SEPARATOR).checkable).toBe(false);
    // The caption TITLE is checked; its token is not.
    const caption = blocks.find((b) => b.kind === BLOCK_KIND.CAPTION_TITLE);
    expect(caption.checkText).toContain('Baseline characteristics');
    expect(caption.checkText).not.toContain('tblcap');
  });

  it('classifies formatted reference entries out but keeps prose annotations in', () => {
    const md = [
      '1. Smith J, Jones A. Trial of something. Lancet. 2020;395:1—10.',
      'This reference was retracted in 2021 and is retained for transparency.',
    ].join('\n');
    const blocks = splitBlocks(md, { sectionKind: 'references' });
    expect(blocks[0].kind).toBe(BLOCK_KIND.REFERENCE_ENTRY);
    expect(blocks[0].checkable).toBe(false);
    expect(blocks[1].kind).toBe(BLOCK_KIND.PARAGRAPH);
    expect(blocks[1].checkable).toBe(true);
  });

  it('never checks a skipped block even if asked', () => {
    const issues = pipeline().checkBlock(
      { index: 0, rev: 'r0', text: 'notaword notaword', kind: BLOCK_KIND.CODE, checkable: false },
      {},
    );
    expect(issues).toEqual([]);
  });

  it('changes the block revision when the text changes', () => {
    expect(blockRevision('a')).not.toBe(blockRevision('b'));
    expect(blockRevision('same')).toBe(blockRevision('same'));
  });

  it('does not apply sentence-shaped rules to table rows', () => {
    // A results table is many rows starting with the same surname; without the
    // table-row exemption the repetition rule reports every table in the paper.
    const md = [
      '| Study | n | Outcome |', '| --- | --- | --- |',
      '| Smith 2020 | 120 | remission |',
      '| Smith 2021 | 130 | remission |',
      '| Smith 2022 | 140 | remission |',
    ].join('\n');
    const blocks = splitBlocks(md).map((b) => ({ ...b, rev: `v${b.index}` }));
    const result = pipeline().check(blocks, { mode: 'document' });
    expect(mergeIssues(result)).toEqual([]);
  });

  it('stays quiet on a long realistic draft (no false positives)', () => {
    const paragraph = 'We searched PubMed, Embase, Cochrane CENTRAL, and Web of Science '
      + 'from inception to 15 January 2026 [[cite:r1]]. Risk of bias was assessed with '
      + 'RoB 2 and ROBINS-I. The pooled odds ratio was 1.42 (95% CI 1.11 to 1.82; '
      + 'I² = 46%; p = 0.006). Median follow-up was 24 months and eGFR was '
      + '68 mL/min/1.73 m² at baseline.';
    const md = Array.from({ length: 20 }, () => paragraph).join('\n\n');
    const blocks = splitBlocks(md, { sectionKind: 'methods' }).map((b) => ({ ...b, rev: `v${b.index}` }));
    expect(blocks.length).toBe(20);
    expect(mergeIssues(pipeline().check(blocks, { mode: 'document' }))).toEqual([]);
  });
});

describe('120.md §6 — issue normalization, dedupe and muting', () => {
  const at = (start, end, ruleId, extra = {}) => makeIssue({
    blockIndex: 0, start, end, ruleId, category: CATEGORY.SPELLING, original: 'x', ...extra,
  });

  it('collapses identical (block,start,end,rule) findings', () => {
    expect(dedupeIssues([at(0, 3, 'wa.spelling'), at(0, 3, 'wa.spelling')])).toHaveLength(1);
  });

  it('keeps the stronger of two same-range same-category findings', () => {
    const [kept] = dedupeIssues([
      at(0, 3, 'a', { severity: SEVERITY.SUGGESTION, confidence: 0.4 }),
      at(0, 3, 'b', { severity: SEVERITY.ERROR, confidence: 0.9 }),
    ]);
    expect(kept.ruleId).toBe('b');
  });

  it('keeps two findings of DIFFERENT categories on one range', () => {
    const issues = dedupeIssues([
      at(0, 3, 'a', { category: CATEGORY.SPELLING }),
      at(0, 3, 'b', { category: CATEGORY.CAPITALIZATION }),
    ]);
    expect(issues).toHaveLength(2);
  });

  it('produces a stable id that survives a recheck and changes with the range', () => {
    const key = { docId: 'd', sectionId: 's', blockIndex: 2, start: 4, end: 9, ruleId: 'wa.spelling' };
    expect(issueId(key)).toBe(issueId({ ...key }));
    expect(issueId(key)).not.toBe(issueId({ ...key, start: 5 }));
  });

  it('maps every category to a decoration group so the UI needs four styles, not eighteen', () => {
    for (const category of ALL_CATEGORIES) expect(CATEGORY_GROUP[category]).toBeTruthy();
  });

  it('mutes categories and rules in one place', () => {
    const issues = [at(0, 3, 'wa.spelling'), at(4, 7, 'wa.style', { category: CATEGORY.STYLE })];
    expect(filterMuted(issues, { mutedCategories: new Set([CATEGORY.STYLE]) })).toHaveLength(1);
    expect(filterMuted(issues, { mutedRules: new Set(['wa.spelling']) })).toHaveLength(1);
    expect(countByCategory(issues)).toEqual({ spelling: 1, style: 1 });
  });

  it('honours muted categories inside the pipeline itself', () => {
    const muted = pipeline({ mutedCategories: new Set([CATEGORY.SPELLING]) });
    const issues = muted.checkBlock({ index: 0, rev: 'r0', text: 'The hepatocelular injury.', kind: 'paragraph' }, {});
    expect(issues).toEqual([]);
  });

  it('refuses to confirm an issue whose text has changed (stale-result protection)', () => {
    const issue = makeIssue({
      blockIndex: 0, start: 4, end: 17, ruleId: SPELLING_RULE_ID,
      category: CATEGORY.SPELLING, original: 'hepatocelular',
    });
    expect(issueMatchesText(issue, 'The hepatocelular injury.')).toBe(true);
    expect(issueMatchesText(issue, 'The hepatocellular injury.')).toBe(false);
    expect(issueMatchesText(issue, 'short')).toBe(false);
  });
});

describe('120.md §6 — dictionary scopes', () => {
  const text = 'Patients received quixadrol at baseline.';

  it('accepts a word from the personal dictionary', () => {
    const userDictionary = indexDictionary([{ term: 'quixadrol' }]);
    expect(checkOne(text).map((i) => i.original)).toContain('quixadrol');
    expect(checkOne(text, {}, { userDictionary })).toEqual([]);
  });

  it('accepts a word from the project dictionary', () => {
    const projectDictionary = indexDictionary([{ term: 'quixadrol', caseSensitive: false }]);
    expect(checkOne(text, {}, { projectDictionary })).toEqual([]);
  });

  it('respects case sensitivity on a dictionary entry', () => {
    const projectDictionary = indexDictionary([{ term: 'QUIXA', caseSensitive: true }]);
    expect(checkOne('The QUIXA trial ran.', {}, { projectDictionary })).toEqual([]);
  });

  it('accepts a term ignored for this manuscript', () => {
    expect(checkOne(text, {}, { ignoredTerms: new Set(['quixadrol']) })).toEqual([]);
  });

  it('teaches new dictionary words to the suggester through update()', () => {
    const pipe = pipeline();
    const lexicon = buildProjectLexicon({ studyTitles: ['A trial of quixadrol in adults'] });
    pipe.update({ projectLexicon: lexicon });
    expect(pipe.checkBlock({ index: 0, rev: 'r0', text, kind: 'paragraph' }, {})).toEqual([]);
  });
});

describe('120.md §6 — document mode vs incremental mode', () => {
  const blocks = blocksOf([
    'We performed a meta-analysis of 14 trials.',
    'The meta analysis used a random-effects model.',
  ]);

  it('runs the document passes only in document mode', () => {
    const incremental = pipeline().check(blocks, { mode: 'blocks' });
    expect(incremental.documentIssues).toEqual([]);
    const full = pipeline().check(blocks, { mode: 'document' });
    expect(full.documentIssues.length).toBeGreaterThan(0);
  });

  it('returns per-block results tagged with the revision that was checked', () => {
    const result = pipeline().check(blocks, { mode: 'blocks' });
    expect(result.blocks.map((b) => b.rev)).toEqual(['r0', 'r1']);
    expect(result.stats.blockCount).toBe(2);
  });

  it('budgets suggestion computation, which is the expensive part', () => {
    const many = blocksOf(Array.from({ length: 8 }, (_, i) => `The hepatocelular ${'zzq'.repeat(i + 1)} injury.`));
    const result = pipeline().check(many, { suggestionBudget: 2 });
    expect(result.stats.suggestionsComputed).toBe(2);
    const withSuggestions = mergeIssues(result).filter((i) => i.suggestions.length);
    expect(withSuggestions.length).toBeLessThanOrEqual(2);
  });
});

describe('120.md §6 — privacy: the engine performs no I/O', () => {
  it('produces only offsets and metadata; nothing is transmitted or persisted', async () => {
    // A structural assertion: no module in engine/ imports fetch, fs, XHR or a
    // network client. If one ever does, this reads as a deliberate decision.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const dir = path.resolve(
      path.dirname(url.fileURLToPath(import.meta.url)),
      '../../../../src/features/manuscript/writingAssistant/engine',
    );
    const files = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, `${path.basename(file)} must not perform I/O`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|node:fs|require\(['"]fs['"]\)|navigator\.sendBeacon|localStorage/);
    }
  });
});
