/**
 * ScreeningPage.ts — page object for the Screening engine (META·SIFT) as it is
 * embedded in the unified Stitch workspace at `/app/project/:id?tab=screening`.
 *
 * The screening engine reads its OWN sub-page from the collision-free `?screen=`
 * param (`overview | import | duplicates | screening | conflicts | second-review |
 * control | export`); the host workspace owns `?tab=`. The white vertical submenu
 * stepper (StitchWorkflowStepper) is the sole screening navigation in Stitch and
 * exposes the stable `stitch-stepper-step-<key>` testids (with `data-status` +
 * `data-disabled` on the numbered pipeline steps).
 *
 * This COMPOSES the shared `ShellNav` for chrome; only screening-specific locator
 * logic lives here. Selectors are verified against the live source:
 *   - workbench (ScreeningTab.jsx): search `getByPlaceholder('Search title, author,
 *     DOI…')`, the left-column status `<select>` (uniquely lists "Quorum / 2nd
 *     review"), the record list container `.sift-rl`, the decision bar buttons
 *     ("✓ Include" / "✗ Exclude" / "? Maybe" / "↩ Undo"), the notes textarea, and
 *     the "<n> / 2 reviewers included" quorum line.
 *   - the sub-step testids are scoped to the DESKTOP submenu (`.stitch-wsnav-sub`)
 *     because the same StitchProjectSubnav is ALSO rendered inside the (closed)
 *     mobile drawer — scoping avoids a strict-mode double match.
 */
import { Page, Locator, expect } from '@playwright/test';
import { ShellNav } from './ShellNav';

export type ScreenKey =
  | 'overview' | 'import' | 'duplicates' | 'screening'
  | 'conflicts' | 'second-review' | 'control' | 'export';

/** The numbered pipeline steps (carry `data-status`); utility rows do not. */
export const PIPELINE_STEPS: ScreenKey[] = ['import', 'duplicates', 'screening', 'conflicts', 'second-review'];

export class ScreeningPage {
  readonly shell: ShellNav;

  constructor(public readonly page: Page) {
    this.shell = new ShellNav(page);
  }

  /* ── Navigation ──────────────────────────────────────────────────────────── */

  /** Build the workspace URL for a main project's screening stage (+ sub-page). */
  url(projectId: string, screen?: ScreenKey): string {
    const base = `/app/project/${encodeURIComponent(projectId)}?tab=screening`;
    return screen && screen !== 'overview' ? `${base}&screen=${screen}` : base;
  }

  /** Open the screening stage (optionally a sub-page) and assert Stitch chrome. */
  async goto(projectId: string, screen?: ScreenKey): Promise<void> {
    await this.shell.goto(this.url(projectId, screen));
    await this.shell.expectShell();
  }

  /** Open the Title & Abstract workbench and wait until its record list is ready. */
  async openWorkbench(projectId: string): Promise<void> {
    await this.goto(projectId, 'screening');
    await expect(this.searchInput).toBeVisible();
  }

  /* ── White submenu sub-stepper (scoped to the visible desktop submenu) ─────── */

  /** The desktop coordinated-nav submenu column that hosts the screening stepper. */
  get subnav(): Locator { return this.page.locator('.stitch-wsnav-sub'); }

  /** A screening sub-step button in the white submenu (stable testid). */
  step(key: ScreenKey | 'prisma'): Locator {
    return this.subnav.getByTestId(`stitch-stepper-step-${key}`);
  }

  /** Click a sub-step and wait for the URL `?screen=` to reflect it. */
  async clickStep(key: ScreenKey): Promise<void> {
    await this.step(key).click();
    await this.page.waitForURL(new RegExp(`[?&]screen=${key}(?:&|$)`));
  }

  /* ── Workbench (ScreeningTab) — scoped to the main content area ─────────────── */

  get main(): Locator { return this.shell.mainContent; }

  /** Debounced title/author/DOI search input (left-column header). */
  get searchInput(): Locator { return this.main.getByPlaceholder('Search title, author, DOI…'); }

  /** The left-column status filter — the only <select> listing "Quorum / 2nd review". */
  get filterSelect(): Locator {
    return this.main.locator('select').filter({ hasText: 'Quorum / 2nd review' });
  }

  /** The scrollable record-list container (left column). */
  get recordList(): Locator { return this.main.locator('.sift-rl'); }

  /** A record row in the list, located by (part of) its title. */
  recordRow(title: string | RegExp): Locator { return this.recordList.getByText(title); }

  /** The "<n> / <total> RECORDS" mono counter in the left-column header. */
  get recordCounter(): Locator { return this.main.getByText(/\d+ \/ \d+ RECORDS?/); }

  /** The empty state shown when a search/filter matches nothing. */
  get noMatchEmptyState(): Locator { return this.main.getByText('No records match the current filter.'); }

  /** The selected record's detail title (rendered as the middle-column heading). */
  detailHeading(title: string | RegExp): Locator {
    return this.main.getByRole('heading', { name: title });
  }

  /* ── Decision bar (middle column) ──────────────────────────────────────────── */

  get includeButton(): Locator { return this.main.getByRole('button', { name: /Include/i }); }
  get excludeButton(): Locator { return this.main.getByRole('button', { name: /Exclude/i }); }
  get maybeButton(): Locator { return this.main.getByRole('button', { name: /Maybe/i }); }
  get undoButton(): Locator { return this.main.getByRole('button', { name: /Undo/i }); }
  get notesTextarea(): Locator { return this.main.getByPlaceholder('Optional screening notes…'); }

  /** The "<n> / 2 reviewers included" quorum line (count is server-backed). */
  reviewersIncluded(n: number): Locator {
    return this.main.getByText(new RegExp(`${n} / 2 reviewers included`));
  }

  /* ── Sub-view anchors (each proves the right screen rendered) ───────────────── */

  get overviewTotalArticles(): Locator { return this.main.getByText('Total Articles', { exact: true }); }
  get importHeading(): Locator { return this.main.getByText('Import References'); }
  get detectDuplicatesButton(): Locator { return this.main.getByRole('button', { name: /Detect Duplicates/i }).first(); }
  get conflictsHeading(): Locator { return this.main.getByRole('heading', { name: /Conflict Resolution/i }); }
  // "Final Review" itself is a plain <div> (not a heading); anchor on the unique,
  // always-rendered banner sentence instead.
  get finalReviewHeading(): Locator { return this.main.getByText(/Records that reached inclusion quorum/); }
  get exportHeading(): Locator { return this.main.getByRole('heading', { name: /Export Data/i }); }
  get exportButton(): Locator { return this.main.getByRole('button', { name: /Export/i }); }

  /* ── AI surfaces (gated >= 50 screened decisions) ──────────────────────────── */

  get aiWhyScoreToggle(): Locator { return this.main.getByRole('button', { name: /Why this score/i }); }

  /* ── Composite assertions ──────────────────────────────────────────────────── */

  /** Assert the six pipeline+export sub-steps are present in the submenu stepper. */
  async expectStepperPresent(): Promise<void> {
    for (const key of [...PIPELINE_STEPS, 'export'] as ScreenKey[]) {
      await expect(this.step(key)).toBeVisible();
    }
  }
}
