/**
 * dupClassify.test.js — se2.md §10 typed duplicate classification (pure).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPair, extractDupFeatures, evaluateDuplicateLabels,
  DUP_TYPES, DUP_MERGEABLE, DUP_MODEL_VERSION,
} from '../../../src/research-engine/screening/deduplication.js';

describe('extractDupFeatures', () => {
  it('detects identifier matches and conflicts', () => {
    const f = extractDupFeatures(
      { doi: '10.1/X', pmid: '111', year: 2020, journal: 'Lancet' },
      { doi: '10.1/x', pmid: '222', year: 2021, journal: 'BMJ' },
    );
    expect(f.doiMatch).toBe(true);       // case-insensitive
    expect(f.pmidConflict).toBe(true);
    expect(f.yearConflict).toBe(true);
    expect(f.journalConflict).toBe(true);
  });
  it('abstractSim is null when an abstract is missing', () => {
    expect(extractDupFeatures({ abstract: 'a b c' }, {}).abstractSim).toBe(null);
  });
});

describe('classifyPair', () => {
  const A = { title: 'Metformin in type 2 diabetes: a randomised trial', authors: 'Smith J; Doe A', year: 2020, journal: 'Lancet', volume: '10', pages: '1-9', doi: '10.1/abc' };

  it('exact_duplicate on DOI match (mergeable)', () => {
    const r = classifyPair(A, { ...A, title: 'slightly different title text here' });
    expect(r.type).toBe(DUP_TYPES.EXACT);
    expect(r.mergeable).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/DOI/i);
  });

  it('exact_duplicate on PMID match', () => {
    const r = classifyPair({ pmid: '999', title: 'x' }, { pmid: '999', title: 'y' });
    expect(r.type).toBe(DUP_TYPES.EXACT);
  });

  it('probable_duplicate: near-identical title + same venue, no conflict', () => {
    const r = classifyPair(
      { title: 'Metformin in type 2 diabetes a randomised controlled trial', authors: 'Smith J; Doe A', year: 2020, journal: 'Lancet', volume: '10', pages: '1-9' },
      { title: 'Metformin in type 2 diabetes a randomised controlled trial', authors: 'Smith J; Doe A', year: 2020, journal: 'Lancet', volume: '10', pages: '1-9' },
    );
    expect(r.type).toBe(DUP_TYPES.PROBABLE);
    expect(r.mergeable).toBe(true);
  });

  it('related_report / same_study_family: same authors + similar title but different venue → NOT mergeable', () => {
    const r = classifyPair(
      { title: 'Metformin in type 2 diabetes a randomised trial', authors: 'Smith J; Doe A', year: 2019, journal: 'medRxiv', doi: '10.1/preprint' },
      { title: 'Metformin in type 2 diabetes a randomised trial (final)', authors: 'Smith J; Doe A', year: 2020, journal: 'Lancet', doi: '10.1/final' },
    );
    expect([DUP_TYPES.RELATED, DUP_TYPES.FAMILY]).toContain(r.type);
    expect(r.mergeable).toBe(false);           // must never auto-merge separate reports
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it('different PMID (else identical) is NEVER a mergeable duplicate — it is a related report', () => {
    const base = { title: 'Effect of metformin on cardiovascular outcomes in type 2 diabetes', authors: 'Smith J; Jones A', year: 2024, journal: 'JACC', volume: '83' };
    const r = classifyPair({ ...base, pmid: '111' }, { ...base, pmid: '222' });
    expect(r.mergeable).toBe(false);
    expect([DUP_TYPES.RELATED, DUP_TYPES.FAMILY]).toContain(r.type);
    expect(r.conflicts.join(' ')).toMatch(/PMID/);
  });

  it('conflicting DOI with weak authors is never mergeable (no possible_duplicate merge)', () => {
    const r = classifyPair(
      { title: 'Deep learning for chest radiograph triage in emergency care', authors: 'Park S', year: 2022, journal: 'Radiology', doi: '10.1/aaa' },
      { title: 'Deep learning for chest radiograph triage in emergency medicine', authors: 'Lee H', year: 2022, journal: 'Radiology', doi: '10.1/bbb' },
    );
    expect(r.mergeable).toBe(false);
    expect(r.conflicts.join(' ')).toMatch(/DOI/);
  });

  it('not_duplicate for unrelated records', () => {
    const r = classifyPair(
      { title: 'Aspirin for primary prevention of stroke', authors: 'Lee K', year: 2018 },
      { title: 'Deep learning for chest radiograph triage', authors: 'Wang Q', year: 2022 },
    );
    expect(r.type).toBe(DUP_TYPES.NOT);
    expect(r.mergeable).toBe(false);
  });

  it('every result carries reasons, conflicts, signals and a confidence', () => {
    const r = classifyPair(A, A);
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(Array.isArray(r.conflicts)).toBe(true);
    expect(r.signals).toBeTruthy();
    expect(r.confidence).toBeGreaterThan(0);
  });
});

describe('evaluateDuplicateLabels', () => {
  it('computes precision/recall + false merge/split, excluding uncertain', () => {
    const pairs = [
      { predictedType: DUP_TYPES.EXACT, label: 'duplicate' },     // tp
      { predictedType: DUP_TYPES.PROBABLE, label: 'duplicate' },  // tp
      { predictedType: DUP_TYPES.PROBABLE, label: 'not_duplicate' }, // fp (false merge)
      { predictedType: DUP_TYPES.RELATED, label: 'duplicate' },   // fn (false split)
      { predictedType: DUP_TYPES.NOT, label: 'not_duplicate' },   // tn
      { predictedType: DUP_TYPES.NOT, label: 'uncertain' },       // excluded
    ];
    const m = evaluateDuplicateLabels(pairs);
    expect(m.n).toBe(5);
    expect(m.uncertain).toBe(1);
    expect(m.confusion).toEqual({ tp: 2, fp: 1, tn: 1, fn: 1 });
    expect(m.precision).toBeCloseTo(2 / 3, 6);
    expect(m.recall).toBeCloseTo(2 / 3, 6);
    expect(m.falseMergeRate).toBeCloseTo(1 / 2, 6);  // fp/(fp+tn)
    expect(m.falseSplitRate).toBeCloseTo(1 / 3, 6);  // fn/(fn+tp)
    expect(m.modelVersion).toBe(DUP_MODEL_VERSION);
  });
  it('handles an empty set', () => {
    const m = evaluateDuplicateLabels([]);
    expect(m.n).toBe(0);
    expect(m.precision).toBe(null);
  });
});

describe('DUP_MERGEABLE', () => {
  it('only exact/probable/possible are mergeable', () => {
    expect(DUP_MERGEABLE.has(DUP_TYPES.EXACT)).toBe(true);
    expect(DUP_MERGEABLE.has(DUP_TYPES.PROBABLE)).toBe(true);
    expect(DUP_MERGEABLE.has(DUP_TYPES.POSSIBLE)).toBe(true);
    expect(DUP_MERGEABLE.has(DUP_TYPES.RELATED)).toBe(false);
    expect(DUP_MERGEABLE.has(DUP_TYPES.FAMILY)).toBe(false);
    expect(DUP_MERGEABLE.has(DUP_TYPES.NOT)).toBe(false);
  });
});
