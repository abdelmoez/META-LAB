/**
 * smoke.spec.ts — the fast, high-signal sanity suite (@smoke, runs cross-browser).
 * Proves the app is up, auth + Stitch activation work, and the core surfaces render.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { gotoStitch, expectStitch } from '../helpers/stitch';
import { publicFlags } from '../helpers/api';

test.describe('@smoke core', () => {
  test('the app renders in the Stitch design mode (rollout default for all users)', async ({ page }) => {
    await gotoStitch(page, '/app'); // asserts html[data-ui-design="stitch"]
    await expect(page).toHaveTitle(/PecanRev/i); // PecanRev branding; not "Research OS"
    expect((await page.content()).toLowerCase()).not.toContain('research os');
  });

  test('a project route renders in Stitch', async ({ page, seed }) => {
    test.skip(!seed.seedProjectId, 'no seed project available');
    await gotoStitch(page, `/app/project/${seed.seedProjectId}`); // asserts Stitch rendered
  });

  test('feature flags searchEngine + pecanSearch are exposed by the API', async ({ request }) => {
    const flags = await publicFlags(request);
    expect(flags).toHaveProperty('searchEngine');
    expect(flags).toHaveProperty('pecanSearch');
  });
});

anonTest.describe('@smoke public', () => {
  anonTest('landing page is reachable when logged out', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toContainText(/PecanRev/i);
  });

  anonTest('the login page renders its form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /log ?in|sign ?in/i }).first()).toBeVisible();
  });
});
