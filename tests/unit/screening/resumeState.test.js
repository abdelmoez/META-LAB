/**
 * resumeState.test.js — 100.md §§12-15. The pure Resume Screening logic: which article
 * a returning reviewer lands on, where it sits in the list, and the wording shown.
 *
 * The edge cases 100.md §15 enumerates are covered here as behaviour, not as prose:
 * nothing screened yet, everything screened, the last decision being an exclusion, an
 * article deleted or deduplicated out of the pool, and the wrap-around when a reviewer
 * skipped some records earlier in the list.
 */
import { describe, it, expect } from 'vitest';
import {
  RESUME_STAGES, RESUME_STATUS, normalizeResumeStage,
  afterCursor, pickResumeTarget, resumePage, resumeMessage,
} from '../../../src/research-engine/screening/resumeState.js';

describe('normalizeResumeStage', () => {
  it('accepts the two real stages and defaults everything else to Title/Abstract', () => {
    expect(RESUME_STAGES).toEqual(['title_abstract', 'full_text']);
    expect(normalizeResumeStage('full_text')).toBe('full_text');
    expect(normalizeResumeStage('title_abstract')).toBe('title_abstract');
    for (const junk of ['', null, undefined, 'second-review', 'FULL_TEXT', 42]) {
      expect(normalizeResumeStage(junk)).toBe('title_abstract');
    }
  });
});

describe('afterCursor — keyset pagination over (createdAt ASC, id ASC)', () => {
  it('builds the strictly-after predicate with the id tiebreak', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(afterCursor({ createdAt: at, id: 'r5' })).toEqual({
      OR: [
        { createdAt: { gt: at } },
        { AND: [{ createdAt: at }, { id: { gt: 'r5' } }] },
      ],
    });
  });
  it('returns null for a missing anchor so the caller starts from the beginning', () => {
    expect(afterCursor(null)).toBeNull();
    expect(afterCursor({ id: 'r5' })).toBeNull();
    expect(afterCursor({ createdAt: new Date() })).toBeNull();
  });
});

describe('pickResumeTarget', () => {
  const anchor = { recordId: 'r103', id: 'r103', createdAt: new Date(), decidedAt: new Date() };

  it('continues AFTER the most recent decision (100.md §13: 101,102,103 → 104)', () => {
    expect(pickResumeTarget({
      decisionAnchor: anchor, nextAfterAnchor: 'r104', firstPending: 'r104',
      pendingCount: 40, stageTotal: 143,
    })).toEqual({ status: RESUME_STATUS.RESUME, recordId: 'r104', wrapped: false });
  });

  it('wraps back to the earliest outstanding article when nothing follows the anchor', () => {
    expect(pickResumeTarget({
      decisionAnchor: anchor, nextAfterAnchor: null, firstPending: 'r7',
      pendingCount: 3, stageTotal: 143,
    })).toEqual({ status: RESUME_STATUS.RESUME, recordId: 'r7', wrapped: true });
  });

  it('starts at the first eligible article when nothing has been screened yet', () => {
    expect(pickResumeTarget({
      decisionAnchor: null, openAnchor: null, firstPending: 'r1',
      pendingCount: 143, stageTotal: 143,
    })).toEqual({ status: RESUME_STATUS.START, recordId: 'r1', wrapped: false });
  });

  it('re-opens an article that was opened but never decided (least friction)', () => {
    expect(pickResumeTarget({
      decisionAnchor: null, openAnchor: { recordId: 'r12' }, firstPending: 'r1',
      pendingCount: 143, stageTotal: 143,
    })).toEqual({ status: RESUME_STATUS.REOPEN, recordId: 'r12', wrapped: false });
  });

  it('a decision always beats a mere open — the anchor is the last COMPLETED action', () => {
    expect(pickResumeTarget({
      decisionAnchor: anchor, openAnchor: { recordId: 'r12' },
      nextAfterAnchor: 'r104', firstPending: 'r1', pendingCount: 40, stageTotal: 143,
    }).recordId).toBe('r104');
  });

  it('says the stage is COMPLETE instead of doing nothing (100.md §15)', () => {
    expect(pickResumeTarget({ decisionAnchor: anchor, pendingCount: 0, stageTotal: 143 }))
      .toEqual({ status: RESUME_STATUS.COMPLETE, recordId: null, wrapped: false });
  });

  it('distinguishes an EMPTY stage from a completed one', () => {
    expect(pickResumeTarget({ pendingCount: 0, stageTotal: 0 }))
      .toEqual({ status: RESUME_STATUS.EMPTY, recordId: null, wrapped: false });
  });

  it('degrades to COMPLETE rather than pointing at nothing when the pool vanished', () => {
    // e.g. the remaining records were hard-deleted or resolved as duplicates between
    // the count and the lookup — never return a status with a null recordId to click.
    expect(pickResumeTarget({ decisionAnchor: anchor, nextAfterAnchor: null, firstPending: null, pendingCount: 2, stageTotal: 9 }).status)
      .toBe(RESUME_STATUS.COMPLETE);
    expect(pickResumeTarget({ decisionAnchor: null, openAnchor: null, firstPending: null, pendingCount: 2, stageTotal: 9 }).status)
      .toBe(RESUME_STATUS.COMPLETE);
  });

  it('is defensive about junk input', () => {
    expect(pickResumeTarget()).toEqual({ status: RESUME_STATUS.EMPTY, recordId: null, wrapped: false });
  });
});

describe('resumePage', () => {
  it('maps a 1-based position to the page that contains it', () => {
    expect(resumePage(1, 50)).toBe(1);
    expect(resumePage(50, 50)).toBe(1);
    expect(resumePage(51, 50)).toBe(2);
    expect(resumePage(137, 50)).toBe(3);
    expect(resumePage(1000, 200)).toBe(5);
  });
  it('falls back to page 1 for junk', () => {
    for (const [p, l] of [[0, 50], [-3, 50], [null, 50], [10, 0], [10, null], ['x', 'y']]) {
      expect(resumePage(p, l)).toBe(1);
    }
  });
});

describe('resumeMessage — one wording, shared by every surface', () => {
  it('states completion explicitly, naming the stage (100.md §15)', () => {
    expect(resumeMessage({ status: RESUME_STATUS.COMPLETE, stageLabel: 'Title & Abstract' }))
      .toBe('You have completed screening for Title & Abstract.');
  });
  it('covers the other outcomes', () => {
    expect(resumeMessage({ status: RESUME_STATUS.EMPTY, stageLabel: 'Final Review' }))
      .toBe('There are no articles to screen in Final Review yet.');
    expect(resumeMessage({ status: RESUME_STATUS.RESUME, position: 104, pending: 40 }))
      .toBe('Continuing from where you stopped (article 104) — 40 still need a decision.');
    expect(resumeMessage({ status: RESUME_STATUS.RESUME, position: 7, pending: 3, wrapped: true }))
      .toContain('Back to the earliest article you skipped (article 7)');
    expect(resumeMessage({ status: RESUME_STATUS.REOPEN, position: 12 }))
      .toBe('Back to the article you had open (article 12).');
    expect(resumeMessage({ status: RESUME_STATUS.START, position: 1 }))
      .toBe('Starting at the first article that needs a decision (article 1).');
  });
  it('omits the position when there is none, and survives junk', () => {
    expect(resumeMessage({ status: RESUME_STATUS.RESUME, pending: 5 }))
      .toBe('Continuing from where you stopped — 5 still need a decision.');
    expect(resumeMessage()).toContain('Continuing from where you stopped');
  });
});
