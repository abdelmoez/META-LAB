import { describe, it, expect } from 'vitest';
import { summariseRobForGrade, robGradeSignature, GRADE_ROB_RATINGS } from '../../src/research-engine/rob/gradeSync.js';

const A = (id, status, overall) => ({ id, status, overall });

describe('gradeSync — summariseRobForGrade', () => {
  it('returns pending with no rating when there are no assessments', () => {
    const r = summariseRobForGrade([]);
    expect(r.hasAny).toBe(false);
    expect(r.suggestedRating).toBe(null);
    expect(r.concern).toBe('pending');
    expect(r.assessed).toBe(0);
  });

  it('returns pending when assessments exist but none are finalised', () => {
    const r = summariseRobForGrade([A('1', 'draft', 'low'), A('2', 'draft', 'high')]);
    expect(r.suggestedRating).toBe(null);
    expect(r.concern).toBe('pending');
    expect(r.completed).toBe(0);
    expect(r.pending).toBe(2);
  });

  it('suggests not_serious when all completed results are low risk', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'low'), A('2', 'complete', 'low'), A('3', 'complete', 'low')]);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.NOT_SERIOUS);
    expect(r.concern).toBe('none');
    expect(r.counts).toEqual({ low: 3, some: 0, high: 0 });
    expect(r.assessed).toBe(3);
  });

  it('suggests serious when a minority are high risk', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'low'), A('2', 'complete', 'low'), A('3', 'complete', 'high')]);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.SERIOUS);
    expect(r.concern).toBe('serious');
  });

  it('suggests serious when some-concerns are the majority (no high)', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'some'), A('2', 'complete', 'some'), A('3', 'complete', 'low')]);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.SERIOUS);
    expect(r.concern).toBe('serious');
  });

  it('keeps not_serious when only a minority have some-concerns and none high', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'low'), A('2', 'complete', 'low'), A('3', 'complete', 'some')]);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.NOT_SERIOUS);
    expect(r.concern).toBe('none');
  });

  it('suggests very_serious when high risk is at least half', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'high'), A('2', 'complete', 'high'), A('3', 'complete', 'low')]);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.VERY_SERIOUS);
    expect(r.concern).toBe('very_serious');
  });

  it('treats consensus status as completed', () => {
    const r = summariseRobForGrade([A('1', 'consensus', 'low'), A('2', 'consensus', 'low')]);
    expect(r.completed).toBe(2);
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.NOT_SERIOUS);
  });

  it('counts drafts as pending and notes them in the reason', () => {
    const r = summariseRobForGrade([A('1', 'complete', 'low'), A('2', 'draft', '')]);
    expect(r.completed).toBe(1);
    expect(r.pending).toBe(1);
    expect(r.reason).toMatch(/not yet finalised/);
  });

  // 86.md P1.12 — ROBINS-I / ROBINS-E overall levels (low/moderate/serious/critical/ni)
  // must map onto the GRADE concern scale, not be silently dropped.
  it('maps ROBINS-I serious/critical to high risk (regression: were previously ignored)', () => {
    const r = summariseRobForGrade([
      A('1', 'complete', 'low'),
      A('2', 'complete', 'critical'),
      A('3', 'complete', 'serious'),
      A('4', 'complete', 'serious'),
      A('5', 'complete', 'critical'),
      A('6', 'complete', 'critical'),
    ]);
    expect(r.assessed).toBe(6);
    expect(r.counts).toEqual({ low: 1, some: 0, high: 5 });
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.VERY_SERIOUS);
    expect(r.concern).toBe('very_serious');
  });

  it('maps ROBINS-I moderate and ni to some-concerns', () => {
    const r = summariseRobForGrade([
      A('1', 'complete', 'moderate'),
      A('2', 'complete', 'moderate'),
      A('3', 'complete', 'ni'),
      A('4', 'complete', 'low'),
    ]);
    expect(r.counts).toEqual({ low: 1, some: 3, high: 0 });
    expect(r.suggestedRating).toBe(GRADE_ROB_RATINGS.SERIOUS); // some-concerns majority
  });

  it('regression guard: five critical ROBINS-I assessments are NOT reported as "none finalised"', () => {
    const r = summariseRobForGrade([
      A('1', 'complete', 'low'),
      A('2', 'complete', 'critical'),
      A('3', 'complete', 'critical'),
      A('4', 'complete', 'critical'),
      A('5', 'complete', 'critical'),
      A('6', 'complete', 'critical'),
    ]);
    expect(r.assessed).toBe(6);
    expect(r.suggestedRating).not.toBe(null);
    expect(r.concern).toBe('very_serious');
  });
});

describe('gradeSync — robGradeSignature (staleness)', () => {
  it('is order-independent', () => {
    const a = [A('1', 'complete', 'low'), A('2', 'complete', 'high')];
    const b = [A('2', 'complete', 'high'), A('1', 'complete', 'low')];
    expect(robGradeSignature(a)).toBe(robGradeSignature(b));
  });

  it('changes when an overall judgement changes', () => {
    const before = robGradeSignature([A('1', 'complete', 'low')]);
    const after = robGradeSignature([A('1', 'complete', 'high')]);
    expect(before).not.toBe(after);
  });

  it('changes when an assessment is reopened (status change)', () => {
    const before = robGradeSignature([A('1', 'complete', 'low')]);
    const after = robGradeSignature([A('1', 'draft', 'low')]);
    expect(before).not.toBe(after);
  });

  it('changes when a new assessment is added', () => {
    const before = robGradeSignature([A('1', 'complete', 'low')]);
    const after = robGradeSignature([A('1', 'complete', 'low'), A('2', 'complete', 'some')]);
    expect(before).not.toBe(after);
  });

  it('is stable for identical input', () => {
    const x = [A('1', 'complete', 'low'), A('2', 'complete', 'some')];
    expect(robGradeSignature(x)).toBe(robGradeSignature([...x]));
  });
});
