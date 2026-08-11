/**
 * publicSettingsHeroHeadline.test.js — 113 §4 r2.
 *
 * GET /api/settings/public is what actually decides the landing <h1>. Two behaviours
 * have to hold at once and they pull in opposite directions:
 *
 *   - A row seeded with a pre-113 DEFAULT must be corrected. `initDefaultSettings()`
 *     never overwrites an existing row, so without a remap every deployment that has
 *     ever booted would serve the brandless headline forever, no matter what the
 *     shipped default says.
 *   - An ADMIN'S OWN wording must survive untouched. The remap is therefore keyed on
 *     BYTE EQUALITY with a headline we once shipped — not on a heuristic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('../../server/db/client.js', () => ({
  prisma: {
    siteSetting: {
      findMany: (...args) => findMany(...args),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
  },
}));

const {
  getPublicSettings,
  LANDING_HERO_HEADLINE,
  LEGACY_HERO_HEADLINES,
} = await import('../../server/controllers/settingsController.js');

/** Minimal express double: captures the JSON body the handler sends. */
function call(rows) {
  findMany.mockResolvedValue(rows);
  const res = {
    body: null,
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return getPublicSettings({}, res).then(() => res);
}

const landingRow = (content) => ({ key: 'landingContent', value: JSON.stringify(content) });

beforeEach(() => { findMany.mockReset(); });

describe('the exported headline constants', () => {
  it('LANDING_HERO_HEADLINE is the 113 brand headline, newline included', () => {
    expect(LANDING_HERO_HEADLINE)
      .toBe('PecanRev: from screening to meta-analysis,\none clean workspace for systematic reviews.');
  });

  it('LEGACY_HERO_HEADLINES lists the shipped defaults it replaces, and nothing else', () => {
    expect(LEGACY_HERO_HEADLINES).toEqual([
      'A serious workspace for systematic reviews and meta-analysis.',
      'A serious workspace for\nsystematic reviews.',
    ]);
    expect(LEGACY_HERO_HEADLINES).not.toContain(LANDING_HERO_HEADLINE);
  });
});

describe('GET /api/settings/public — heroHeadline', () => {
  it('serves the brand headline when no landingContent row exists at all', async () => {
    const res = await call([]);
    expect(res.body.landingContent.heroHeadline).toBe(LANDING_HERO_HEADLINE);
  });

  it.each(LEGACY_HERO_HEADLINES)('remaps the legacy default %j to the brand headline', async (legacy) => {
    const res = await call([landingRow({ heroHeadline: legacy, ctaText: 'Start Your Review' })]);
    expect(res.body.landingContent.heroHeadline).toBe(LANDING_HERO_HEADLINE);
    // The remap is surgical: every other stored field is untouched.
    expect(res.body.landingContent.ctaText).toBe('Start Your Review');
  });

  it("NEVER overwrites an admin's own headline", async () => {
    const custom = 'Kyoto University Evidence Synthesis Unit — review workspace';
    const res = await call([landingRow({ heroHeadline: custom })]);
    expect(res.body.landingContent.heroHeadline).toBe(custom);
  });

  it('a one-character edit of a legacy default counts as an admin choice', async () => {
    const edited = `${LEGACY_HERO_HEADLINES[0]} `;
    const res = await call([landingRow({ heroHeadline: edited })]);
    expect(res.body.landingContent.heroHeadline).toBe(edited);
  });

  it('fills a missing or blank headline rather than shipping an empty H1', async () => {
    for (const stored of [undefined, '', '   ', null, 42]) {
      const res = await call([landingRow({ heroHeadline: stored })]);
      expect(res.body.landingContent.heroHeadline).toBe(LANDING_HERO_HEADLINE);
    }
  });

  it('is idempotent — a row already holding the brand headline is passed through', async () => {
    const res = await call([landingRow({ heroHeadline: LANDING_HERO_HEADLINE })]);
    expect(res.body.landingContent.heroHeadline).toBe(LANDING_HERO_HEADLINE);
  });
});
