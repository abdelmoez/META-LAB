/**
 * 86.md P0.4 — evidence-shift alerts could never fire because livingService called
 * detectEvidenceShift(prevMa, currMa) with whole ARRAYS, while the detector compares
 * ONE per-outcome summary pair. detectMaShifts pairs the rows by outcome/timepoint
 * and runs the detector per pair. This pins the fix and documents the old failure.
 */
import { describe, it, expect } from 'vitest';
import { detectMaShifts } from '../../../src/research-engine/living/snapshotDiff.js';
import { detectEvidenceShift } from '../../../src/research-engine/statistics/evidenceShift.js';

// Snapshot MA-row shape, as buildSnapshotSummary emits it.
const row = (over = {}) => ({
  outcome: 'Mortality', timepoint: '', esType: 'OR',
  k: 5, es: 0.5, lo: 0.1, hi: 0.9, pval: 0.02, i2: 10, method: 'DL', ...over,
});

describe('detectMaShifts (86.md P0.4)', () => {
  it('detects a direction flip between paired outcomes', () => {
    const prev = [row({ es: 0.5, lo: 0.1, hi: 0.9 })];   // significant, positive
    const curr = [row({ es: -0.5, lo: -0.9, hi: -0.1 })]; // significant, negative
    const shifts = detectMaShifts(prev, curr);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.some((s) => s.type === 'direction_change')).toBe(true);
  });

  it('detects a significance change (CI crosses the null now)', () => {
    const prev = [row({ es: 0.5, lo: 0.1, hi: 0.9 })];   // excludes null
    const curr = [row({ es: 0.2, lo: -0.3, hi: 0.7 })];  // now crosses null
    const shifts = detectMaShifts(prev, curr);
    expect(shifts.some((s) => s.type === 'significance_change')).toBe(true);
  });

  it('raises outcome_added / outcome_removed for unmatched outcomes', () => {
    const added = detectMaShifts([], [row()]);
    expect(added.some((s) => s.type === 'outcome_added')).toBe(true);
    const removed = detectMaShifts([row()], []);
    expect(removed.some((s) => s.type === 'outcome_removed')).toBe(true);
  });

  it('reports no shift for identical snapshots', () => {
    expect(detectMaShifts([row()], [row()])).toEqual([]);
  });

  // 86.md P2.15/P3.30 — AUC lives on the raw 0–1 scale where the null is 0.5, not 0.
  it('judges AUC significance against 0.5, not 0', () => {
    const auc = (over) => row({ outcome: 'Discrimination', esType: 'AUC', ...over });
    // prev CI [0.55,0.75] excludes 0.5 (significant); curr [0.45,0.60] crosses 0.5.
    const prev = [auc({ es: 0.65, lo: 0.55, hi: 0.75 })];
    const curr = [auc({ es: 0.52, lo: 0.45, hi: 0.60 })];
    const shifts = detectMaShifts(prev, curr);
    expect(shifts.some((s) => s.type === 'significance_change')).toBe(true);
  });

  it('does NOT fire a spurious AUC significance shift when both CIs stay above 0.5', () => {
    const auc = (over) => row({ outcome: 'Discrimination', esType: 'AUC', ...over });
    // Both exclude the 0.5 null; against the OLD null=0 both trivially excluded 0 too,
    // but neither crosses — so no significance_change either way. The guard is that a
    // small magnitude drift does not read as a significance flip.
    const prev = [auc({ es: 0.80, lo: 0.72, hi: 0.88 })];
    const curr = [auc({ es: 0.78, lo: 0.70, hi: 0.86 })];
    const shifts = detectMaShifts(prev, curr);
    expect(shifts.some((s) => s.type === 'significance_change')).toBe(false);
  });

  it('regression guard: calling the detector on the whole arrays finds nothing (the old bug)', () => {
    const prev = [row({ es: 0.5, lo: 0.1, hi: 0.9 })];
    const curr = [row({ es: -0.5, lo: -0.9, hi: -0.1 })];
    // Arrays are truthy but have no k/es/i2 props → every numeric check fails.
    const res = detectEvidenceShift(prev, curr);
    expect(res.any).toBe(false);
    // The correct path DOES fire on the same data.
    expect(detectMaShifts(prev, curr).length).toBeGreaterThan(0);
  });
});
