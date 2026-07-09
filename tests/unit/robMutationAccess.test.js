/**
 * robMutationAccess.test.js — pure RoB authorization + study-source helpers
 * (prompt46 #3/#4).
 */
import { describe, it, expect } from 'vitest';
import { canMutateAssessment, normaliseScreeningStudy, normaliseManualStudy } from '../../server/controllers/robAccess.js';

const A = { reviewerId: 'creator-1' };

describe('canMutateAssessment (creator | owner | leader)', () => {
  it('owner may mutate any assessment regardless of creator', () => {
    expect(canMutateAssessment(A, { canEdit: true, isOwner: true, role: 'owner' }, 'someone-else')).toBe(true);
  });
  it('leader may mutate any assessment', () => {
    expect(canMutateAssessment(A, { canEdit: true, isOwner: false, role: 'leader' }, 'someone-else')).toBe(true);
  });
  it('the creator may mutate their own assessment', () => {
    expect(canMutateAssessment(A, { canEdit: true, isOwner: false, role: 'reviewer' }, 'creator-1')).toBe(true);
  });
  it('another reviewer (edit access, not creator) may NOT mutate', () => {
    expect(canMutateAssessment(A, { canEdit: true, isOwner: false, role: 'reviewer' }, 'other-2')).toBe(false);
  });
  it('a read-only member never mutates', () => {
    expect(canMutateAssessment(A, { canEdit: false, isOwner: false, role: 'reviewer' }, 'creator-1')).toBe(false);
  });
  it('legacy assessment with empty reviewerId is owner/leader-only (no creator match)', () => {
    const legacy = { reviewerId: '' };
    expect(canMutateAssessment(legacy, { canEdit: true, isOwner: false, role: 'reviewer' }, 'anyone')).toBe(false);
    expect(canMutateAssessment(legacy, { canEdit: true, isOwner: true, role: 'owner' }, 'anyone')).toBe(true);
  });
  it('null/empty access denies', () => {
    expect(canMutateAssessment(A, null, 'creator-1')).toBe(false);
    expect(canMutateAssessment(A, {}, 'creator-1')).toBe(false);
  });
});

describe('study source normalisers', () => {
  it('screening study → source:screening with stringified year', () => {
    // 79.md §1 — journal / doi / pmid are passed through (optional; '' / null when absent)
    // so the redesigned article list can distinguish same-author/year studies.
    expect(normaliseScreeningStudy({ id: 's1', title: 'T', author: 'Doe', year: 2021 }))
      .toEqual({ id: 's1', source: 'screening', title: 'T', author: 'Doe', year: '2021', journal: '', doi: null, pmid: null });
  });
  it('screening study → surfaces journal/doi/pmid when the blob carries them', () => {
    expect(normaliseScreeningStudy({ id: 's2', title: 'T2', author: 'Roe', year: '2020', journal: 'BMJ', doi: '10.1/x', pmid: '999' }))
      .toEqual({ id: 's2', source: 'screening', title: 'T2', author: 'Roe', year: '2020', journal: 'BMJ', doi: '10.1/x', pmid: '999' });
  });
  it('manual study → source:manual, authors mapped to author', () => {
    const out = normaliseManualStudy({ id: 'm1', title: 'Manual', authors: 'Roe', year: '2024', doi: '10.x', pmid: '123', createdById: 'u1', createdByName: 'U' });
    expect(out).toMatchObject({ id: 'm1', source: 'manual', title: 'Manual', author: 'Roe', year: '2024', doi: '10.x', pmid: '123' });
  });
});
