/**
 * visual.spec.ts — careful, NON-BRITTLE visual regression for a SMALL set of STABLE
 * surfaces: the public landing hero, the global app shell (purple rail), a static
 * dashboard page, the project-workspace workflow rail, and the Ops console chrome.
 *
 * WHY THESE ARE SAFE BASELINES (the whole point of this file):
 *  - We screenshot DETERMINISTIC chrome + STATIC content only. We never shoot the
 *    volatile dashboard overview or any engine screen: the project list, KPI counts
 *    and "recently updated" all change as parallel tests create/delete projects, so
 *    a full-page `/app` shot would flap constantly.
 *  - Every dynamic atom the brief calls out — dates, counts, the `v{n}` version
 *    label, presence avatars, the live invitations/unread badges — is MASKED via the
 *    stable testids / roles / attributes documented in FOUNDATION.md (never a guess).
 *  - `reducedMotion: 'reduce'` + `animations: 'disabled'` freeze framer-motion
 *    entrance/auto-cycling animations (landing) and CSS transitions (shell).
 *  - A fixed viewport makes layout independent of the project's device default, and
 *    `maxDiffPixelRatio` tolerates sub-pixel anti-aliasing across machines.
 *
 * BASELINES: the generated `visual.spec.ts-snapshots/*.png` are produced on the first
 * run (the orchestrator runs once with `--update-snapshots`), then COMMITTED and
 * REVIEWED like source. A later red diff means the UI changed on purpose-or-not —
 * only refresh the baseline after a human confirms the change is intended.
 *
 * Note: this file is intentionally NOT tagged @smoke, so it runs only in the
 * `chromium` project (firefox/webkit grep @smoke; mobile/tablet match responsive/).
 * Pixel baselines are browser/OS-specific, so single-engine is deliberate.
 */
import type { Page } from '@playwright/test';
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import * as api from '../helpers/api';

// Fixed viewport + reduced motion for BOTH test objects (allowed in a SPEC file).
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
anonTest.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

// Shared screenshot options. 2% pixel tolerance absorbs AA without hiding real diffs.
const DIFF = { maxDiffPixelRatio: 0.02, animations: 'disabled' as const };

/** The build-specific version label appears as `<… title="PecanRev version x.y.z">v{n}`
 *  in the project rail (and possibly elsewhere). Mask it everywhere it can surface. */
const versionLabel = (page: Page) => page.locator('[title^="PecanRev version"]');

/** Wait for web fonts so glyph rendering is stable before any screenshot. */
async function fontsReady(page: Page): Promise<void> {
  await page
    .evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true)))
    .catch(() => { /* fonts API unavailable — best effort */ });
}

/* ── Public landing (logged-out) ─────────────────────────────────────────────── */
anonTest.describe('visual — public landing', () => {
  anonTest('landing hero matches the visual baseline', async ({ page }) => {
    // betaWaitlist ON would swap `/` for the waitlist page — skip honestly if so.
    const flags = await api.publicFlags(page.request);
    anonTest.skip(!!flags.betaWaitlist, 'TODO: betaWaitlist ON → "/" renders the waitlist, not the landing hero');

    const resp = await page.goto('/');
    expect(resp?.status()).toBeLessThan(400);
    // Real assertion: the landing actually rendered with PecanRev branding.
    await expect(page.locator('body')).toContainText(/PecanRev/i);
    await fontsReady(page);

    // Viewport-only (the hero / above-the-fold). Lower marketing sections use
    // framer-motion AUTO-CYCLING content, so we deliberately avoid a full-page shot.
    await expect(page).toHaveScreenshot('landing-hero.png', {
      ...DIFF,
      mask: [versionLabel(page)], // defensive — in case a versioned footer ever scrolls in
    });
  });
});

/* ── App shell chrome (admin, Stitch) ────────────────────────────────────────── */
test.describe('visual — app shell (admin, Stitch)', () => {
  test('the global primary rail matches the visual baseline', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app'); // asserts html[data-ui-design="stitch"]
    // Real assertions: the global nav chrome is mounted.
    await expect(nav.primaryRail).toBeVisible();
    await expect(nav.globalNavItem('dashboard')).toBeVisible();
    await fontsReady(page);

    // Locator shot of the purple global rail — fully deterministic chrome for the
    // fixed seeded admin (same nav items, same avatar initial every run).
    await expect(nav.primaryRail).toHaveScreenshot('app-global-rail.png', {
      ...DIFF,
      mask: [
        nav.globalNavItem('invitations'), // can carry a live pending-invite count badge
        versionLabel(page),
      ],
    });
  });

  test('the dashboard (static Resources view) matches the visual baseline', async ({ page }) => {
    const nav = new ShellNav(page);
    // ?view=resources renders ResourcesView — STATIC help links + a feedback form
    // (its only dynamic value is the seeded admin's email, which is constant). This
    // gives us a full-shell dashboard shot without the volatile project list/KPIs.
    await nav.goto('/app?view=resources');
    await nav.expectShell();
    // Real assertion: the static resources content rendered.
    await expect(page.getByText('Help & documentation')).toBeVisible();
    await fontsReady(page);

    await expect(page).toHaveScreenshot('dashboard-resources.png', {
      ...DIFF,
      mask: [
        nav.topHeader,     // breadcrumb (+ project presence on other routes)
        nav.contextRail,   // DashboardSideMenu carries a live invitations-count badge
        versionLabel(page),
      ],
    });
  });
});

/* ── Project workspace chrome (admin, Stitch) ────────────────────────────────── */
test.describe('visual — project workspace (admin, Stitch)', () => {
  test('the project workflow rail matches the visual baseline', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=overview`);
    // Real assertions: the workspace rail is mounted and Overview is the active stage.
    await expect(nav.projectRail).toBeVisible();
    await expect(nav.backToProjects).toBeVisible();
    await expect(nav.projectCategory('overview')).toHaveAttribute('aria-current', 'page');

    // Force a KNOWN pin state (pinned = persistently expanded, so the shot does not
    // depend on hover and is not flapped by another spec toggling the admin's pin).
    if ((await nav.projectRail.getAttribute('data-pinned')) !== 'true') {
      await nav.pinControl.click();
      await expect(nav.projectRail).toHaveAttribute('data-pinned', 'true');
    }
    await page.mouse.move(0, 0); // park the cursor off-rail (no hover expansion artifacts)
    await fontsReady(page);

    // A brand-new tmpProject => every workflow step sits at its initial status, so the
    // rail is deterministic. Mask only the build-specific version label in the footer
    // (the account name/avatar below it is the constant seeded admin).
    await expect(nav.projectRail).toHaveScreenshot('project-rail.png', {
      ...DIFF,
      mask: [nav.projectRail.locator('[title^="PecanRev version"]')],
    });
  });
});

/* ── Ops console chrome (always legacy) ──────────────────────────────────────── */
test.describe('visual — Ops console (legacy)', () => {
  test('the Ops console sidebar matches the visual baseline', async ({ page }) => {
    // /ops is ALWAYS legacy (ForceLegacyDesign) even for a Stitch admin — do NOT
    // assert Stitch here.
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    const overview = page.getByTestId('nav-overview');
    // Real assertions: the admin reached Ops and the fixed nav set rendered.
    await expect(overview).toBeVisible();
    await expect(page.getByTestId('nav-flags')).toBeVisible();
    await fontsReady(page);

    // The sidebar is the fixed 220px column — the parent <div> of the nav buttons.
    // It is a deterministic, fixed set of admin sections (great regression target),
    // unlike the overview metrics/map in the main pane.
    const sidebar = overview.locator('xpath=..');
    await expect(sidebar).toHaveScreenshot('ops-sidebar.png', {
      ...DIFF,
      mask: [
        page.getByTestId('messages-unread-badge'), // live unread-message count
        // Footer build line: `v{n} · build {sha} · {date}` — all build/time-specific.
        page.getByRole('button', { name: /Back to Dashboard/i }).locator('xpath=..'),
      ],
    });
  });
});
