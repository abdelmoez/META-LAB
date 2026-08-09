/**
 * recordListQuery.test.js — 65.md SCR-1: eligibility + Prisma-query mapping for
 * the listRecords fast path. Pure unit tests (no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  fastListEligible, buildFastListQuery, FAST_LIST_FILTERS, pageWindow, moveIntent,
  advanceContextMatches,
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

/* ── 107.md §7 — what a next/previous keystroke means at the current position ──── */

describe('moveIntent — keyboard navigation at the edge of the loaded window', () => {
  const M = (o) => moveIntent({ count: 50, hasMore: false, loadingMore: false, ...o });

  it('moves within the loaded list in both directions', () => {
    expect(M({ index: 0, dir: 1 })).toBe('move');
    expect(M({ index: 24, dir: 1 })).toBe('move');
    expect(M({ index: 48, dir: 1 })).toBe('move');   // → the last loaded row
    expect(M({ index: 1, dir: -1 })).toBe('move');
    expect(M({ index: 49, dir: -1 })).toBe('move');
  });

  it('paginates when the last loaded row is not the last record', () => {
    expect(M({ index: 49, dir: 1, hasMore: true })).toBe('load-next');
  });

  it('refuses to queue a second request while one is in flight', () => {
    // Holding the arrow key down must not fan out into concurrent page requests.
    expect(M({ index: 49, dir: 1, hasMore: true, loadingMore: true })).toBe('noop');
  });

  it('reports the TRUE end of the list rather than pretending to load', () => {
    expect(M({ index: 49, dir: 1, hasMore: false })).toBe('end');
    expect(M({ index: 49, dir: 1, hasMore: false, loadingMore: true })).toBe('end');
    expect(M({ index: 7, dir: 1, count: 8, hasMore: false })).toBe('end');
  });

  it('stops at the top — "earlier records" is a list control, not a selection move', () => {
    expect(M({ index: 0, dir: -1 })).toBe('noop');
    expect(M({ index: 0, dir: -1, hasMore: true })).toBe('noop');
  });

  it('does nothing at all on an empty list', () => {
    expect(M({ index: -1, dir: 1, count: 0, hasMore: true })).toBe('noop');
    expect(M({ index: 0, dir: 1, count: 0 })).toBe('noop');
  });

  it('with nothing selected, forward opens the first record and backward does nothing', () => {
    expect(M({ index: -1, dir: 1 })).toBe('move');
    expect(M({ index: -1, dir: -1 })).toBe('noop');
  });

  it('is defensive about junk', () => {
    expect(moveIntent()).toBe('noop');
    expect(M({ index: NaN, dir: 1 })).toBe('move');          // treated as "nothing selected"
    expect(M({ index: 49, dir: 0, hasMore: true })).toBe('load-next'); // 0 reads as forward
    expect(M({ index: 3, dir: -0.5 })).toBe('move');
    expect(M({ index: 200, dir: 1, hasMore: false })).toBe('end');
  });

  /* 107.md rec — the caller feeds the RESET load state in as well. A reset (Resume
     Screening, filter/search change, the realtime `decision.saved` refresh) replaces
     the whole window, so an append issued during one merges two different queries.
     moveIntent's own contract is unchanged; this pins the semantics the caller relies
     on — any in-flight load, of either kind, must read as 'noop' at the boundary. */
  it('treats an in-flight RESET as "already loading" at the boundary', () => {
    const busy = (loadingMore) => M({ index: 49, dir: 1, hasMore: true, loadingMore });
    expect(busy(false)).toBe('load-next');
    expect(busy(true)).toBe('noop');            // loadingMore || loading || advanceLock
    // …and it still moves inside the loaded window while a reset is in flight.
    expect(M({ index: 10, dir: 1, hasMore: true, loadingMore: true })).toBe('move');
  });
});

/* ── 107.md rec — is a deferred auto-advance still about the displayed list? ───── */

describe('advanceContextMatches — scoping a pending auto-advance to its dataset', () => {
  const PEND = { pid: 'p1', filter: 'all', search: '', gen: 3 };
  const CTX = { pid: 'p1', filter: 'all', search: '', gen: 3 };

  it('matches when nothing moved under the reviewer', () => {
    expect(advanceContextMatches(PEND, CTX)).toBe(true);
    expect(advanceContextMatches({ ...PEND, seen: new Set(['a']) }, CTX)).toBe(true);
  });

  it('rejects a project switch mid-flight', () => {
    expect(advanceContextMatches(PEND, { ...CTX, pid: 'p2' })).toBe(false);
  });

  it('rejects a filter or search change mid-flight', () => {
    expect(advanceContextMatches(PEND, { ...CTX, filter: 'undecided' })).toBe(false);
    expect(advanceContextMatches(PEND, { ...CTX, search: 'sepsis' })).toBe(false);
  });

  it('rejects any intervening RESET load (the generation moved)', () => {
    expect(advanceContextMatches(PEND, { ...CTX, gen: 4 })).toBe(false);
    expect(advanceContextMatches({ ...PEND, gen: 0 }, { ...CTX, gen: 1 })).toBe(false);
  });

  it('never matches an absent or non-object pending advance', () => {
    expect(advanceContextMatches(null, CTX)).toBe(false);
    expect(advanceContextMatches(undefined, CTX)).toBe(false);
    expect(advanceContextMatches('nope', CTX)).toBe(false);
    expect(advanceContextMatches(PEND)).toBe(false);
  });

  it('compares strictly — a missing stamp is not a wildcard', () => {
    expect(advanceContextMatches({}, {})).toBe(true);                       // both empty
    expect(advanceContextMatches({}, CTX)).toBe(false);
    expect(advanceContextMatches(PEND, { pid: 'p1', filter: 'all', search: '' })).toBe(false);
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
