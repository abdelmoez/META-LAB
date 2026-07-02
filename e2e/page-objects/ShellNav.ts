/**
 * ShellNav.ts — the ONE shared page object for the Stitch chrome (the persistent
 * navigation + overlays every authenticated spec touches). Feature page objects
 * compose this; they never re-implement nav.
 *
 * Selectors are the stable data-testids added to the shell (shellParts.jsx,
 * StitchAppShell.jsx, StitchProjectRail.jsx, StitchWorkflowStepper.jsx) and the
 * overlay primitives (overlay.jsx). See PLAYWRIGHT_COVERAGE_MATRIX.md.
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoStitch, expectStitch } from '../helpers/stitch';

export class ShellNav {
  constructor(public readonly page: Page) {}

  // ── App chrome ─────────────────────────────────────────────────────────────
  get appShell(): Locator { return this.page.getByTestId('stitch-app-shell'); }
  get mainContent(): Locator { return this.page.getByTestId('stitch-main-content'); }
  get topHeader(): Locator { return this.page.getByTestId('stitch-top-header'); }
  get primaryRail(): Locator { return this.page.getByTestId('stitch-primary-rail'); }
  get homeButton(): Locator { return this.page.getByTestId('stitch-home-button'); }
  get contextRail(): Locator { return this.page.getByTestId('stitch-context-rail'); }
  get drawerToggle(): Locator { return this.page.getByTestId('stitch-drawer-toggle'); }

  globalNavItem(key: 'dashboard' | 'activity' | 'invitations' | 'help'): Locator {
    return this.page.getByTestId(`stitch-global-nav-item-${key}`);
  }

  // ── Account menu ─────────────────────────────────────────────────────────────
  get accountButton(): Locator { return this.page.getByTestId('stitch-account-button'); }
  get accountMenu(): Locator { return this.page.getByTestId('stitch-account-menu'); }
  accountMenuItem(key: 'profile' | 'theme' | 'ops-console' | 'signout'): Locator {
    return this.page.getByTestId(`stitch-account-menu-item-${key}`);
  }

  async openAccountMenu(): Promise<void> {
    if (await this.accountMenu.isVisible().catch(() => false)) return;
    await this.accountButton.click();
    await expect(this.accountMenu).toBeVisible();
  }

  async signOut(): Promise<void> {
    await this.openAccountMenu();
    await this.accountMenuItem('signout').click();
  }

  // ── Project workspace rail / stepper ─────────────────────────────────────────
  get projectRail(): Locator { return this.page.getByTestId('stitch-project-rail'); }
  get pinControl(): Locator { return this.page.getByTestId('stitch-pin-control'); }
  get backToProjects(): Locator { return this.page.getByTestId('stitch-back-to-projects'); }
  get workflowStepper(): Locator { return this.page.getByTestId('stitch-workflow-stepper'); }

  projectCategory(id: string): Locator { return this.page.getByTestId(`stitch-project-category-${id}`); }
  workflowStep(id: string): Locator { return this.page.getByTestId(`stitch-workflow-step-${id}`); }
  stepperStep(key: string): Locator { return this.page.getByTestId(`stitch-stepper-step-${key}`); }

  // ── Overlays ─────────────────────────────────────────────────────────────────
  get modal(): Locator { return this.page.getByTestId('stitch-modal'); }
  modalNamed(name: string): Locator { return this.page.locator(`[data-testid="stitch-modal"][data-modal="${name}"]`); }
  get modalTitle(): Locator { return this.page.getByTestId('stitch-modal-title'); }
  get modalClose(): Locator { return this.page.getByTestId('stitch-modal-close'); }
  get toast(): Locator { return this.page.getByTestId('stitch-toast'); }
  toastWithTone(tone: 'success' | 'error' | 'info' | 'warn'): Locator {
    return this.page.locator(`[data-testid="stitch-toast"][data-tone="${tone}"]`);
  }

  // ── Navigation helpers ───────────────────────────────────────────────────────
  /** Go to a path and assert the app rendered in Stitch (waits past pre-auth paint). */
  async goto(path = '/app'): Promise<void> { await gotoStitch(this.page, path); }

  async expectStitch(): Promise<void> { await expectStitch(this.page); }

  /** Assert the app chrome is mounted (a strong "we are authenticated in Stitch" signal). */
  async expectShell(): Promise<void> {
    await expect(this.appShell).toBeVisible();
    await expect(this.topHeader).toBeVisible();
  }
}
