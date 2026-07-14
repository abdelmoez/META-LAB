/**
 * ProjectOverviewPage.ts — the page object for the Stitch dashboard + project
 * lifecycle surfaces owned by the `dashboard-projects` area:
 *   - the dashboard hub (`/app`, the `?view=` tabs) and its project list,
 *   - the create / rename / archive / restore / delete modals, and
 *   - the single-project overview (`/app/project/:id`).
 *
 * It COMPOSES the shared `ShellNav` (chrome + overlay primitives) rather than
 * re-implementing nav. Specs stay readable; all area-specific locator logic lives
 * here. Verified against the live source (StitchDashboard.jsx + the stitch
 * primitives), NOT only the discovery map — the map's `.stitch-card` selector is
 * stale (StitchCard emits `stitch-fade-in`), and these modals are the
 * `stitch-modal` testid but set NO `data-modal`, so we target them by title.
 *
 * Stable anchors used:
 *  - modal:        `stitch-modal` testid (ShellNav.modal) + its `stitch-modal-title`.
 *  - toast:        `stitch-toast` testid with `data-tone` (ShellNav.toastWithTone).
 *  - form inputs:  the real ids `#np-title`, `#np-desc`, `#rn`, `#del-confirm`.
 *  - project card: the title `<div title="<name>">` (getByTitle) → its enclosing
 *                  `.stitch-fade-in` card → the card's action buttons by aria-label.
 *  - overview:     the project name renders as the page `<h1>` (StitchPageHeader).
 */
import { Page, Locator, expect } from '@playwright/test';
import { ShellNav } from './ShellNav';

export class ProjectOverviewPage {
  readonly shell: ShellNav;

  constructor(public readonly page: Page) {
    this.shell = new ShellNav(page);
  }

  /* ── Navigation ──────────────────────────────────────────────────────────── */

  /** Open the dashboard hub (optionally a specific `?view=`) and assert Stitch. */
  async gotoDashboard(view?: 'overview' | 'mywork' | 'activity' | 'invitations' | 'archived' | 'resources'): Promise<void> {
    await this.shell.goto(view && view !== 'overview' ? `/app?view=${view}` : '/app');
  }

  /** Open a single project's overview tab and assert Stitch. */
  async gotoProjectOverview(projectId: string): Promise<void> {
    await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=overview`);
  }

  /* ── Dashboard overview chrome ───────────────────────────────────────────── */

  /** The "New project" CTA (header on overview; also the empty-state button). */
  get newProjectButton(): Locator { return this.page.getByRole('button', { name: 'New project' }).first(); }
  get searchInput(): Locator { return this.page.getByPlaceholder('Search projects…'); }
  kpiCard(label: string): Locator { return this.page.getByText(label, { exact: true }); }

  /* ── Project cards (located by their title attribute) ────────────────────── */

  /** The title element of a project card — carries `title="<full name>"`. */
  cardTitle(name: string): Locator { return this.page.getByTitle(name, { exact: true }); }

  /** A whole project card (the StitchCard `.stitch-fade-in` that holds the title). */
  card(name: string): Locator {
    return this.page.locator('.stitch-fade-in').filter({ has: this.cardTitle(name) });
  }

  openButton(name: string): Locator { return this.card(name).getByRole('button', { name: 'Open', exact: true }); }
  renameButton(name: string): Locator { return this.card(name).getByRole('button', { name: 'Rename', exact: true }); }
  archiveButton(name: string): Locator { return this.card(name).getByRole('button', { name: 'Archive', exact: true }); }
  restoreButton(name: string): Locator { return this.card(name).getByRole('button', { name: 'Restore', exact: true }); }
  deleteButton(name: string): Locator { return this.card(name).getByRole('button', { name: 'Delete', exact: true }); }

  /* ── Modal helpers (all reuse the shared overlay primitive) ──────────────── */

  /** A footer/body button inside the currently-open modal. */
  modalButton(name: string): Locator { return this.shell.modal.getByRole('button', { name, exact: true }); }
  /** Any `role="alert"` (StitchField error span) inside the open modal. */
  get modalError(): Locator { return this.shell.modal.getByRole('alert'); }

  // Real input ids wired by StitchInput/StitchTextarea.
  get createTitleInput(): Locator { return this.page.locator('#np-title'); }
  get createDescInput(): Locator { return this.page.locator('#np-desc'); }
  get renameInput(): Locator { return this.page.locator('#rn'); }
  get deleteConfirmInput(): Locator { return this.page.locator('#del-confirm'); }

  /* ── High-level flows ────────────────────────────────────────────────────── */

  /** Open the create-project modal and wait for it to be ready. */
  async openCreateModal(): Promise<void> {
    await this.newProjectButton.click();
    await expect(this.shell.modalTitle).toHaveText('New project');
    await expect(this.createTitleInput).toBeVisible();
  }

  /** Create a project through the UI. 83.md §1 — success navigates into the new
   *  project immediately, which unmounts the dashboard (and its toast container), so
   *  callers assert the outcome (URL / card) instead of this method waiting on a
   *  toast that may already be gone. */
  async createProjectViaUI(name: string, description?: string): Promise<void> {
    await this.openCreateModal();
    await this.createTitleInput.fill(name);
    if (description) await this.createDescInput.fill(description);
    await this.modalButton('Create project').click();
  }

  /** Open the rename modal for a card. */
  async openRenameModal(name: string): Promise<void> {
    await this.renameButton(name).click();
    await expect(this.shell.modalTitle).toHaveText('Rename project');
  }

  /** Open the delete modal for a card. */
  async openDeleteModal(name: string): Promise<void> {
    await this.deleteButton(name).click();
    await expect(this.shell.modalTitle).toHaveText('Delete project');
  }

  /* ── Assertion helpers ───────────────────────────────────────────────────── */

  /** A success toast carrying a specific message (toasts auto-dismiss after ~4s). */
  successToast(message: string): Locator {
    return this.shell.toastWithTone('success').filter({ hasText: message });
  }

  /** Assert the project-overview workspace (NOT the dashboard) is rendered.
   *  The project rail (`stitch-project-rail`) exists ONLY inside a project workspace,
   *  and carries `data-active-stage` — a stable, unambiguous signal that we left the
   *  dashboard and are on the overview stage. (`name` is implied by the caller's URL
   *  assertion on the project id.) */
  async expectOverviewRendered(_name?: string): Promise<void> {
    await this.shell.expectShell();
    await expect(this.shell.projectRail).toBeVisible();
    await expect(this.shell.projectRail).toHaveAttribute('data-active-stage', 'overview');
  }
}
