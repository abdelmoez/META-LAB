/**
 * searchModeStore.test.js — 78.md #5. The shared reactive mode store is the ONE bridge
 * that keeps the white side-menu in sync with the in-body SearchWorkspace mode choice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSearchMode, publishSearchMode, subscribeSearchMode, __resetSearchModeStore,
  getSearchStageStatuses, publishSearchStageStatuses, subscribeSearchStageStatuses,
  getSearchStageAdvisories, searchAdvisoryLabel,
} from '../../src/features/searchWorkspace/searchModeStore.js';

beforeEach(() => __resetSearchModeStore());

describe('searchModeStore', () => {
  it('getSearchMode is undefined until resolved, then reflects the published value', () => {
    expect(getSearchMode('p1')).toBeUndefined();
    publishSearchMode('p1', 'automated');
    expect(getSearchMode('p1')).toBe('automated');
    publishSearchMode('p1', 'manual');
    expect(getSearchMode('p1')).toBe('manual');
  });

  it('normalizes a junk mode to null (resolved)', () => {
    publishSearchMode('p1', 'nonsense');
    expect(getSearchMode('p1')).toBeNull();          // resolved, not undefined
  });

  it('notifies subscribers on change and is keyed per project', () => {
    const seen = [];
    const unsub = subscribeSearchMode('p1', (m) => seen.push(m));
    publishSearchMode('p1', 'automated');
    publishSearchMode('p2', 'manual');               // different project → not delivered to p1
    publishSearchMode('p1', 'manual');
    expect(seen).toEqual(['automated', 'manual']);
    unsub();
    publishSearchMode('p1', 'automated');
    expect(seen).toEqual(['automated', 'manual']);   // no delivery after unsubscribe
  });

  it('is idempotent: republishing the same mode does not re-notify', () => {
    const seen = [];
    subscribeSearchMode('p1', (m) => seen.push(m));
    publishSearchMode('p1', 'automated');
    publishSearchMode('p1', 'automated');            // no-op
    publishSearchMode('p1', 'automated');            // no-op
    expect(seen).toEqual(['automated']);
  });

  it('a subscriber that throws never blocks the publish (other subscribers still fire)', () => {
    const seen = [];
    subscribeSearchMode('p1', () => { throw new Error('boom'); });
    subscribeSearchMode('p1', (m) => seen.push(m));
    expect(() => publishSearchMode('p1', 'manual')).not.toThrow();
    expect(seen).toEqual(['manual']);
  });

  it('ignores a missing projectId gracefully', () => {
    expect(() => publishSearchMode('', 'manual')).not.toThrow();
    expect(subscribeSearchMode('', () => {})()).toBeUndefined();
    expect(getSearchMode('')).toBeUndefined();
  });
});

describe('searchModeStore — 85.md per-stage statuses (additive)', () => {
  const STATUSES = { question: 'done', concepts: 'partial', terms: 'attention', mode: 'empty' };

  it('is undefined until the workspace publishes, then reflects the map', () => {
    expect(getSearchStageStatuses('p1')).toBeUndefined();
    publishSearchStageStatuses('p1', STATUSES);
    expect(getSearchStageStatuses('p1')).toEqual(STATUSES);
  });

  it('notifies subscribers per project + supports unsubscribe', () => {
    const seen = [];
    const unsub = subscribeSearchStageStatuses('p1', (s) => seen.push(s));
    publishSearchStageStatuses('p1', STATUSES);
    publishSearchStageStatuses('p2', { question: 'empty' }); // other project → not delivered
    expect(seen).toEqual([STATUSES]);
    unsub();
    publishSearchStageStatuses('p1', { question: 'empty' });
    expect(seen.length).toBe(1);
  });

  it('is idempotent on deep-equal maps (republish per render never storms)', () => {
    const seen = [];
    subscribeSearchStageStatuses('p1', (s) => seen.push(s));
    publishSearchStageStatuses('p1', { a: 'done', b: 'empty' });
    publishSearchStageStatuses('p1', { b: 'empty', a: 'done' }); // deep-equal → no-op
    expect(seen.length).toBe(1);
    publishSearchStageStatuses('p1', { a: 'done', b: 'partial' }); // real change
    expect(seen.length).toBe(2);
  });

  it('sanitizes junk (non-string values dropped; empty/junk maps ignored)', () => {
    publishSearchStageStatuses('p1', { good: 'done', bad: 42, worse: null });
    expect(getSearchStageStatuses('p1')).toEqual({ good: 'done' });
    publishSearchStageStatuses('p3', null);
    publishSearchStageStatuses('p3', 'nonsense');
    expect(getSearchStageStatuses('p3')).toBeUndefined();
  });

  it('the mode API is untouched by status publishes (and vice versa)', () => {
    publishSearchStageStatuses('p1', STATUSES);
    expect(getSearchMode('p1')).toBeUndefined();
    publishSearchMode('p1', 'manual');
    expect(getSearchStageStatuses('p1')).toEqual(STATUSES);
  });

  it('__resetSearchModeStore clears statuses too', () => {
    publishSearchStageStatuses('p1', STATUSES);
    __resetSearchModeStore();
    expect(getSearchStageStatuses('p1')).toBeUndefined();
  });
});

/* 114.md §2 r2 — the ADVISORY channel crosses the store boundary.
   The bug: the workspace computed { statuses, advisories } but this publisher took
   statuses ONLY, so the review counts were dropped here — and since the in-body rail
   that rendered them is suppressed whenever the white side-menu stepper drives the
   stages, the advisory pill was unreachable in the production Stitch shell. */
describe('searchModeStore — 114.md §2 advisories ride WITH the statuses', () => {
  const MODEL = {
    statuses: { terms: 'done', mode: 'empty' },
    advisories: { terms: { suggestions: 2, warnings: 1, total: 3 } },
  };

  it('the { statuses, advisories } model form publishes BOTH channels', () => {
    expect(getSearchStageAdvisories('p1')).toBeUndefined();
    publishSearchStageStatuses('p1', MODEL);
    expect(getSearchStageStatuses('p1')).toEqual(MODEL.statuses);
    expect(getSearchStageAdvisories('p1')).toEqual(MODEL.advisories);
  });

  it('the legacy statuses-only form still works and never invents advisories', () => {
    publishSearchStageStatuses('p1', { terms: 'done' });
    expect(getSearchStageStatuses('p1')).toEqual({ terms: 'done' });
    expect(getSearchStageAdvisories('p1')).toBeUndefined();
  });

  it('a statuses-only publish never CLEARS advisories a model publish established', () => {
    publishSearchStageStatuses('p1', MODEL);
    publishSearchStageStatuses('p1', { terms: 'partial' });
    expect(getSearchStageStatuses('p1')).toEqual({ terms: 'partial' });
    expect(getSearchStageAdvisories('p1')).toEqual(MODEL.advisories);
  });

  it('subscribers receive (statuses, advisories); both are idempotent on deep-equal', () => {
    const seen = [];
    subscribeSearchStageStatuses('p1', (s, a) => seen.push([s, a]));
    publishSearchStageStatuses('p1', MODEL);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toEqual(MODEL.statuses);
    expect(seen[0][1]).toEqual(MODEL.advisories);
    // Deep-equal republish (a fresh object every render) → no notification at all.
    publishSearchStageStatuses('p1', {
      statuses: { mode: 'empty', terms: 'done' },
      advisories: { terms: { suggestions: 2, warnings: 1, total: 3 } },
    });
    expect(seen).toHaveLength(1);
  });

  it('an ADVISORY-only change notifies with a FRESH statuses reference (the stepper must repaint)', () => {
    const seen = [];
    publishSearchStageStatuses('p1', MODEL);
    const before = getSearchStageStatuses('p1');
    subscribeSearchStageStatuses('p1', (s, a) => seen.push([s, a]));
    // Accepting one suggestion: the status holds at 'done', only the count moves.
    publishSearchStageStatuses('p1', {
      statuses: { terms: 'done', mode: 'empty' },
      advisories: { terms: { suggestions: 1, warnings: 1, total: 2 } },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0][1].terms.total).toBe(2);
    expect(seen[0][0]).toEqual(before);
    expect(seen[0][0]).not.toBe(before);          // new reference → React re-renders
    expect(getSearchStageStatuses('p1')).toBe(seen[0][0]);
  });

  it('sanitizes junk advisories (bad counts → 0; a missing total is derived; junk map ignored)', () => {
    publishSearchStageStatuses('p1', {
      statuses: { terms: 'done' },
      advisories: { terms: { suggestions: 2 }, bad: 7, worse: null, neg: { suggestions: -3, warnings: 'x' } },
    });
    expect(getSearchStageAdvisories('p1')).toEqual({
      terms: { suggestions: 2, warnings: 0, total: 2 },   // total derived from the split
      neg: { suggestions: 0, warnings: 0, total: 0 },
    });
    publishSearchStageStatuses('p2', { statuses: { terms: 'done' }, advisories: 'nonsense' });
    expect(getSearchStageAdvisories('p2')).toBeUndefined();
  });

  it('__resetSearchModeStore clears advisories too', () => {
    publishSearchStageStatuses('p1', MODEL);
    __resetSearchModeStore();
    expect(getSearchStageAdvisories('p1')).toBeUndefined();
  });
});

/* 114.md §2 r2 (minor ×3) — the ONE honest wording. The old copy hard-coded the noun
   "suggestions" onto `total`, so a strategy carrying only QUALITY WARNINGS was
   announced as "2 suggestions to review". The split fields exist so the label can
   stay true; these three wordings are the contract every surface shares. */
describe('searchAdvisoryLabel — the three honest wordings', () => {
  it('suggestions only → "N suggestions to review"', () => {
    expect(searchAdvisoryLabel({ suggestions: 2, warnings: 0, total: 2 })).toBe('2 suggestions to review');
    expect(searchAdvisoryLabel({ suggestions: 1, warnings: 0, total: 1 })).toBe('1 suggestion to review');
  });
  it('warnings only → "N quality notes to review" (never called a suggestion)', () => {
    expect(searchAdvisoryLabel({ suggestions: 0, warnings: 3, total: 3 })).toBe('3 quality notes to review');
    expect(searchAdvisoryLabel({ suggestions: 0, warnings: 1, total: 1 })).toBe('1 quality note to review');
  });
  it('mixed → "N suggestions, M quality notes" (both kinds named)', () => {
    expect(searchAdvisoryLabel({ suggestions: 2, warnings: 1, total: 3 })).toBe('2 suggestions, 1 quality note');
    expect(searchAdvisoryLabel({ suggestions: 1, warnings: 2, total: 3 })).toBe('1 suggestion, 2 quality notes');
  });
  it('nothing to review → empty string (callers render no pill)', () => {
    expect(searchAdvisoryLabel({ suggestions: 0, warnings: 0, total: 0 })).toBe('');
    expect(searchAdvisoryLabel(null)).toBe('');
    expect(searchAdvisoryLabel(undefined)).toBe('');
    expect(searchAdvisoryLabel({})).toBe('');
  });
  it('a total with no split stays generic rather than guessing a noun', () => {
    expect(searchAdvisoryLabel({ total: 4 })).toBe('4 items to review');
    expect(searchAdvisoryLabel({ total: 1 })).toBe('1 item to review');
  });
});
