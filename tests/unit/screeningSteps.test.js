/**
 * screeningSteps.test.js (prompt21 Task 9) — the Screening workflow stepper's
 * completion logic. Pure derivation from the overview `dataSummary`; must never
 * invent progress and must flag attention (unresolved duplicates/conflicts).
 */
import { describe, it, expect } from 'vitest';
import { buildScreeningSteps } from '../../src/frontend/screening/ui/screeningSteps.js';

const byId = (steps) => Object.fromEntries(steps.map(s => [s.id, s]));

describe('buildScreeningSteps', () => {
  it('an empty project: only Import is active, everything else pending', () => {
    const s = byId(buildScreeningSteps({}));
    expect(s.import.status).toBe('active');
    expect(s.duplicates.status).toBe('pending');
    expect(s.screening.status).toBe('pending');
    expect(s.conflicts.status).toBe('pending');
    expect(s['second-review'].status).toBe('pending');
    expect(s.extraction.status).toBe('pending');
    // Always exactly the six pipeline steps, in order.
    expect(buildScreeningSteps({}).map(x => x.id)).toEqual([
      'import', 'duplicates', 'screening', 'conflicts', 'second-review', 'extraction',
    ]);
  });

  it('records imported → Import done; duplicates flag attention when unresolved', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 10, duplicateDetectionRun: true, unresolvedDuplicateGroups: 3 }));
    expect(s.import.status).toBe('done');
    expect(s.duplicates.status).toBe('attention');
    expect(s.duplicates.hint).toMatch(/3 to resolve/);
    // Screening still active (nothing advanced to full text yet).
    expect(s.screening.status).toBe('active');
  });

  it('duplicates resolved → done; unresolved conflicts flag attention', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 10, duplicateDetectionRun: true, unresolvedDuplicateGroups: 0, unresolvedConflicts: 2 }));
    expect(s.duplicates.status).toBe('done');
    expect(s.conflicts.status).toBe('attention');
    expect(s.conflicts.hint).toMatch(/2 open/);
  });

  it('records advanced to full text → Title & Abstract done; Final Review active with pending count', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 10, eligibleSecondReview: 4, acceptedToExtraction: 1, rejectedSecond: 1, unresolvedConflicts: 0 }));
    expect(s.screening.status).toBe('done');
    expect(s.conflicts.status).toBe('done');
    // 4 at full text, 2 decided → 2 pending final.
    expect(s['second-review'].status).toBe('active');
    expect(s['second-review'].hint).toMatch(/2 pending/);
    // 1 accepted → Data Extraction shows done with sent count.
    expect(s.extraction.status).toBe('done');
    expect(s.extraction.hint).toMatch(/1 sent/);
  });

  it('all eligible decided → Final Review done; nothing accepted → extraction stays pending', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 5, eligibleSecondReview: 3, acceptedToExtraction: 0, rejectedSecond: 3 }));
    expect(s['second-review'].status).toBe('done');
    expect(s.extraction.status).toBe('pending');
  });

  it('exact title/abstract progress (prompt21 follow-up): active while records still need screening, done at 0 pending', () => {
    // titleAbstractPending present → exact path (not the coarse "advanced" heuristic).
    const active = byId(buildScreeningSteps({ totalArticles: 10, screeningPool: 10, titleAbstractPending: 4, eligibleSecondReview: 2 }));
    expect(active.screening.status).toBe('active');
    expect(active.screening.hint).toMatch(/4 to screen/);
    const done = byId(buildScreeningSteps({ totalArticles: 10, screeningPool: 10, titleAbstractPending: 0, eligibleSecondReview: 6 }));
    expect(done.screening.status).toBe('done');
    expect(done.screening.hint).toBeNull();
  });

  it('Data Extraction step is status-only (not clickable); pipeline steps map to screens', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 5, acceptedToExtraction: 2 }));
    expect(s.extraction.screen).toBeNull();
    expect(s.import.screen).toBe('import');
    expect(s['second-review'].screen).toBe('second-review');
    expect(s.extraction.status).toBe('done');
  });

  it('every step exposes a real, non-fake task-count line (prompt23 Task 3)', () => {
    // Empty project → safe fallbacks, never a fabricated number.
    const empty = byId(buildScreeningSteps({}));
    expect(empty.import.count).toBe('Not started');
    expect(empty.duplicates.count).toBe('—');
    expect(empty.screening.count).toBe('—');
    expect(empty.conflicts.count).toBe('—');
    expect(empty['second-review'].count).toBe('—');

    // Populated project → real counts reflecting the data.
    const live = byId(buildScreeningSteps({
      totalArticles: 124, duplicateDetectionRun: true, unresolvedDuplicateGroups: 3,
      titleAbstractPending: 45, unresolvedConflicts: 2, eligibleSecondReview: 10,
      acceptedToExtraction: 4, rejectedSecond: 0,
    }));
    expect(live.import.count).toBe('124 records');
    expect(live.duplicates.count).toBe('3 unresolved');
    expect(live.screening.count).toBe('45 remaining');
    expect(live.conflicts.count).toBe('2 conflicts');
    expect(live['second-review'].count).toMatch(/pending|sent/);
    expect(live.extraction.count).toBe('4 sent');
  });

  // ── 107.md §1 — explicit duplicate-detection states ────────────────────────
  describe('duplicates step reads the explicit detection state (107.md §1)', () => {
    const base = { totalArticles: 40, unresolvedDuplicateGroups: 0, resolvedDuplicateGroups: 0 };

    it('REGRESSION: a completed run that found ZERO duplicates is done, not "Pending"', () => {
      // The reported bug: detection completed, produced no groups, and the stepper
      // sat on 'Pending' forever because the flag was inferred from group EXISTENCE.
      const s = byId(buildScreeningSteps({
        ...base,
        duplicateDetectionRun: true,
        duplicateDetection: { status: 'completed', lastCompletedAt: '2026-01-02T03:04:05.000Z', lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('done');
      expect(s.duplicates.count).toBe('No duplicates');
      expect(s.duplicates.hint).toBeNull();
    });

    it('a completed run whose groups are all resolved still says "Resolved"', () => {
      const s = byId(buildScreeningSteps({
        ...base,
        resolvedDuplicateGroups: 5,
        duplicateDetectionRun: true,
        duplicateDetection: { status: 'completed', lastCompletedAt: '2026-01-02T03:04:05.000Z', lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('done');
      expect(s.duplicates.count).toBe('Resolved');
    });

    it('an active job (queued or processing) shows "Processing…"', () => {
      for (const status of ['queued', 'processing']) {
        const s = byId(buildScreeningSteps({
          ...base,
          duplicateDetectionRun: false,
          duplicateDetection: { status, lastCompletedAt: null, lastError: null, stale: false, staleReason: null },
        }));
        expect(s.duplicates.status).toBe('active');
        expect(s.duplicates.count).toBe('Processing…');
      }
    });

    it('a running job wins over leftover unresolved groups from an earlier sweep', () => {
      const s = byId(buildScreeningSteps({
        ...base,
        unresolvedDuplicateGroups: 7,
        duplicateDetectionRun: true,
        duplicateDetection: { status: 'processing', lastCompletedAt: '2026-01-01T00:00:00.000Z', lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.count).toBe('Processing…');
      // The attention hint is still available to the caller (nothing was resolved).
      expect(s.duplicates.hint).toBe('7 to resolve');
    });

    it('a failed job needs attention and says "Failed"', () => {
      const s = byId(buildScreeningSteps({
        ...base,
        duplicateDetectionRun: false,
        duplicateDetection: { status: 'failed', lastCompletedAt: null, lastError: 'Duplicate detection failed unexpectedly.', stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('attention');
      expect(s.duplicates.count).toBe('Failed');
    });

    it('never run with records present is still active/"Pending" (unchanged)', () => {
      const s = byId(buildScreeningSteps({
        ...base,
        duplicateDetectionRun: false,
        duplicateDetection: { status: 'never_run', lastCompletedAt: null, lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('active');
      expect(s.duplicates.count).toBe('Pending');
    });

    it('a completed run with unresolved groups keeps the exact legacy attention strings', () => {
      const s = byId(buildScreeningSteps({
        ...base,
        unresolvedDuplicateGroups: 3,
        duplicateDetectionRun: true,
        duplicateDetection: { status: 'completed', lastCompletedAt: '2026-01-02T03:04:05.000Z', lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('attention');
      expect(s.duplicates.count).toBe('3 unresolved');
      expect(s.duplicates.hint).toBe('3 to resolve');
    });

    it('no records → pending/"—" whatever the job says', () => {
      const s = byId(buildScreeningSteps({
        totalArticles: 0,
        duplicateDetection: { status: 'processing', lastCompletedAt: null, lastError: null, stale: false, staleReason: null },
      }));
      expect(s.duplicates.status).toBe('pending');
      expect(s.duplicates.count).toBe('—');
    });

    it('a legacy caller with only duplicateDetectionRun keeps the pre-107 behaviour', () => {
      const done = byId(buildScreeningSteps({ totalArticles: 40, duplicateDetectionRun: true, unresolvedDuplicateGroups: 0 }));
      expect(done.duplicates.status).toBe('done');
      expect(done.duplicates.count).toBe('Resolved'); // NOT 'No duplicates' without the explicit state
      const pending = byId(buildScreeningSteps({ totalArticles: 40, duplicateDetectionRun: false }));
      expect(pending.duplicates.status).toBe('active');
      expect(pending.duplicates.count).toBe('Pending');
      const attention = byId(buildScreeningSteps({ totalArticles: 40, duplicateDetectionRun: false, unresolvedDuplicateGroups: 2 }));
      expect(attention.duplicates.status).toBe('attention');
      expect(attention.duplicates.count).toBe('2 unresolved');
    });

    it('a garbage duplicateDetection value degrades to the legacy flag', () => {
      for (const bad of [null, 'completed', 42, [], { status: '' }]) {
        const s = byId(buildScreeningSteps({ totalArticles: 40, duplicateDetectionRun: false, duplicateDetection: bad }));
        expect(s.duplicates.status).toBe('active');
        expect(s.duplicates.count).toBe('Pending');
      }
    });
  });
});
