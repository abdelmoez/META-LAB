/**
 * fullTextPanel.test.jsx — 68.md P9 automated OA full-text retrieval UI.
 *
 * SSR-safe contract tests (mirrors livingReviewTab / pecanSearchTab style — no jsdom,
 * no effects):
 *  - the flag helper reads featureFlags.fullTextRetrieval (fetch stubbed);
 *  - flag OFF → FullTextPanel renders null (its flag/status loads live in effects
 *    that never run under renderToStaticMarkup, so the initial render is null);
 *  - flag ON path: the exported CoverageHeader leaf renders the coverage line +
 *    counts from a mocked status payload, and recordStatus classifies rows.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FullTextPanel, { CoverageHeader, JobResult, recordStatus } from '../../src/features/fullText/FullTextPanel.jsx';
import { fullTextRetrievalFlagEnabled } from '../../src/features/fullText/flag.js';

afterAll(() => { vi.unstubAllGlobals(); });

/* A realistic /status coverage payload. */
const COVERAGE = {
  totalRecords: 40, included: 12, withPdf: 7, includedWithPdf: 7, includedMissing: 5,
  candidatesFound: 9, requested: 2, received: 1, noOa: 3,
};

describe('fullTextRetrievalFlagEnabled', () => {
  it('is TRUE when the public flag is on', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ featureFlags: { fullTextRetrieval: true } }),
    })));
    expect(await fullTextRetrievalFlagEnabled()).toBe(true);
  });

  it('is FALSE when the flag is off, missing, or the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ featureFlags: { fullTextRetrieval: false } }),
    })));
    expect(await fullTextRetrievalFlagEnabled()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ featureFlags: {} }) })));
    expect(await fullTextRetrievalFlagEnabled()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    expect(await fullTextRetrievalFlagEnabled()).toBe(false);
  });
});

describe('FullTextPanel — flag off', () => {
  it('renders null before the flag resolves (SSR runs no effect)', () => {
    const html = renderToStaticMarkup(h(FullTextPanel, { pid: 'p1' }));
    expect(html).toBe('');
  });
});

describe('CoverageHeader — flag on payload', () => {
  it('renders the coverage line and every count', () => {
    const html = renderToStaticMarkup(h(CoverageHeader, { coverage: COVERAGE }));
    // "7 of 12 included records have full text"
    expect(html).toContain('7');
    expect(html).toContain('12');
    expect(html).toContain('included records have full text');
    expect(html).toContain('OA found');
    expect(html).toContain('requested');
    expect(html).toContain('received');
    expect(html).toContain('no OA');
  });
});

describe('JobResult — honest terminal counts', () => {
  it('renders the fetched/noOa/failed breakdown', () => {
    const job = { status: 'completed', scope: 'included', counts: { fetched: 4, alreadyHad: 1, noOa: 3, linkOut: 2, failed: 1 } };
    const html = renderToStaticMarkup(h(JobResult, { job }));
    expect(html).toContain('Last retrieval');
    expect(html).toContain('fetched');
    expect(html).toContain('failed');
  });

  it('surfaces a failed job error', () => {
    const html = renderToStaticMarkup(h(JobResult, { job: { status: 'failed', error: 'provider down' } }));
    expect(html).toContain('provider down');
  });
});

describe('recordStatus', () => {
  it('classifies attached / OA-found / no-OA rows', () => {
    expect(recordStatus({ attachmentCount: 1 }).label).toBe('PDF attached');
    expect(recordStatus({ attachmentCount: 0, bestCandidate: { status: 'found', pdfUrl: 'x' } }).label).toBe('OA found');
    expect(recordStatus({ attachmentCount: 0, bestCandidate: null }).label).toBe('No OA — request');
  });
});
