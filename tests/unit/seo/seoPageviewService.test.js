/**
 * seoPageviewService.test.js — 113.md phase 19 — the public landing-page counter.
 *
 * This service is the only thing in the product that writes a row in response to
 * an anonymous visitor, so the tests are about what it REFUSES to do as much as
 * what it records:
 *
 *   1. ALLOWLIST. Only a canonicalPath of the public-page registry is ever
 *      written. An app URL, an admin URL, a project URL, a traversal attempt and
 *      a plausible-looking marketing path that is not registered all write
 *      nothing — and all return the same "not-tracked", so the endpoint cannot
 *      be used to enumerate routes.
 *   2. CLASSIFICATION happens server-side and collapses a referrer to one of
 *      five labels. AI hosts win over search hosts (gemini.google.com is an AI
 *      referral, not a Google one), our own host is 'internal', and an
 *      unparseable or absent referrer is 'direct' rather than a guess.
 *   3. AGGREGATION SUMS. The table has no unique constraint on purpose, so two
 *      racing beacons can leave twin rows for the same (day, path, class); the
 *      reader must add them, never count rows.
 *   4. NEVER THROWS. A rejecting database is a typed return value.
 *
 * The fake prisma below implements exactly the three operations the service
 * depends on (findFirst / update / create), so the test fails if the
 * findFirst-then-increment shape is dropped.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PUBLIC_PAGES } from '../../../src/frontend/website/publicPages.js';

const db = { rows: [], seq: 0, findThrows: false, createThrows: false, findManyThrows: false };

const prismaMock = {
  seoPageView: {
    findFirst: vi.fn(async ({ where }) => {
      if (db.findThrows) throw new Error('database is locked');
      return db.rows.find(
        (r) => r.day === where.day && r.path === where.path && r.referrerClass === where.referrerClass,
      ) || null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = db.rows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      row.count += data.count.increment;
      return row;
    }),
    create: vi.fn(async ({ data }) => {
      if (db.createThrows) throw new Error('database is locked');
      db.seq += 1;
      const row = { id: `pv${db.seq}`, ...data };
      db.rows.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }) => {
      if (db.findManyThrows) throw new Error('query failed');
      return db.rows.filter((r) => r.day >= where.day.gte && r.day <= where.day.lte);
    }),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const {
  classifyReferrer, normalizeBeaconPath, isTrackablePath, trackablePaths,
  aggregatePageViews, recordPageView, getPageViewSummary,
  utcDay, windowStartDay, REFERRER_CLASSES,
} = await import('../../../server/services/seoPageviewService.js');
const { handlePageViewBeacon } = await import('../../../server/routes/seoPublic.js');

beforeEach(() => {
  db.rows = [];
  db.seq = 0;
  db.findThrows = false;
  db.createThrows = false;
  db.findManyThrows = false;
  vi.clearAllMocks();
});

/** A registered public path, taken from the registry rather than hardcoded. */
const REGISTERED = PUBLIC_PAGES.find((e) => e.path === '/features/screening').canonicalPath;

describe('utcDay / windowStartDay', () => {
  it('keeps UTC calendar days only — no clock time survives', () => {
    expect(utcDay(new Date('2026-08-10T23:59:59.999Z'))).toBe('2026-08-10');
    expect(utcDay(new Date('2026-08-11T00:00:00.000Z'))).toBe('2026-08-11');
  });

  it('an invalid date degrades to today rather than writing garbage', () => {
    expect(utcDay(new Date('nonsense'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the window START is inclusive: 14 days ending today spans 14 day strings', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(windowStartDay(14, now)).toBe('2026-07-28');
    expect(windowStartDay(1, now)).toBe('2026-08-10');
  });
});

describe('normalizeBeaconPath', () => {
  it('strips the query string and the fragment before anything else', () => {
    expect(normalizeBeaconPath('/features/screening?utm_source=x&q=my+private+search')).toBe('/features/screening');
    expect(normalizeBeaconPath('/features/screening#section')).toBe('/features/screening');
  });

  it('accepts an absolute URL but keeps only its pathname', () => {
    expect(normalizeBeaconPath('https://pecanrev.com/features/screening?a=1')).toBe('/features/screening');
  });

  it('strips a trailing slash so /x and /x/ are one row', () => {
    expect(normalizeBeaconPath('/features/screening/')).toBe('/features/screening');
    expect(normalizeBeaconPath('/')).toBe('/');
  });

  it('rejects anything that is not a plain rooted path', () => {
    for (const bad of ['', '   ', 'features', 'javascript:alert(1)', '//evil.example', '/a//b', '/Features/Screening', `/${'x'.repeat(600)}`, null, undefined, 42, {}]) {
      expect(normalizeBeaconPath(bad), String(bad)).toBeNull();
    }
  });
});

describe('the allowlist', () => {
  it('is exactly the registry canonicalPaths', () => {
    const expected = [...new Set(PUBLIC_PAGES.map((e) => e.canonicalPath))].sort();
    expect(trackablePaths()).toEqual(expected);
  });

  it('accepts registered public paths and refuses everything else', () => {
    expect(isTrackablePath('/')).toBe(true);
    expect(isTrackablePath(REGISTERED)).toBe(true);
    for (const bad of ['/app', '/app/projects/abc123', '/ops', '/api/admin/users', '/features/not-a-page', '/resources/made-up']) {
      expect(isTrackablePath(bad), bad).toBe(false);
    }
  });
});

describe('classifyReferrer', () => {
  const host = 'pecanrev.com';

  it('no referrer is direct — never guessed', () => {
    expect(classifyReferrer('', { host })).toBe('direct');
    expect(classifyReferrer(undefined, { host })).toBe('direct');
    expect(classifyReferrer('not a url', { host })).toBe('direct');
  });

  it('recognises our own host (with and without www) as internal', () => {
    expect(classifyReferrer('https://pecanrev.com/resources', { host })).toBe('internal');
    expect(classifyReferrer('https://www.pecanrev.com/resources', { host })).toBe('internal');
  });

  it('classifies the classic search engines, including country domains', () => {
    for (const url of [
      'https://www.google.com/', 'https://www.google.co.uk/search',
      'https://www.bing.com/search', 'https://duckduckgo.com/',
      'https://search.yahoo.co.jp/', 'https://www.baidu.com/', 'https://www.ecosia.org/',
    ]) {
      expect(classifyReferrer(url, { host }), url).toBe('search');
    }
  });

  it('classifies AI assistants, and AI WINS over a search-engine label', () => {
    for (const url of [
      'https://chatgpt.com/', 'https://chat.openai.com/', 'https://www.perplexity.ai/',
      'https://claude.ai/', 'https://claude.com/', 'https://copilot.microsoft.com/',
      'https://you.com/search',
    ]) {
      expect(classifyReferrer(url, { host }), url).toBe('ai');
    }
    // gemini.google.com carries BOTH a search label and an AI label.
    expect(classifyReferrer('https://gemini.google.com/app', { host })).toBe('ai');
  });

  it('anything else that linked here is a referral', () => {
    expect(classifyReferrer('https://twitter.com/someone/status/1', { host })).toBe('referral');
    expect(classifyReferrer('https://a-university.example/libguides', { host })).toBe('referral');
  });

  it('only ever returns one of the five schema labels', () => {
    for (const url of ['', 'https://x.example/', 'https://google.com/', 'https://claude.ai/', 'https://pecanrev.com/']) {
      expect(REFERRER_CLASSES).toContain(classifyReferrer(url, { host }));
    }
  });
});

describe('recordPageView', () => {
  const now = new Date('2026-08-10T09:00:00.000Z');

  it('creates a row for a registered path, then INCREMENTS instead of inserting again', async () => {
    const first = await recordPageView({ path: REGISTERED, referrer: 'https://www.google.com/', host: 'pecanrev.com', now });
    expect(first).toMatchObject({ ok: true, created: true, day: '2026-08-10', path: REGISTERED, referrerClass: 'search' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].count).toBe(1);

    const second = await recordPageView({ path: REGISTERED, referrer: 'https://www.bing.com/', host: 'pecanrev.com', now });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].count).toBe(2);
  });

  it('splits by referrer class and by UTC day', async () => {
    await recordPageView({ path: REGISTERED, referrer: 'https://www.google.com/', host: 'pecanrev.com', now });
    await recordPageView({ path: REGISTERED, referrer: 'https://claude.ai/', host: 'pecanrev.com', now });
    await recordPageView({ path: REGISTERED, referrer: '', host: 'pecanrev.com', now: new Date('2026-08-11T01:00:00.000Z') });
    expect(db.rows.map((r) => [r.day, r.referrerClass, r.count])).toEqual([
      ['2026-08-10', 'search', 1],
      ['2026-08-10', 'ai', 1],
      ['2026-08-11', 'direct', 1],
    ]);
  });

  it('writes NOTHING for an unregistered path, and says so without naming why', async () => {
    for (const bad of ['/app/projects/secret-id', '/ops', '/features/not-a-page', 'nonsense', '']) {
      const r = await recordPageView({ path: bad, referrer: '', host: 'pecanrev.com', now });
      expect(r, bad).toEqual({ ok: false, reason: 'not-tracked' });
    }
    expect(db.rows).toHaveLength(0);
    expect(prismaMock.seoPageView.create).not.toHaveBeenCalled();
  });

  it('never persists the raw referrer — only the class label', async () => {
    await recordPageView({
      path: REGISTERED,
      referrer: 'https://www.google.com/search?q=confidential+clinical+question',
      host: 'pecanrev.com',
      now,
    });
    const stored = JSON.stringify(db.rows);
    expect(stored).not.toContain('confidential');
    expect(stored).not.toContain('google');
    expect(db.rows[0].referrerClass).toBe('search');
  });

  it('never throws when the database is unavailable', async () => {
    db.findThrows = true;
    await expect(recordPageView({ path: REGISTERED, referrer: '', host: 'pecanrev.com', now }))
      .resolves.toEqual({ ok: false, reason: 'error' });
    db.findThrows = false;
    db.createThrows = true;
    await expect(recordPageView({ path: REGISTERED, referrer: '', host: 'pecanrev.com', now }))
      .resolves.toEqual({ ok: false, reason: 'error' });
  });
});

describe('aggregatePageViews', () => {
  it('SUMS racing twin rows instead of counting them (there is no unique index)', () => {
    const agg = aggregatePageViews([
      { day: '2026-08-10', path: '/a', referrerClass: 'search', count: 3 },
      { day: '2026-08-10', path: '/a', referrerClass: 'search', count: 2 }, // the twin
    ]);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].classes.search).toBe(5);
    expect(agg.rows[0].total).toBe(5);
    expect(agg.grandTotal).toBe(5);
  });

  it('buckets by path and class, and orders by total desc then path', () => {
    const agg = aggregatePageViews([
      { day: '2026-08-10', path: '/b', referrerClass: 'ai', count: 1 },
      { day: '2026-08-10', path: '/a', referrerClass: 'search', count: 4 },
      { day: '2026-08-11', path: '/a', referrerClass: 'direct', count: 1 },
    ]);
    expect(agg.rows.map((r) => r.path)).toEqual(['/a', '/b']);
    expect(agg.rows[0].classes).toMatchObject({ search: 4, direct: 1, ai: 0 });
    expect(agg.totals).toEqual({ search: 4, ai: 1, referral: 0, internal: 0, direct: 1 });
    expect(agg.days).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('is defensive about junk rows rather than producing NaN', () => {
    const agg = aggregatePageViews([
      { path: '/a', referrerClass: 'nope', count: 'x' },
      { path: null, count: 5 },
      null,
    ]);
    expect(agg.grandTotal).toBe(0);
    expect(agg.rows[0].classes.direct).toBe(0); // unknown class folds to 'direct'
  });

  it('returns an empty, fully-zeroed shape for no rows (never null)', () => {
    const agg = aggregatePageViews([]);
    expect(agg.rows).toEqual([]);
    expect(agg.grandTotal).toBe(0);
    for (const cls of REFERRER_CLASSES) expect(agg.totals[cls]).toBe(0);
  });
});

describe('POST /api/seo/pageview — the public beacon handler', () => {
  /** Minimal res double recording the status + whether a body was written. */
  const makeRes = () => {
    const rec = { status: null, ended: false, body: undefined };
    const res = {
      status: (s) => { rec.status = s; return res; },
      end: (b) => { rec.ended = true; rec.body = b; return res; },
      json: (b) => { rec.body = b; return res; },
    };
    return { res, rec };
  };
  const makeReq = (body) => ({ body, get: (h) => (h.toLowerCase() === 'host' ? 'pecanrev.com' : undefined) });

  const flush = () => new Promise((r) => { setTimeout(r, 0); });

  it('answers 204 with an EMPTY body for a tracked page, and records it', async () => {
    const { res, rec } = makeRes();
    handlePageViewBeacon(makeReq({ path: REGISTERED, referrer: 'https://claude.ai/' }), res);
    expect(rec.status).toBe(204);
    expect(rec.ended).toBe(true);
    expect(rec.body).toBeUndefined();
    await flush();
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ path: REGISTERED, referrerClass: 'ai', count: 1 });
  });

  it('answers the SAME 204 for an unknown path — the endpoint never leaks which routes exist', async () => {
    for (const body of [{ path: '/app/projects/secret' }, { path: '/nope' }, {}, null, 'not an object']) {
      const { res, rec } = makeRes();
      handlePageViewBeacon(makeReq(body), res);
      expect(rec.status, JSON.stringify(body)).toBe(204);
    }
    await flush();
    expect(db.rows).toHaveLength(0);
  });

  it('answers 204 even when the database is down (the write is detached)', async () => {
    db.findThrows = true;
    const { res, rec } = makeRes();
    handlePageViewBeacon(makeReq({ path: REGISTERED, referrer: '' }), res);
    expect(rec.status).toBe(204);
    await flush();
    expect(db.rows).toHaveLength(0);
  });

  it('responds BEFORE the write — the socket is never held open by telemetry', () => {
    const { res, rec } = makeRes();
    handlePageViewBeacon(makeReq({ path: REGISTERED, referrer: '' }), res);
    // Synchronously after the call the response is finished and nothing is stored yet.
    expect(rec.status).toBe(204);
    expect(db.rows).toHaveLength(0);
  });
});

describe('getPageViewSummary', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('queries an inclusive UTC day window and folds the rows', async () => {
    db.rows = [
      { id: 'a', day: '2026-08-09', path: '/', referrerClass: 'search', count: 2 },
      { id: 'b', day: '2026-08-10', path: '/', referrerClass: 'ai', count: 1 },
      { id: 'c', day: '2026-06-01', path: '/', referrerClass: 'direct', count: 99 }, // outside
    ];
    const out = await getPageViewSummary({ days: 14, now });
    expect(out.from).toBe('2026-07-28');
    expect(out.to).toBe('2026-08-10');
    expect(out.available).toBe(true);
    expect(out.grandTotal).toBe(3);
    expect(out.totals).toMatchObject({ search: 2, ai: 1 });
  });

  it('clamps the window rather than trusting the caller', async () => {
    expect((await getPageViewSummary({ days: 5000, now })).days).toBe(90);
    expect((await getPageViewSummary({ days: -3, now })).days).toBe(14);
    expect((await getPageViewSummary({ days: 'abc', now })).days).toBe(14);
  });

  it('reports a failed read honestly instead of showing zeros as data', async () => {
    db.findManyThrows = true;
    const out = await getPageViewSummary({ days: 14, now });
    expect(out.available).toBe(false);
    expect(out.error).toBeTruthy();
    expect(out.grandTotal).toBe(0);
  });
});
