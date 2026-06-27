/**
 * stitch57Stepper.test.js — 57.md shared vertical-stepper model (pure).
 * submenuSteps() turns each category's submenu into numbered workflow steps (+
 * utility rows for the Screen category) with status from the shared truth.
 */
import { describe, it, expect } from 'vitest';
import { submenuSteps } from '../../src/frontend/stitch/nav/stepperModel.js';
import { buildScreeningSteps } from '../../src/frontend/screening/ui/screeningSteps.js';

const CTX = { projectId: 'p1', linkedSiftId: 's1' };

describe('57.md — phase categories become numbered steppers', () => {
  it('Plan & Protocol = PICO(1) + Protocol(2) with status from statusMap', () => {
    const steps = submenuSteps('plan', CTX, { statusMap: { pico: 'done', prospero: 'partial' } });
    expect(steps.map((s) => s.key)).toEqual(['pico', 'prospero']);
    expect(steps.map((s) => s.num)).toEqual([1, 2]);
    expect(steps[0].status).toBe('done');
    expect(steps[1].status).toBe('partial');
    expect(typeof steps[0].desc).toBe('string'); // brief helper text
  });
  it('Analyze numbers all five analysis stages 1..5', () => {
    const steps = submenuSteps('analyze', CTX, { statusMap: {} });
    expect(steps.map((s) => s.key)).toEqual(['analysis', 'forest', 'sensitivity', 'subgroup', 'nma']);
    expect(steps.map((s) => s.num)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.every((s) => s.status === 'empty')).toBe(true);
  });
  it('Extract and Report are numbered steppers too', () => {
    expect(submenuSteps('extract', CTX, {}).map((s) => s.num)).toEqual([1, 2]);
    expect(submenuSteps('report', CTX, {}).map((s) => s.num)).toEqual([1, 2, 3]);
  });
  it('returns null for single-destination categories', () => {
    expect(submenuSteps('overview', CTX, {})).toBeNull();
    expect(submenuSteps('control', CTX, {})).toBeNull();
    expect(submenuSteps('reference', CTX, {})).toBeNull();
  });
});

describe('57.md — Screen category: numbered workflow steps + utility rows + live counts', () => {
  const summary = {
    totalArticles: 3900, duplicateDetectionRun: true, unresolvedDuplicateGroups: 312,
    titleAbstractPending: 1796, unresolvedConflicts: 14, eligibleSecondReview: 63,
    acceptedToExtraction: 0, rejectedSecond: 0,
  };
  const screeningSteps = buildScreeningSteps(summary);
  const steps = submenuSteps('screen', CTX, { screeningSteps });

  it('numbers ONLY the workflow steps (import…final review) 1..5, utilities have no number', () => {
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.import.num).toBe(1);
    expect(byKey.duplicates.num).toBe(2);
    expect(byKey.screening.num).toBe(3);
    expect(byKey.conflicts.num).toBe(4);
    expect(byKey['second-review'].num).toBe(5);
    // utility rows are NOT numbered steps
    expect(byKey.overview.num).toBeNull();
    expect(byKey.control.num).toBeNull();
    expect(byKey.export.num).toBeNull();
    expect(byKey.prisma.num).toBeNull();
  });
  it('maps the screening status vocabulary onto navStatus + carries live counts', () => {
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.duplicates.status).toBe('attention'); // 312 unresolved
    expect(byKey.duplicates.count).toContain('312');
    expect(byKey.conflicts.status).toBe('attention');  // 14 conflicts
    expect(byKey.conflicts.count).toContain('14');
    expect(byKey.import.status).toBe('done');           // 3900 imported
  });
  it('disables screening sub-pages when there is no linked workspace (PRISMA stays navigable)', () => {
    const noLink = submenuSteps('screen', { projectId: 'p1', linkedSiftId: null }, { screeningSteps: [] });
    const byKey = Object.fromEntries(noLink.map((s) => [s.key, s]));
    expect(byKey.import.disabled).toBe(true);
    expect(byKey.prisma.disabled).toBe(false);
  });
});
