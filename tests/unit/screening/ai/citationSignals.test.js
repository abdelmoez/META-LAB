/**
 * citationSignals.test.js — citation-graph features for screening relevance
 * (66.md P4.3). Covers the pure feature builder (buildCitationFeatures), the
 * hybrid fusion's citation renormalization (hybridScore), and the byte-identical
 * guarantee end-to-end through trainAndScore.
 *
 * The load-bearing invariant under test: citation metadata can only ADD signal,
 * never gate screening. A run WITHOUT citation metadata must be byte-identical to
 * the pre-citation engine, and records/projects without metadata must yield a
 * null signal that the hybrid fusion renormalizes away.
 */
import { describe, it, expect } from 'vitest';
import { buildCitationFeatures } from '../../../../src/research-engine/screening/ai/citationSignals.js';
import { hybridScore } from '../../../../src/research-engine/screening/ai/hybrid.js';
import { trainAndScore } from '../../../../src/research-engine/screening/ai/activeLearning.js';
import { DEFAULT_AI_CONFIG, resolveConfig } from '../../../../src/research-engine/screening/ai/config.js';

const CIT_CFG = DEFAULT_AI_CONFIG.citation;

// ── Small labelled citation graph ───────────────────────────────────────────
// Included works: I1, I2, I3 (workIds W_I1..). Excluded works: E1, E2, E3.
// A candidate that CITES an included work + shares included references should
// score above 0.5; one whose links land on the excluded side below 0.5.
function makeRecords() {
  return [
    { id: 'I1' }, { id: 'I2' }, { id: 'I3' },
    { id: 'E1' }, { id: 'E2' }, { id: 'E3' },
    { id: 'CAND_INC' },   // cites included + shares an included reference
    { id: 'CAND_EXC' },   // cites excluded + shares an excluded reference
    { id: 'CAND_NONE' },  // has metadata but no citation links to either side
    { id: 'NO_META' },    // no metadata at all
  ];
}

const labels = {
  I1: 'include', I2: 'include', I3: 'include',
  E1: 'exclude', E2: 'exclude', E3: 'exclude',
};

// refs use provider ids; 'R_shared_inc' is referenced by two included works, so
// after leave-one-out it still has support from the OTHER included work.
function makeCitationMeta() {
  return {
    I1: { workId: 'W_I1', refs: ['R_shared_inc', 'R_a'], citedByCount: 10, referenceCount: 2 },
    I2: { workId: 'W_I2', refs: ['R_shared_inc', 'R_b'], citedByCount: 8, referenceCount: 2 },
    I3: { workId: 'W_I3', refs: ['R_c'], citedByCount: 5, referenceCount: 1 },
    E1: { workId: 'W_E1', refs: ['R_shared_exc', 'R_x'], citedByCount: 3, referenceCount: 2 },
    E2: { workId: 'W_E2', refs: ['R_shared_exc', 'R_y'], citedByCount: 2, referenceCount: 2 },
    E3: { workId: 'W_E3', refs: ['R_z'], citedByCount: 1, referenceCount: 1 },
    // Cites two included works AND shares an included reference → strong include side.
    CAND_INC: { workId: 'W_CAND_INC', refs: ['W_I1', 'W_I2', 'R_shared_inc'], citedByCount: 0, referenceCount: 3 },
    // Cites two excluded works AND shares an excluded reference → strong exclude side.
    CAND_EXC: { workId: 'W_CAND_EXC', refs: ['W_E1', 'W_E2', 'R_shared_exc'], citedByCount: 0, referenceCount: 3 },
    // Has metadata but references nothing labelled → neutral.
    CAND_NONE: { workId: 'W_CAND_NONE', refs: ['R_unrelated1', 'R_unrelated2'], citedByCount: 0, referenceCount: 2 },
  };
}

describe('buildCitationFeatures — availability gating', () => {
  it('is unavailable when NO record has metadata', () => {
    const out = buildCitationFeatures({
      records: makeRecords(), labelByRecordId: labels, citationByRecordId: {}, config: CIT_CFG,
    });
    expect(out.available).toBe(false);
    expect(out.nWithMetadata).toBe(0);
    expect(out.coverage).toBe(0);
    // Every record's signal is null when unavailable.
    for (const r of makeRecords()) expect(out.byRecordId[r.id].signal).toBeNull();
  });

  it('is unavailable when too FEW labelled records carry metadata', () => {
    // Only one labelled record with metadata (< minLabeledWithMetadata = 3).
    const meta = { I1: { workId: 'W_I1', refs: ['R_a'] }, CAND_INC: { workId: 'W_C', refs: ['W_I1'] } };
    const out = buildCitationFeatures({
      records: makeRecords(), labelByRecordId: labels, citationByRecordId: meta, config: CIT_CFG,
    });
    expect(out.available).toBe(false);
  });

  it('is available once enough labelled records carry metadata', () => {
    const out = buildCitationFeatures({
      records: makeRecords(), labelByRecordId: labels, citationByRecordId: makeCitationMeta(), config: CIT_CFG,
    });
    expect(out.available).toBe(true);
    expect(out.nWithMetadata).toBe(9);       // all but NO_META
    expect(out.coverage).toBeCloseTo(9 / 10, 6);
  });
});

describe('buildCitationFeatures — signal + reasons', () => {
  const out = buildCitationFeatures({
    records: makeRecords(), labelByRecordId: labels, citationByRecordId: makeCitationMeta(), config: CIT_CFG,
  });

  it('records WITHOUT metadata get a null signal', () => {
    expect(out.byRecordId.NO_META.signal).toBeNull();
    expect(out.byRecordId.NO_META.features).toBeNull();
  });

  it('a direct-citation-to-included candidate raises the signal above 0.5', () => {
    const c = out.byRecordId.CAND_INC;
    expect(c.signal).toBeGreaterThan(0.5);
    expect(c.features.citesIncluded).toBe(2);          // cites W_I1 + W_I2
    expect(c.features.sharedRefsIncluded).toBeGreaterThan(0); // shares R_shared_inc
  });

  it('a candidate whose links land on the EXCLUDED side lowers the signal below 0.5', () => {
    const c = out.byRecordId.CAND_EXC;
    expect(c.signal).toBeLessThan(0.5);
    expect(c.features.citesExcluded).toBe(2);
  });

  it('a metadata-only candidate with no labelled links is neutral (≈0.5)', () => {
    expect(out.byRecordId.CAND_NONE.signal).toBeCloseTo(0.5, 6);
  });

  it('reasons text is grounded in the counts', () => {
    const c = out.byRecordId.CAND_INC;
    expect(c.reasons).toContain('Cites 2 included studies');
    // Singular/plural grammar is honest.
    const single = buildCitationFeatures({
      records: [{ id: 'I1' }, { id: 'I2' }, { id: 'I3' }, { id: 'E1' }, { id: 'E2' }, { id: 'X' }],
      labelByRecordId: labels,
      citationByRecordId: {
        I1: { workId: 'W_I1', refs: [] }, I2: { workId: 'W_I2', refs: [] }, I3: { workId: 'W_I3', refs: [] },
        E1: { workId: 'W_E1', refs: [] }, E2: { workId: 'W_E2', refs: [] },
        X: { workId: 'W_X', refs: ['W_I1'] },
      },
      config: CIT_CFG,
    });
    expect(single.byRecordId.X.reasons).toContain('Cites 1 included study');
  });

  it('leave-one-out: a labelled include whose only contribution to the shared-ref union is its own gets shared=0', () => {
    // I3 references R_c, which NO other labelled record references. Its own
    // contribution to the included-side union is R_c; after leave-one-out that
    // ref has zero remaining support, so its shared-ref count must be 0.
    const c = out.byRecordId.I3;
    expect(c.features.sharedRefsIncluded).toBe(0);
    // I1 references R_shared_inc, which I2 also references → after leave-one-out
    // it still has support, so I1's shared-ref count is > 0.
    expect(out.byRecordId.I1.features.sharedRefsIncluded).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = buildCitationFeatures({ records: makeRecords(), labelByRecordId: labels, citationByRecordId: makeCitationMeta(), config: CIT_CFG });
    const b = buildCitationFeatures({ records: makeRecords(), labelByRecordId: labels, citationByRecordId: makeCitationMeta(), config: CIT_CFG });
    for (const r of makeRecords()) expect(a.byRecordId[r.id].signal).toBe(b.byRecordId[r.id].signal);
  });
});

describe('hybridScore — citation renormalization', () => {
  const base = {
    classifier: { available: true, proba: 0.7 },
    coldStart: 0.6,
    semanticIncluded: 0.55,
    semanticExcluded: 0.45,
    keyword: null,
  };
  const hcfg = DEFAULT_AI_CONFIG.hybrid;

  it('citation:null is byte-identical to citation absent (renormalized away)', () => {
    const withNull = hybridScore({ ...base, citation: null }, hcfg);
    const absent = hybridScore({ ...base }, hcfg);
    expect(withNull.score).toBe(absent.score);
    expect(withNull.weights).toEqual(absent.weights);
    expect(withNull.subScores.citation).toBeNull();
  });

  it('adding a citation signal when present changes the score and adds weight', () => {
    const without = hybridScore({ ...base, citation: null }, hcfg);
    const withHigh = hybridScore({ ...base, citation: 0.95 }, hcfg);
    expect(withHigh.score).not.toBe(without.score);
    expect(withHigh.weights.citation).toBeGreaterThan(0);
    // A high citation signal (0.95) pulls the fused score UP vs. no citation.
    expect(withHigh.score).toBeGreaterThan(without.score);
    // Every active weight still sums to 1 (proper renormalization).
    const sum = Object.values(withHigh.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('trainAndScore — citation end-to-end byte-identity', () => {
  // A realistic mini-project so training can run; citation metadata is layered on
  // top without altering the record text.
  function makeTextRecords() {
    const inc = Array.from({ length: 6 }, (_, i) => ({
      id: `inc${i}`,
      title: `Randomized controlled trial ${i} of therapy in heart failure`,
      abstract: 'Double-blind randomized placebo-controlled trial of mortality in reduced ejection fraction heart failure.',
      year: '2020', keywords: 'heart failure; randomized controlled trial',
    }));
    const exc = Array.from({ length: 6 }, (_, i) => ({
      id: `exc${i}`,
      title: `Narrative review ${i} of hospital billing policy`,
      abstract: 'Editorial commentary on healthcare funding and journal formatting unrelated to clinical outcomes.',
      year: '2019', keywords: 'policy; administration',
    }));
    return [...inc, ...exc];
  }
  const textLabels = {};
  const recs = makeTextRecords();
  recs.slice(0, 4).forEach(r => { textLabels[r.id] = 'include'; });
  recs.slice(6, 10).forEach(r => { textLabels[r.id] = 'exclude'; });

  // Citation graph: included records reference a shared work; a held-out include
  // candidate cites two included works → its citation signal should be present.
  function textCitationMeta() {
    const m = {};
    recs.slice(0, 4).forEach((r, i) => { m[r.id] = { workId: `W_${r.id}`, refs: ['R_common_inc', `R_${i}`] }; });
    recs.slice(6, 10).forEach((r, i) => { m[r.id] = { workId: `W_${r.id}`, refs: ['R_common_exc', `R_e${i}`] }; });
    // held-out include record cites two labelled includes + shares their ref
    m['inc4'] = { workId: 'W_inc4', refs: ['W_inc0', 'W_inc1', 'R_common_inc'] };
    m['inc5'] = { workId: 'W_inc5', refs: ['W_inc2', 'R_common_inc'] };
    return m;
  }

  it('WITHOUT citation metadata: passing citationByRecordId:undefined is deep-equal to omitting the arg (byte-identical guarantee)', () => {
    const withUndef = trainAndScore({ records: recs, labelByRecordId: textLabels, citationByRecordId: undefined });
    const without = trainAndScore({ records: recs, labelByRecordId: textLabels });
    expect(withUndef.scores).toEqual(without.scores);
    expect(withUndef.meta).toEqual(without.meta);
  });

  it('WITH citation metadata present: meta.citation.available is true and scores differ from the no-metadata run', () => {
    const withCit = trainAndScore({ records: recs, labelByRecordId: textLabels, citationByRecordId: textCitationMeta() });
    const without = trainAndScore({ records: recs, labelByRecordId: textLabels });
    expect(withCit.meta.citation.available).toBe(true);
    expect(withCit.meta.citation.nWithMetadata).toBeGreaterThanOrEqual(9);
    // At least one record's fused score changed once citation signal entered the mix.
    const a = Object.fromEntries(withCit.scores.map(s => [s.recordId, s.score]));
    const b = Object.fromEntries(without.scores.map(s => [s.recordId, s.score]));
    const anyDiff = recs.some(r => a[r.id] !== b[r.id]);
    expect(anyDiff).toBe(true);
    // The held-out include that cites included studies surfaces a citation subscore.
    const inc4 = withCit.scores.find(s => s.recordId === 'inc4');
    expect(inc4.citation).toBeTruthy();
    expect(inc4.citation.signal).toBeGreaterThan(0.5);
  });

  it('citation features are derived from the CALL\'s own labels (leakage-free across CV folds)', () => {
    // With a DIFFERENT label set, the same citation metadata produces different
    // features — proving the engine recomputes them per call rather than caching.
    const meta = textCitationMeta();
    const flipped = {};
    recs.slice(0, 4).forEach(r => { flipped[r.id] = 'exclude'; });
    recs.slice(6, 10).forEach(r => { flipped[r.id] = 'include'; });
    const a = trainAndScore({ records: recs, labelByRecordId: textLabels, citationByRecordId: meta });
    const b = trainAndScore({ records: recs, labelByRecordId: flipped, citationByRecordId: meta });
    const aInc4 = a.scores.find(s => s.recordId === 'inc4').citation;
    const bInc4 = b.scores.find(s => s.recordId === 'inc4').citation;
    // inc4 cites inc0/inc1: includes under `textLabels`, excludes under `flipped`,
    // so its citation signal flips sides.
    expect(aInc4.signal).toBeGreaterThan(0.5);
    expect(bInc4.signal).toBeLessThan(0.5);
  });

  it('is fully deterministic with citation metadata', () => {
    const a = trainAndScore({ records: recs, labelByRecordId: textLabels, citationByRecordId: textCitationMeta() });
    const b = trainAndScore({ records: recs, labelByRecordId: textLabels, citationByRecordId: textCitationMeta() });
    expect(a.scores.map(s => s.score)).toEqual(b.scores.map(s => s.score));
  });
});
