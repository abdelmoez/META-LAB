/**
 * branding-nav.spec.ts — user-facing branding + design-mode navigation.
 *
 * Two related contracts are proven here:
 *
 *  1. BRANDING. The user-facing brand is "PecanRev" everywhere a visitor looks
 *     (landing, login, the Stitch dashboard, a project workspace), and NONE of the
 *     retired legacy names leak into rendered output. The rebrand intentionally KEPT
 *     internal identifiers (the `metalab_session` cookie, the `metalab_ui_design`
 *     localStorage key, `/api/screening/metalab/*` routes, DB columns) — those are
 *     NOT user-facing, so the leak check only matches the legacy *display* names with
 *     a word separator ("meta lab", "meta-lab", "meta sift", "meta-sift",
 *     "research os"). Bare `metalab`/`metasift` identifiers therefore never match.
 *
 *  2. DESIGN MODE (65.md). Stitch IS the product UI: every non-admin ALWAYS renders
 *     the Ops-governed `designSettings.defaultMode` (shipped: stitch) — their
 *     `?ui=legacy` links and saved preferences are ignored unless Ops enables
 *     `allowLegacyFallback` (emergency escape, default off). Only ADMINS keep a
 *     personal ?ui=/saved chain. The old in-app design switch is GONE for everyone —
 *     admins govern the theme from Ops › Appearance + ?ui= only. `/ops` is always
 *     legacy. The account-menu theme toggle flips `html[data-theme]` and persists
 *     across reload. Finally, the global rail + project rail navigate correctly.
 *
 * Authoring rules: only NEW files under e2e/, only the documented stable testids +
 * role/text selectors, every test asserts real behaviour, and any global setting we
 * mutate (design rollout, theme) is restored in a `finally` so sibling specs are
 * never left in a changed state.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import * as api from '../helpers/api';
import { expectStitch, expectLegacy, STITCH_STORAGE_KEY } from '../helpers/stitch';
import { BASE_URL, normalStatePath } from '../helpers/env';
import fs from 'node:fs';
import type { Browser } from '@playwright/test';

/* ─── Legacy-brand leak detector ──────────────────────────────────────────────
   Retired *display* names, lower-cased, each carrying a word separator so the
   intentionally-kept internal identifiers (metalab_session cookie,
   metalab_ui_design localStorage key, _linkedMetaSift fields, metaLabPulse
   keyframe, etc.) — which have NO separator between "meta" and the next word —
   can never produce a false positive. */
const LEGACY_BRAND_TOKENS = ['meta lab', 'meta-lab', 'meta sift', 'meta-sift', 'research os'];

function assertNoLegacyBrandLeak(content: string, where: string): void {
  const lc = content.toLowerCase();
  for (const tok of LEGACY_BRAND_TOKENS) {
    expect(lc.includes(tok), `${where} must not leak the legacy brand "${tok}"`).toBeFalsy();
  }
}

/** A fresh browser page authenticated as the seeded NON-admin user, with NO design
 *  priming: the saved-mode + cached-settings keys are cleared so whatever renders
 *  comes purely from the server-driven resolution (the Ops-governed default). */
async function newNormalPage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: normalStatePath });
  await ctx.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem('metalab_design_settings');
    } catch { /* storage unavailable */ }
  }, STITCH_STORAGE_KEY);
  const np = await ctx.newPage();
  return { ctx, np };
}

/* ════════════════════════════════════════════════════════════════════════════
   BRANDING — authenticated (Stitch) surfaces
   ════════════════════════════════════════════════════════════════════════════ */

test.describe('@smoke Branding — user-facing brand is PecanRev (no legacy leaks)', () => {
  test('the Stitch dashboard (/app) is PecanRev-branded with no legacy names', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app'); // asserts html[data-ui-design="stitch"]

    await expect(page).toHaveTitle(/PecanRev/i);
    // The global rail monogram is the brand anchor ("PecanRev home").
    await expect(nav.homeButton).toHaveAttribute('aria-label', /PecanRev/i);

    assertNoLegacyBrandLeak(await page.content(), '/app');
  });

  test('a project workspace overview is PecanRev-branded with no legacy names', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}`);

    await expect(page).toHaveTitle(/PecanRev/i);
    await expect(nav.projectRail).toBeVisible();
    // The project rail monogram ("PecanRev dashboard") is the brand anchor here
    // (the global rail's stitch-home-button is not mounted on project routes).
    await expect(page.getByRole('button', { name: /PecanRev/i }).first()).toBeVisible();

    assertNoLegacyBrandLeak(await page.content(), '/app/project/:id overview');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   BRANDING — public (logged-out) surfaces
   ════════════════════════════════════════════════════════════════════════════ */

anonTest.describe('@smoke Branding — public surfaces', () => {
  anonTest('the public landing is PecanRev-branded with no legacy names', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status() ?? 200).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(/PecanRev/i);
    assertNoLegacyBrandLeak(await page.content(), 'landing');
  });

  // Login.jsx renders the shared BrandWordmark ("PecanRev") since 63.md, so this
  // is a live branding assertion (it was a .fixme while the page still hard-coded
  // the retired META·LAB wordmark).
  anonTest('the login page is PecanRev-branded with no legacy wordmark', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /log ?in|sign ?in/i }).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/PecanRev/i);
    await expect(page.locator('body')).not.toContainText(/META[·\-]\s*LAB/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   DESIGN MODE — Ops governance (defaultMode + allowLegacyFallback), /ops, ?ui=
   ════════════════════════════════════════════════════════════════════════════ */

test.describe('Design mode', () => {
  test('a non-admin lands on Stitch by default (no priming, pure Ops default)', async ({ request, browser, seed }) => {
    test.skip(!seed.normal || !fs.existsSync(normalStatePath), 'TODO: no seeded normal (non-admin) user available');

    // Guard the precondition rather than mutating global state: the shipped
    // default IS stitch, so a differing value means another spec leaked.
    const settings = await api.getDesignSettings(request);
    expect(settings.defaultMode, 'shipped designSettings.defaultMode must be stitch').toBe('stitch');

    const { ctx, np } = await newNormalPage(browser);
    try {
      // Sanity: this session really is a NON-admin (so "renders Stitch" is meaningful).
      const who = await ctx.request.get('/api/auth/me');
      expect(who.ok(), 'normal-user session should be valid').toBeTruthy();
      const w = await who.json();
      expect(String(w.role || w.user?.role || ''), 'fixture user must be a non-admin').not.toMatch(/admin/i);

      await np.goto('/app', { waitUntil: 'domcontentloaded' });
      await expectStitch(np); // Ops defaultMode:'stitch' → every non-admin renders Stitch
    } finally {
      await ctx.close();
    }
  });

  test('?ui=legacy does NOT flip a non-admin while legacy fallback is off', async ({ request, browser, seed }) => {
    test.skip(!seed.normal || !fs.existsSync(normalStatePath), 'TODO: no seeded normal (non-admin) user available');

    const original = await api.getDesignSettings(request);
    // Pin the exact governance state under test (the shipped default), restore after.
    await api.setDesignSettings(request, { defaultMode: 'stitch', allowLegacyFallback: false });

    const { ctx, np } = await newNormalPage(browser);
    try {
      const who = await ctx.request.get('/api/auth/me');
      expect(who.ok(), 'normal-user session should be valid').toBeTruthy();
      const w = await who.json();
      expect(String(w.role || w.user?.role || ''), 'fixture user must be a non-admin').not.toMatch(/admin/i);

      // The override is ignored for a non-admin: after the provider resolves
      // authoritatively (post-auth + settings), the page is Stitch anyway.
      await np.goto('/app?ui=legacy', { waitUntil: 'domcontentloaded' });
      await expectStitch(np);
    } finally {
      await ctx.close();
      // Restore the global governance record for sibling specs.
      await api.setDesignSettings(request, {
        defaultMode: original.defaultMode,
        allowLegacyFallback: original.allowLegacyFallback ?? false,
      });
    }
  });

  test('no design-switch control renders in any header — for admins or normal users', async ({ request, page, browser, seed }) => {
    // The retired AdminDesignSwitch was a role=radiogroup "Interface design"
    // (inline in the Stitch header + a floating pill over legacy pages). It must
    // be gone EVERYWHERE — theme governance lives in Ops › Appearance now.
    const absent = async (p: import('@playwright/test').Page, where: string) => {
      await expect(p.getByRole('radiogroup', { name: 'Interface design' }), `design switch must be absent on ${where}`).toHaveCount(0);
    };

    try {
      // Admin, Stitch dashboard header.
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await expectStitch(page);
      await absent(page, 'admin /app (stitch header)');

      // Admin, legacy chrome (via the admin-only override) — the old floating pill mount.
      await page.goto('/app?ui=legacy', { waitUntil: 'domcontentloaded' });
      await expectLegacy(page);
      await absent(page, 'admin /app?ui=legacy (legacy chrome)');

      // Normal user, Stitch dashboard.
      if (seed.normal && fs.existsSync(normalStatePath)) {
        const { ctx, np } = await newNormalPage(browser);
        try {
          await np.goto('/app', { waitUntil: 'domcontentloaded' });
          await expectStitch(np);
          await absent(np, 'normal /app');
        } finally {
          await ctx.close();
        }
      }
    } finally {
      // The admin's ?ui=legacy visit auto-persisted legacy (65.md keeps admin
      // override persistence) — put the admin back on Stitch for sibling specs.
      await api.setDesignMode(request, 'stitch');
    }
  });

  test('/ops renders the legacy console even for a Stitch admin', async ({ page }) => {
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    // We actually reached the Ops console (not a redirect to /login or /app)…
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe('/ops');
    // …and it is forced legacy (ForceLegacyDesign) despite the admin's Stitch preference.
    await expectLegacy(page);
  });

  test('?ui=legacy still works for the admin (personal override)', async ({ request, page }) => {
    try {
      await page.goto('/app?ui=legacy', { waitUntil: 'domcontentloaded' });
      await expectLegacy(page);

      // Back on plain /app the admin renders Stitch again: the override persisted
      // server-side (admin-only), but this fixture re-primes the admin's saved
      // localStorage mode to stitch on every navigation — which wins the chain.
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await expectStitch(page);
    } finally {
      // Undo the auto-persisted legacy on the admin profile for sibling specs.
      await api.setDesignMode(request, 'stitch');
    }
  });

  test('account-menu theme toggle flips html[data-theme] and persists across reload', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app');

    const initial = (await page.locator('html').getAttribute('data-theme')) || 'day';
    const flipped = initial === 'night' ? 'day' : 'night';

    try {
      await nav.openAccountMenu();
      await nav.accountMenuItem('theme').click();
      await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(flipped);

      // The choice survives a full reload (localStorage + pre-paint bootstrap).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await nav.expectStitch();
      await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(flipped);
    } finally {
      // The theme persists to the admin's server profile too, so flip it back.
      await nav.openAccountMenu();
      await nav.accountMenuItem('theme').click();
      await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(initial);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   NAVIGATION CORRECTNESS — rail buttons go to the right routes
   ════════════════════════════════════════════════════════════════════════════ */

test.describe('Navigation', () => {
  test('global rail items navigate to the correct dashboard routes', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app');
    await expect(nav.globalNavItem('dashboard')).toBeVisible();

    // Dashboard → Activity view (/app?view=activity).
    await nav.globalNavItem('activity').click();
    await page.waitForURL((u) => u.pathname.endsWith('/app') && u.searchParams.get('view') === 'activity');

    // Activity → Dashboard (back to the bare /app, no view param).
    await nav.globalNavItem('dashboard').click();
    await page.waitForURL((u) => u.pathname.endsWith('/app') && !u.searchParams.get('view'));
  });

  test('project rail categories navigate to the correct workspace tabs', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}`);
    await expect(nav.projectRail).toBeVisible();

    const projectPath = `/app/project/${tmpProject.id}`;

    // A single-destination category (Project Control) → ?tab=control.
    await nav.projectCategory('control').click();
    await page.waitForURL((u) => u.pathname === projectPath && u.searchParams.get('tab') === 'control');

    // A research-workflow stepper step (Search) → ?tab=search.
    await nav.workflowStep('search').click();
    await page.waitForURL((u) => u.pathname === projectPath && u.searchParams.get('tab') === 'search');
  });
});
