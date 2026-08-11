/**
 * opsSeoUi.test.jsx — SSR-shape tests for the extracted Ops SEO package
 * (113.md item 8 — src/frontend/pages/admin/seo/).
 *
 * House style (the opsEmailUi / opsResearchGovernanceUi precedent):
 * renderToStaticMarkup, no jsdom, no RTL. Effects never run, so everything
 * asserted is what the package renders from its props and its own vocabulary.
 *
 * What matters most here is not layout but HONESTY, so that is what is pinned:
 *
 *   - the two panels are SEPARATE tabs, each carrying a scope notice that says
 *     which side of the "built" / "served" line it is on;
 *   - the live tab shows NOTHING until an operator runs a check, and offers the
 *     button that runs it;
 *   - Search Console / Bing render "Not configured" with the reason, and never
 *     a coverage or impression number;
 *   - the analytics empty state says "no data yet", not "no data available";
 *   - `servingVerdict` maps the 111 production failure (app shell on every
 *     route) to a FAILING verdict, which is the whole point of the section.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGES } from '../../src/frontend/website/publicPages.js';
import {
  registryInventory, registryCounts, registryChecks, artifactChecks, readVerificationTokens,
} from '../../server/controllers/seoAdminController.js';
import SeoSection, { SEO_TABS } from '../../src/frontend/pages/admin/seo/SeoSection.jsx';
import RepositoryTab from '../../src/frontend/pages/admin/seo/RepositoryTab.jsx';
import LiveCheckTab from '../../src/frontend/pages/admin/seo/LiveCheckTab.jsx';
import AnalyticsTab from '../../src/frontend/pages/admin/seo/AnalyticsTab.jsx';
import {
  REFERRER_CLASSES, REFERRER_CLASS_LABELS, CHECK_STATUS_LABEL,
  SERVING_VERDICT_LABEL, servingVerdict, sharePct,
} from '../../src/frontend/pages/admin/seo/fields.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PKG = resolve(ROOT, 'src', 'frontend', 'pages', 'admin', 'seo');
const render = (el) => renderToStaticMarkup(el);

/** The exact payload GET /api/admin/seo/status returns, built from the registry. */
function statusFixture() {
  const inventory = registryInventory(PUBLIC_PAGES);
  const counts = registryCounts(inventory);
  const artifacts = {
    distPresent: true,
    prerender: { present: true, pageCount: inventory.length, generatedAt: '2026-08-10T03:00:00.000Z' },
    sitemap: { present: true, urlCount: counts.inSitemap, generatedAt: '2026-08-10T03:00:00.000Z' },
    robots: { present: true, hasSitemapLine: true },
    llms: { present: true, pageLinkCount: counts.indexable },
  };
  return {
    generatedAt: '2026-08-10T04:00:00.000Z',
    origin: 'https://pecanrev.com',
    baseUrl: 'https://pecanrev.com',
    inventory,
    counts,
    artifacts,
    checks: [...registryChecks(inventory), ...artifactChecks(artifacts, { expectedSitemapUrls: counts.inSitemap })],
    verification: readVerificationTokens(),
  };
}

const STATUS = statusFixture();

describe('SEO section shell', () => {
  const html = render(h(SeoSection, { initialStatus: STATUS }));

  it('renders the <h2> the Ops page object matches on', () => {
    expect(html).toContain('>SEO</h2>');
  });

  it('renders all three sub-tabs with their stable testids', () => {
    expect(SEO_TABS.map((t) => t.id)).toEqual(['repository', 'live', 'analytics']);
    for (const t of SEO_TABS) {
      expect(html, `sub-tab ${t.id}`).toContain(`data-testid="seo-tab-${t.id}"`);
      expect(html).toContain(t.label);
    }
  });

  it('states the repository-vs-observed split, and that no ranking data is shown', () => {
    expect(html).toContain('Repository validation');
    expect(html).toContain('Externally observed');
    expect(html).toMatch(/no Search Console credentials|hold no Search Console/i);
    expect(html).toMatch(/ranking/i);
  });
});

describe('Repository tab — panel A', () => {
  const html = render(h(RepositoryTab, { status: STATUS, loading: false }));

  it('labels itself as a measurement of the BUILD, not of what is served', () => {
    expect(html).toContain('data-testid="seo-repository-scope"');
    expect(html).toContain('Repository validation');
    expect(html).toMatch(/not what the web server hands to a crawler/i);
  });

  it('renders the count chips from the real registry', () => {
    for (const id of ['total', 'indexable', 'noindex', 'sitemap', 'excluded', 'jsonld']) {
      expect(html, `chip ${id}`).toContain(`data-testid="seo-count-${id}"`);
    }
    expect(html).toContain(`>${STATUS.counts.total}<`);
  });

  it('renders one check row per returned check, each with a verdict badge', () => {
    expect(STATUS.checks.length).toBeGreaterThanOrEqual(9);
    for (const c of STATUS.checks) {
      expect(html, `check ${c.id}`).toContain(`data-testid="seo-check-${c.id}"`);
      expect(html, `badge ${c.id}`).toContain(`data-testid="seo-check-badge-${c.id}"`);
    }
    expect(html).toContain(CHECK_STATUS_LABEL.pass);
  });

  it('renders the four build-artefact facts', () => {
    for (const id of ['prerender', 'sitemap', 'robots', 'llms']) {
      expect(html, `artifact ${id}`).toContain(`data-testid="seo-artifact-${id}"`);
    }
  });

  it('renders the full route inventory table', () => {
    expect(html).toContain('data-testid="seo-inventory-table"');
    for (const path of ['/', '/features/screening', '/resources']) {
      expect(html, `row ${path}`).toContain(`>${path}<`);
    }
  });
});

describe('Live check tab — panel B', () => {
  const html = render(h(LiveCheckTab, { status: STATUS }));

  it('warns that it is an observation, not repository truth', () => {
    expect(html).toContain('data-testid="seo-live-scope"');
    expect(html).toMatch(/not repository truth/i);
    expect(html).toMatch(/Nothing here is stored or cached/i);
  });

  it('offers the on-demand button and shows NO result until it is used', () => {
    expect(html).toContain('data-testid="seo-live-run"');
    expect(html).toContain('Run live check');
    expect(html).toContain('data-testid="seo-live-idle"');
    expect(html).not.toContain('data-testid="seo-live-results"');
  });

  it('reports Search Console and Bing as not configured, with the reason', () => {
    expect(html).toContain('data-testid="seo-verification"');
    expect(html).toContain('data-testid="seo-verification-google"');
    expect(html).toContain('data-testid="seo-verification-bing"');
    expect(html).toMatch(/Not configured|Verification token present/);
    expect(html).toMatch(/coverage, impressions and index status cannot be shown/i);
  });

  it('never renders an impression, click or ranking figure', () => {
    expect(html).not.toMatch(/impressions:\s*\d/i);
    expect(html).not.toMatch(/average position/i);
    expect(html).not.toMatch(/click-through/i);
  });
});

describe('Analytics tab — panel C', () => {
  /** The empty envelope the API returns before anything has been recorded. */
  const EMPTY = {
    days: 14, from: '2026-07-28', to: '2026-08-10', rows: [],
    totals: Object.fromEntries(REFERRER_CLASSES.map((c) => [c, 0])),
    grandTotal: 0, observedDays: [], available: true,
  };
  const html = render(h(AnalyticsTab, { initialData: EMPTY }));

  it('states the privacy contract up front', () => {
    expect(html).toContain('data-testid="seo-analytics-scope"');
    expect(html).toMatch(/No cookies/i);
    expect(html).toMatch(/no visitor or session identifier/i);
    expect(html).toMatch(/classified server-side and discarded/i);
  });

  it('renders a column per referrer class plus a window selector', () => {
    expect(html).toContain('data-testid="seo-analytics-table"');
    expect(html).toContain('data-testid="seo-analytics-window"');
    for (const cls of REFERRER_CLASSES) {
      expect(html, `column ${cls}`).toContain(REFERRER_CLASS_LABELS[cls]);
    }
  });

  it('the empty state is honest about WHY there is no data', () => {
    expect(html).toMatch(/No data yet/);
    expect(html).toMatch(/beacon has only been live since this deploy/i);
  });

  it('discloses which pages the beacon does NOT cover rather than undercounting silently', () => {
    expect(html).toMatch(/are not counted/i);
  });
});

describe('servingVerdict — the shell detector', () => {
  it('all three signals present = prerendered', () => {
    expect(servingVerdict({ ok: true, status: 200, titleMatches: true, h1Present: true, jsonLdPresent: true })).toBe('prerendered');
  });

  it('THE 111 FAILURE: 200 OK with none of the signals = app shell', () => {
    const v = servingVerdict({ ok: true, status: 200, titleMatches: false, h1Present: false, jsonLdPresent: false });
    expect(v).toBe('shell');
    expect(SERVING_VERDICT_LABEL[v]).toMatch(/crawlers see no content/i);
  });

  it('a partial render is neither a pass nor a shell', () => {
    expect(servingVerdict({ ok: true, status: 200, titleMatches: true, h1Present: false, jsonLdPresent: false })).toBe('partial');
  });

  it('a failed fetch and an HTTP error are distinct, and neither is a pass', () => {
    expect(servingVerdict({ ok: false, error: 'fetch failed: timed out after 8s' })).toBe('unreachable');
    expect(servingVerdict({ ok: true, status: 503 })).toBe('http-error');
  });
});

describe('sharePct', () => {
  it('never divides by zero and never invents a percentage', () => {
    expect(sharePct(0, 0)).toBe('—');
    expect(sharePct(5, 0)).toBe('—');
    expect(sharePct(1, 4)).toBe('25%');
  });
});

describe('Legacy design constraint', () => {
  const files = readdirSync(PKG).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));

  it('the package has the expected modules', () => {
    expect(files.sort()).toEqual(['AnalyticsTab.jsx', 'LiveCheckTab.jsx', 'RepositoryTab.jsx', 'SeoSection.jsx', 'fields.js']);
  });

  it('no module imports a Stitch primitive or design-system component', () => {
    for (const f of files) {
      const src = readFileSync(resolve(PKG, f), 'utf8');
      for (const spec of [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])) {
        expect(/stitch|design-system|\/ds\//i.test(spec), `${f} must not import "${spec}" — /ops is legacy-design only`).toBe(false);
      }
    }
  });

  it('alpha() is used instead of hex concatenation onto CSS vars', () => {
    for (const f of files) {
      const body = readFileSync(resolve(PKG, f), 'utf8');
      expect(/\$\{C\.[a-zA-Z0-9]+\}[0-9a-fA-F]{2}[^0-9a-fA-F]/.test(body), `${f} concatenates a hex alpha onto a CSS var`).toBe(false);
    }
  });
});
