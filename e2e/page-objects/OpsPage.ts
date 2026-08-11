/**
 * OpsPage.ts — page object for the Ops / Admin console at `/ops`.
 *
 * IMPORTANT: `/ops` renders the LEGACY chrome (ForceLegacyDesign), NOT the Stitch
 * shell — so the shared Stitch `ShellNav` page object does NOT apply here. The Ops
 * console has its own fixed sidebar (the `nav-*` buttons) and its own top bar. This
 * object owns all of that.
 *
 * Selectors are the stable data-testids already in AdminConsole.jsx:
 *   - Sidebar nav: `nav-{section}` for each section in OPS_SECTION_IDS.
 *   - Appearance tab: `appearance-hex-input`, `appearance-save`,
 *     `design-allow-all-toggle`, `design-default-mode` (a native <select>),
 *     `design-settings-save` (label "Save rollout", disabled until the rollout
 *     settings are dirty).
 *   - Flags tab: `flag-toggle-{key}` + the 109.md confirmation modal
 *     (`flags-confirm-modal`, `flags-reason`, `flags-confirm`, `flags-cancel`)
 *     and `flags-search`. NOTE: the whole-form `flags-save` button is GONE —
 *     each flag is now written on its own through PATCH /feature-flags/:key.
 *   - Research Governance: `rg-tab-{id}` sub-tabs, `rg-search-input`,
 *     `rg-setting-{catalogueKey}` rows, `rg-toggle-/rg-number-/rg-enum-{key}`
 *     controls, `rg-dup-health-badge`, `rg-requeue-{jobId}`.
 *   - Screening › Audit: `sift-audit-{project,action,entity,actor,from,to}`,
 *     `sift-audit-{prev,next,refresh}`.
 *   - Settings tab: `settings-appname`, `settings-defaulttheme`,
 *     `settings-registration`, `settings-save`.
 *   - Messages nav: `messages-unread-badge` (only when unread > 0).
 *
 * Per-section content is asserted via each section's stable <h2> heading (the
 * AdminConsole renders exactly one section at a time into the main panel).
 */
import { Page, Locator, expect } from '@playwright/test';

/**
 * The Ops sections in sidebar order. MUST stay in lockstep with NAV_SECTIONS in
 * src/frontend/pages/admin/opsSections.js AND the server-side allow-list in
 * getConsole (server/controllers/adminController.js) — tests/unit/opsSectionSync.test.js
 * fails the build if any of the three drift apart.
 */
export const OPS_SECTION_IDS = [
  'overview', 'users', 'onboarding', 'projects', 'sift',
  // 109.md §4 — one section (with sub-tabs) for the research control plane.
  'research',
  'rob',
  'searchProviders', 'waitlist', 'content', 'settings', 'style', 'flags',
  // 67.md + 66.md P5/P6 — product tiers, extraction-AI and living-review policy.
  'tiers', 'extractionAi', 'livingReviews',
  'messages',
  // 112.md follow-up — outbound email templates + delivery history.
  'email',
  // 113.md item 8 — read-only SEO console.
  'seo',
  'security', 'health', 'engineVersions',
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
    research: /Research Governance/i,
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
    email: /^Email$/i,
    seo: /^SEO$/i,
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
  // 109.md §§40-42 — a flag change is a per-key PATCH behind a confirmation modal
  // with an optional audit reason. There is no whole-form save any more.
  flagToggle(key: string): Locator { return this.page.getByTestId(`flag-toggle-${key}`); }
  get flagsConfirmModal(): Locator { return this.page.getByTestId('flags-confirm-modal'); }
  get flagsConfirm(): Locator { return this.page.getByTestId('flags-confirm'); }
  get flagsCancel(): Locator { return this.page.getByTestId('flags-cancel'); }
  get flagsReason(): Locator { return this.page.getByTestId('flags-reason'); }
  get flagsSearch(): Locator { return this.page.getByTestId('flags-search'); }

  /** Flip a flag through the confirmation modal (the only supported UI path). */
  async setFlag(key: string, reason?: string): Promise<void> {
    await this.flagToggle(key).click();
    await expect(this.flagsConfirmModal).toBeVisible({ timeout: 10000 });
    if (reason) await this.flagsReason.fill(reason);
    await this.flagsConfirm.click();
    await expect(this.flagsConfirmModal).toHaveCount(0, { timeout: 15000 });
  }

  // ── Research Governance section (109.md §4) ─────────────────────────────────
  researchTab(id: 'duplicates' | 'keywords' | 'extraction' | 'interaction' | 'errors'): Locator {
    return this.page.getByTestId(`rg-tab-${id}`);
  }
  get researchSearch(): Locator { return this.page.getByTestId('rg-search-input'); }
  get researchSearchResults(): Locator { return this.page.getByTestId('rg-search-results'); }
  get researchReset(): Locator { return this.page.getByTestId('rg-reset'); }
  get dupHealthBadge(): Locator { return this.page.getByTestId('rg-dup-health-badge'); }
  /** A catalogue row, by its stable catalogue key (e.g. 'interaction.historyCap'). */
  rgSetting(key: string): Locator { return this.page.getByTestId(`rg-setting-${key}`); }
  rgToggle(key: string): Locator { return this.page.getByTestId(`rg-toggle-${key}`); }
  rgNumber(key: string): Locator { return this.page.getByTestId(`rg-number-${key}`); }
  rgEnum(key: string): Locator { return this.page.getByTestId(`rg-enum-${key}`); }

  /** Open a Research Governance sub-tab and wait for its first card to mount. */
  async openResearchTab(id: 'duplicates' | 'keywords' | 'extraction' | 'interaction' | 'errors'): Promise<void> {
    await this.researchTab(id).click();
  }

  // ── Email section (112.md follow-up) ─────────────────────────────────────────
  emailTab(id: 'templates' | 'delivery'): Locator { return this.page.getByTestId(`em-tab-${id}`); }
  get emailTemplatesTable(): Locator { return this.page.getByTestId('em-templates-table'); }
  emailTemplateRow(key: string): Locator { return this.page.getByTestId(`em-template-row-${key}`); }
  emailEdit(key: string): Locator { return this.page.getByTestId(`em-edit-${key}`); }
  get emailEditor(): Locator { return this.page.getByTestId('em-editor'); }
  emailVarChip(name: string): Locator { return this.page.getByTestId(`em-var-${name}`); }
  get emailPreviewButton(): Locator { return this.page.getByTestId('em-preview-btn'); }
  get emailPreviewFrame(): Locator { return this.page.getByTestId('em-preview-frame'); }
  get emailEnabledToggle(): Locator { return this.page.getByTestId('em-enabled-toggle'); }
  get emailDeliveryTable(): Locator { return this.page.getByTestId('em-delivery-table'); }
  get emailDeliveryFilterStatus(): Locator { return this.page.getByTestId('em-delivery-filter-status'); }
  get emailDeliveryFilterTemplate(): Locator { return this.page.getByTestId('em-delivery-filter-template'); }

  /** Open an Email sub-tab. */
  async openEmailTab(id: 'templates' | 'delivery'): Promise<void> {
    await this.emailTab(id).click();
  }

  // ── SEO section (113.md item 8) ──────────────────────────────────────────────
  // READ-ONLY console. `seo-live-run` reaches the PUBLIC origin over the network,
  // so specs assert that the button exists — never what the internet answered.
  seoTab(id: 'repository' | 'live' | 'analytics'): Locator { return this.page.getByTestId(`seo-tab-${id}`); }
  get seoInventoryTable(): Locator { return this.page.getByTestId('seo-inventory-table'); }
  get seoChecksList(): Locator { return this.page.getByTestId('seo-checks'); }
  seoCheck(id: string): Locator { return this.page.getByTestId(`seo-check-${id}`); }
  get seoLiveRun(): Locator { return this.page.getByTestId('seo-live-run'); }
  get seoLiveScope(): Locator { return this.page.getByTestId('seo-live-scope'); }
  get seoVerification(): Locator { return this.page.getByTestId('seo-verification'); }
  get seoAnalyticsTable(): Locator { return this.page.getByTestId('seo-analytics-table'); }
  get seoAnalyticsScope(): Locator { return this.page.getByTestId('seo-analytics-scope'); }

  /** Open an SEO sub-tab. */
  async openSeoTab(id: 'repository' | 'live' | 'analytics'): Promise<void> {
    await this.seoTab(id).click();
  }

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
