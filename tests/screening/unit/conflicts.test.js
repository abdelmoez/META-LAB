/**
 * conflicts.test.js
 * Unit tests for the META·SIFT Beta conflict detection module.
 * No server required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { detectConflict, findAllConflicts } from '../../../src/research-engine/screening/conflicts.js';

// ── detectConflict ─────────────────────────────────────────────────────────────

describe('detectConflict', () => {
  it('returns no conflict for empty decisions array', () => {
    const result = detectConflict([]);
    expect(result.hasConflict).toBe(false);
  });

  it('returns no conflict when only one reviewer has decided', () => {
    const decisions = [{ reviewerId: 'r1', decision: 'include' }];
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });

  it('returns no conflict when two reviewers made the same decision (include/include)', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: 'include' },
    ];
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });

  it('returns no conflict when two reviewers both excluded', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'exclude' },
      { reviewerId: 'r2', decision: 'exclude' },
    ];
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });

  it('detects conflict when one reviewer includes and another excludes', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: 'exclude' },
    ];
    const result = detectConflict(decisions);
    expect(result.hasConflict).toBe(true);
  });

  it('detects conflict when decisions are include and maybe', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: 'maybe' },
    ];
    expect(detectConflict(decisions).hasConflict).toBe(true);
  });

  it('detects conflict when decisions are exclude and maybe', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'exclude' },
      { reviewerId: 'r2', decision: 'maybe' },
    ];
    expect(detectConflict(decisions).hasConflict).toBe(true);
  });

  it('ignores undecided decisions when counting conflicts', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: 'undecided' },
    ];
    // Only one real decision — no conflict possible
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });

  it('ignores empty/null decision fields', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: '' },
      { reviewerId: 'r3', decision: null },
    ];
    // Only r1 has a real decision
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });

  it('returns correct reviewerId-to-decision map', () => {
    const decisions = [
      { reviewerId: 'alice', decision: 'include' },
      { reviewerId: 'bob', decision: 'exclude' },
    ];
    const result = detectConflict(decisions);
    expect(result.decisions).toEqual({ alice: 'include', bob: 'exclude' });
  });

  it('returns uniqueDecisions array with all distinct values', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'include' },
      { reviewerId: 'r2', decision: 'exclude' },
      { reviewerId: 'r3', decision: 'include' },
    ];
    const result = detectConflict(decisions);
    expect(result.uniqueDecisions).toContain('include');
    expect(result.uniqueDecisions).toContain('exclude');
    expect(result.uniqueDecisions).toHaveLength(2);
  });

  it('three reviewers all agree — no conflict', () => {
    const decisions = [
      { reviewerId: 'r1', decision: 'exclude' },
      { reviewerId: 'r2', decision: 'exclude' },
      { reviewerId: 'r3', decision: 'exclude' },
    ];
    expect(detectConflict(decisions).hasConflict).toBe(false);
  });
});

// ── findAllConflicts ───────────────────────────────────────────────────────────

describe('findAllConflicts', () => {
  it('returns empty array when there are no conflicts', () => {
    const recordDecisions = {
      rec1: [
        { reviewerId: 'r1', decision: 'include' },
        { reviewerId: 'r2', decision: 'include' },
      ],
      rec2: [
        { reviewerId: 'r1', decision: 'exclude' },
        { reviewerId: 'r2', decision: 'exclude' },
      ],
    };
    expect(findAllConflicts(recordDecisions)).toEqual([]);
  });

  it('identifies a single conflicted record', () => {
    const recordDecisions = {
      rec1: [
        { reviewerId: 'r1', decision: 'include' },
        { reviewerId: 'r2', decision: 'exclude' },
      ],
      rec2: [
        { reviewerId: 'r1', decision: 'exclude' },
        { reviewerId: 'r2', decision: 'exclude' },
      ],
    };
    const conflicts = findAllConflicts(recordDecisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].recordId).toBe('rec1');
    expect(conflicts[0].hasConflict).toBe(true);
  });

  it('identifies multiple conflicted records', () => {
    const recordDecisions = {
      rec1: [
        { reviewerId: 'r1', decision: 'include' },
        { reviewerId: 'r2', decision: 'exclude' },
      ],
      rec2: [
        { reviewerId: 'r1', decision: 'maybe' },
        { reviewerId: 'r2', decision: 'exclude' },
      ],
      rec3: [
        { reviewerId: 'r1', decision: 'include' },
        { reviewerId: 'r2', decision: 'include' },
      ],
    };
    const conflicts = findAllConflicts(recordDecisions);
    expect(conflicts).toHaveLength(2);
    const ids = conflicts.map(c => c.recordId);
    expect(ids).toContain('rec1');
    expect(ids).toContain('rec2');
    expect(ids).not.toContain('rec3');
  });

  it('returns empty array for empty input object', () => {
    expect(findAllConflicts({})).toEqual([]);
  });

  it('includes the decisions map in conflict results', () => {
    const recordDecisions = {
      recA: [
        { reviewerId: 'alice', decision: 'include' },
        { reviewerId: 'bob', decision: 'exclude' },
      ],
    };
    const conflicts = findAllConflicts(recordDecisions);
    expect(conflicts[0].decisions).toEqual({ alice: 'include', bob: 'exclude' });
  });
});
