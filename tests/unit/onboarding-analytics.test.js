/**
 * onboarding-analytics.test.js — prompt36 Task 6. Pure-logic coverage for the
 * onboarding analytics math: percentage helper, per-question rows (active vs
 * inactive denominators), overview totals/rates, per-user rows, and the
 * privacy-aware answer renderer. DB-coupled controllers are exercised by the
 * live admin smoke flow; these lock the formulas + denominator contract.
 */
import { describe, it, expect } from 'vitest';
import {
  onbPct,
  questionAnalyticsRow,
  onboardingOverview,
  userAnalyticsRow,
  safeAnswerDisplay,
} from '../../server/controllers/onboardingController.js';

const Q = (over = {}) => ({ id: 'q1', key: 'k', prompt: 'p', type: 'single_select', isActive: true, isRequired: false, allowSkip: true, ...over });

describe('onbPct — one-decimal percentage', () => {
  it('rounds to one decimal place', () => {
    expect(onbPct(1, 3)).toBe(33.3);
    expect(onbPct(2, 3)).toBe(66.7);
    expect(onbPct(1, 2)).toBe(50);
  });
  it('is 0 when the denominator is 0 (never NaN/Infinity)', () => {
    expect(onbPct(5, 0)).toBe(0);
    expect(onbPct(0, 0)).toBe(0);
  });
});

describe('questionAnalyticsRow — active question (denominator = total users)', () => {
  it('answered + skipped + pending = total users, and the three rates sum to ~100%', () => {
    const row = questionAnalyticsRow(Q(), { answered: 6, skipped: 2, lastAnsweredAt: 't1' }, 10);
    expect(row.answered).toBe(6);
    expect(row.skipped).toBe(2);
    expect(row.pending).toBe(2); // 10 - (6 + 2)
    expect(row.answered + row.skipped + row.pending).toBe(10);
    expect(row.answeredPct).toBe(60);
    expect(row.skippedPct).toBe(20);
    expect(row.pendingPct).toBe(20);
    expect(row.denomBasis).toBe('all_users');
    expect(row.lastAnsweredAt).toBe('t1');
  });
  it('never returns a negative pending count', () => {
    // defensive: more responses than the current user count (e.g. deleted users)
    const row = questionAnalyticsRow(Q(), { answered: 8, skipped: 5 }, 10);
    expect(row.pending).toBe(0);
  });
  it('a required question reports allowSkip=false', () => {
    const row = questionAnalyticsRow(Q({ isRequired: true, allowSkip: true }), { answered: 1, skipped: 0 }, 4);
    expect(row.allowSkip).toBe(false);
  });
});

describe('questionAnalyticsRow — inactive question (denominator = responders)', () => {
  it('pending is 0 and percentages are over the users who actually responded', () => {
    const row = questionAnalyticsRow(Q({ isActive: false }), { answered: 3, skipped: 1 }, 10);
    expect(row.pending).toBe(0);
    expect(row.answeredPct).toBe(75);  // 3 / (3+1)
    expect(row.skippedPct).toBe(25);
    expect(row.pendingPct).toBe(0);
    expect(row.denomBasis).toBe('responders');
  });
});

describe('onboardingOverview — active-question universe', () => {
  it('computes assigned = activeQuestions × totalUsers and consistent rates', () => {
    const o = onboardingOverview({ totalQuestions: 5, activeQuestions: 3, totalUsers: 10, answeredActive: 12, skippedActive: 6, completedUsers: 4 });
    expect(o.totalAssignedResponses).toBe(30); // 3 × 10
    expect(o.answered).toBe(12);
    expect(o.skipped).toBe(6);
    expect(o.pending).toBe(12); // 30 - (12 + 6)
    expect(o.completionRate).toBe(40);
    expect(o.skipRate).toBe(20);
    expect(o.pendingRate).toBe(40);
    // the three rates sum to 100% of the assignment universe
    expect(o.completionRate + o.skipRate + o.pendingRate).toBe(100);
    expect(o.completedUsers).toBe(4);
    expect(o.completedUserRate).toBe(40); // 4 / 10
  });
  it('no active questions ⇒ zero assigned and zero rates (no divide-by-zero)', () => {
    const o = onboardingOverview({ totalQuestions: 2, activeQuestions: 0, totalUsers: 10, answeredActive: 0, skippedActive: 0, completedUsers: 0 });
    expect(o.totalAssignedResponses).toBe(0);
    expect(o.completionRate).toBe(0);
    expect(o.pendingRate).toBe(0);
  });
});

describe('userAnalyticsRow — per-user completion over active questions', () => {
  it('pending = activeQuestions - (answered + skipped); complete when none pending', () => {
    const row = userAnalyticsRow({ id: 'u1', name: 'Dr A', email: 'a@x.io', lastActivity: 'ts' }, { answered: 2, skipped: 1 }, 4);
    expect(row.answered).toBe(2);
    expect(row.skipped).toBe(1);
    expect(row.pending).toBe(1);
    expect(row.completionPct).toBe(50); // 2 / 4
    expect(row.complete).toBe(false);
    expect(row.lastActivity).toBe('ts');
  });
  it('marks a user complete when they have responded to every active question', () => {
    const row = userAnalyticsRow({ id: 'u2', name: 'B', email: 'b@x.io' }, { answered: 3, skipped: 1 }, 4);
    expect(row.pending).toBe(0);
    expect(row.complete).toBe(true);
  });
  it('with zero active questions, nobody is "complete"', () => {
    const row = userAnalyticsRow({ id: 'u3' }, { answered: 0, skipped: 0 }, 0);
    expect(row.complete).toBe(false);
    expect(row.completionPct).toBe(0);
  });
});

describe('safeAnswerDisplay — privacy-aware answer rendering', () => {
  it('renders a plain JSON-encoded string answer', () => {
    expect(safeAnswerDisplay(Q({ type: 'single_select' }), JSON.stringify('Radiologist'))).toBe('Radiologist');
  });
  it('joins a multi-select array', () => {
    expect(safeAnswerDisplay(Q({ type: 'multi_select' }), JSON.stringify(['a', 'b']))).toBe('a, b');
  });
  it('surfaces only the human-readable name for an institution object', () => {
    const raw = JSON.stringify({ name: 'typed', canonicalName: 'Stanford University', rorId: 'x', city: 'Stanford' });
    expect(safeAnswerDisplay(Q({ type: 'institution' }), raw)).toBe('Stanford University');
  });
  it('returns null for null / empty answers', () => {
    expect(safeAnswerDisplay(Q(), null)).toBe(null);
    expect(safeAnswerDisplay(Q({ type: 'text' }), JSON.stringify(''))).toBe(null);
  });
});
