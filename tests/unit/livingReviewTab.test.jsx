/**
 * livingReviewTab.test.jsx — 66.md P6 "Living Review".
 *
 * SSR-safe contract tests (mirrors pecanSearchTab.test.jsx style — no jsdom/effects):
 *  - the flag helper reads featureFlags.livingReview (fetch stubbed);
 *  - the DISABLED path (flag off) renders the quiet disabled note;
 *  - the ENABLED path renders every dashboard section from a mocked overview payload;
 *  - the livingApi client builds the exact backend URLs the /api/living contract
 *    specifies and every endpoint is present.
 *
 * The component's real flag/overview loads happen in effects (which do not run under
 * renderToStaticMarkup), so we render the pure, exported leaf views directly:
 * DisabledNote for the off path and LivingDashboardView(data) for the on path.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LivingReviewTab, { DisabledNote, LivingDashboardView } from '../../src/features/livingReview/LivingReviewTab.jsx';
import { livingReviewFlagEnabled } from '../../src/features/livingReview/flag.js';
import { livingApi } from '../../src/features/livingReview/livingApi.js';

afterAll(() => { vi.unstubAllGlobals(); });

/* A realistic overview payload with every section populated. */
const OVERVIEW = {
  canManage: true,
  pecanSearchEnabled: true,
  settings: { schedulerEnabled: true, allowedCadences: ['manual', 'weekly', 'monthly'], maxSavedSearchesPerProject: 5 },
  searches: [
    {
      id: 'ls1', name: 'Diabetes update', providerIds: ['pubmed', 'europepmc'], canonicalText: '(diabetes)',
      cadence: 'weekly', enabled: true, nextRunAt: new Date(Date.now() + 86400000).toISOString(),
      lastRunAt: new Date(Date.now() - 3600000).toISOString(), lastRunId: 'r1', lastRunState: 'completed',
      lastResultCount: 120, lastNewCount: 8, lastError: null, notes: '', createdByName: 'Alice',
    },
  ],
  snapshots: [
    { id: 'sn1', kind: 'update', label: 'Update — Diabetes', runId: 'r1', appVersion: '3.55.0', createdAt: new Date().toISOString(), createdByName: 'system' },
    { id: 'sn0', kind: 'manual', label: 'Baseline', runId: null, appVersion: '3.54.0', createdAt: new Date(Date.now() - 999999).toISOString(), createdByName: 'Alice' },
  ],
  alerts: [
    {
      id: 'al1', severity: 'notable', status: 'open', createdAt: new Date().toISOString(),
      snapshotId: 'sn1', prevSnapshotId: 'sn0',
      shifts: [{ outcome: 'Mortality', type: 'effect_magnitude', severity: 'notable', message: 'Potential evidence shift: the pooled effect magnitude for "Mortality" changed by roughly 30% between updates. Review recommended.' }],
    },
  ],
  queue: {
    records: [
      { recordId: 'rec1', screenProjectId: 'sp1', title: 'A new RCT of metformin', year: 2026, journal: 'BMJ', ai: { score: 0.82, calibratedProba: 0.79, prediction: 'include', band: 'high' } },
    ],
    runs: [{ id: 'r1', state: 'completed' }],
    totalPending: 1,
  },
};

describe('livingReviewFlagEnabled (fetch stubbed)', () => {
  it('is true only when featureFlags.livingReview === true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ featureFlags: { livingReview: true } }) })));
    expect(await livingReviewFlagEnabled()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ featureFlags: { livingReview: false } }) })));
    expect(await livingReviewFlagEnabled()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ featureFlags: {} }) })));
    expect(await livingReviewFlagEnabled()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await livingReviewFlagEnabled()).toBe(false);
  });
});

describe('LivingReviewTab render paths (SSR)', () => {
  it('flag OFF → the disabled note (no dashboard)', () => {
    // The top-level component starts in its loading state under SSR (the flag effect
    // does not run); the disabled note is the leaf the off-path renders.
    const html = renderToStaticMarkup(h(DisabledNote));
    expect(html).toContain('Living Review');
    expect(html).toContain('disabled');
    expect(html).toContain('Feature Flags');
    expect(html).not.toContain('Saved searches');
  });

  it('the top-level tab renders without crashing (loading state under SSR)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ featureFlags: { livingReview: true } }) })));
    const html = renderToStaticMarkup(h(LivingReviewTab, { projectId: 'p1' }));
    expect(html).toContain('Loading');
  });

  it('flag ON → the dashboard renders every section from the overview payload', () => {
    const html = renderToStaticMarkup(h(LivingDashboardView, { projectId: 'p1', data: OVERVIEW }));
    // 1. alerts banner
    expect(html).toContain('Potential evidence shift detected');
    expect(html).toContain('Review recommended');
    expect(html).toContain('Mortality');
    // 2. saved searches
    expect(html).toContain('Saved searches');
    expect(html).toContain('Diabetes update');
    expect(html).toContain('Run now');
    expect(html).toContain('new record'); // "8 new records"
    // 3. new-since-last-update queue
    expect(html).toContain('New since last update');
    expect(html).toContain('A new RCT of metformin');
    expect(html).toContain('Screen these records');
    // 4. snapshots timeline
    expect(html).toContain('Snapshots');
    expect(html).toContain('Baseline');
    expect(html).toContain('Create snapshot');
    // 5. PRISMA panel (its counts load in an effect → shows its loading state under SSR)
    expect(html).toContain('cumulative counts');
  });

  it('flag ON but read-only → managing controls are gated', () => {
    const ro = { ...OVERVIEW, canManage: false };
    const html = renderToStaticMarkup(h(LivingDashboardView, { projectId: 'p1', data: ro }));
    // No "+ New saved search" or "Create snapshot" affordance for non-managers.
    expect(html).not.toContain('New saved search');
    expect(html).not.toContain('Create snapshot');
    // The dashboard still renders (read-only can browse).
    expect(html).toContain('Saved searches');
  });

  it('flag ON with !pecanSearchEnabled → Run now still renders (disabled + explained)', () => {
    const noPecan = { ...OVERVIEW, pecanSearchEnabled: false };
    const html = renderToStaticMarkup(h(LivingDashboardView, { projectId: 'p1', data: noPecan }));
    expect(html).toContain('Run now');
    expect(html).toContain('Enable Pecan Search');
  });
});

describe('livingApi URL contracts (fetch stubbed)', () => {
  it('hits the exact /api/living endpoints', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
    }));

    await livingApi.overview('p1');
    await livingApi.preview('p1');
    await livingApi.queue('p1', { limit: 50 });
    await livingApi.createSearch('p1', { name: 'x' });
    await livingApi.updateSearch('p1', 's1', { enabled: false });
    await livingApi.deleteSearch('p1', 's1');
    await livingApi.runSearch('p1', 's1');
    await livingApi.listSnapshots('p1');
    await livingApi.getSnapshot('p1', 'sn1');
    await livingApi.createSnapshot('p1', { label: 'q3' });
    await livingApi.compareSnapshots('p1', 'a', 'b');
    await livingApi.ackAlert('p1', 'al1');

    // PUT and DELETE share the /searches/s1 url, so assert on the (url, method) pairs.
    const has = (url, method) => calls.some((c) => c.url === url && c.method === method);
    expect(has('/api/living/p1/overview', 'GET')).toBe(true);
    expect(has('/api/living/p1/preview', 'GET')).toBe(true);
    expect(has('/api/living/p1/queue?limit=50', 'GET')).toBe(true);
    expect(has('/api/living/p1/searches', 'POST')).toBe(true);
    expect(has('/api/living/p1/searches/s1', 'PUT')).toBe(true);
    expect(has('/api/living/p1/searches/s1', 'DELETE')).toBe(true);
    expect(has('/api/living/p1/searches/s1/run', 'POST')).toBe(true);
    expect(has('/api/living/p1/snapshots', 'POST')).toBe(true);
    expect(has('/api/living/p1/snapshots/sn1', 'GET')).toBe(true);
    expect(has('/api/living/p1/snapshots/compare?a=a&b=b', 'GET')).toBe(true);
    expect(has('/api/living/p1/alerts/al1/ack', 'POST')).toBe(true);
  });

  it('every contract method exists on livingApi', () => {
    for (const fn of ['overview', 'preview', 'queue', 'createSearch', 'updateSearch', 'deleteSearch', 'runSearch', 'listSnapshots', 'getSnapshot', 'createSnapshot', 'compareSnapshots', 'ackAlert']) {
      expect(typeof livingApi[fn]).toBe('function');
    }
  });
});
