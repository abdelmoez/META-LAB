/**
 * snapshotDiff.test.js — whole-project snapshot diffing for living reviews.
 */
import { describe, it, expect } from 'vitest';
import { diffSnapshots } from '../../../src/research-engine/living/snapshotDiff.js';

function snap(over = {}) {
  return {
    createdAt: '2026-07-01T03:00:00.000Z',
    prisma: { identified: 100, duplicatesRemoved: 10, screened: 90, fullTextAssessed: 40, included: 12 },
    screening: { total: 90, decided: 90, includedK: 12 },
    extraction: { consensusCount: 12 },
    ma: [
      { outcome: 'Mortality', timepoint: '30d', esType: 'OR', k: 5, es: -0.3, lo: -0.5, hi: -0.1, pval: 0.01, i2: 20, method: 'random' },
    ],
    model: { engineVersion: 'v2', engineConfigVersion: 'cfg-1', runId: 'r1' },
    searches: [{ provider: 'PubMed', resultCount: 200 }, { provider: 'Embase', resultCount: 150 }],
    ...over,
  };
}

describe('prisma delta', () => {
  it('reports only changed prisma fields with correct delta math', () => {
    const prev = snap();
    const curr = snap({
      prisma: { identified: 130, duplicatesRemoved: 10, screened: 118, fullTextAssessed: 50, included: 15 },
    });
    const d = diffSnapshots(prev, curr);
    expect(d.prisma.identified).toEqual({ prev: 100, curr: 130, delta: 30 });
    expect(d.prisma.included).toEqual({ prev: 12, curr: 15, delta: 3 });
    expect(d.prisma.fullTextAssessed).toEqual({ prev: 40, curr: 50, delta: 10 });
    // unchanged field omitted
    expect(d.prisma.duplicatesRemoved).toBeUndefined();
  });

  it('no prisma changes → empty object', () => {
    const d = diffSnapshots(snap(), snap());
    expect(d.prisma).toEqual({});
  });
});

describe('counts delta (screening + extraction merged)', () => {
  it('merges and diffs screening and extraction fields', () => {
    const prev = snap();
    const curr = snap({
      screening: { total: 118, decided: 118, includedK: 15 },
      extraction: { consensusCount: 15 },
    });
    const d = diffSnapshots(prev, curr);
    expect(d.counts.decided).toEqual({ prev: 90, curr: 118, delta: 28 });
    expect(d.counts.total).toEqual({ prev: 90, curr: 118, delta: 28 });
    expect(d.counts.includedK).toEqual({ prev: 12, curr: 15, delta: 3 });
    expect(d.counts.consensusCount).toEqual({ prev: 12, curr: 15, delta: 3 });
  });
});

describe('maShifts', () => {
  it('surfaces a direction flip via detectEvidenceShift', () => {
    const prev = snap();
    const curr = snap({
      ma: [{ outcome: 'Mortality', timepoint: '30d', esType: 'OR', k: 6, es: 0.3, lo: 0.1, hi: 0.5, pval: 0.02, i2: 20, method: 'random' }],
    });
    const d = diffSnapshots(prev, curr);
    const types = d.maShifts.map((s) => s.type);
    expect(types).toContain('direction_change');
    expect(d.maShifts.some((s) => s.severity === 'major')).toBe(true);
  });

  it('detects an added outcome', () => {
    const prev = snap();
    const curr = snap({
      ma: [
        ...prev.ma,
        { outcome: 'Relapse', timepoint: '1y', esType: 'RR', k: 4, es: -0.2, lo: -0.4, hi: -0.05, pval: 0.03, i2: 10, method: 'random' },
      ],
    });
    const d = diffSnapshots(prev, curr);
    const added = d.maShifts.find((s) => s.type === 'outcome_added');
    expect(added).toBeTruthy();
    expect(added.outcome).toBe('Relapse');
  });

  it('detects a removed outcome', () => {
    const prev = snap({
      ma: [
        { outcome: 'Mortality', timepoint: '30d', esType: 'OR', k: 5, es: -0.3, lo: -0.5, hi: -0.1, pval: 0.01, i2: 20, method: 'random' },
        { outcome: 'Relapse', timepoint: '1y', esType: 'RR', k: 4, es: -0.2, lo: -0.4, hi: -0.05, pval: 0.03, i2: 10, method: 'random' },
      ],
    });
    const curr = snap();
    const d = diffSnapshots(prev, curr);
    expect(d.maShifts.some((s) => s.type === 'outcome_removed' && s.outcome === 'Relapse')).toBe(true);
  });

  it('no MA change → empty maShifts', () => {
    expect(diffSnapshots(snap(), snap()).maShifts).toEqual([]);
  });
});

describe('modelChanged', () => {
  it('true when engineVersion changes', () => {
    const d = diffSnapshots(snap(), snap({ model: { engineVersion: 'v3', engineConfigVersion: 'cfg-1', runId: 'r2' } }));
    expect(d.modelChanged).toBe(true);
  });
  it('true when engineConfigVersion changes', () => {
    const d = diffSnapshots(snap(), snap({ model: { engineVersion: 'v2', engineConfigVersion: 'cfg-2', runId: 'r2' } }));
    expect(d.modelChanged).toBe(true);
  });
  it('false when only runId changes', () => {
    const d = diffSnapshots(snap(), snap({ model: { engineVersion: 'v2', engineConfigVersion: 'cfg-1', runId: 'r99' } }));
    expect(d.modelChanged).toBe(false);
  });
});

describe('searchChanges', () => {
  it('reports per-provider count changes only', () => {
    const prev = snap();
    const curr = snap({ searches: [{ provider: 'PubMed', resultCount: 240 }, { provider: 'Embase', resultCount: 150 }] });
    const d = diffSnapshots(prev, curr);
    expect(d.searchChanges).toEqual([{ provider: 'PubMed', prevCount: 200, currCount: 240 }]);
  });

  it('handles a newly added provider (prev 0)', () => {
    const prev = snap();
    const curr = snap({
      searches: [
        { provider: 'PubMed', resultCount: 200 },
        { provider: 'Embase', resultCount: 150 },
        { provider: 'Scopus', resultCount: 60 },
      ],
    });
    const d = diffSnapshots(prev, curr);
    expect(d.searchChanges).toContainEqual({ provider: 'Scopus', prevCount: 0, currCount: 60 });
  });

  it('no search change → empty array', () => {
    expect(diffSnapshots(snap(), snap()).searchChanges).toEqual([]);
  });
});

describe('summaryText', () => {
  it('mentions included-study growth and a major shift', () => {
    const prev = snap();
    const curr = snap({
      prisma: { identified: 130, duplicatesRemoved: 10, screened: 118, fullTextAssessed: 50, included: 15 },
      ma: [{ outcome: 'Mortality', timepoint: '30d', esType: 'OR', k: 6, es: 0.3, lo: 0.1, hi: 0.5, pval: 0.02, i2: 20, method: 'random' }],
    });
    const d = diffSnapshots(prev, curr);
    expect(d.summaryText).toMatch(/included studies \+3/i);
    expect(d.summaryText).toMatch(/major potential evidence shift/i);
  });

  it('states "no material changes" for identical snapshots', () => {
    expect(diffSnapshots(snap(), snap()).summaryText).toMatch(/no material changes/i);
  });

  it('notes a model version change', () => {
    const d = diffSnapshots(snap(), snap({ model: { engineVersion: 'v3', engineConfigVersion: 'cfg-1', runId: 'r2' } }));
    expect(d.summaryText).toMatch(/scoring model version changed/i);
  });
});

describe('robustness', () => {
  it('handles missing sections without crashing', () => {
    expect(() => diffSnapshots({}, {})).not.toThrow();
    const d = diffSnapshots({}, {});
    expect(d.prisma).toEqual({});
    expect(d.counts).toEqual({});
    expect(d.maShifts).toEqual([]);
    expect(d.searchChanges).toEqual([]);
    expect(d.modelChanged).toBe(false);
  });

  it('is deterministic', () => {
    const prev = snap();
    const curr = snap({ prisma: { identified: 130, duplicatesRemoved: 10, screened: 118, fullTextAssessed: 50, included: 15 } });
    expect(JSON.stringify(diffSnapshots(prev, curr))).toBe(JSON.stringify(diffSnapshots(prev, curr)));
  });
});
