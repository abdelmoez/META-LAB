/**
 * recordListQuery.test.js — 65.md SCR-1: eligibility + Prisma-query mapping for
 * the listRecords fast path. Pure unit tests (no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  fastListEligible, buildFastListQuery, FAST_LIST_FILTERS,
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
