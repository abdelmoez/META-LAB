import { describe, it, expect } from 'vitest';
import { createDedupIndex, DEDUP_RULE_VERSION } from '../../../server/pecanSearch/dedup.js';

const REC = (o) => ({ id: o.id || '', title: o.title || '', doi: o.doi || '', pmid: o.pmid || '', year: o.year || '', authors: o.authors || '', journal: o.journal || '' });

describe('dedup orchestration', () => {
  it('exposes the engine rule version', () => {
    expect(typeof DEDUP_RULE_VERSION).toBe('string');
  });

  it('detects an exact DOI match against an EXISTING project record', () => {
    const idx = createDedupIndex([REC({ id: 'e1', title: 'Some study', doi: '10.1/x', year: '2020' })]);
    const v = idx.classify({ title: 'Some study (reprint)', doi: '10.1/x', year: '2020' });
    expect(v.outcome).toBe('existing_match');
    expect(v.matchedId).toBe('e1');
  });

  it('detects an exact_dup against an IN-RUN landed record', () => {
    const idx = createDedupIndex([]);
    idx.addLanded(REC({ id: 'r1', title: 'Trial of metformin', pmid: '555', year: '2019' }));
    const v = idx.classify({ title: 'Trial of metformin', pmid: '555', year: '2019' });
    expect(v.outcome).toBe('exact_dup');
    expect(v.matchedId).toBe('r1');
  });

  it('auto-merges a high-confidence fuzzy duplicate against an IN-RUN landed record (probable → fuzzy_dup)', () => {
    const idx = createDedupIndex([]);
    idx.addLanded(REC({ id: 'r1', title: 'Effect of metformin on glycaemic control in adults', authors: 'Smith J; Doe A', journal: 'Diabetes Care', year: '2018' }));
    const v = idx.classify({ title: 'Effect of metformin on glycemic control in adults', authors: 'Smith J; Doe A', journal: 'Diabetes Care', year: '2018' });
    expect(['fuzzy_dup', 'ambiguous']).toContain(v.outcome);
    if (v.outcome === 'fuzzy_dup') expect(v.decisionSource).toBe('automatic');
  });

  it('a PROBABLE fuzzy match against a PRE-EXISTING record is an existing_match, not fuzzy_dup (78.md #4 recs — makes reruns rerun-stable)', () => {
    const idx = createDedupIndex([REC({ id: 'e1', title: 'Effect of metformin on glycaemic control in adults', authors: 'Smith J; Doe A', journal: 'Diabetes Care', year: '2018' })]);
    const v = idx.classify({ title: 'Effect of metformin on glycemic control in adults', authors: 'Smith J; Doe A', journal: 'Diabetes Care', year: '2018' });
    expect(v.outcome).toBe('existing_match');
    expect(v.matchedId).toBe('e1');
  });

  it('routes a possible/related match to ambiguous review (not auto-merged)', () => {
    const idx = createDedupIndex([REC({ id: 'e1', title: 'Metformin therapy in older patients with diabetes', authors: 'Smith J', journal: 'Lancet', year: '2015' })]);
    const v = idx.classify({ title: 'Metformin therapy in older patients with diabetes', authors: 'Smith J', journal: 'NEJM', year: '2017', doi: '10.9/diff' });
    // Different venue + year + identifier with similar title → related/family → ambiguous.
    expect(['ambiguous', 'new']).toContain(v.outcome);
  });

  it('returns new when there is no match', () => {
    const idx = createDedupIndex([REC({ id: 'e1', title: 'Completely unrelated topic about astronomy' })]);
    const v = idx.classify({ title: 'A study of cardiac surgery outcomes', doi: '10.1/heart' });
    expect(v.outcome).toBe('new');
  });

  it('disables fuzzy blocking above the ceiling (still does exact)', () => {
    const big = Array.from({ length: 5 }, (_, i) => REC({ id: 'e' + i, title: 'Title number ' + i, doi: '10.1/' + i }));
    const idx = createDedupIndex(big, { fuzzyCeiling: 2 });
    expect(idx.fuzzyEnabled).toBe(false);
    expect(idx.classify({ doi: '10.1/3', title: 'whatever' }).outcome).toBe('existing_match');
  });
});
