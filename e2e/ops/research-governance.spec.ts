/**
 * research-governance.spec.ts — Ops › Research Governance (109.md §4).
 *
 * Covers:
 *   1. The section mounts for an admin and every sub-tab renders its content.
 *   2. Duplicate Detection — the health card resolves to a real state badge and the
 *      environment-managed worker knobs render read-only with their variable names.
 *   3. A safe governance setting round-trips through the UI and is asserted via the
 *      API, then restored (GLOBAL-STATE SAFETY, same discipline as ops.spec.ts).
 *   4. A guarded setting cannot be changed without passing the confirmation modal.
 *   5. Settings search (§44) finds a control by concept ("undo").
 *   6. Read-only scientific governance is visible and has NO control (§2/§31): the
 *      proportion compatibility guard has no off switch anywhere in Ops.
 *
 * GLOBAL-STATE SAFETY: researchGovernanceSettings is a global SiteSetting. The one
 * test that writes captures the original first and restores it in try/finally.
 */
import { test, expect } from '../fixtures/stitch-test';
import { OpsPage } from '../page-objects/OpsPage';
import * as api from '../helpers/api';

test.describe('Ops › Research Governance', () => {
  test('@smoke the section mounts and every sub-tab renders', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('research');

    await expect(ops.sectionHeading('research')).toBeVisible();

    // Duplicate Detection is the default sub-tab.
    await expect(page.getByTestId('rg-dup-health')).toBeVisible({ timeout: 15000 });

    await ops.openResearchTab('keywords');
    await expect(page.getByTestId('rg-keyword-settings')).toBeVisible();
    await expect(page.getByTestId('rg-keyword-audit')).toBeVisible();

    await ops.openResearchTab('extraction');
    await expect(page.getByTestId('rg-extraction-settings')).toBeVisible();
    await expect(page.getByTestId('rg-analysis-settings')).toBeVisible();
    await expect(page.getByTestId('rg-analysis-variables')).toBeVisible();

    await ops.openResearchTab('interaction');
    await expect(page.getByTestId('rg-navigation-settings')).toBeVisible();
    await expect(page.getByTestId('rg-history-settings')).toBeVisible();
    await expect(page.getByTestId('rg-shortcuts')).toBeVisible();

    await ops.openResearchTab('errors');
    await expect(page.getByTestId('rg-client-errors')).toBeVisible();
  });

  test('Duplicate Detection: health resolves and the worker knobs are env-badged read-only', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('research');

    // The health badge only renders once GET .../duplicate-jobs/health resolved.
    await expect(ops.dupHealthBadge).toBeVisible({ timeout: 15000 });
    await expect(ops.dupHealthBadge).toHaveText(/healthy|degraded|disabled/i);

    // 109.md §45 — env-managed knobs are shown with their variable name, read-only.
    await expect(page.getByTestId('rg-dup-env-note')).toContainText(/Managed by environment/i);
    const maxBlock = ops.rgSetting('duplicates.env.SCREEN_DUP_MAX_BLOCK');
    await expect(maxBlock).toBeVisible();
    await expect(maxBlock).toContainText('SCREEN_DUP_MAX_BLOCK');
    // No control of any kind inside an env row.
    await expect(maxBlock.locator('input, select')).toHaveCount(0);

    // The job table is paginated server-side — the pager or an empty state, never
    // an unbounded dump.
    await expect(page.getByTestId('rg-dup-jobs-table')).toBeVisible();
  });

  test('a safe governance setting round-trips through the UI and is restored', async ({ page, request }) => {
    const ops = new OpsPage(page);
    const KEY = 'interaction.historyCap';
    const PATH = 'historyCap';

    const before = await api.getResearchGovernance(request);
    const original = Number(before.settings[PATH]);
    const target = original === 20 ? 25 : 20;

    await ops.goto();
    await ops.openSection('research');
    await ops.openResearchTab('interaction');

    const input = ops.rgNumber(KEY);
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => Number(await input.inputValue()), { timeout: 15000 }).toBe(original);

    try {
      await input.fill(String(target));
      await input.blur();

      await expect
        .poll(async () => Number((await api.getResearchGovernance(request)).settings[PATH]), { timeout: 10000 })
        .toBe(target);
    } finally {
      await api.setResearchGovernance(request, { [KEY]: original });
    }

    expect(Number((await api.getResearchGovernance(request)).settings[PATH])).toBe(original);
  });

  test('a guarded setting requires the confirmation modal and cancelling writes nothing', async ({ page, request }) => {
    const ops = new OpsPage(page);
    const KEY = 'analysis.requireOverrideRationale';
    const PATH = 'requireOverrideRationale';

    const original = (await api.getResearchGovernance(request)).settings[PATH];

    await ops.goto();
    await ops.openSection('research');
    await ops.openResearchTab('extraction');

    const toggle = ops.rgToggle(KEY);
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();

    // 109.md §§40-41 — the impact preview appears before anything is written.
    const modal = page.getByTestId('rg-setting-confirm-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/current/i);
    await page.getByTestId('rg-setting-confirm-cancel').click();
    await expect(modal).toHaveCount(0);

    expect((await api.getResearchGovernance(request)).settings[PATH]).toBe(original);
  });

  test('settings search finds a control by concept', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('research');

    await ops.researchSearch.fill('undo');
    const results = ops.researchSearchResults;
    await expect(results).toBeVisible();
    // The history cap is described in undo terms; the Ctrl+Y alias is found through
    // its catalogue aliases even though its own wording only says "redo".
    await expect(results).toContainText('interaction.historyCap');
    await expect(results).toContainText('interaction.ctrlYRedoAlias');

    await ops.researchSearch.fill('duplicate');
    await expect(results).toContainText('duplicates.');
  });

  test('the proportion compatibility guard is visible, read-only, and has no off switch', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('research');
    await ops.openResearchTab('extraction');

    const guard = ops.rgSetting('analysis.compatibilityGuard');
    await expect(guard).toBeVisible({ timeout: 15000 });
    await expect(guard).toContainText(/read-only/i);
    // 109.md §§2, 31 — no toggle, no input, no select. Not merely disabled: absent.
    await expect(guard.locator('input, select')).toHaveCount(0);
    await expect(ops.rgToggle('analysis.compatibilityGuard')).toHaveCount(0);

    // The stored enum registries render their stable identifiers next to the labels.
    await expect(ops.rgSetting('extraction.denominatorPopulations')).toContainText('Denominator Population categories');
    await expect(page.getByTestId('rg-extraction-settings')).toContainText('plp_molecular_diagnoses');
  });
});
