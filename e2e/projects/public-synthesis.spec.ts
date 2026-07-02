/**
 * 68.md P8 — public synthesis lifecycle: private by default, explicit publish,
 * anonymous read of the sanitized snapshot, immediate unpublish.
 * API-driven seeding (admin request fixture) + anonymous browser context.
 */
import { test, expect } from '../fixtures/stitch-test';

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

  test('flag OFF → authed synthesis API is hidden (404)', async ({ request, tmpProject, setFlags }) => {
    await setFlags({ publicSynthesis: false });
    const res = await request.get(`/api/synthesis/${tmpProject.id}/status`);
    expect(res.status()).toBe(404);
  });
});
