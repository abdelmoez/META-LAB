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

  /** The non-fullbleed workspace tool body — scopes all tab-content locators. */
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

  get wizardHeading(): Locator { return this.body.getByRole('heading', { name: 'Search', exact: true }); }

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

  /* ── Run step (PecanSearchTab) ───────────────────────────────────────────── */

  get pecanHeading(): Locator { return this.body.getByRole('heading', { name: /Search & Discovery/i }); }
  /** The wizard's Run-disabled note — present ONLY when pecanSearch is off. */
  get pecanRunDisabledNote(): Locator { return this.body.getByText(/enable the Pecan Search Engine in the Ops console/i); }

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
