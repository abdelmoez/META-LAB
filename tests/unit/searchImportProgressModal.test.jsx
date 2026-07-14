/**
 * SSR-render tests for the Search → Screening progress modal
 * (src/features/pecanSearch/components/SearchImportProgressModal.jsx).
 *
 * Mirrors the repo's component-test style: renderToStaticMarkup (no jsdom). Effects
 * (the focus trap) don't run during static render, so we assert the produced markup:
 * dialog semantics, the real progressbar + aria values, the step list, live counts,
 * activity text, and the per-state footer actions. The modal renders its dialog inline
 * when there is no `document` (SSR), which is exactly this environment.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Modal from '../../src/features/pecanSearch/components/SearchImportProgressModal.jsx';

const render = (props) => renderToStaticMarkup(createElement(Modal, props));

const runningRun = {
  id: 'r1', name: 'Primary search', state: 'running',
  sources: [
    { provider: 'pubmed', state: 'running', stage: 'fetching', rawCount: 120, previewCount: 1000, cap: 2000, importedCount: 0 },
    { provider: 'crossref', state: 'completed', rawCount: 300, importedCount: 200, exactDupCount: 50, existingMatchCount: 20 },
  ],
};

describe('SearchImportProgressModal — closed / open', () => {
  it('renders nothing when closed', () => {
    expect(render({ open: false, run: runningRun })).toBe('');
  });

  it('renders a labelled modal dialog when open', () => {
    const html = render({ open: true, run: runningRun, displayPercent: 57, onClose() {} });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('Adding articles to Screening');
    expect(html).toContain('data-testid="search-import-progress"');
  });
});

describe('SearchImportProgressModal — running state', () => {
  const html = render({ open: true, run: runningRun, displayPercent: 57, onClose() {}, onCancel() {}, screeningHref: '/app?tab=screening' });

  it('shows a real progressbar reflecting the passed display percent', () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="57"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuetext="57%"');
  });

  it('shows a live current-activity line naming the fetching database', () => {
    expect(html).toContain('data-testid="progress-activity"');
    expect(html).toContain('PubMed');
  });

  it('shows the step list with a searching label', () => {
    expect(html).toContain('Searching databases');
    expect(html).toContain('Adding records to Screening');
  });

  it('offers a Cancel affordance but not Go to Screening while running', () => {
    expect(html).toContain('Cancel search');
    expect(html).not.toContain('Go to Screening');
    expect(html).toContain('Run in background');
  });

  it('has a screen-reader status live region announcing the phase', () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe('SearchImportProgressModal — starting (pre-202)', () => {
  it('opens immediately with an indeterminate bar before the run exists', () => {
    const html = render({ open: true, run: null, starting: true, onClose() {} });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Adding articles to Screening');
    // Indeterminate: a progressbar with aria-valuetext but no committed aria-valuenow.
    expect(html).toContain('aria-valuetext="Working…"');
    expect(html).not.toContain('aria-valuenow');
  });
});

describe('SearchImportProgressModal — completed', () => {
  const done = {
    id: 'r2', name: 'Primary', state: 'completed',
    sources: [{ provider: 'pubmed', state: 'completed', rawCount: 750, importedCount: 706, exactDupCount: 42, existingMatchCount: 0, failedRecordCount: 2 }],
  };
  const html = render({ open: true, run: done, onClose() {}, screeningHref: '/app?tab=screening&screen=import' });

  it('snaps the bar to 100%', () => {
    expect(html).toContain('aria-valuenow="100"');
  });

  it('shows the satisfying completion title + summary numbers', () => {
    expect(html).toContain('Articles added to Screening');
    expect(html).toContain('706'); // added
    expect(html).toContain('42');  // duplicates removed
    expect(html).toContain('2');   // skipped
  });

  it('offers Go to Screening (primary) + Stay in Search', () => {
    expect(html).toContain('Go to Screening');
    expect(html).toContain('Stay in Search');
    expect(html).toContain('href="/app?tab=screening&amp;screen=import"');
  });
});

describe('SearchImportProgressModal — partial / failed / cancelled', () => {
  it('partial: warns but still offers Retry + Go to Screening', () => {
    const partial = {
      id: 'r3', state: 'partial',
      sources: [
        { provider: 'pubmed', state: 'completed', rawCount: 500, importedCount: 300 },
        { provider: 'crossref', state: 'failed', rawCount: 0, errorDetail: 'timeout' },
      ],
    };
    const html = render({ open: true, run: partial, onClose() {}, onRetry() {}, screeningHref: '/x' });
    expect(html).toContain('some databases incomplete');
    expect(html).toContain('Retry');
    expect(html).toContain('Go to Screening');
  });

  it('failed: reassures on consistency and offers Retry', () => {
    const failed = {
      id: 'r4', state: 'failed', errorSummary: 'Provider down',
      sources: [{ provider: 'pubmed', state: 'failed', rawCount: 0, errorDetail: 'db down' }],
    };
    const html = render({ open: true, run: failed, onClose() {}, onRetry() {} });
    expect(html).toContain('did not complete');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Go to Screening');
  });

  it('cancelled: communicates kept records', () => {
    const cancelled = {
      id: 'r5', state: 'cancelled',
      sources: [{ provider: 'pubmed', state: 'cancelled', rawCount: 40, importedCount: 12 }],
    };
    const html = render({ open: true, run: cancelled, onClose() {}, screeningHref: '/x' });
    expect(html).toContain('Search cancelled');
    expect(html).toContain('12');
  });
});

describe('SearchImportProgressModal — start error', () => {
  it('shows a fatal start error with a close action and no fake progress', () => {
    const html = render({ open: true, run: null, startError: 'Too many searches are already running.', onClose() {} });
    expect(html).toContain('Could not start the search');
    expect(html).toContain('Too many searches are already running.');
    expect(html).toContain('No records were created');
    expect(html).not.toContain('role="progressbar"');
  });
});

describe('SearchImportProgressModal — read-only', () => {
  it('hides Cancel for a read-only viewer', () => {
    const html = render({ open: true, run: runningRun, onClose() {}, onCancel() {}, readOnly: true });
    expect(html).not.toContain('Cancel search');
  });
});

describe('SearchImportProgressModal — review-round fixes', () => {
  it('does not offer Retry for an all-skipped run (nothing is retryable)', () => {
    const skipped = { id: 'r6', state: 'failed', sources: [{ provider: 'pubmed', state: 'skipped' }, { provider: 'crossref', state: 'skipped' }] };
    const html = render({ open: true, run: skipped, onClose() {}, onRetry() {} });
    expect(html).not.toContain('Retry');
  });

  it('does not double-count ambiguous records in the completion bullets', () => {
    const done = { id: 'r7', state: 'completed', sources: [{ provider: 'pubmed', state: 'completed', rawCount: 100, importedCount: 60, ambiguousDupCount: 10, exactDupCount: 20, existingMatchCount: 20 }] };
    const html = render({ open: true, run: done, onClose() {}, screeningHref: '/x' });
    expect(html).not.toContain('to review as possible duplicates');
    // ...but the ambiguous count is still surfaced via the review Note (not a bucket).
    expect(html).toContain('duplicate review');
  });

  it('a failed run that already landed records offers Go to Screening + honest copy', () => {
    const failed = { id: 'r8', state: 'failed', errorSummary: 'DB error', sources: [{ provider: 'pubmed', state: 'failed', rawCount: 50, importedCount: 40 }] };
    const html = render({ open: true, run: failed, onClose() {}, onRetry() {}, screeningHref: '/x' });
    expect(html).toContain('Go to Screening');
    expect(html).toContain('40');
    expect(html).toContain('will not create duplicates');
    expect(html).not.toContain('failed before any records were added');
  });
});
