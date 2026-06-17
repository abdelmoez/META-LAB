/**
 * screeningCompletion.test.js — prompt29 Part 9. The main workflow "Screening"
 * step must turn complete ONLY when every screening substep is finished.
 */
import { describe, it, expect } from 'vitest';
import { isScreeningComplete } from '../../server/utils/screeningCompletion.js';

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
