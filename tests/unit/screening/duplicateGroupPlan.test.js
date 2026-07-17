/**
 * duplicateGroupPlan.test.js — 92.md write-plan mapping (pure).
 * The plan layer is what makes re-detection idempotent and manual-review-safe:
 * unchanged groups produce NO writes, new members extend the oldest existing
 * group, absorbed groups merge deterministically, and the target's reviewer-
 * selected primary survives.
 */
import { describe, it, expect } from 'vitest';
import { planGroupWrites } from '../../../src/research-engine/screening/duplicateGroupPlan.js';

const g = (id, createdAt, members, primaryId = null) => ({
  id, createdAt,
  records: members.map((m) => ({ id: m, isPrimary: m === primaryId })),
});

describe('planGroupWrites', () => {
  it('creates a plan for a brand-new group', () => {
    const plans = planGroupWrites([['a', 'b']], []);
    expect(plans).toEqual([{ kind: 'create', members: ['a', 'b'] }]);
  });

  it('produces NO plan when the persisted group already matches and has a primary', () => {
    const open = [g('g1', '2026-01-01', ['a', 'b'], 'a')];
    expect(planGroupWrites([['a', 'b']], open)).toEqual([]);
  });

  it('re-plans a group whose membership matches but which lost its primary (repair)', () => {
    const open = [g('g1', '2026-01-01', ['a', 'b'], null)];
    const plans = planGroupWrites([['a', 'b']], open);
    expect(plans).toHaveLength(1);
    expect(plans[0].kind).toBe('extend');
    expect(plans[0].newMembers).toEqual([]);
    expect(plans[0].targetPrimaryId).toBeNull();
  });

  it('extends an existing group with new members, keeping its primary', () => {
    const open = [g('g1', '2026-01-01', ['a', 'b'], 'b')];
    const plans = planGroupWrites([['a', 'b', 'c']], open);
    expect(plans).toEqual([{
      kind: 'extend', targetId: 'g1', members: ['a', 'b', 'c'],
      newMembers: ['c'], absorbedGroupIds: [], targetPrimaryId: 'b',
    }]);
  });

  it('absorbs newer overlapping groups into the OLDEST one and keeps ITS primary', () => {
    const open = [
      g('g2', '2026-02-01', ['c', 'd'], 'c'), // newer
      g('g1', '2026-01-01', ['a', 'b'], 'b'), // older → target
    ];
    const plans = planGroupWrites([['a', 'b', 'c', 'd', 'e']], open);
    expect(plans).toEqual([{
      kind: 'extend', targetId: 'g1', members: ['a', 'b', 'c', 'd', 'e'],
      newMembers: ['c', 'd', 'e'], absorbedGroupIds: ['g2'],
      targetPrimaryId: 'b', // the target's reviewer-selected primary — never g2's
    }]);
  });

  it('breaks createdAt ties by smallest group id (deterministic)', () => {
    const open = [
      g('gB', '2026-01-01', ['c', 'd'], 'c'),
      g('gA', '2026-01-01', ['a', 'b'], 'a'),
    ];
    const plans = planGroupWrites([['a', 'b', 'c', 'd']], open);
    expect(plans[0].targetId).toBe('gA');
    expect(plans[0].absorbedGroupIds).toEqual(['gB']);
  });

  it('mixes creates and extends across independent groups', () => {
    const open = [g('g1', '2026-01-01', ['a', 'b'], 'a')];
    const plans = planGroupWrites([['a', 'b'], ['x', 'y']], open);
    expect(plans).toEqual([{ kind: 'create', members: ['x', 'y'] }]);
  });
});
