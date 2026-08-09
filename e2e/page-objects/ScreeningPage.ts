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

  /* ── Resume Screening (100.md §§12-15) ─────────────────────────────────────── */

  /** The bar at the top of the records panel; `data-status` carries the outcome. */
  get resumeBar(): Locator { return this.main.getByTestId('screening-resume-bar'); }
  /** "Continue where you left off" / "Start screening" / "Back to your open article". */
  get resumeButton(): Locator { return this.main.getByTestId('screening-resume-button'); }
  /** The §15 "you have completed screening for this stage" state. */
  get resumeComplete(): Locator { return this.main.getByTestId('screening-resume-complete'); }
  /** The one-line explanation of where resume landed you (and why). */
  get resumeNote(): Locator { return this.main.getByTestId('screening-resume-note'); }
  /** Every record row, in the server's canonical order (createdAt ASC, id ASC). */
  get rows(): Locator { return this.main.locator('[data-testid="screening-record-row"]'); }
  /** The currently selected record row (data-selected="true"). */
  get selectedRow(): Locator { return this.main.locator('[data-testid="screening-record-row"][data-selected="true"]'); }
  /** A record row by its record id. */
  rowById(recordId: string): Locator { return this.main.locator(`[data-record-id="${recordId}"]`); }

  /** The selected record's detail title (rendered as the middle-column heading). */
  detailHeading(title: string | RegExp): Locator {
    return this.main.getByRole('heading', { name: title });
  }

  /* ── Decision bar (middle column) ──────────────────────────────────────────── */

  /** 107.md §6 — the sticky decision row under the abstract; `data-decision` carries
   *  the reviewer's current decision (include | exclude | maybe | undecided). */
  get decisionBar(): Locator { return this.main.getByTestId('screening-decision-bar'); }
  get includeButton(): Locator { return this.main.getByRole('button', { name: /Include/i }); }
  get excludeButton(): Locator { return this.main.getByRole('button', { name: /Exclude/i }); }
  get maybeButton(): Locator { return this.main.getByRole('button', { name: /Maybe/i }); }
  get undoButton(): Locator { return this.main.getByRole('button', { name: /Undo/i }); }
  get notesTextarea(): Locator { return this.main.getByPlaceholder('Optional screening notes…'); }

  /* ── Keywords (107.md §2, 108.md §§18-21) ──────────────────────────────────────
   *  TWO surfaces show the same keyword and share one context menu:
   *    · `keywordRow`  — the ALWAYS-VISIBLE checkbox list in the right-hand filter
   *      panel. This is what a user means by "my keywords"; prefer it.
   *    · `keywordChip` — the editor chip, behind the leader-gated "✎ Edit keyword
   *      lists" accordion (`openKeywordEditor()` opens it).
   *  Both carry data-term / data-origin / data-list. */

  /** A keyword row in the right-column filter list (always visible). */
  keywordRow(term: string): Locator {
    return this.main.locator(`[data-testid="screening-keyword-row"][data-term="${term}"]`);
  }

  /** Every keyword row currently rendered (the list is collapsed to 8 + "Show more"). */
  get keywordRows(): Locator { return this.main.locator('[data-testid="screening-keyword-row"]'); }

  /** An editor chip (inside the leader-only keyword editor accordion). */
  keywordChip(term: string): Locator {
    return this.main.locator(`[data-testid="screening-keyword-chip"][data-term="${term}"]`);
  }

  get keywordChips(): Locator { return this.main.locator('[data-testid="screening-keyword-chip"]'); }

  /** The chip's × (the visible, non-right-click deletion route — 108.md §21/§25). */
  keywordChipRemove(term: string): Locator {
    return this.keywordChip(term).getByTestId('screening-keyword-chip-remove');
  }

  /** Expand the leader-only chip editor if it is not already open. */
  async openKeywordEditor(): Promise<void> {
    const toggle = this.main.getByRole('button', { name: /Edit keyword lists/ });
    if (await toggle.isVisible()) await toggle.click();
    await expect(this.main.getByRole('button', { name: /Hide keyword editor/ })).toBeVisible();
  }

  /** Expand EVERY keyword group — each previews only its first 8 terms, and a newly
   *  added term lands at the end of a ~28-item default list. */
  async expandKeywordGroups(): Promise<void> {
    const more = this.main.getByRole('button', { name: /Show more \(/ });
    // Re-query each round: clicking one swaps its own label to "Show less".
    for (let i = 0; i < 4 && await more.count() > 0; i += 1) await more.first().click();
  }

  /** The pointer-anchored context menu (108.md §18). */
  get keywordMenu(): Locator { return this.page.getByTestId('screening-keyword-menu'); }
  /** Prefer the role over the testid — e2e/README.md §"selectors". */
  get keywordMenuDelete(): Locator {
    return this.page.getByRole('menuitem', { name: /^Delete keyword/ });
  }

  /** Right-click a keyword and wait for PecanRev's own menu (never the browser's). */
  async openKeywordMenu(target: Locator): Promise<void> {
    await target.click({ button: 'right' });
    await expect(this.keywordMenu).toBeVisible();
  }

  /* ── Undo feedback (108.md §17) — the shared queued snackbar ──────────────────── */

  /** The single visible note. Rendered by the app-wide UndoFeedbackProvider. */
  get feedback(): Locator { return this.page.getByTestId('history-feedback'); }
  get snackbar(): Locator { return this.page.getByTestId('screening-keyword-snackbar'); }
  /** The snackbar's Undo button — the same history entry Ctrl+Z would run. */
  get snackbarUndo(): Locator { return this.page.getByTestId('screening-keyword-undo'); }

  /** Ctrl/Cmd+Z — page-scoped application undo. */
  async undo(): Promise<void> { await this.page.keyboard.press('ControlOrMeta+z'); }
  /** Ctrl/Cmd+Shift+Z — redo. */
  async redo(): Promise<void> { await this.page.keyboard.press('ControlOrMeta+Shift+z'); }

  /* ── Record navigation footer (107.md §7) ──────────────────────────────────── */

  get recordNav(): Locator { return this.main.getByTestId('screening-record-nav'); }
  /** The subtle "there is nothing after this study" line by the position counter. */
  get endOfList(): Locator { return this.main.getByTestId('screening-end-of-list'); }
  /** The inline "Loading more…" indicator shown while auto-pagination is in flight. */
  get loadingMore(): Locator { return this.main.getByTestId('screening-loading-more'); }
  /** The manual fallback that auto-pagination augments (never replaces). */
  get loadMoreButton(): Locator { return this.main.getByRole('button', { name: /Load more/ }); }

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
  // 97.md — the tab heading is now "Export screening data" (ExportTab.jsx).
  get exportHeading(): Locator { return this.main.getByRole('heading', { name: /Export screening data/i }); }
  /** The single-format "↓ Export…" button. Still unique under /Export/i: the 97.md
   *  ZIP button is named "↓ Download screening file (ZIP)" (no "export" in it). */
  get exportButton(): Locator { return this.main.getByRole('button', { name: /Export/i }); }
  /** 97.md headline action — the portable ZIP job button. */
  get zipDownloadButton(): Locator { return this.main.getByRole('button', { name: /Download screening file/i }); }

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
