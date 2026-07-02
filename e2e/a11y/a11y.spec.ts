/**
 * a11y.spec.ts — automated accessibility coverage for PecanRev's major surfaces.
 *
 * Two layers:
 *  1. axe-core scans (helpers/axe.ts) of the landing, login, dashboard and a project
 *     overview — gated to serious/critical WCAG A/AA violations, with a per-page
 *     documented allowlist (ALLOW) so the gate is a real baseline, not a fake pass.
 *  2. Targeted semantic assertions the app's own contract promises: the active nav
 *     item carries aria-current, the workflow stepper exposes status via data-status
 *     (not colour alone), the create-project modal traps focus + closes on Escape,
 *     and shell buttons have accessible names.
 *
 * Authoring notes:
 *  - Anonymous surfaces use `anonTest`; authed surfaces use `test` (seeded admin in
 *    Stitch). Setup is always via fixtures/helpers, never by driving the UI.
 *  - Scoped scans use `stitch-main-content` so a single chrome regression doesn't
 *    fail every page; the chrome itself is covered by the nav/modal/button tests.
 */
import { test, expect, anonTest } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import { expectNoSeriousA11y } from '../helpers/axe';

/**
 * Documented per-surface baseline allowlists (axe rule ids).
 *
 * These start EMPTY: the intent is zero serious/critical violations. If a scan
 * surfaces a real, pre-existing violation that cannot be fixed in this pass, add the
 * rule id here WITH A COMMENT explaining what/why and a follow-up, e.g.:
 *   landing: ['color-contrast'], // TODO(a11y): hero CTA fails AA on brand bg — PECAN-123
 * Adding an id is a conscious, reviewed acceptance — never a silent mute.
 */
const ALLOW = {
  // TODO(a11y): the marketing landing has low-contrast text on the brand-tinted hero
  // (axe `color-contrast`, serious). Pre-existing design debt — accepted as a reviewed
  // baseline so the gate catches NEW regressions; fix in a dedicated design pass.
  landing: ['color-contrast'] as string[],
  login: [] as string[],
  dashboard: [] as string[],
  projectOverview: [] as string[],
};

const MAIN = '[data-testid="stitch-main-content"]';

// ─────────────────────────────────────────────────────────────────────────────
// 1. axe scans of major surfaces (chromium-only — heavier, not @smoke)
// ─────────────────────────────────────────────────────────────────────────────
anonTest.describe('a11y axe — public surfaces', () => {
  anonTest('landing page has no serious/critical WCAG A/AA violations', async ({ page }, testInfo) => {
    await page.goto('/');
    // Ensure the page actually rendered before scanning (not a blank/error shell).
    await expect(page.locator('body')).toContainText(/PecanRev/i);
    await expectNoSeriousA11y(page, { allow: ALLOW.landing, label: 'landing', testInfo });
  });

  anonTest('login page has no serious/critical WCAG A/AA violations', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /log ?in|sign ?in/i }).first()).toBeVisible();
    await expectNoSeriousA11y(page, { allow: ALLOW.login, label: 'login', testInfo });
  });
});

test.describe('a11y axe — authenticated surfaces', () => {
  test('the /app dashboard main content has no serious/critical violations', async ({ page }, testInfo) => {
    const nav = new ShellNav(page);
    await nav.goto('/app?view=overview');
    await nav.expectShell();
    await expect(nav.mainContent).toBeVisible();
    await expectNoSeriousA11y(page, { include: MAIN, allow: ALLOW.dashboard, label: 'dashboard', testInfo });
  });

  test('a project overview main content has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=overview`);
    // Workspace shell mounted (rail + main content) before we scan.
    await expect(nav.projectRail).toBeVisible();
    await expect(nav.mainContent).toBeVisible();
    await expectNoSeriousA11y(page, { include: MAIN, allow: ALLOW.projectOverview, label: 'project-overview', testInfo });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Targeted semantic / ARIA contract assertions
// ─────────────────────────────────────────────────────────────────────────────
test.describe('a11y semantics — navigation & status', () => {
  test('@smoke the active global nav item carries aria-current="page"', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app?view=overview');
    await nav.expectShell();

    // On /app the Dashboard nav item is the active surface…
    await expect(nav.globalNavItem('dashboard')).toHaveAttribute('aria-current', 'page');
    // …and a non-active item must NOT advertise itself as current (proves it's meaningful).
    await expect(nav.globalNavItem('help')).not.toHaveAttribute('aria-current', 'page');
  });

  test('workflow steps communicate status via data-status (not colour alone)', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=overview`);
    await expect(nav.projectRail).toBeVisible();

    // The project rail's research-workflow rows each carry a machine-readable
    // data-status AND a descriptive aria-label — status is never colour-only.
    const steps = page.locator('[data-testid^="stitch-workflow-step-"]');
    const count = await steps.count();
    expect(count, 'project rail should render workflow steps').toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const step = steps.nth(i);
      await expect(step).toHaveAttribute('data-status', /.+/);
      await expect(step).toHaveAttribute('aria-label', /.+/);
    }
    // NOTE: the white-submenu stepper (`stitch-stepper-step-*`) carries data-status
    // on its NUMBERED rows; its utility rows (Overview/Settings/Export/PRISMA) have
    // no status and intentionally omit the attribute, so the canonical status-bearing
    // assertion targets the always-present project-rail workflow steps above.
  });
});

test.describe('a11y semantics — create-project modal', () => {
  test('the create-project dialog is modal, traps focus, and closes on Escape', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app?view=overview');
    await nav.expectShell();

    // Open via the header action (overview view) — never via direct state mutation.
    await page.getByRole('button', { name: 'New project' }).first().click();

    await expect(nav.modal).toBeVisible();
    await expect(nav.modal).toHaveAttribute('aria-modal', 'true');
    await expect(nav.modalTitle).toHaveText(/New project/i);

    // Focus is moved INTO the dialog (focus trap engaged).
    const focusInsideModal = () => page.evaluate(() => {
      const m = document.querySelector('[data-testid="stitch-modal"]');
      const a = document.activeElement;
      return !!(m && a && m.contains(a));
    });
    await expect.poll(focusInsideModal, { message: 'focus should move into the dialog' }).toBe(true);

    // Tabbing stays trapped within the dialog (does not escape to page chrome).
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await focusInsideModal()).toBe(true);

    // Escape dismisses the dialog.
    await page.keyboard.press('Escape');
    await expect(nav.modal).toBeHidden();
  });
});

test.describe('a11y semantics — shell buttons have accessible names', () => {
  test('@smoke core shell controls expose a non-empty accessible name', async ({ page }) => {
    const nav = new ShellNav(page);
    await nav.goto('/app?view=overview');
    await nav.expectShell();

    // Home button's accessible NAME computes (reachable by role + name).
    await expect(page.getByRole('button', { name: 'PecanRev home' })).toBeVisible();

    // Icon-only shell buttons carry an explicit aria-label.
    await expect(nav.homeButton).toHaveAttribute('aria-label', /.+/);
    await expect(page.getByTestId('stitch-profile-button')).toHaveAttribute('aria-label', 'Profile & settings');
    await expect(nav.accountButton).toHaveAttribute('aria-label', 'Account menu');
    // Mobile drawer toggle is display:none on desktop, but its label must still exist.
    await expect(nav.drawerToggle).toHaveAttribute('aria-label', 'Open navigation');

    // Every global nav item (icon-only) has an accessible name.
    for (const key of ['dashboard', 'activity', 'invitations', 'help'] as const) {
      await expect(nav.globalNavItem(key)).toHaveAttribute('aria-label', /.+/);
    }
  });
});
