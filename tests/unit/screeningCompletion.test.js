/**
 * screeningCompletion.test.js — prompt29 Part 9. The main workflow "Screening"
 * step must turn complete ONLY when every screening substep is finished.
 */
import { describe, it, expect } from 'vitest';
import { isScreeningComplete, isScreeningWorkComplete } from '../../server/utils/screeningCompletion.js';

const complete = {
  total: 50, unresolvedDuplicateGroups: 0, titleAbstractPending: 0,
  unresolvedConflicts: 0, secondReviewPending: 0, includedFinal: 8,
};

describe('isScreeningComplete', () => {
  it('true only when every substep is finished', () => {
    expect(isScreeningComplete(complete)).toBe(true);
  });

  it('false before any records exist', () => {
    expect(isScreeningComplete({ ...complete, total: 0 })).toBe(false);
  });

  it('false while duplicates are unresolved', () => {
    expect(isScreeningComplete({ ...complete, unresolvedDuplicateGroups: 2 })).toBe(false);
  });

  it('false while title/abstract screening is pending', () => {
    expect(isScreeningComplete({ ...complete, titleAbstractPending: 5 })).toBe(false);
  });

  it('false while conflicts are unresolved', () => {
    expect(isScreeningComplete({ ...complete, unresolvedConflicts: 1 })).toBe(false);
  });

  it('false while full-text/final review is pending', () => {
    expect(isScreeningComplete({ ...complete, secondReviewPending: 3 })).toBe(false);
  });

  it('false when no study has been included/handed off (the old too-early case)', () => {
    // Old rule turned green on includedFinal>0 alone; new rule still requires the
    // rest. Here everything is done EXCEPT nothing was included → not complete.
    expect(isScreeningComplete({ ...complete, includedFinal: 0 })).toBe(false);
  });

  it('does not crash on missing / partial input', () => {
    expect(isScreeningComplete({})).toBe(false);
    expect(isScreeningComplete()).toBe(false);
    expect(isScreeningComplete({ total: 10 })).toBe(false);
  });
});

/* 98.md §14 — the workflow-PROGRESS predicate. Same conjunction, ONE divergence:
   includedFinal>0 is NOT required (an all-rejected screen IS finished work). */
describe('isScreeningWorkComplete', () => {
  it('true when every substep is finished', () => {
    expect(isScreeningWorkComplete(complete)).toBe(true);
  });

  it('true even when zero studies were included (all-rejected empty review)', () => {
    expect(isScreeningWorkComplete({ ...complete, includedFinal: 0 })).toBe(true);
    // …where isScreeningComplete deliberately stays false (extraction hand-off gate).
    expect(isScreeningComplete({ ...complete, includedFinal: 0 })).toBe(false);
  });

  it('false before any records exist', () => {
    expect(isScreeningWorkComplete({ ...complete, total: 0 })).toBe(false);
  });

  it('false while any substep is pending', () => {
    expect(isScreeningWorkComplete({ ...complete, unresolvedDuplicateGroups: 2 })).toBe(false);
    expect(isScreeningWorkComplete({ ...complete, titleAbstractPending: 5 })).toBe(false);
    expect(isScreeningWorkComplete({ ...complete, unresolvedConflicts: 1 })).toBe(false);
    expect(isScreeningWorkComplete({ ...complete, secondReviewPending: 3 })).toBe(false);
  });

  it('does not crash on missing / partial input', () => {
    expect(isScreeningWorkComplete({})).toBe(false);
    expect(isScreeningWorkComplete()).toBe(false);
    expect(isScreeningWorkComplete({ total: 10 })).toBe(true); // no pending counts, records exist
  });
});
