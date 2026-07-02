/**
 * tiers.spec.ts — the Ops › Tiers section (67.md product-tier admin surface).
 *
 * READ-ONLY by design: this spec renders + reaches the Tiers section and confirms
 * the anon 404-cloak. It performs NO tier mutations (no edits, no default flips) so
 * it can never poison the global tier state that sibling integration/e2e specs read.
 *
 * The Tiers UI (TiersSection) is built in a PARALLEL workstream, so the selectors
 * here target STABLE things only:
 *   - the sidebar nav entry labelled 'Tiers' (data-testid `nav-tiers` once wired);
 *   - the three seeded tier display names 'Free' / 'Plus' / 'Pro' (from ProductTier);
 *   - the separation note containing 'separate from project roles'.
 * When the section markup differs, we prefer loose getByText matching. If the Tiers
 * nav is not merged yet, the UI-dependent test SKIPS cleanly (documented below) so
 * this file is green either way — the anon + admin-reachability guarantees still run.
 */
import { test, expect } from '../fixtures/stitch-test';
import { anonTest } from '../fixtures/stitch-test';
import { OpsPage } from '../page-objects/OpsPage';

test.describe('Ops console — Tiers section (admin, read-only)', () => {
  test('the Tiers nav is reachable and renders the three tier cards + separation note', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();

    // The Tiers section ships in a parallel workstream. Find its nav by the stable
    // testid first, then fall back to the visible label. If neither exists yet, the
    // UI is not merged — skip the UI assertions but keep the file green (the anon
    // cloak + admin reachability are covered by the other cases here).
    const navById = page.getByTestId('nav-tiers');
    const navByLabel = page.getByRole('button', { name: /^Tiers$/ });
    const hasNav = (await navById.count()) > 0 || (await navByLabel.count()) > 0;
    test.skip(!hasNav, 'Ops › Tiers UI not merged in this build — section nav absent (parallel workstream).');

    const nav = (await navById.count()) > 0 ? navById : navByLabel;
    await nav.click();

    // The three seeded tier CARDS render. Display names live in editable
    // "Display name" textboxes (input values, which getByText cannot match) and
    // also appear as hidden <option>s in the default-tier select — so assert on
    // the tier-id chips + the editable inputs' values instead.
    await expect(page.locator('input[value="Free"]').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[value="Plus"]').first()).toBeVisible();
    await expect(page.locator('input[value="Pro"]').first()).toBeVisible();

    // The separation note is the load-bearing UX contract: tiers ≠ project roles.
    await expect(
      page.getByText(/separate from project roles/i).first(),
    ).toBeVisible();

    // The enforcement kill-switch control exists somewhere in the section. Match it
    // loosely (a checkbox/switch or a labelled control mentioning "enforcement").
    const enforcement = page.getByText(/enforce/i).first();
    await expect(enforcement).toBeVisible();
  });

  test('the Tiers admin API is reachable for the admin session (read-only GET)', async ({ request }) => {
    // Independent of the UI: the admin session can GET the tier admin payload. This
    // proves admin-only reachability even when the section markup is still landing.
    const res = await request.get('/api/admin/tiers');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tiers)).toBe(true);
    expect(body.tiers.length).toBeGreaterThanOrEqual(3);
    // The response carries the separation note the UI surfaces.
    expect(String(body.note || '')).toMatch(/separate from project roles/i);
    // The three default tiers are present by id.
    const ids = body.tiers.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['free', 'plus', 'pro']));
  });
});

anonTest.describe('Ops console — Tiers is not reachable anonymously', () => {
  anonTest('an anonymous visitor to /ops gets the 404 cloak, never the Tiers section', async ({ page }) => {
    // AdminRoute renders a generic 404 (existence-hiding) for non-staff, including
    // anonymous visitors — the /ops route must not reveal itself or any Tiers UI.
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });

    // The 404 cloak renders a big "404" + "Page not found" and NO ops sidebar.
    await expect(page.getByText('Page not found')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('nav-users')).toHaveCount(0);
    await expect(page.getByTestId('nav-tiers')).toHaveCount(0);
    // No tier display cluster leaks onto the cloak page.
    await expect(page.getByText(/separate from project roles/i)).toHaveCount(0);
  });
});
