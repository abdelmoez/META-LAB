/**
 * searchModeStore.test.js — 78.md #5. The shared reactive mode store is the ONE bridge
 * that keeps the white side-menu in sync with the in-body SearchWorkspace mode choice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSearchMode, publishSearchMode, subscribeSearchMode, __resetSearchModeStore,
  getSearchStageStatuses, publishSearchStageStatuses, subscribeSearchStageStatuses,
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
