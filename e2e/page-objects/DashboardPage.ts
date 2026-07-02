/**
 * DashboardPage.ts — the page object for the Stitch dashboard hub (route `/app`,
 * StitchDashboard.jsx). It composes the shared `ShellNav` chrome object and adds
 * the dashboard-specific surfaces: the white-column workspace MENU (view switcher),
 * the overview KPI metric cards, the project filters + search, the project grid
 * cards, the "Recently updated" bento and the empty states.
 *
 * Selector strategy (per e2e/.discovery/FOUNDATION.md + the dashboard-projects map):
 *   - The dashboard menu is an <aside aria-label="Dashboard menu"> → ARIA role
 *     `complementary` with accessible name "Dashboard menu". It is rendered as the
 *     shell's contextRail, OUTSIDE `stitch-main-content`.
 *   - Everything else (KPIs, filters, search, cards, empty states) lives inside
 *     `stitch-main-content`, so it is scoped to `nav.mainContent` to avoid ever
 *     matching the menu, the purple rail or the top header.
 *   - There are no per-element testids here yet (this pass adds none), so we scope by
 *     role + visible text. Project cards are counted via their unique "Open" button;
 *     card titles carry a `title` attribute that, within main, is exclusive to grid
 *     project cards (the version chip lives in the aside; recently-updated rows use a
 *     <strong> with no title attr).
 */
import { Page, Locator } from '@playwright/test';
import { ShellNav } from './ShellNav';

export type DashboardView =
  | 'overview' | 'mywork' | 'activity' | 'invitations' | 'archived' | 'resources';

/** The four overview KPI metric-card labels (StitchDashboard.jsx lines 424–427). */
export const KPI_LABELS = ['Active projects', 'Owned by you', 'Studies imported', 'Screening records'] as const;

/** The project-list filter chips, in render order (StitchDashboard FILTERS). */
export const FILTER_LABELS = ['All', 'Active', 'In progress', 'Completed', 'Owned by me'] as const;

/** The page-header (StitchPageHeader) <h1> text for each view. Overview is special;
 *  every other view renders VIEW_LABEL[view]. */
export const VIEW_HEADING: Record<DashboardView, RegExp> = {
  overview: /^Your research at a glance$/,
  mywork: /^My Work$/,
  activity: /^Activity$/,
  invitations: /^Invitations$/,
  archived: /^Archived Projects$/,
  resources: /^Resources$/,
};

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export class DashboardPage {
  readonly nav: ShellNav;
  constructor(public readonly page: Page) { this.nav = new ShellNav(page); }

  /** The fluid main workspace column (everything except the menu/rail/header). */
  get main(): Locator { return this.nav.mainContent; }

  // ── Navigation ───────────────────────────────────────────────────────────────
  /** Open a dashboard view by URL and assert Stitch rendered. Overview is the bare
   *  `/app` route (dashboardHref('overview') === '/app'); the rest carry `?view=`. */
  async open(view: DashboardView = 'overview'): Promise<void> {
    const path = view === 'overview' ? '/app' : `/app?view=${view}`;
    await this.nav.goto(path); // gotoStitch: navigates + asserts html[data-ui-design=stitch]
  }

  // ── Dashboard white-column MENU (the ?view= switcher) ────────────────────────
  /** The <aside aria-label="Dashboard menu"> (role=complementary). */
  get menu(): Locator { return this.page.getByRole('complementary', { name: 'Dashboard menu' }); }

  /** A menu item button by accessible name (string is exact; pass a RegExp for the
   *  badge-bearing "Invitations" item whose name may include a pending count). */
  menuItem(name: string | RegExp): Locator { return this.menu.getByRole('button', { name }); }

  async clickMenu(name: string | RegExp): Promise<void> { await this.menuItem(name).click(); }

  // ── Page header ──────────────────────────────────────────────────────────────
  /** The StitchPageHeader <h1> — the first level-1 heading in main (rendered before
   *  the per-view content), so `.first()` is always the page title. */
  get pageHeading(): Locator { return this.main.getByRole('heading', { level: 1 }).first(); }

  /** The header "New project" action (overview only). */
  get newProjectButton(): Locator { return this.main.getByRole('button', { name: 'New project' }); }

  // ── KPI metric cards (overview) ──────────────────────────────────────────────
  /** The StitchMetricCard whose label matches — resolved from the label span up to
   *  the card root (label span → header flex div → card div). */
  kpiCard(label: string): Locator {
    return this.main.getByText(label, { exact: true }).locator('xpath=ancestor::div[2]');
  }

  /** The numeric value shown on a KPI card (the only digits in the card's text). */
  async kpiValue(label: string): Promise<number> {
    const txt = await this.kpiCard(label).innerText();
    const digits = txt.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : NaN;
  }

  // ── Filters ──────────────────────────────────────────────────────────────────
  /** A filter chip button (name starts with its label; a trailing count follows). */
  filterButton(label: string): Locator {
    return this.main.getByRole('button', { name: new RegExp('^' + escapeRe(label)) });
  }

  async clickFilter(label: string): Promise<void> { await this.filterButton(label).click(); }

  /** The count badge baked into a filter chip (its trailing digits). */
  async filterCount(label: string): Promise<number> {
    const txt = await this.filterButton(label).innerText();
    const m = txt.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : NaN;
  }

  // ── Project search ───────────────────────────────────────────────────────────
  get searchInput(): Locator { return this.main.getByPlaceholder('Search projects'); }
  async search(text: string): Promise<void> { await this.searchInput.fill(text); }
  async clearSearch(): Promise<void> { await this.searchInput.fill(''); }

  // ── Project grid cards ───────────────────────────────────────────────────────
  /** One "Open" button per project card → a reliable count of visible cards. */
  get openButtons(): Locator { return this.main.getByRole('button', { name: 'Open', exact: true }); }
  async projectCount(): Promise<number> { return this.openButtons.count(); }

  /** Project card titles (a `[title]` attr is exclusive to grid cards within main). */
  get cardTitles(): Locator { return this.main.locator('[title]'); }
  /** Grid card titles whose text contains `name`. */
  cardTitle(name: string | RegExp): Locator { return this.cardTitles.filter({ hasText: name }); }

  // ── Recently-updated bento ───────────────────────────────────────────────────
  get recentlyUpdatedHeading(): Locator { return this.main.getByRole('heading', { name: 'Recently updated' }); }
  get viewActivityLink(): Locator { return this.main.getByRole('button', { name: /View activity/i }); }

  // ── Empty states ─────────────────────────────────────────────────────────────
  get noMatchEmpty(): Locator { return this.main.getByText('No matching projects'); }
  get noMatchDesc(): Locator { return this.main.getByText('Try a different filter or search term.'); }
  get noProjectsEmpty(): Locator { return this.main.getByText('No projects yet'); }
  get noArchivedEmpty(): Locator { return this.main.getByText('No archived projects'); }
}
