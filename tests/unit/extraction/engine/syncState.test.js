import { describe, it, expect } from 'vitest';
import {
  computeSyncHash, analysisReady, syncStatusOf, markSynced, setInclusion,
  SYNC_STATUSES, SYNC_STATUS_META,
} from '../../../../src/research-engine/extraction/engine/syncState.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

describe('syncState.computeSyncHash', () => {
  it('is stable and ignores cosmetic whitespace', () => {
    const a = computeSyncHash({ es: '0.5', lo: '0.3', hi: '0.7' });
    const b = computeSyncHash({ es: ' 0.5 ', lo: '0.3', hi: '0.7' });
    expect(a).toBe(b);
  });
  it('changes when an analysis input changes', () => {
    const a = computeSyncHash({ es: '0.5' });
    const b = computeSyncHash({ es: '0.6' });
    expect(a).not.toBe(b);
  });
});

describe('syncState.analysisReady', () => {
  it('false without es', () => expect(analysisReady(mkStudy())).toBe(false));
  it('true with a numeric es', () => expect(analysisReady({ ...mkStudy(), es: '0.5' })).toBe(true));
});

describe('syncState.syncStatusOf', () => {
  it('not_ready without an effect size', () => {
    expect(syncStatusOf(mkStudy())).toBe('not_ready');
  });
  it('ready when analysis-ready but never synced', () => {
    expect(syncStatusOf({ ...mkStudy(), es: '0.5' })).toBe('ready');
  });
  it('synced right after markSynced', () => {
    const s = markSynced({ ...mkStudy(), es: '0.5' }, { at: '2026-01-01T00:00:00Z', by: 'u1' });
    expect(syncStatusOf(s)).toBe('synced');
    expect(s.extractionMeta.syncedAt).toBe('2026-01-01T00:00:00Z');
  });
  it('updated_since_sync after the es changes post-sync', () => {
    const s = markSynced({ ...mkStudy(), es: '0.5' }, { at: 't' });
    const edited = { ...s, es: '0.9' };
    expect(syncStatusOf(edited)).toBe('updated_since_sync');
  });
  it('excluded when the reviewer removes it from analysis', () => {
    const s = setInclusion({ ...mkStudy(), es: '0.5' }, false);
    expect(syncStatusOf(s)).toBe('excluded');
  });
  it('re-including a study restores its sync state', () => {
    let s = setInclusion({ ...mkStudy(), es: '0.5' }, false);
    s = setInclusion(s, true);
    expect(syncStatusOf(s)).toBe('ready');
  });
  it('markSynced does not mutate the input', () => {
    const s = { ...mkStudy(), es: '0.5' };
    markSynced(s, { at: 't' });
    expect(s.extractionMeta).toBeUndefined();
  });
  it('every sync status has UI meta', () => {
    for (const st of SYNC_STATUSES) expect(SYNC_STATUS_META[st]).toBeTruthy();
  });
});
