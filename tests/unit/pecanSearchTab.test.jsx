/**
 * pecanSearchTab.test.jsx — P1 "Search & Discovery".
 *
 * SSR-safe smoke + contract tests (mirrors tooltip.test.jsx style):
 *  - the tab renders its initial/loading state without crashing and without
 *    firing any network work during static render (effects don't run in SSR);
 *  - the API client builds the exact backend URLs the contract specifies;
 *  - the flag gate + idempotency-key helpers behave.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PecanSearchTab from '../../src/features/pecanSearch/PecanSearchTab.jsx';
import {
  pecanSearchApi, runsUrl, reportExportUrl, newIdempotencyKey, loadCanonicalQuery, pecanSearchFlagEnabled,
} from '../../src/features/pecanSearch/pecanSearchApi.js';

describe('PecanSearchTab (SSR smoke)', () => {
  it('renders its initial loading state without crashing', () => {
    const html = renderToStaticMarkup(
      createElement(PecanSearchTab, { projectId: 'proj-1', pico: { P: 'adults' }, readOnly: false }),
    );
    expect(html).toContain('Search &amp; Discovery');
    // initial state shows the strategy + sources scaffolding (no live data yet)
    expect(html).toContain('Search strategy');
    expect(html).toContain('Sources');
  });

  it('renders in read-only mode without crashing', () => {
    const html = renderToStaticMarkup(
      createElement(PecanSearchTab, { projectId: 'proj-2', pico: {}, readOnly: true }),
    );
    // read-only callers do not get the Review & run card
    expect(html).toContain('Search &amp; Discovery');
    expect(html).not.toContain('Review &amp; run');
  });
});

describe('pecanSearchApi URL contracts', () => {
  it('builds the runs list URL with pagination', () => {
    expect(runsUrl('p1')).toBe('/api/pecan-search/projects/p1/runs');
    expect(runsUrl('p1', { skip: 20, take: 10 })).toBe('/api/pecan-search/projects/p1/runs?skip=20&take=10');
  });

  it('builds the report export URL and clamps the format', () => {
    expect(reportExportUrl('p1', 'r9', 'csv')).toBe('/api/pecan-search/projects/p1/runs/r9/report/export?format=csv');
    expect(reportExportUrl('p1', 'r9', 'html')).toBe('/api/pecan-search/projects/p1/runs/r9/report/export?format=html');
    // unknown formats fall back to json
    expect(reportExportUrl('p1', 'r9', 'evil')).toBe('/api/pecan-search/projects/p1/runs/r9/report/export?format=json');
  });

  it('exposes every contract endpoint on the api object', () => {
    for (const fn of ['getProviders', 'validate', 'translate', 'previewCount', 'startRun', 'listRuns', 'getRun', 'cancelRun', 'retryRun', 'listDuplicates', 'resolveDuplicate', 'getReport']) {
      expect(typeof pecanSearchApi[fn]).toBe('function');
    }
  });

  it('mints distinct idempotency keys', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
  });
});

describe('pecanSearchApi network-backed helpers (fetch stubbed)', () => {
  const realFetch = global.fetch;

  it('startRun POSTs to the runs endpoint with an Idempotency-Key header', async () => {
    let captured = null;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 202, text: async () => JSON.stringify({ run: { id: 'r1' }, created: true }) };
    };
    const out = await pecanSearchApi.startRun('p1', { name: 'x', canonicalQuery: { concepts: [] }, sources: [{ provider: 'pubmed' }], caps: {} }, 'idem-123');
    expect(captured.url).toBe('/api/pecan-search/projects/p1/runs');
    expect(captured.opts.method).toBe('POST');
    expect(captured.opts.credentials).toBe('include');
    expect(captured.opts.headers['Idempotency-Key']).toBe('idem-123');
    expect(out.created).toBe(true);
    global.fetch = realFetch;
  });

  it('loadCanonicalQuery reads the search-builder backend and shapes { concepts, filters }', async () => {
    global.fetch = async (url) => {
      expect(url).toBe('/api/search-builder/p1');
      return { ok: true, status: 200, text: async () => JSON.stringify({ concepts: [{ id: 'c1', terms: [{ text: 'diabetes' }] }], revision: 3 }) };
    };
    const q = await loadCanonicalQuery('p1');
    expect(q.concepts).toHaveLength(1);
    expect(q.filters).toBeTruthy();
    expect(q.revision).toBe(3);
    global.fetch = realFetch;
  });

  it('loadCanonicalQuery returns null when nothing is saved', async () => {
    global.fetch = async () => ({ ok: true, status: 200, text: async () => 'null' });
    const q = await loadCanonicalQuery('p1');
    expect(q).toBe(null);
    global.fetch = realFetch;
  });

  it('pecanSearchFlagEnabled reads the public flag, default OFF on error', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ featureFlags: { pecanSearch: true } }) });
    expect(await pecanSearchFlagEnabled()).toBe(true);
    global.fetch = async () => ({ ok: true, json: async () => ({ featureFlags: { pecanSearch: false } }) });
    expect(await pecanSearchFlagEnabled()).toBe(false);
    global.fetch = async () => { throw new Error('down'); };
    expect(await pecanSearchFlagEnabled()).toBe(false);
    global.fetch = realFetch;
  });
});
