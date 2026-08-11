/**
 * landingHeroHeadline.test.js — 113 §4 r2.
 *
 * THE BUG THIS PINS: the landing <h1> is rendered as
 * `settings.heroHeadline || DEFAULTS.heroHeadline`, and GET /api/settings/public
 * ALWAYS supplies a heroHeadline. So editing Landing.jsx's DEFAULTS — which is what
 * 113 did — changed nothing a visitor or a crawler ever saw: the server kept serving
 * the pre-113 brandless copy from its own defaults (and from rows seeded with it,
 * which `initDefaultSettings` never overwrites).
 *
 * FOUR copies of one string therefore have to agree, and this file is the only thing
 * that makes disagreement loud:
 *   1. src/frontend/pages/Landing.jsx            DEFAULTS.heroHeadline (fallback)
 *   2. server/controllers/settingsController.js  LANDING_HERO_HEADLINE (the SSOT,
 *                                                and what production actually serves)
 *   3. server/scripts/init-settings.js           the standalone seeding script
 *   4. src/frontend/pages/admin/AdminConsole.jsx Ops › Content's DEFAULT_CONTENT
 *
 * Source scans rather than imports: init-settings.js constructs a PrismaClient at
 * module scope, and Landing.jsx/AdminConsole.jsx are large React trees. The string is
 * what matters, so the string is what is compared.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

/**
 * The expected headline, written here as the same JS source literal the four files
 * use (with an escaped newline) so a stray real newline or a smart quote fails.
 */
const HEADLINE_LITERAL =
  "'PecanRev: from screening to meta-analysis,\\none clean workspace for systematic reviews.'";

const SOURCES = {
  'src/frontend/pages/Landing.jsx': read('src/frontend/pages/Landing.jsx'),
  'server/controllers/settingsController.js': read('server/controllers/settingsController.js'),
  'server/scripts/init-settings.js': read('server/scripts/init-settings.js'),
  'src/frontend/pages/admin/AdminConsole.jsx': read('src/frontend/pages/admin/AdminConsole.jsx'),
};

describe('113 §4 — the landing H1 default is the same string in all four places', () => {
  it.each(Object.keys(SOURCES))('%s carries the brand headline', (file) => {
    expect(SOURCES[file]).toContain(HEADLINE_LITERAL);
  });

  it.each(Object.keys(SOURCES))('%s no longer carries a pre-113 headline default', (file) => {
    // The brandless copies. Their only remaining legal home is the documented
    // LEGACY_HERO_HEADLINES remap list in settingsController.js.
    const legacy = [
      "heroHeadline: 'A serious workspace for systematic reviews and meta-analysis.'",
      "heroHeadline:      'A serious workspace for\\nsystematic reviews.'",
    ];
    for (const dead of legacy) expect(SOURCES[file]).not.toContain(dead);
  });

  it('the H1 still reads the admin overlay with the local default as fallback', () => {
    // If this wiring ever changes, the reasoning above (and the remap) needs revisiting.
    expect(SOURCES['src/frontend/pages/Landing.jsx'])
      .toContain('{settings.heroHeadline || DEFAULTS.heroHeadline}');
  });

  it('the headline names the brand and the product category', () => {
    // 113 §4 — the one heading a crawler treats as the page subject.
    expect(HEADLINE_LITERAL).toContain('PecanRev');
    expect(HEADLINE_LITERAL).toContain('systematic reviews');
  });
});

/**
 * 113 r2 — the prerendered homepage is what a non-JS crawler reads. Framer Motion's
 * `hidden` variant serialises to a literal `opacity:0`, and `whileInView` never
 * fires in renderToString, so the SSR tree MUST take the reduced-motion branch.
 */
describe('113 r2 — Landing renders its visible (reduced-motion) tree on the server', () => {
  const landing = SOURCES['src/frontend/pages/Landing.jsx'];

  it('usePrefersReducedMotion defaults to true when there is no window', () => {
    expect(landing).toMatch(
      /function usePrefersReducedMotion\(\)[\s\S]{0,240}?if \(typeof window === 'undefined'\) return true;/,
    );
  });

  it('Reveal falls back to a plain div without a window', () => {
    expect(landing).toContain("if (reduced || typeof window === 'undefined') return <div style={style}>");
  });
});
