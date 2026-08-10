/**
 * screeningProgressStrip.test.jsx — 110.md §1.
 *
 * SSR shape of the Overview's whole-project progress: the headline percentage, the
 * stage strip (reviewer passes → conflict resolution → complete) and the audit
 * tiles. The arithmetic itself is pinned in tests/unit/screeningProgress.test.js;
 * this file pins what a project leader actually SEES.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import ScreeningProgressStrip, { ScreeningProgressTiles } from '../../../src/frontend/screening/components/ScreeningProgressStrip.jsx';
import { computeScreeningProgress } from '../../../src/research-engine/screening/screeningProgress.js';

const model = (input) => computeScreeningProgress(input);

describe('ScreeningProgressStrip', () => {
  it('shows 50%, not 100%, when one reviewer has screened everything once', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({ requiredReviewers: 2, poolSize: 1000, reviewerHistogram: { 1: 1000 } }),
    }));
    expect(html).toContain('data-testid="screening-progress-strip"');
    expect(html).toContain('data-completion="50"');
    expect(html).toContain('data-complete="false"');
    expect(html).toContain('50%');
    expect(html).toContain('Screening completion across all required reviewers');
    expect(html).toContain('2 independent reviewers per record');
    expect(html).toContain('1,000 of 2,000 reviewer decisions');
    // 110 review (F4) — ONE number format per card: the remaining-work sentence is
    // rendered from `summaryParts` through the same `fmt` as the headline, so it can
    // no longer read "1000 awaiting another reviewer" next to "1,000 of 2,000".
    expect(html).toContain('1,000 awaiting another reviewer.');
    expect(html).not.toContain('1000 awaiting');
  });

  it('locale-formats EVERY figure in the remaining-work sentence, not just the first', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({
        requiredReviewers: 2, poolSize: 40000, reviewerHistogram: { 1: 12345 },
        unresolvedConflicts: 2500,
      }),
    }));
    expect(html).toContain('27,655 not screened yet · 12,345 awaiting another reviewer · 2,500 conflicts to resolve.');
    // The raw model string stays locale-independent (it is also an API payload field).
    expect(model({
      requiredReviewers: 2, poolSize: 40000, reviewerHistogram: { 1: 12345 }, unresolvedConflicts: 2500,
    }).summary).toBe('27655 not screened yet · 12345 awaiting another reviewer · 2500 conflicts to resolve.');
  });

  it('falls back to the flat `summary` string when the server predates summaryParts', () => {
    const legacy = { ...model({ requiredReviewers: 2, poolSize: 10, reviewerHistogram: { 1: 4 } }) };
    delete legacy.summaryParts;
    const html = r(h(ScreeningProgressStrip, { progress: legacy }));
    expect(html).toContain('6 not screened yet · 4 awaiting another reviewer.');
  });

  it('renders one segment per required reviewer pass plus conflicts and complete', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({ requiredReviewers: 3, poolSize: 30, reviewerHistogram: { 1: 30 } }),
    }));
    expect(html).toContain('data-required-reviewers="3"');
    for (const key of ['pass-1', 'pass-2', 'pass-3', 'conflicts', 'complete']) {
      expect(html).toContain(`data-stage="${key}"`);
    }
    expect(html).toContain('Pass 1');
    expect(html).toContain('Pass 3');
    expect(html).toContain('Conflicts');
    expect(html).toContain('Complete');
    // pass-1 satisfied, pass-2 is where the team is now.
    expect(html).toContain('data-stage="pass-1" data-status="complete"');
    expect(html).toContain('data-stage="pass-2" data-status="active"');
    expect(html).toContain('data-stage="pass-3" data-status="pending"');
    expect(html).toContain('Now');
  });

  it('a single-reviewer project shows exactly one pass', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({ requiredReviewers: 1, poolSize: 12, reviewerHistogram: { 1: 6 } }),
    }));
    expect(html).toContain('data-stage="pass-1"');
    expect(html).not.toContain('data-stage="pass-2"');
    expect(html).toContain('1 independent reviewer per record');
  });

  it('parks on conflict resolution when every decision is in but a conflict is open', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({
        requiredReviewers: 2, poolSize: 40, reviewerHistogram: { 2: 40 },
        unresolvedConflicts: 3, resolvedConflicts: 1,
      }),
    }));
    // 80/80 decisions plus 3 open conflicts as their own units → 80/83 = 96%.
    expect(html).toContain('data-completion="96"');
    expect(html).toContain('data-complete="false"');
    expect(html).toContain('data-stage="conflicts" data-status="active"');
    expect(html).toContain('data-stage="complete" data-status="pending"');
    expect(html).toContain('Remaining');
    expect(html).toContain('3 conflicts to resolve.');
  });

  it('reads 100% complete only when passes and conflicts are both done', () => {
    const html = r(h(ScreeningProgressStrip, {
      progress: model({ requiredReviewers: 2, poolSize: 40, reviewerHistogram: { 2: 40 }, resolvedConflicts: 4 }),
    }));
    expect(html).toContain('data-completion="100"');
    expect(html).toContain('data-complete="true"');
    expect(html).toContain('data-stage="complete" data-status="complete"');
    expect(html).toContain('Every record has 2 reviewer decisions and no conflicts remain.');
    expect(html).not.toContain('Remaining');
  });

  it('says so plainly when the project has no records', () => {
    const html = r(h(ScreeningProgressStrip, { progress: model({ requiredReviewers: 2, poolSize: 0 }) }));
    expect(html).toContain('data-completion="0"');
    expect(html).toContain('No records to screen yet.');
    expect(html).toContain('0 of 0 reviewer decisions');
  });

  it('renders nothing without a model (older server response)', () => {
    expect(r(h(ScreeningProgressStrip, { progress: null }))).toBe('');
    expect(r(h(ScreeningProgressTiles, { progress: null }))).toBe('');
  });
});

describe('ScreeningProgressTiles', () => {
  it('breaks the headline down into auditable counts', () => {
    const html = r(h(ScreeningProgressTiles, {
      progress: model({
        requiredReviewers: 2, poolSize: 100, reviewerHistogram: { 1: 35, 2: 25 },
        unresolvedConflicts: 2, resolvedConflicts: 1,
      }),
    }));
    expect(html).toContain('Fully reviewed');
    expect(html).toContain('2 of 2 passes');
    expect(html).toContain('Awaiting another reviewer');
    expect(html).toContain('Not screened yet');
    expect(html).toContain('Conflicts to resolve');
    expect(html).toContain('1 resolved');
    expect(html).toContain('>25<');
    expect(html).toContain('>35<');
    expect(html).toContain('>40<');
  });

  it('shows "none raised" when no conflict has ever been recorded', () => {
    const html = r(h(ScreeningProgressTiles, {
      progress: model({ requiredReviewers: 2, poolSize: 10, reviewerHistogram: { 2: 10 } }),
    }));
    expect(html).toContain('none raised');
  });
});
