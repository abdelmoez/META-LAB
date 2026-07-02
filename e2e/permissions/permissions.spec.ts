/**
 * permissions.spec.ts — Roles & permission boundaries.
 *
 * Proves the DENY side of the dual role model:
 *   - Global roles (admin / mod / user / anonymous) gate the Ops console + admin API.
 *   - Project roles (owner vs everyone-else) gate project-scoped operations.
 *
 * Boundaries are asserted with the contexts the suite actually has a session for
 * (admin `page`/`request`, `modContext`, `normalContext`, anonymous). Roles whose
 * UI session does NOT exist in this run (the unregistered viewer/reviewer email
 * invites) are covered at the SERVER seam via API; the UI-only check for them is a
 * documented `test.skip`.
 *
 * Source of truth (verified):
 *   - AdminRoute renders an in-place 404 (`GenericNotFound`, text "Page not found")
 *     for non-staff — a deliberate existence cloak, NOT a redirect.
 *   - ProtectedRoute `Navigate to="/login"` for the unauthenticated.
 *   - Ops nav for a mod = MOD_SECTIONS (users, messages); admin-only sections never render.
 *   - Stitch account menu shows "Ops Console" only to staff (isStaff = admin|mod).
 *   - requireAdmin: /api/admin/{metrics,feature-flags,settings,users/:id/role};
 *     requireAdminOrMod: /api/admin/{console,users}.
 *   - listMembers / ownerDeleteProject are owner/member-scoped → 404 for outsiders.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import * as api from '../helpers/api';

// ── Route & chrome gating (UI) ───────────────────────────────────────────────
test.describe('Permission boundaries — route & chrome gating', () => {
  test('a normal user hitting /ops is 404-cloaked (AdminRoute), never the Ops console @smoke', async ({ normalContext }) => {
    const { page } = normalContext;
    await page.goto('/ops');
    // AdminRoute renders GenericNotFound in place for non-staff — existence hidden.
    await expect(page.getByText('Page not found')).toBeVisible();
    // The Ops console sidebar never mounts → no nav-* items for a normal user.
    await expect(page.getByTestId('nav-users')).toHaveCount(0);
    await expect(page.getByTestId('nav-flags')).toHaveCount(0);
    // Not redirected: the 404 is rendered AT /ops (route existence is not leaked via a bounce).
    expect(new URL(page.url()).pathname).toBe('/ops');
  });

  test('a normal user hitting /sift-beta is 404-cloaked (AdminRoute)', async ({ normalContext }) => {
    const { page } = normalContext;
    await page.goto('/sift-beta');
    await expect(page.getByText('Page not found')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/sift-beta');
  });

  test('a mod reaches /ops but admin-only nav (Flags, Settings, …) is absent', async ({ modContext }) => {
    const { page } = modContext;
    await page.goto('/ops'); // /ops is always legacy (ForceLegacyDesign); AdminRoute admits mod.
    // The (Mod) console mounted → proves the mod passed AdminRoute.
    await expect(page.getByTestId('nav-users')).toBeVisible();
    // MOD_SECTIONS = users + messages only; every admin-only section is omitted for a mod.
    await expect(page.getByTestId('nav-flags')).toHaveCount(0);
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
    await expect(page.getByTestId('nav-security')).toHaveCount(0);
    await expect(page.getByTestId('nav-style')).toHaveCount(0);
  });

  test('the account menu shows "Ops Console" only to staff (admin yes, normal no) @smoke', async ({ page, request, normalContext }) => {
    // 65.md — Stitch is the product UI for everyone; a normal user renders the
    // Stitch shell unless Ops flips designSettings.defaultMode to legacy. Guard
    // on that (rare, emergency-only) run config, not the retired allow-all gate.
    const ds = await api.getDesignSettings(request).catch(() => null);
    test.skip(ds?.defaultMode === 'legacy', 'Ops has flipped defaultMode to legacy (emergency fallback) — the Stitch account menu is not rendered.');

    // Admin: the Ops Console item IS present.
    const adminNav = new ShellNav(page);
    await adminNav.goto('/app');
    await adminNav.openAccountMenu();
    await expect(adminNav.accountMenuItem('ops-console')).toBeVisible();
    await expect(adminNav.accountMenuItem('profile')).toBeVisible();

    // Normal user: same menu, but NO Ops Console item.
    const userNav = new ShellNav(normalContext.page);
    await userNav.goto('/app');
    await userNav.openAccountMenu();
    await expect(userNav.accountMenuItem('profile')).toBeVisible(); // the menu really opened
    await expect(userNav.accountMenuItem('ops-console')).toHaveCount(0);
  });
});

// ── Unauthenticated visitor (anonymous) ──────────────────────────────────────
anonTest.describe('Permission boundaries — unauthenticated', () => {
  anonTest('an anonymous visitor at /app is redirected to /login (ProtectedRoute) @smoke', async ({ page }) => {
    await page.goto('/app');
    await page.waitForURL(/\/login(\?|#|$)/);
    await expect(page.getByRole('button', { name: /log ?in|sign ?in/i }).first()).toBeVisible();
  });

  anonTest('an anonymous visitor at /ops is 404-cloaked, NOT bounced to /login (existence hidden)', async ({ page }) => {
    await page.goto('/ops');
    await expect(page.getByText('Page not found')).toBeVisible();
    // Critically: it stays on /ops (a 404), it does NOT redirect to /login — that
    // would reveal the route exists. AdminRoute hides admin routes from everyone non-staff.
    expect(new URL(page.url()).pathname).toBe('/ops');
  });
});

// ── Server API boundaries ────────────────────────────────────────────────────
test.describe('Permission boundaries — server API', () => {
  test('a non-staff user is 403 on admin-only API @smoke', async ({ normalContext }) => {
    // requireAdmin → 403 for a plain user.
    expect((await normalContext.request.get('/api/admin/metrics')).status()).toBe(403);
    // requireAdminOrMod → still 403 (a user is not even mod-level).
    expect((await normalContext.request.get('/api/admin/console')).status()).toBe(403);
  });

  test('a mod can read the console descriptor but is 403 on admin-only sections', async ({ modContext }) => {
    // requireAdminOrMod → mod allowed (this is how the mod reaches /ops at all).
    expect((await modContext.request.get('/api/admin/console')).ok()).toBeTruthy();
    // The Flags/Settings nav items hidden from the mod UI map to admin-only endpoints.
    expect((await modContext.request.get('/api/admin/feature-flags')).status()).toBe(403);
    expect((await modContext.request.get('/api/admin/settings')).status()).toBe(403);
  });

  test('a mod cannot change a user\'s role (requireAdmin)', async ({ modContext, normalContext }) => {
    const target = await api.me(normalContext.request);
    test.skip(!target?.id, 'normal user id unavailable from /api/auth/me');
    const res = await modContext.request.patch(`/api/admin/users/${target!.id}/role`, { data: { role: 'mod' } });
    expect(res.status()).toBe(403);
    // The boundary actually held: the target user's role is unchanged.
    const after = await api.me(normalContext.request);
    expect(after?.role).toBe('user');
  });

  test('a registered non-member cannot read members of, or delete, another owner\'s project', async ({ request, projectWithMembers, normalContext }) => {
    // Seed a project with viewer/reviewer collaborators (unregistered email invites).
    const { project, siftId, members } = await projectWithMembers.create(['viewer', 'reviewer']);
    expect(members).toHaveLength(2);
    expect(members.every((m) => !!m.inviteToken)).toBeTruthy(); // pending (unregistered) invites

    // The normal user is NOT a member → cannot list the project's screening members
    // (server returns 404; the project's existence is not leaked to outsiders).
    const list = await normalContext.request.get(`/api/screening/projects/${siftId}/members`);
    expect(list.ok()).toBeFalsy();
    expect([403, 404]).toContain(list.status());

    // The normal user is NOT the owner → cannot delete the project (owner-scoped → 404).
    const del = await normalContext.request.post(`/api/projects/${project.id}/delete`, { data: { confirm: true } });
    expect(del.ok()).toBeFalsy();
    expect([403, 404]).toContain(del.status());

    // …and the project still exists for its owner (admin) after the denied delete.
    const owned = await api.listProjects(request);
    expect(owned.map((p) => p.id)).toContain(project.id);
  });

  test.skip('a seeded viewer/reviewer is UI-blocked from saving a screening decision', async () => {
    // TODO: projectWithMembers seeds viewer/reviewer as UNREGISTERED email invites, so
    // there is no browser session for those roles in this run (only admin/mod/normal
    // storageStates exist). The decision-permission boundary is exercised at the server
    // seam via the non-member API checks above; a true per-role UI assertion needs a
    // registered + logged-in viewer fixture (accept the invite, then login).
  });
});
