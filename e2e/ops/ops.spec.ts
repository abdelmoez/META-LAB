/**
 * ops.spec.ts — the Ops / Admin console at `/ops` (LEGACY chrome, admin-only).
 *
 * Covers:
 *   1. The console loads for an admin and all 16 nav sections are reachable
 *      (each section renders its own <h2> heading).
 *   2. Appearance tab — the Stitch-rollout `design-default-mode` round-trips
 *      through a real save and is asserted via the API, then restored.
 *   3. Flags tab — a benign feature flag toggles + persists, then is restored.
 *   4. Settings tab — the app-settings form loads with the current app name and a
 *      save control.
 *   5. Mod role — `/ops` loads but exposes ONLY users + messages; admin-only navs
 *      are absent.
 *
 * GLOBAL-STATE SAFETY: design-settings and feature flags are global SiteSettings.
 * Tests that mutate them capture the original value first and ALWAYS restore it
 * (try/finally + an API restore) so sibling specs are never poisoned.
 */
import { test, expect } from '../fixtures/stitch-test';
import { OpsPage, OPS_SECTION_IDS } from '../page-objects/OpsPage';
import * as api from '../helpers/api';

test.describe('Ops console — admin', () => {
  test('@smoke /ops loads for an admin with all 16 nav sections present', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();

    // The admin default section is Overview — its heading proves the console mounted.
    await expect(ops.sectionHeading('overview')).toBeVisible({ timeout: 15000 });

    // All 16 sidebar nav buttons are present for an admin.
    for (const id of OPS_SECTION_IDS) {
      await expect(ops.nav(id), `nav-${id} should be visible for admin`).toBeVisible();
    }
  });

  test('every one of the 16 nav sections is reachable and renders its content', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();

    for (const id of OPS_SECTION_IDS) {
      await ops.nav(id).click();
      // Clicking activates the tab (fontWeight 600) AND mounts the section, whose
      // stable <h2> heading is the real "content appeared" assertion.
      await ops.expectNavActive(id);
      await expect(ops.sectionHeading(id), `section ${id} should render its heading`)
        .toBeVisible({ timeout: 15000 });
    }
  });

  test('Appearance tab: design rollout default-mode round-trips through save and is restored', async ({ page, request }) => {
    const ops = new OpsPage(page);
    await ops.goto();

    // Capture the original GLOBAL value up front so we restore exactly what was there.
    const original = await api.getDesignSettings(request);
    const target: 'legacy' | 'stitch' = original.defaultMode === 'stitch' ? 'legacy' : 'stitch';

    await ops.openAppearance();
    // The Appearance tab also exposes the brand controls — a cheap sanity that we
    // are on the right section.
    await expect(ops.appearanceHexInput).toBeVisible();

    const select = ops.designDefaultMode;
    await expect(select).toBeVisible();
    // Wait until the <select> reflects the server's current value (it loads async).
    await expect.poll(async () => select.inputValue(), { timeout: 15000 }).toBe(original.defaultMode);

    try {
      // ── Flip to the opposite mode and save ──────────────────────────────────
      await select.selectOption(target);
      await expect(ops.designSettingsSave).toBeEnabled(); // disabled until dirty
      await ops.designSettingsSave.click();
      // The real persistence assertion: the server's design-settings now read `target`.
      await expect
        .poll(async () => (await api.getDesignSettings(request)).defaultMode, { timeout: 10000 })
        .toBe(target);

      // ── Restore to the original via the SAME UI path (save again) ────────────
      await expect.poll(async () => select.inputValue(), { timeout: 10000 }).toBe(target);
      await select.selectOption(original.defaultMode);
      await expect(ops.designSettingsSave).toBeEnabled();
      await ops.designSettingsSave.click();
      await expect
        .poll(async () => (await api.getDesignSettings(request)).defaultMode, { timeout: 10000 })
        .toBe(original.defaultMode);
    } finally {
      // Belt-and-suspenders: guarantee the global setting is exactly the original,
      // even if an assertion above threw mid-way. Idempotent if already restored.
      await api.setDesignSettings(request, {
        defaultMode: original.defaultMode,
        allowAllUsers: original.allowAllUsers,
      });
    }

    // Final confirmation that the global state is clean for sibling specs.
    const after = await api.getDesignSettings(request);
    expect(after.defaultMode).toBe(original.defaultMode);
    expect(after.allowAllUsers).toBe(original.allowAllUsers);
  });

  test('Flags tab: a benign feature flag toggles, persists, and is restored', async ({ page, request }) => {
    const ops = new OpsPage(page);
    await ops.goto();

    // `projectDuplication` is purely client-cosmetic and not in the suite's
    // ENGINE_FLAGS set, so flipping it briefly cannot break any sibling spec.
    const FLAG = 'projectDuplication';
    const before = await api.getFeatureFlags(request);
    const original = !!before[FLAG];

    try {
      await ops.openSection('flags');
      const toggle = ops.flagToggle(FLAG);
      // The toggle being visible means the flags GET resolved (section is past its
      // loading spinner), so clicking flips real loaded state — not an empty object.
      await expect(toggle).toBeVisible({ timeout: 15000 });

      await toggle.click(); // flip
      await ops.flagsSave.click();

      // The Toggle has no `checked` attr — assert the flip via a follow-up GET.
      await expect
        .poll(async () => !!(await api.getFeatureFlags(request))[FLAG], { timeout: 10000 })
        .toBe(!original);
    } finally {
      // Restore the global flag to its original value regardless of UI outcome.
      await api.setFeatureFlags(request, { [FLAG]: original });
    }

    expect(!!(await api.getFeatureFlags(request))[FLAG]).toBe(original);
  });

  test('Settings tab: app-settings form loads with the current app name and a save control', async ({ page, request }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('settings');

    await expect(ops.settingsAppName).toBeVisible();
    await expect(ops.settingsSave).toBeVisible();

    // The form is hydrated from the persisted app settings — the input is non-empty
    // and matches the API's app name (when the server provides one).
    const settings = await api.getAppSettings(request);
    const apiAppName = typeof settings.appName === 'string' ? settings.appName : '';

    await expect
      .poll(async () => (await ops.settingsAppName.inputValue()).length, { timeout: 10000 })
      .toBeGreaterThan(0);

    if (apiAppName.length > 0) {
      await expect.poll(async () => ops.settingsAppName.inputValue(), { timeout: 10000 }).toBe(apiAppName);
    }
  });
});

test.describe('Ops console — mod (limited)', () => {
  // The mod user is only seeded in some environments; skip cleanly when absent so
  // requesting the `modContext` fixture (which requires the mod storageState) never
  // hard-fails. Skipping here means the body-only `modContext` fixture is not built.
  test.beforeEach(({ seed }) => {
    test.skip(!seed.mod, 'no mod user seeded in this environment');
  });

  test('a mod sees ONLY the users + messages sections; admin-only navs are absent', async ({ modContext }) => {
    const ops = new OpsPage(modContext.page);
    await ops.goto();

    // Allowed for a mod.
    await expect(ops.nav('users')).toBeVisible();
    await expect(ops.nav('messages')).toBeVisible();

    // Admin-only sections must not even render as dead links in the mod sidebar.
    for (const id of ['overview', 'flags', 'settings', 'style', 'security', 'health', 'projects'] as const) {
      await expect(ops.nav(id), `nav-${id} must be absent for a mod`).toHaveCount(0);
    }
  });
});
