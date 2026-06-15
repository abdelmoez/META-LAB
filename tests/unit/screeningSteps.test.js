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

  it('Data Extraction step is status-only (not clickable); pipeline steps map to screens', () => {
    const s = byId(buildScreeningSteps({ totalArticles: 5, acceptedToExtraction: 2 }));
    expect(s.extraction.screen).toBeNull();
    expect(s.import.screen).toBe('import');
    expect(s['second-review'].screen).toBe('second-review');
    expect(s.extraction.status).toBe('done');
  });
});
