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
// 98.md §14 — a detail-path screening evidence bag for a genuinely FINISHED screen
// (records imported, all substeps zero, server-computed complete:true). Sign-off
// alone no longer satisfies screeningRule (Defect 1), so the "everything done"
// fixtures must carry corroborating evidence like the real server annotation does.
const screeningFinished = (over = {}) => ({
  decidedCount: 8, screenablePool: 40, recordCount: 42, progressStatus: 'done',
  complete: true, includedFinal: 8,
  pending: { titleAbstractPending: 0, unresolvedConflicts: 0, unresolvedDuplicateGroups: 0, secondReviewPending: 0 },
  ...over,
});
const screeningStepOf = (out) => out.steps.find((s) => s.id === 'screening');

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
    screening: screeningFinished(),             // corroborated sign-off (98.md §14)
    search: { revision: 1, conceptCount: 3 },   // real saved strategy (live groups)
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
  const evidence = { screening: screeningFinished(), search: { revision: 1, conceptCount: 1 } };

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

describe('computeProjectProgress — screening derived-done needs evidence, sign-off needs corroboration (98.md §14)', () => {
  it('derives done when every screenable record is decided (no sign-off needed)', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: { decidedCount: 40, screenablePool: 40, recordCount: 42, progressStatus: 'in_progress' } }, {});
    expect(screeningStepOf(out).status).toBe('done');
  });
  it('is partial while records exist but are not all decided', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: { decidedCount: 10, screenablePool: 40, recordCount: 42, progressStatus: 'in_progress' } }, {});
    expect(screeningStepOf(out).status).toBe('partial');
  });
  it('server-computed complete:true is done regardless of the decided/pool gap (TA-excluded records never get a finalStatus)', () => {
    // Defect 2: decided counts only full-text-finalized records, so a finished
    // screen legitimately sits below the pool — `complete` is the authority.
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({ progressStatus: 'in_progress', decidedCount: 8 }),
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('done');
    expect(step.detail).toBe('completed');
  });
  it('server-computed complete:false blocks done even when decided >= pool', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({
        progressStatus: 'in_progress', decidedCount: 40, complete: false,
        pending: { titleAbstractPending: 3, unresolvedConflicts: 0, unresolvedDuplicateGroups: 0, secondReviewPending: 0 },
      }),
    }, {});
    expect(screeningStepOf(out).status).toBe('partial');
  });
  it('sign-off with records and no counter-evidence stays done (list-path shape)', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: {
        decidedCount: 10, screenablePool: 40, recordCount: 42, progressStatus: 'done',
        pending: { unresolvedConflicts: 0, unresolvedDuplicateGroups: 0 },
      },
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('done');
    expect(step.reason).toBe('Screening signed off');
  });
  it('sign-off contradicted by pending substeps reports partial, not done (Defect 1)', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({
        complete: false,
        pending: { titleAbstractPending: 0, unresolvedConflicts: 2, unresolvedDuplicateGroups: 0, secondReviewPending: 0 },
      }),
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('partial');
    expect(step.reason).toBe('Signed off, but screening work is pending');
  });
});

/* ── 98.md §14 — the nine scenario tests ───────────────────────────────── */

describe('computeProjectProgress — 98.md §14 scenarios', () => {
  it('1. empty project: screening empty / not_started, pct 0', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {}, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('empty');
    expect(step.detail).toBe('not_started');
    expect(out.pct).toBe(0);
  });

  it('2. search completed but screening not started', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      search: { revision: 2, conceptCount: 3 },
      screening: { decidedCount: 0, screenablePool: 0, recordCount: 0, progressStatus: 'not_started' },
    }, {});
    expect(out.steps.find((s) => s.id === 'search').status).toBe('done');
    const step = screeningStepOf(out);
    expect(step.status).toBe('empty');
    expect(step.detail).toBe('not_started');
  });

  it('3. partially screened: partial / in_progress', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: { decidedCount: 10, screenablePool: 40, recordCount: 42, progressStatus: 'in_progress' },
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('partial');
    expect(step.detail).toBe('in_progress');
  });

  it('4. first reviewer complete, second pending: partial, and a sign-off does not turn it done', () => {
    const ev = screeningFinished({
      progressStatus: 'in_progress', decidedCount: 0, complete: false, includedFinal: 0,
      pending: { titleAbstractPending: 40, unresolvedConflicts: 0, unresolvedDuplicateGroups: 0, secondReviewPending: 0 },
    });
    const out = computeProjectProgress({ pico: {}, studies: [] }, { screening: ev }, {});
    expect(screeningStepOf(out).status).toBe('partial');
    expect(screeningStepOf(out).detail).toBe('in_progress');
    // sign-off on top of the same evidence → still not done (corroboration fails)
    const signed = computeProjectProgress({ pico: {}, studies: [] }, { screening: { ...ev, progressStatus: 'done' } }, {});
    expect(screeningStepOf(signed).status).toBe('partial');
    expect(screeningStepOf(signed).reason).toBe('Signed off, but screening work is pending');
  });

  it('4b. title/abstract finished, full-text outstanding: detail awaiting_second_review', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({
        progressStatus: 'in_progress', decidedCount: 2, complete: false, includedFinal: 2,
        pending: { titleAbstractPending: 0, unresolvedConflicts: 0, unresolvedDuplicateGroups: 0, secondReviewPending: 5 },
      }),
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('partial');
    expect(step.detail).toBe('awaiting_second_review');
  });

  it('5. conflicts unresolved: detail conflicts_remaining, never done', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({
        progressStatus: 'in_progress', decidedCount: 40, complete: false,
        pending: { titleAbstractPending: 0, unresolvedConflicts: 3, unresolvedDuplicateGroups: 0, secondReviewPending: 2 },
      }),
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('partial');
    expect(step.detail).toBe('conflicts_remaining');
  });

  it('6. fully completed screening: done / completed without any sign-off', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({ progressStatus: 'in_progress' }),
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('done');
    expect(step.reason).toBe('All screening steps complete');
    expect(step.detail).toBe('completed');
  });

  it('6b. zero-included edge: an all-rejected screen with complete:true IS done (no includedFinal>0 gate)', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: screeningFinished({ progressStatus: 'in_progress', decidedCount: 40, includedFinal: 0 }),
    }, {});
    expect(screeningStepOf(out).status).toBe('done');
  });

  it('7. zero imported studies: a bare sign-off reports partial, not done', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: { decidedCount: 0, screenablePool: 0, recordCount: 0, progressStatus: 'done' },
    }, {});
    const step = screeningStepOf(out);
    expect(step.status).toBe('partial');
    expect(step.reason).toBe('Signed off, but screening work is pending');
  });

  it('8. migrated legacy project (no linked workspace evidence): blob fallback', () => {
    // A positive legacy include count → partial; the auto-filled "0" → empty (Defect 5).
    const legacy = computeProjectProgress({ pico: {}, studies: [], prisma: { included: '12' } }, {}, {});
    expect(screeningStepOf(legacy).status).toBe('partial');
    const zeroed = computeProjectProgress({ pico: {}, studies: [], prisma: { included: '0' } }, {}, {});
    expect(screeningStepOf(zeroed).status).toBe('empty');
    // client-side recompute: no server evidence, counts ride on _linkedMetaSift
    const annotated = computeProjectProgress({
      pico: {}, studies: [],
      _linkedMetaSift: { id: 'ws', decidedCount: 5, screenablePool: 10, recordCount: 10, progressStatus: 'in_progress' },
    }, {}, {});
    expect(screeningStepOf(annotated).status).toBe('partial');
  });

  it('9. duplicates swept after finalize can no longer fake done (Defect 2a)', () => {
    // Pre-fix, decidedCount ignored isDuplicate — 45 finalized-then-swept records
    // beat a 40-record pool. Post-fix the server counts decided over the SAME
    // duplicate-free population, so the evidence arrives as 30/40 → partial…
    const out = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: {
        decidedCount: 30, screenablePool: 40, recordCount: 45, progressStatus: 'in_progress',
        pending: { unresolvedConflicts: 0, unresolvedDuplicateGroups: 0 },
      },
    }, {});
    expect(screeningStepOf(out).status).toBe('partial');
    // …and even a decided >= pool reading cannot go done while duplicate groups
    // are unresolved (the list-path pending bag blocks the heuristic).
    const swept = computeProjectProgress({ pico: {}, studies: [] }, {
      screening: {
        decidedCount: 40, screenablePool: 40, recordCount: 45, progressStatus: 'in_progress',
        pending: { unresolvedConflicts: 0, unresolvedDuplicateGroups: 2 },
      },
    }, {});
    expect(screeningStepOf(swept).status).toBe('partial');
  });
});

describe('computeProjectProgress — prisma "0" is not completion evidence (98.md §14 Defect 5)', () => {
  const prismaStep = (out) => out.steps.find((s) => s.id === 'prisma');
  it('included "0" is at most partial; a positive count is done', () => {
    expect(prismaStep(computeProjectProgress({ pico: {}, studies: [], prisma: { included: '0' } }, {}, {})).status).toBe('partial');
    expect(prismaStep(computeProjectProgress({ pico: {}, studies: [], prisma: { included: '12' } }, {}, {})).status).toBe('done');
  });
  it('non-numeric non-empty legacy strings stay done (back-compat)', () => {
    expect(prismaStep(computeProjectProgress({ pico: {}, studies: [], prisma: { included: '12 (3 RCTs)' } }, {}, {})).status).toBe('done');
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
  // 98.md §6 — conceptCount now counts LIVE groups; empty seed groups are zero.
  it('a saved revision with only empty groups is NOT done — and a bare revision is not even partial', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { search: { revision: 2, conceptCount: 0 } }, {});
    expect(out.steps.find((s) => s.id === 'search').status).toBe('empty');
  });
  it('a bare revision counts as partial only with the ready-for-screening hand-off', () => {
    const out = computeProjectProgress({ pico: {}, studies: [] }, { search: { revision: 1, conceptCount: 0, readyForScreening: true } }, {});
    expect(out.steps.find((s) => s.id === 'search').status).toBe('partial');
  });
});
