/**
 * projectProgress.test.js — 75.md Phases 8-9 (Workstream D).
 *
 * Pins the ONE canonical workflow-progress model:
 *   - 0% when nothing is done; 100% is REACHABLE when every required step has
 *     real evidence (incl. the nma flag-off exclusion — the old "100% unreachable"
 *     bug where nma had no rule and subgroup could never reach 'done').
 *   - optional tools / unrelated blob keys never change pct (not in the denominator).
 *   - an unsatisfied step is never 'done'.
 *   - deleting required evidence LOWERS pct (recalculated, never sticky).
 *   - the same (project, evidence, opts) yields the same pct on every surface.
 *   - the networkMetaAnalysis flag toggles nma in/out of the denominator.
 */
import { describe, it, expect } from 'vitest';
import { computeProjectProgress, PRISMA_TOTAL } from '../../src/research-engine/progress/projectProgress.js';

/* ── fixtures ──────────────────────────────────────────────────────────── */

const reportAllChecked = () =>
  Object.fromEntries(Array.from({ length: PRISMA_TOTAL }, (_, i) => [`r${i}`, true]));
const prospero15 = () =>
  Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, 'x']));
const grade5 = () => ({ rob: 'x', inconsistency: 'x', imprecision: 'x', indirectness: 'x', publicationBias: 'x' });
// 4 poolable studies (ES + CI + a RoB judgement) → analysis/forest/sensitivity/
// subgroup all reach 'done', extraction + rob 'done'.
const poolableStudies = (n = 4) =>
  Array.from({ length: n }, () => ({ es: '0.5', lo: '0.2', hi: '0.8', rob: { d1: 'Low' } }));
const manuscript3 = () => [{ sections: { title: { content: 'T' }, abstract: { content: 'A' }, methods: { content: 'M' } } }];

/** A project + evidence where EVERY required step is satisfied. */
function fullyDone() {
  const project = {
    pico: { P: 'p', I: 'i', C: 'c', O: 'o', timeframeMode: 'any' },
    prospero: { fields: prospero15() },
    prisma: { included: '20' },
    studies: poolableStudies(4),
    grade: grade5(),
    reportChecked: reportAllChecked(),
    manuscripts: manuscript3(),
  };
  const evidence = {
    screening: { progressStatus: 'done' },      // human sign-off
    search: { revision: 1, conceptCount: 3 },   // real saved strategy
  };
  return { project, evidence };
}

/* ── tests ─────────────────────────────────────────────────────────────── */

describe('computeProjectProgress — 0% baseline', () => {
  it('is 0% when nothing is done and points at the first step', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {}, {});
    expect(out.pct).toBe(0);
    expect(out.requiredDone).toBe(0);
    expect(out.nextStepId).toBe('pico');
    expect(out.steps.every((s) => s.status === 'empty')).toBe(true);
  });
});

describe('computeProjectProgress — 100% reachability', () => {
  it('reaches 100% with all required evidence (flag OFF → nma excluded, denom 14)', () => {
    const { project, evidence } = fullyDone();
    const out = computeProjectProgress(project, evidence, { networkMetaAnalysis: false });
    expect(out.pct).toBe(100);
    expect(out.requiredTotal).toBe(14);
    expect(out.requiredDone).toBe(14);
    expect(out.nextStepId).toBeNull();
    // nma is still REPORTED, but marked not-required so it never blocks 100%.
    const nma = out.steps.find((s) => s.id === 'nma');
    expect(nma.required).toBe(false);
  });

  it('reaches 100% with the flag ON too (denom 15; nma is required + done)', () => {
    const { project, evidence } = fullyDone();
    const out = computeProjectProgress(project, evidence, { networkMetaAnalysis: true });
    expect(out.pct).toBe(100);
    expect(out.requiredTotal).toBe(15);
    const nma = out.steps.find((s) => s.id === 'nma');
    expect(nma.required).toBe(true);
    expect(nma.status).toBe('done');
  });
});

describe('computeProjectProgress — nma flag gating changes the denominator', () => {
  // 7 required steps done, NO studies (so nma is empty). Excluding an empty nma
  // from the denominator raises the pct: 7/14 = 50% vs 7/15 = 47%.
  const project = {
    pico: { P: 'p', I: 'i', C: 'c', O: 'o', timeframeMode: 'any' },
    prospero: { fields: prospero15() },
    prisma: { included: '20' },
    grade: grade5(),
    reportChecked: reportAllChecked(),
    studies: [],
  };
  const evidence = { screening: { progressStatus: 'done' }, search: { revision: 1, conceptCount: 1 } };

  it('excludes nma when the flag is off → higher pct', () => {
    const off = computeProjectProgress(project, evidence, { networkMetaAnalysis: false });
    expect(off.requiredTotal).toBe(14);
    expect(off.requiredDone).toBe(7);
    expect(off.pct).toBe(50);
  });
  it('includes an empty nma when the flag is on → lower pct', () => {
    const on = computeProjectProgress(project, evidence, { networkMetaAnalysis: true });
    expect(on.requiredTotal).toBe(15);
    expect(on.requiredDone).toBe(7);
    expect(on.pct).toBe(47);
    expect(on.pct).toBeLessThan(50);
  });
});

describe('computeProjectProgress — optional tools / unrelated keys do not change pct', () => {
  it('adding living-review / citation-mining / annotation blobs leaves pct untouched', () => {
    const { project, evidence } = fullyDone();
    const base = computeProjectProgress(project, evidence, {});
    const withTools = computeProjectProgress(
      { ...project, living: { enabled: true }, citationMining: { runs: 3 }, _linkedMetaSift: { id: 'x' }, methods: { notes: 'z' } },
      evidence,
      {},
    );
    expect(withTools.pct).toBe(base.pct);
    expect(withTools.requiredTotal).toBe(base.requiredTotal);
    // and no optional tool leaked into the step list
    expect(withTools.steps.some((s) => ['living', 'citation', 'methods', 'overview', 'control'].includes(s.id))).toBe(false);
  });
});

describe('computeProjectProgress — an unsatisfied step is never done', () => {
  it('a study with an ES but no CI leaves forest empty and analysis partial', () => {
    const out = computeProjectProgress({ pico: {}, studies: [{ es: '0.5' }] }, {}, {});
    const byId = Object.fromEntries(out.steps.map((s) => [s.id, s]));
    expect(byId.extraction.status).toBe('done');   // it does have an ES
    expect(byId.analysis.status).toBe('partial');  // but cannot pool (needs ≥2 w/ CI)
    expect(byId.forest.status).toBe('empty');      // and forest is NOT done
    expect(byId.forest.status).not.toBe('done');
  });
  it('an empty screening evidence bag never counts screening as done', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: { decidedCount: 0, screenablePool: 0, recordCount: 0, progressStatus: 'in_progress' } }, {});
    const screening = out.steps.find((s) => s.id === 'screening');
    expect(screening.status).toBe('empty');
  });
});

describe('computeProjectProgress — recalculation (never sticky)', () => {
  it('deleting required evidence lowers pct', () => {
    const { project, evidence } = fullyDone();
    const before = computeProjectProgress(project, evidence, {});
    expect(before.pct).toBe(100);
    const { grade, reportChecked, ...missing } = project; // drop grade + report
    const after = computeProjectProgress(missing, evidence, {});
    expect(after.pct).toBeLessThan(before.pct);
    expect(after.steps.find((s) => s.id === 'grade').status).toBe('empty');
    expect(after.steps.find((s) => s.id === 'report').status).toBe('empty');
  });
});

describe('computeProjectProgress — surface independence', () => {
  it('same (project, evidence, opts) → identical result no matter who calls it', () => {
    const { project, evidence } = fullyDone();
    const a = computeProjectProgress(project, evidence, { networkMetaAnalysis: true });
    const b = computeProjectProgress(project, evidence, { networkMetaAnalysis: true });
    expect(a.pct).toBe(b.pct);
    expect(a).toEqual(b);
  });
});

describe('computeProjectProgress — screening derived-done keeps human sign-off OR full decisions', () => {
  it('derives done when every screenable record is decided (no sign-off needed)', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: { decidedCount: 40, screenablePool: 40, recordCount: 42, progressStatus: 'in_progress' } }, {});
    expect(out.steps.find((s) => s.id === 'screening').status).toBe('done');
  });
  it('is partial while records exist but are not all decided', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: { decidedCount: 10, screenablePool: 40, recordCount: 42, progressStatus: 'in_progress' } }, {});
    expect(out.steps.find((s) => s.id === 'screening').status).toBe('partial');
  });
});

describe('computeProjectProgress — search reads the real strategy, not the stale db-count heuristic', () => {
  it('a saved strategy with concepts is done even with zero database checkboxes', () => {
    const out = computeProjectProgress({ pico: {}, studies: [], search: { dbs: {} } }, { search: { revision: 2, conceptCount: 4 } }, {});
    expect(out.steps.find((s) => s.id === 'search').status).toBe('done');
  });
  it('falls back to the blob heuristic when no module evidence is supplied', () => {
    const out = computeProjectProgress({ pico: {}, studies: [], search: { dbs: { PubMed: true, Embase: true, Scopus: true }, string: '("a" OR "b")' } }, {}, {});
    expect(out.steps.find((s) => s.id === 'search').status).toBe('done');
  });
});
