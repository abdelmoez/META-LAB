/**
 * SearchPage.ts — the page object for the `search-protocol` area: the Protocol/PICO
 * tab, the unified 3-step Search wizard (Define → Build → Run), and the embedded
 * Pecan "Search & Discovery" run surface.
 *
 * It COMPOSES the shared `ShellNav` (chrome + overlays) rather than re-implementing
 * nav. Locators are verified against the live source, not just the discovery map
 * (the map's `bestSelector`s for PICO P/I/C/O lean on `getByLabelText`, but those
 * `<label>`s are NOT wired with `htmlFor`, so we target the textareas by their
 * stable placeholder text instead):
 *
 *  - PICO tab (`?tab=pico`, serverBackedWorkflowState ON → ProtocolModulePanel):
 *      SectionHeader renders an `<h2>Research Question & PICO</h2>`; the question +
 *      P/I/C/O textareas + PROSPERO input are matched by their `e.g. …` placeholders;
 *      the server-backed StatusPill text ("Server-backed"/"Saving…"/"Saved") proves
 *      the module (not the legacy in-blob PICOTab) rendered.
 *  - Search wizard (`?tab=search`, searchEngine ON → SearchWizard): the body owns an
 *      `<h2>Search</h2>`; the 3 step pips are `<button>`s carrying `aria-current="step"`
 *      when active — disambiguated from the footer Next/Run buttons by their unique
 *      hint text. The footer "Run & send to screening" button gates on the builder
 *      reporting ≥1 concept.
 *  - Build step Pecan estimates (pecanSearch ON): a "Estimate results" control (when
 *      enabled) vs an "enable it in Ops" note (when off).
 *  - Run step (PecanSearchTab): an `<h2>Search & Discovery</h2>` + cards; the wizard's
 *      "enable the Pecan Search Engine in the Ops console" note appears ONLY when off.
 *  - Protocol/PROSPERO (`?tab=prospero`): SectionHeader `<h2>Protocol (PROSPERO)</h2>`.
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

  /* ── Search wizard chrome ────────────────────────────────────────────────── */

  get wizardHeading(): Locator { return this.body.getByRole('heading', { name: 'Pecan Search Engine', exact: true }); }

  /** The 3 step pips — targeted by their unique hint text so they never collide
   *  with the footer Next/Run buttons (which also contain "Build"/"Run"). */
  get defineStep(): Locator { return this.body.getByRole('button', { name: /Pick your concepts/i }); }
  get buildStep(): Locator { return this.body.getByRole('button', { name: /Generate the per-database strategy/i }); }
  get runStep(): Locator { return this.body.getByRole('button', { name: /Search every database/i }); }

  get nextBuildButton(): Locator { return this.body.getByRole('button', { name: /Next:\s*Build/i }); }
  get runFooterButton(): Locator { return this.body.getByRole('button', { name: /Run.*send to screening/i }); }

  /** The footer step counter, e.g. "Step 2 of 3". */
  stepIndicator(n: 1 | 2 | 3): Locator { return this.body.getByText(new RegExp(`Step\\s+${n}\\s+of\\s+3`)); }

  async waitForWizard(): Promise<void> {
    await expect(this.wizardHeading).toBeVisible();
    await expect(this.defineStep).toBeVisible();
  }

  /** Assert exactly one step pip is active and it is the expected one. */
  async expectActiveStep(which: 'define' | 'build' | 'run'): Promise<void> {
    const pip = which === 'define' ? this.defineStep : which === 'build' ? this.buildStep : this.runStep;
    await expect(pip).toHaveAttribute('aria-current', 'step');
  }

  /* ── Build step — Pecan estimate control vs the "enable in Ops" note ─────── */

  get estimateButton(): Locator { return this.body.getByRole('button', { name: /Estimate results|Refresh estimates|Estimating/i }); }
  get estimatesCard(): Locator { return this.body.getByText(/Estimated results per database/i); }
  /** The BuildEstimates degraded note shown ONLY when Search & Discovery is off. */
  get pecanDisabledNote(): Locator { return this.body.getByText(/enable it in Ops/i); }
  /** A Build-phase anchor present regardless of the Pecan flag. */
  get databasePicker(): Locator { return this.body.getByText(/Pick the databases you plan to search/i); }

  /* ── Define step — keyword entry ─────────────────────────────────────────── */

  /** The per-PICO-field "Add a keyword to <field>…" input (Define / Step 1). */
  keywordInput(field: 'Population' | 'Intervention / Exposure' | 'Comparator / Control' | 'Outcomes'): Locator {
    return this.body.getByPlaceholder(new RegExp(`Add a keyword to ${field}`, 'i'));
  }
  /** The remove-chip button for a selected keyword (carries aria-label "Remove <term>"). */
  selectedKeywordRemove(term: string): Locator { return this.body.getByRole('button', { name: `Remove ${term}` }); }

  /** Type a keyword into a field and commit it with Enter. */
  async addKeyword(field: 'Population' | 'Intervention / Exposure' | 'Comparator / Control' | 'Outcomes', term: string): Promise<void> {
    const input = this.keywordInput(field);
    await expect(input).toBeVisible();
    await input.fill(term);
    await input.press('Enter');
  }

  /* ── 74.md/75.md — the staged Search Workspace's stage navigation ──────────────
     75.md moved the numbered Search workflow into the WHITE project side-menu (the
     shared `stitch-workflow-stepper`): under the Stitch shell the in-body StageRail
     (`search-workspace-rail`) is HIDDEN (`hideRail` from StitchProjectWorkspace) and
     the side-menu stepper drives stages via `?tab=search&stage=<id>` links. A non-
     Stitch / hideRail=false mount still renders the in-body rail. EXACTLY ONE of the
     two is present at a time, so this union locator drives whichever the shell shows,
     and both restructure identically on a mode switch (both derive from `stagesFor`).
     Stage pips carry the stage label in their accessible name in BOTH surfaces
     ("Step N: <label>" in the side-menu, "Stage N: <label>" in the in-body rail). */
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

  /** Open ?tab=search and wait for the STAGED workspace (not the legacy wizard). The
   *  dispatcher reads /api/settings/public once per mount, so retry the navigation
   *  until the freshly-flipped `searchWorkspaceV2` flag has propagated. */
  async openStagedWorkspace(projectId: string): Promise<void> {
    await expect(async () => {
      await this.gotoSearch(projectId);
      await expect(this.stageSurface).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** Deep-link a specific staged Search stage (`?tab=search&stage=<id>`), retrying
   *  while the flag propagates until the stage surface reports the requested stage. */
  async gotoStage(projectId: string, stageId: string): Promise<void> {
    await expect(async () => {
      await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=search&stage=${encodeURIComponent(stageId)}`);
      await expect(this.stageSurface).toHaveAttribute('data-stage', stageId, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /* ── 85.md — staged workspace (searchWorkspaceV2): redesigned Concepts +
        Terms & Vocabulary master-detail locators ─────────────────────────────── */

  /** Concepts stage — the cards container (pinned testid) + one card by name. */
  get conceptCards(): Locator { return this.body.getByTestId('sb-concepts-summary'); }
  conceptCard(name: string): Locator {
    return this.body.getByTestId('sb-concept-card').filter({ hasText: name });
  }
  /** The card's ONE primary action — navigates to Terms & Vocabulary. */
  editTermsButton(conceptName: string): Locator {
    return this.conceptCard(conceptName).getByRole('button', { name: /Edit terms/ });
  }

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

  /* ── Run step (PecanSearchTab) ───────────────────────────────────────────── */

  get pecanHeading(): Locator { return this.body.getByRole('heading', { name: /Run search — Pecan Search Engine/i }); }
  /** The wizard's Run-disabled note — present ONLY when pecanSearch is off. */
  get pecanRunDisabledNote(): Locator { return this.body.getByText(/enable the Pecan Search Engine — Automated Run in the Ops console/i); }

  /** Advance Define → Build → Run, waiting for the concept gate to open first. */
  async openRunStep(): Promise<void> {
    await this.nextBuildButton.click();
    await this.expectActiveStep('build');
    // The footer Run button enables once the embedded builder reports ≥1 concept
    // (the builder seeds the 5 PICO groups on load, so this opens shortly after).
    await expect(this.runFooterButton).toBeEnabled({ timeout: 15_000 });
    await this.runFooterButton.click();
  }

  /* ── Protocol / PROSPERO ─────────────────────────────────────────────────── */

  get prosperoHeading(): Locator { return this.body.getByRole('heading', { name: /Protocol \(PROSPERO\)/i }); }
  get generateDraftButton(): Locator { return this.body.getByRole('button', { name: /Generate draft/i }); }
}
