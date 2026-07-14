/** 88.md — Project History display helpers (pure). */
import { describe, it, expect } from 'vitest';
import { eventTitle, significanceBadge, manuscriptImpact, beforeAfter, originLabel, humanizeType } from '../../../src/features/provenance/format.js';

describe('provenance format helpers', () => {
  it('titles known + unknown event types', () => {
    expect(eventTitle({ eventType: 'META_ANALYSIS_MODEL_CHANGED' })).toBe('Meta-analysis model changed');
    expect(eventTitle({ eventType: 'SOME_NEW_THING' })).toBe('Some new thing');
    expect(humanizeType('DATABASE_ADDED')).toBe('Database added');
  });
  it('significance badge tone scales with level', () => {
    expect(significanceBadge(6).tone).toBe('danger');
    expect(significanceBadge(5).tone).toBe('warn');
    expect(significanceBadge(4).tone).toBe('info');
    expect(significanceBadge(3).tone).toBe('brand');
    expect(significanceBadge(1).tone).toBe('neutral');
  });
  it('manuscript impact summarizes affected sections', () => {
    expect(manuscriptImpact({ manuscriptSections: ['methods', 'results'], resultImpact: 'changed' })).toBe('Methods, Results updated');
    expect(manuscriptImpact({ manuscriptSections: [] })).toBe(null);
  });
  it('beforeAfter renders compact values, null when empty', () => {
    expect(beforeAfter({ prevValue: 'fixed', newValue: 'random' })).toEqual({ prev: 'fixed', next: 'random' });
    expect(beforeAfter({ prevValue: null, newValue: null })).toBe(null);
  });
  it('originLabel maps origins', () => {
    expect(originLabel('automated_search')).toBe('Automated search');
    expect(originLabel('migration')).toBe('Migration');
    expect(originLabel('weird')).toBe('User');
  });
});
