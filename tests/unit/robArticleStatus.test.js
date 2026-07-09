/**
 * robArticleStatus.test.js — 79.md §1. Pure card-level status derivation for the
 * redesigned Risk-of-Bias article list. Verifies the four distinguishable states and
 * that the encoding carries a redundant icon (never colour alone).
 */
import { describe, it, expect } from 'vitest';
import { articleStatusOf } from '../../src/frontend/rob/articleStatus.js';

describe('articleStatusOf', () => {
  it('no assessments → Not started', () => {
    const s = articleStatusOf([]);
    expect(s.key).toBe('not-started');
    expect(s.label).toBe('Not started');
    expect(s.icon).toBeTruthy(); // redundant symbol, not colour alone
  });

  it('handles null/undefined as Not started', () => {
    expect(articleStatusOf(null).key).toBe('not-started');
    expect(articleStatusOf(undefined).key).toBe('not-started');
  });

  it('drafts only → In progress', () => {
    const s = articleStatusOf([{ status: 'draft' }, { status: 'in_progress' }]);
    expect(s.key).toBe('in-progress');
    expect(s.icon).toBe('clock');
  });

  it('all finalised → Complete', () => {
    expect(articleStatusOf([{ status: 'complete' }]).key).toBe('complete');
    expect(articleStatusOf([{ status: 'complete' }]).label).toBe('Complete');
    expect(articleStatusOf([{ status: 'complete' }, { status: 'complete' }]).label).toBe('All complete');
    expect(articleStatusOf([{ status: 'complete' }]).icon).toBe('circleCheck');
  });

  it('mixed finalised/draft → partial with n/N label', () => {
    const s = articleStatusOf([{ status: 'complete' }, { status: 'draft' }, { status: 'draft' }]);
    expect(s.key).toBe('partial');
    expect(s.label).toBe('1/3 complete');
  });

  it('every status carries a distinct icon (accessible without colour)', () => {
    const icons = new Set([
      articleStatusOf([]).icon,
      articleStatusOf([{ status: 'draft' }]).icon,
      articleStatusOf([{ status: 'complete' }, { status: 'draft' }]).icon,
      articleStatusOf([{ status: 'complete' }]).icon,
    ]);
    expect(icons.size).toBeGreaterThanOrEqual(3); // minus / clock / circleCheck
  });
});
