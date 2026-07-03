/**
 * OpsPage.ts — page object for the Ops / Admin console at `/ops`.
 *
 * IMPORTANT: `/ops` renders the LEGACY chrome (ForceLegacyDesign), NOT the Stitch
 * shell — so the shared Stitch `ShellNav` page object does NOT apply here. The Ops
 * console has its own fixed sidebar (the `nav-*` buttons) and its own top bar. This
 * object owns all of that.
 *
 * Selectors are the stable data-testids already in AdminConsole.jsx:
 *   - Sidebar nav: `nav-{section}` for each of the 16 sections.
 *   - Appearance tab: `appearance-hex-input`, `appearance-save`,
 *     `design-allow-all-toggle`, `design-default-mode` (a native <select>),
 *     `design-settings-save` (label "Save rollout", disabled until the rollout
 *     settings are dirty).
 *   - Flags tab: `flag-toggle-{key}`, `flags-save`.
 *   - Settings tab: `settings-appname`, `settings-defaulttheme`,
 *     `settings-registration`, `settings-save`.
 *   - Messages nav: `messages-unread-badge` (only when unread > 0).
 *
 * Per-section content is asserted via each section's stable <h2> heading (the
 * AdminConsole renders exactly one section at a time into the main panel).
 */
import { Page, Locator, expect } from '@playwright/test';

/** The 16 Ops sections in sidebar order (NAV_SECTIONS in AdminConsole.jsx). */
export const OPS_SECTION_IDS = [
  'overview', 'users', 'onboarding', 'projects', 'sift', 'rob',
  'searchProviders', 'waitlist', 'content', 'settings', 'style', 'flags',
  // 66.md P5/P6 + 67.md — extraction-AI, living-review policy, product tiers.
  'extractionAi', 'livingReviews', 'tiers',
  'messages', 'security', 'health', 'engineVersions',
] as const;

export type OpsSectionId = (typeof OPS_SECTION_IDS)[number];

/** Sections a `mod` (non-admin staff) is allowed to see (MOD_SECTIONS server-side). */
export const MOD_SECTION_IDS: OpsSectionId[] = ['users', 'messages'];

export class OpsPage {
  constructor(public readonly page: Page) {}

  /** The stable <h2> heading each section renders (one section is mounted at a time). */
  private static readonly HEADINGS: Record<OpsSectionId, RegExp> = {
    overview: /Platform Overview/i,
    users: /^Users$/i,
    onboarding: /^Onboarding$/i,
    projects: /^Projects$/i,
    sift: /Screening/i,
    rob: /Risk of Bias/i,
    searchProviders: /Pecan Search Engine — Providers/i,
    waitlist: /Beta Waitlist/i,
    content: /Website Content Editor/i,
    settings: /App Settings/i,
    style: /^Appearance$/i,
    flags: /Feature Flags/i,
    extractionAi: /Extraction Assist/i,
    livingReviews: /Living Reviews/i,
    tiers: /^Tiers$/i,
    messages: /Contact Messages/i,
    security: /Security/i,
    health: /System Health/i,
    engineVersions: /Engine Versions/i,
  };

  // ── Sidebar nav ──────────────────────────────────────────────────────────────
  nav(id: OpsSectionId | string): Locator { return this.page.getByTestId(`nav-${id}`); }

  /** The section's top <h2> (the strongest "this section actually rendered" signal). */
  sectionHeading(id: OpsSectionId): Locator {
    return this.page.getByRole('heading', { name: OpsPage.HEADINGS[id] }).first();
  }

  get messagesUnreadBadge(): Locator { return this.page.getByTestId('messages-unread-badge'); }

  // ── Appearance ('style') tab ─────────────────────────────────────────────────
  get appearanceHexInput(): Locator { return this.page.getByTestId('appearance-hex-input'); }
  get appearanceSave(): Locator { return this.page.getByTestId('appearance-save'); }
  // 65.md — the retired allow-all toggle was replaced by the legacy-fallback
  // control (Stitch is the product default; legacy is the Ops-governed escape).
  get designLegacyFallbackToggle(): Locator { return this.page.getByTestId('design-legacy-fallback-toggle'); }
  get designDefaultMode(): Locator { return this.page.getByTestId('design-default-mode'); }
  get designSettingsSave(): Locator { return this.page.getByTestId('design-settings-save'); }

  // ── Flags tab ────────────────────────────────────────────────────────────────
  flagToggle(key: string): Locator { return this.page.getByTestId(`flag-toggle-${key}`); }
  get flagsSave(): Locator { return this.page.getByTestId('flags-save'); }

  // ── Settings tab ─────────────────────────────────────────────────────────────
  get settingsAppName(): Locator { return this.page.getByTestId('settings-appname'); }
  get settingsDefaultTheme(): Locator { return this.page.getByTestId('settings-defaulttheme'); }
  get settingsRegistration(): Locator { return this.page.getByTestId('settings-registration'); }
  get settingsSave(): Locator { return this.page.getByTestId('settings-save'); }

  // ── Navigation ───────────────────────────────────────────────────────────────
  /**
   * Load /ops and wait for the console sidebar to mount. `nav-users` is present for
   * BOTH admin and mod, so it is a role-agnostic "console loaded" signal. We do NOT
   * assert the Stitch design attribute here — /ops is always legacy.
   */
  async goto(): Promise<void> {
    await this.page.goto('/ops', { waitUntil: 'domcontentloaded' });
    await expect(this.nav('users')).toBeVisible({ timeout: 20000 });
  }

  /** Click a section's nav button and wait for that section's heading to render. */
  async openSection(id: OpsSectionId): Promise<void> {
    await this.nav(id).click();
    await expect(this.sectionHeading(id)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Open the Appearance tab, but FIRST arm a waiter for the design-settings GET so
   * the `design-default-mode` <select> is guaranteed to hold the server's current
   * value before any test interacts with it (it loads asynchronously after mount).
   */
  async openAppearance(): Promise<void> {
    const designLoaded = this.page
      .waitForResponse(
        (r) => r.url().includes('/api/admin/design-settings') && r.request().method() === 'GET',
        { timeout: 15000 },
      )
      .catch(() => null); // tolerate an already-fired / proxied response; the poll below still gates
    await this.nav('style').click();
    await designLoaded;
    await expect(this.sectionHeading('style')).toBeVisible({ timeout: 15000 });
  }

  /** Assert a nav button is the active/selected tab (active = fontWeight 600, inactive = 400). */
  async expectNavActive(id: OpsSectionId): Promise<void> {
    await expect(this.nav(id)).toHaveCSS('font-weight', '600');
  }
}
