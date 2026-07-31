/**
 * SearchPage.ts — the page object for the `search-protocol` area: the Protocol/PICO
 * tab, the STAGED Search workspace (96.md — 7 stages: Research Question → Terms &
 * Vocabulary → Search Mode → Database Strategies → Results → Documentation → Send to
 * Screening), and the embedded Pecan "Search & Discovery" run surface.
 *
 * 96.md retired the legacy 3-step SearchWizard and the separate Concepts / Test &
 * Refine stages: the workspace renders whenever `searchEngine` is ON (no
 * searchWorkspaceV2 flag flip needed any more), phrase selection lives on the
 * research-question card at the top of Terms & Vocabulary (`sb-question-card`), and
 * concept groups are created by clicking question tokens or the manual add box.
 *
 * It COMPOSES the shared `ShellNav` (chrome + overlays) rather than re-implementing
 * nav. Locators are verified against the live source:
 *
 *  - PICO tab (`?tab=pico`, serverBackedWorkflowState ON → ProtocolModulePanel):
 *      SectionHeader renders an `<h2>Research Question & PICO</h2>`; the question +
 *      P/I/C/O textareas + PROSPERO input are matched by their `e.g. …` placeholders;
 *      the server-backed StatusPill text ("Server-backed"/"Saving…"/"Saved") proves
 *      the module (not the legacy in-blob PICOTab) rendered. (Protocol keeps PICO —
 *      96.md removed it from the SEARCH engine only.)
 *  - Staged workspace (`?tab=search`): stage surface `search-workspace-stage`
 *      (data-stage), side-menu stepper / in-body rail union (`stageNav`), the
 *      question EDITOR on the question stage (`search-question-editor`), and the
 *      Terms & Vocabulary master-detail (navigator, active concept, chips, preview,
 *      Database previews, drift banner, group actions).
 *
 * Tab-content locators are scoped to the workspace tool body (`.stitch-tool-body`)
 * so they never collide with the persistent nav / context rail.
 */
import { Page, Locator, expect } from '@playwright/test';
import { ShellNav } from './ShellNav';

/** Distinctive placeholder fragments for the PICO textareas (case-sensitive on
 *  purpose: the P/C placeholders use Capitalised forms the research-question
 *  example does not, so these match exactly one field each). */
const PICO_PLACEHOLDER: Record<'P' | 'I' | 'C' | 'O', RegExp> = {
  P: /Type 2 diabetes, diagnosed/,
  I: /SGLT2 inhibitor added to metformin/,
  C: /Metformin alone, placebo/,
  O: /MACE; HbA1c reduction/,
};

export class SearchPage {
  readonly shell: ShellNav;

  constructor(public readonly page: Page) {
    this.shell = new ShellNav(page);
  }

  /** The workspace tool body — scopes all tab-content locators. Present in BOTH the
   *  carded (pico/prospero) and full-bleed (search) layouts: StitchProjectWorkspace
   *  keeps the `stitch-tool-body` class on the tool-body wrapper regardless of
   *  full-bleed, so the search stage's content is scopable here too. */
  private get body(): Locator { return this.page.locator('.stitch-tool-body'); }

  /* ── Navigation ──────────────────────────────────────────────────────────── */

  async gotoPico(projectId: string): Promise<void> {
    await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=pico`);
  }
  async gotoSearch(projectId: string): Promise<void> {
    await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=search`);
  }
  async gotoProspero(projectId: string): Promise<void> {
    await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=prospero`);
  }

  /* ── Protocol / PICO (server-backed ProtocolModulePanel) ─────────────────── */

  get picoHeading(): Locator { return this.body.getByRole('heading', { name: /Research Question & PICO/i }); }
  get researchQuestion(): Locator { return this.body.getByPlaceholder(/adding an SGLT2 inhibitor to metformin/i); }
  picoField(key: 'P' | 'I' | 'C' | 'O'): Locator { return this.body.getByPlaceholder(PICO_PLACEHOLDER[key]); }
  get prosperoIdInput(): Locator { return this.body.getByPlaceholder(/CRD42024/); }
  /** The server-backed status pill (absent from the legacy in-blob PICOTab). */
  get serverBackedPill(): Locator { return this.body.getByText('Server-backed', { exact: true }); }

  /** Wait until the PICO module has loaded and its question field is editable. */
  async waitForPicoReady(): Promise<void> {
    await expect(this.picoHeading).toBeVisible();
    await expect(this.researchQuestion).toBeEditable();
  }

  /* ── Staged workspace chrome ─────────────────────────────────────────────── */

  get workspaceHeading(): Locator { return this.body.getByRole('heading', { name: 'Pecan Search Engine', exact: true }); }

  /* ── 74.md/75.md — the staged Search Workspace's stage navigation ──────────────
     75.md moved the numbered Search workflow into the WHITE project side-menu (the
     shared `stitch-workflow-stepper`): under the Stitch shell the in-body StageRail
     (`search-workspace-rail`) is HIDDEN (`hideRail` from StitchProjectWorkspace) and
     the side-menu stepper drives stages via `?tab=search&stage=<id>` links. A non-
     Stitch / hideRail=false mount still renders the in-body rail. EXACTLY ONE of the
     two is present at a time, so this union locator drives whichever the shell shows,
     and both restructure identically on a mode switch (both derive from `stagesFor`). */
  get stageNav(): Locator {
    return this.page.locator('[data-testid="stitch-workflow-stepper"], [data-testid="search-workspace-rail"]');
  }
  /** A stage pip by (partial) label, in whichever navigation surface is present. */
  stageStep(name: RegExp | string): Locator {
    return this.stageNav.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });
  }
  /** The staged workspace's stage surface — present in BOTH shells once the staged
   *  workspace is mounted; `data-stage` carries the active stage id. */
  get stageSurface(): Locator { return this.page.getByTestId('search-workspace-stage'); }

  /** Open ?tab=search and wait for the STAGED workspace. The dispatcher reads
   *  /api/settings/public once per mount, so retry the navigation until the flag
   *  state has propagated. */
  async openStagedWorkspace(projectId: string): Promise<void> {
    await expect(async () => {
      await this.gotoSearch(projectId);
      await expect(this.stageSurface).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** Deep-link a specific staged Search stage (`?tab=search&stage=<id>`), retrying
   *  while flags propagate until the stage surface reports the requested stage. */
  async gotoStage(projectId: string, stageId: string): Promise<void> {
    await expect(async () => {
      await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=search&stage=${encodeURIComponent(stageId)}`);
      await expect(this.stageSurface).toHaveAttribute('data-stage', stageId, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /* ── 96.md D1 — the Research Question stage EDITOR ───────────────────────── */

  get questionEditor(): Locator { return this.body.getByTestId('search-question-editor'); }

  /** Write the research question on the question stage (whole-project autosave).
   *  96.md QA — the editor commits through TWO debounces (a 500ms local-draft
   *  commit to updNested, then the ~800ms whole-project autosave PUT), so a
   *  navigation right after fill() used to race the save and land on Terms with
   *  an EMPTY question (no clickable tokens). Blur to flush the local commit,
   *  then poll the server until pico.question matches before returning. */
  async setQuestion(projectId: string, text: string): Promise<void> {
    await this.gotoStage(projectId, 'question');
    await expect(this.questionEditor).toBeVisible();
    await this.questionEditor.fill(text);
    await expect(this.questionEditor).toHaveValue(text);
    await this.questionEditor.blur(); // flush the local-draft commit immediately
    await expect
      .poll(async () => {
        const r = await this.page.request.get(`/api/projects/${encodeURIComponent(projectId)}`);
        if (!r.ok()) return null;
        const b = await r.json().catch(() => null);
        return (b && b.pico && b.pico.question) || '';
      }, { timeout: 20_000, message: 'research question never persisted to the project' })
      .toBe(text);
  }

  /**
   * Wait until the builder's DEBOUNCED autosave (800ms) has actually landed the
   * strategy on the server. Any spec that mutates the strategy and then hard-
   * navigates (page.goto) MUST call this first — navigation destroys the page
   * before the debounce fires, silently losing the mutation (the exact race that
   * made the drift journey flake). Polls the same API the builder saves to.
   */
  async awaitStrategySaved(projectId: string, minConcepts = 1): Promise<void> {
    await expect
      .poll(async () => {
        const r = await this.page.request.get(`/api/search-builder/${encodeURIComponent(projectId)}`);
        if (!r.ok()) return -1;
        const b = await r.json().catch(() => null);
        return b && Array.isArray(b.concepts) ? b.concepts.length : 0;
      }, { timeout: 20_000, message: `strategy never autosaved (< ${minConcepts} concepts on the server)` })
      .toBeGreaterThanOrEqual(minConcepts);
  }

  /* ── 96.md D13 — Terms & Vocabulary: the central workspace ───────────────── */

  /** The research-question phrase-selection card at the top of Terms & Vocabulary. */
  get questionCard(): Locator { return this.body.getByTestId('sb-question-card'); }
  /** A clickable question token/phrase (aria-pressed carries the selected state). */
  phraseToken(text: string | RegExp): Locator {
    return this.questionCard.getByRole('button', { name: text });
  }
  /** The manual "add a concept" box on the question card. */
  get addConceptInput(): Locator { return this.questionCard.getByLabel('Add a concept group manually'); }
  /** Create a concept group from arbitrary text (label = sourcePhrase = text). */
  async addConceptGroup(text: string): Promise<void> {
    await expect(this.addConceptInput).toBeVisible();
    await this.addConceptInput.fill(text);
    await this.addConceptInput.press('Enter');
  }

  /** The "question changed" drift banner (96.md D2 — never auto-deletes). */
  get driftBanner(): Locator { return this.body.getByTestId('sb-drift-banner'); }
  /** The active group's management toolbar (reorder / merge / split / delete). */
  get groupActions(): Locator { return this.body.getByTestId('sb-group-actions'); }
  get splitPanel(): Locator { return this.body.getByTestId('sb-split-panel'); }
  /** The compiled per-database preview cards inside Terms & Vocabulary. */
  get dbPreviews(): Locator { return this.body.getByTestId('sb-db-previews'); }

  /** Terms stage — master-detail surfaces. */
  get conceptNavigator(): Locator { return this.body.getByTestId('sb-concept-navigator'); }
  navigatorPill(name: string): Locator {
    return this.conceptNavigator.getByRole('tab', { name: new RegExp(name, 'i') });
  }
  get activeConcept(): Locator { return this.body.getByTestId('sb-active-concept'); }
  get addTermInput(): Locator { return this.body.getByTestId('sb-add-term-input'); }
  get addTermButton(): Locator { return this.body.getByTestId('sb-add-term-btn'); }
  get addStatusLine(): Locator { return this.body.getByTestId('sb-add-status'); }
  /** A term chip's EDIT button (the whole chip) inside the active concept. EXACT so a
   *  free-text term never aliases a longer subject-heading descriptor that contains it
   *  as a substring (e.g. "heart failure" vs "Heart Failure, Diastolic"); the chip's
   *  accessible name is exactly `Edit <text>` (aria-label overrides the inner text). */
  termChip(term: string): Locator {
    return this.activeConcept.getByRole('button', { name: `Edit ${term}`, exact: true });
  }
  /** A term chip's separate remove button (pinned aria contract; EXACT — see termChip). */
  termChipRemove(term: string): Locator {
    return this.activeConcept.getByRole('button', { name: `Remove ${term}`, exact: true });
  }
  get termEditor(): Locator { return this.body.getByTestId('sb-term-editor'); }
  get suggestionsArea(): Locator { return this.body.getByTestId('sb-suggestions'); }
  suggestionRow(text: string): Locator {
    return this.body.getByTestId('sb-suggestion-row').filter({ hasText: text });
  }
  get strategyPreview(): Locator { return this.body.getByTestId('sb-strategy-preview'); }
  get saveStatus(): Locator { return this.body.getByTestId('sb-save-status').first(); }
  /** The undo snackbar is portaled-fixed at the page level (not body-scoped). */
  get undoSnackbar(): Locator { return this.page.getByTestId('sb-undo'); }

  /** Type into the active concept's add box and commit with the explicit Add button. */
  async addTermToActiveConcept(term: string): Promise<void> {
    await expect(this.addTermInput).toBeVisible();
    await this.addTermInput.fill(term);
    await this.addTermButton.click();
  }

  /* ── Database Strategies stage / Terms estimates ─────────────────────────── */

  get estimateButton(): Locator { return this.body.getByRole('button', { name: /Estimate results|Refresh estimates|Estimating/i }); }
  get estimatesCard(): Locator { return this.body.getByText(/Estimated results per database/i); }
  /** The PreviewEstimates degraded note shown ONLY when Search & Discovery is off. */
  get pecanDisabledNote(): Locator { return this.body.getByText(/enable it in Ops/i); }
  /** A Database Strategies anchor present regardless of the Pecan flag. */
  get databasePicker(): Locator { return this.body.getByText(/Pick the databases you plan to search/i); }

  /* ── Results stage (PecanSearchTab) ──────────────────────────────────────── */

  get pecanHeading(): Locator { return this.body.getByRole('heading', { name: /Run search — Pecan Search Engine/i }); }
  /** The Run-disabled note — present ONLY when pecanSearch is off. */
  get pecanRunDisabledNote(): Locator { return this.body.getByText(/enable the Pecan Search Engine — Automated Run in the Ops console/i); }

  /* ── Protocol / PROSPERO ─────────────────────────────────────────────────── */

  get prosperoHeading(): Locator { return this.body.getByRole('heading', { name: /Protocol \(PROSPERO\)/i }); }
  get generateDraftButton(): Locator { return this.body.getByRole('button', { name: /Generate draft/i }); }
}
