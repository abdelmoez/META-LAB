/**
 * recordListQuery.test.js — 65.md SCR-1: eligibility + Prisma-query mapping for
 * the listRecords fast path. Pure unit tests (no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  fastListEligible, buildFastListQuery, FAST_LIST_FILTERS, pageWindow,
} from '../../../src/research-engine/screening/recordListQuery.js';

describe('fastListEligible — conservative eligibility', () => {
  it('accepts the default request (no search/keywords/AI, filter all)', () => {
    expect(fastListEligible({ search: '', filter: 'all' })).toBe(true);
    expect(fastListEligible({})).toBe(true); // filter defaults to all
  });

  it('accepts the per-member open-state filters', () => {
    expect(fastListEligible({ filter: 'unopened_me' })).toBe(true);
    expect(fastListEligible({ filter: 'opened_me' })).toBe(true);
  });

  it('rejects any text search', () => {
    expect(fastListEligible({ search: 'aspirin', filter: 'all' })).toBe(false);
  });

  it('rejects keyword filtering', () => {
    expect(fastListEligible({ filter: 'all', keywords: 'trial,rct' })).toBe(false);
  });

  it('rejects hasAbstract filtering', () => {
    expect(fastListEligible({ filter: 'all', hasAbstract: 'yes' })).toBe(false);
    expect(fastListEligible({ filter: 'all', hasAbstract: 'no' })).toBe(false);
    // undefined / empty stays eligible
    expect(fastListEligible({ filter: 'all', hasAbstract: undefined })).toBe(true);
    expect(fastListEligible({ filter: 'all', hasAbstract: '' })).toBe(true);
  });

  it('rejects AI-queue ordering and band filtering (but tolerates the defaults)', () => {
    expect(fastListEligible({ filter: 'all', aiQueue: 'ai_relevance' })).toBe(false);
    expect(fastListEligible({ filter: 'all', aiBand: 'high' })).toBe(false);
    expect(fastListEligible({ filter: 'all', aiQueue: 'default', aiBand: 'all' })).toBe(true);
    expect(fastListEligible({ filter: 'all', aiQueue: '', aiBand: '' })).toBe(true);
  });

  it('rejects decision-based filters (first-decision-row semantics are not relational)', () => {
    for (const f of ['undecided', 'included', 'excluded', 'maybe', 'include', 'exclude', 'quorum', 'disputed']) {
      expect(fastListEligible({ filter: f })).toBe(false);
    }
  });

  it('the exported safe-filter list matches the eligibility behaviour', () => {
    for (const f of FAST_LIST_FILTERS) expect(fastListEligible({ filter: f })).toBe(true);
  });
});

describe('buildFastListQuery — where/orderBy mapping', () => {
  const args = { projectId: 'p1', userId: 'u1' };

  it("'all' → project scope only", () => {
    const q = buildFastListQuery({ ...args, filter: 'all' });
    expect(q.where).toEqual({ projectId: 'p1' });
  });

  it("'unopened_me' → none of MY open-state rows", () => {
    const q = buildFastListQuery({ ...args, filter: 'unopened_me' });
    expect(q.where).toEqual({ projectId: 'p1', openStates: { none: { userId: 'u1' } } });
  });

  it("'opened_me' → some of MY open-state rows", () => {
    const q = buildFastListQuery({ ...args, filter: 'opened_me' });
    expect(q.where).toEqual({ projectId: 'p1', openStates: { some: { userId: 'u1' } } });
  });

  it('ordering is createdAt asc with a deterministic id tiebreak (stable skip/take)', () => {
    const q = buildFastListQuery({ ...args, filter: 'all' });
    expect(q.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});

/* ── 100.md §13 — the page window Resume Screening introduced ─────────────────── */

describe('pageWindow — what is still loadable around a contiguous run of pages', () => {
  const W = (o) => pageWindow({ limit: 50, ...o });

  it('the ordinary case (loaded from page 1) behaves exactly as before', () => {
    expect(W({ firstPage: 1, page: 1, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: false, earlierCount: 0, hasMore: true, remaining: 499 });
    expect(W({ firstPage: 1, page: 3, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: false, earlierCount: 0, hasMore: true, remaining: 399 });
  });

  it('a resume jump reports BOTH directions honestly', () => {
    // Jumped straight to page 3: 100 records lie behind, 399 ahead — not 499.
    expect(W({ firstPage: 3, page: 3, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: true, earlierCount: 100, hasMore: true, remaining: 399 });
    // …then "Earlier records" once: the run is now 2…3.
    expect(W({ firstPage: 2, page: 3, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: true, earlierCount: 50, hasMore: true, remaining: 399 });
    // …and "Load more" once: the run is 2…4.
    expect(W({ firstPage: 2, page: 4, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: true, earlierCount: 50, hasMore: true, remaining: 349 });
  });

  it('the last page offers nothing more, whatever the partial size', () => {
    expect(W({ firstPage: 11, page: 11, pages: 11, total: 549 }))
      .toEqual({ hasEarlier: true, earlierCount: 500, hasMore: false, remaining: 0 });
    expect(W({ firstPage: 1, page: 1, pages: 1, total: 8 }))
      .toEqual({ hasEarlier: false, earlierCount: 0, hasMore: false, remaining: 0 });
  });

  it('never reports more earlier records than exist, and never goes negative', () => {
    expect(W({ firstPage: 3, page: 3, pages: 3, total: 120 }).earlierCount).toBe(100);
    expect(W({ firstPage: 5, page: 5, pages: 5, total: 60 }).earlierCount).toBe(60);
    expect(W({ firstPage: 1, page: 9, pages: 3, total: 100 }).remaining).toBe(0);
  });

  it('is defensive about junk', () => {
    expect(W({})).toEqual({ hasEarlier: false, earlierCount: 0, hasMore: false, remaining: 0 });
    expect(pageWindow()).toEqual({ hasEarlier: false, earlierCount: 0, hasMore: false, remaining: 0 });
    expect(W({ firstPage: -3, page: 'x', pages: null, total: -5, limit: 0 }))
      .toEqual({ hasEarlier: false, earlierCount: 0, hasMore: false, remaining: 0 });
    // A window whose `page` precedes `firstPage` is nonsense — clamp, never invert.
    expect(W({ firstPage: 4, page: 2, pages: 10, total: 500 }).remaining).toBe(300);
  });
});
