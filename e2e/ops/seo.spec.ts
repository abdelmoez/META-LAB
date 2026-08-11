/**
 * seo.spec.ts — Ops › SEO (113.md item 8).
 *
 * Covers:
 *   1. The section mounts for an admin and all three sub-tabs render.
 *   2. Repository validation renders the registry-computed inventory, the count
 *      chips and the check list.
 *   3. The two panels are LABELLED as what they are — "built here" vs
 *      "observed out there" — because conflating them is the exact mistake the
 *      section exists to prevent.
 *   4. The live check offers its on-demand button and shows nothing before it is
 *      pressed.
 *   5. Landing analytics renders its table and its privacy notice.
 *
 * DELIBERATELY NOT ASSERTED: anything the live check returns. It reaches the
 * PUBLIC origin over the internet; a test that asserted on that would be a test
 * of the deployment and the network, and it would fail in CI, offline, and on
 * every developer machine. The button's EXISTENCE is the contract here; the
 * evaluation logic behind it is unit-tested in
 * tests/unit/seo/seoAdminController.test.js against fixed HTML.
 *
 * GLOBAL-STATE SAFETY: the whole section is read-only — there is no writable
 * setting anywhere in it — so no restore discipline is needed.
 */
import { test, expect } from '../fixtures/stitch-test';
import { OpsPage } from '../page-objects/OpsPage';

test.describe('Ops › SEO', () => {
  test('@smoke the section mounts and all three sub-tabs render', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('seo');

    await expect(ops.sectionHeading('seo')).toBeVisible();

    // Repository validation is the default sub-tab.
    await expect(ops.seoChecksList).toBeVisible({ timeout: 15000 });
    await expect(ops.seoInventoryTable).toBeVisible({ timeout: 15000 });

    await ops.openSeoTab('live');
    await expect(ops.seoLiveRun).toBeVisible();

    await ops.openSeoTab('analytics');
    await expect(ops.seoAnalyticsTable).toBeVisible({ timeout: 15000 });
  });

  test('repository validation renders the registry inventory computed server-side', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('seo');

    await expect(page.getByTestId('seo-count-total')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('seo-count-indexable')).toBeVisible();
    await expect(page.getByTestId('seo-count-sitemap')).toBeVisible();

    // The named checks the panel promises.
    for (const id of ['unique-titles', 'unique-descriptions', 'description-length', 'canonical-present', 'components-exist']) {
      await expect(ops.seoCheck(id), `check ${id}`).toBeVisible();
    }

    // The inventory lists real registry paths.
    await expect(ops.seoInventoryTable).toContainText('/features/screening');
    await expect(ops.seoInventoryTable).toContainText('/resources');
  });

  test('the two panels label themselves — repository truth vs external observation', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('seo');

    await expect(page.getByTestId('seo-repository-scope')).toContainText(/Repository validation/i);
    await expect(page.getByTestId('seo-repository-scope')).toContainText(/not what the web server hands to a crawler/i);

    await ops.openSeoTab('live');
    await expect(ops.seoLiveScope).toContainText(/not repository truth/i);
    await expect(ops.seoLiveScope).toContainText(/stored or cached/i);
  });

  test('the live check is on-demand and shows nothing until it is run', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('seo');
    await ops.openSeoTab('live');

    await expect(ops.seoLiveRun).toBeVisible();
    await expect(ops.seoLiveRun).toContainText(/Run live check/i);
    // Nothing has been observed in this session — and no result is invented.
    await expect(page.getByTestId('seo-live-idle')).toBeVisible();
    await expect(page.getByTestId('seo-live-results')).toHaveCount(0);
    // NOT clicked: the button reaches the public internet.

    // Search Console / Bing state is reported without any API behind it.
    await expect(ops.seoVerification).toBeVisible();
    await expect(page.getByTestId('seo-verification-google')).toContainText(/Not configured|Verification token present/i);
    await expect(ops.seoVerification).toContainText(/cannot be shown/i);
  });

  test('landing analytics renders its table, window control and privacy notice', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('seo');
    await ops.openSeoTab('analytics');

    await expect(ops.seoAnalyticsTable).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('seo-analytics-window')).toBeVisible();
    await expect(ops.seoAnalyticsScope).toContainText(/No cookies/i);
    await expect(ops.seoAnalyticsScope).toContainText(/no visitor or session identifier/i);
  });
});
