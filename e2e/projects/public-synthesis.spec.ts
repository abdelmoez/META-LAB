/**
 * 68.md P8 — public synthesis lifecycle: private by default, explicit publish,
 * anonymous read of the sanitized snapshot, immediate unpublish.
 * API-driven seeding (admin request fixture) + anonymous browser context.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ensureScreeningWorkspace, addProjectMember } from '../helpers/api';

test.describe('public synthesis (flag publicSynthesis)', () => {
  test('publish → anonymous view → unpublish → clean unavailable', async ({ page, request, browser, tmpProject, setFlags }) => {
    await setFlags({ publicSynthesis: true });

    // Private by default: no status row until someone publishes.
    const st0 = await request.get(`/api/synthesis/${tmpProject.id}/status`);
    expect(st0.ok()).toBeTruthy();

    // Publish (admin owner).
    const pub = await request.post(`/api/synthesis/${tmpProject.id}/publish`, {
      data: { settings: { publicTitle: 'E2E Public Synthesis', publicSummary: 'A published snapshot.' } },
    });
    expect(pub.ok()).toBeTruthy();
    const status = await (await request.get(`/api/synthesis/${tmpProject.id}/status`)).json();
    const token: string = status.shareToken || status.token || status.synthesis?.shareToken;
    expect(token, 'publish must yield a share token').toBeTruthy();
    expect(token.length).toBeGreaterThanOrEqual(32);

    // Anonymous visitor sees the public page (fresh context, NO storage state).
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const anonPage = await anon.newPage();
    await anonPage.goto(`/public/synthesis/${token}`);
    await expect(anonPage.getByText('E2E Public Synthesis')).toBeVisible({ timeout: 15000 });
    await expect(anonPage.getByText(/PecanRev/i).first()).toBeVisible();

    // Unpublish → the same URL shows a clean unavailable state, never data.
    const unpub = await request.post(`/api/synthesis/${tmpProject.id}/unpublish`);
    expect(unpub.ok()).toBeTruthy();
    await anonPage.goto(`/public/synthesis/${token}`);
    await expect(anonPage.getByText(/not available|no longer available/i).first()).toBeVisible({ timeout: 15000 });
    await expect(anonPage.getByText('E2E Public Synthesis')).toHaveCount(0);
    await anon.close();
  });

  /**
   * 68.md P8 + 75.md Phase 7 — WHO the flag hides the API from.
   *
   * This assertion used to be made with the `request` fixture, which is the seeded
   * ADMIN, and it expected 404. That contradicts the platform's own gate:
   * `featureAccess` (server/services/featureAccess.js) answers `adminOnly` for an
   * admin whenever a flag is off, precisely so a globally-disabled feature stays
   * see/open/use/testable by admins — so the admin's 200 was the correct response
   * and the test was asserting a rule against the one caller it does not apply to.
   *
   * The gate is therefore driven with a NON-admin. The 404 must also be provably
   * the FLAG's and not the membership resolver's (`gate()` 404s twice: 'Not found'
   * for the flag, 'Project not found' for access), so the normal user is made a
   * member first and the flag-on request is asserted to reach 200 with the same
   * caller and the same URL. Only the flag changes between the two reads.
   *
   * The mod is included deliberately: the flag bypass is ADMIN-ONLY and narrower
   * than the tier bypass (isSystemBypassUser = admin OR mod), and that decision is
   * only load-bearing if something fails when it erodes.
   */
  test('flag OFF → the authed synthesis API is hidden from non-admins (404); admins keep it', async ({
    request, seed, normalContext, modContext, tmpProject, setFlags,
  }) => {
    test.skip(!seed.normal || !seed.mod, 'needs the seeded non-admin users');
    const url = `/api/synthesis/${tmpProject.id}/status`;
    const siftId = await ensureScreeningWorkspace(request, tmpProject.id);
    await addProjectMember(request, siftId, { email: seed.normal!.email, preset: 'reviewer' });
    await addProjectMember(request, siftId, { email: seed.mod!.email, preset: 'reviewer' });

    // Baseline: with the flag ON both non-admins reach the API, so neither 404
    // below can be blamed on access resolution.
    await setFlags({ publicSynthesis: true });
    expect((await normalContext.request.get(url)).status(), 'a member reaches the API while the flag is on').toBe(200);
    expect((await modContext.request.get(url)).status()).toBe(200);

    // Flag OFF: existence-hidden for everyone without the admin role.
    await setFlags({ publicSynthesis: false });
    const off = await normalContext.request.get(url);
    expect(off.status()).toBe(404);
    expect((await off.json())?.error, 'the flag gate 404s before access resolution does').toBe('Not found');
    expect((await modContext.request.get(url)).status(), 'a moderator is NOT an admin for flags').toBe(404);

    // 75.md Phase 7 — and the admin override is the documented behaviour, not a leak.
    expect((await request.get(url)).status(), 'an admin keeps a disabled feature usable').toBe(200);
  });
});
