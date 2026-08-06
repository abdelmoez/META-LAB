/**
 * SearchPage.ts — the page object for the `search-protocol` area: the Protocol/PICO
 * tab, the STAGED Search workspace (96.md → 98.md — 6 stages (98.md §3 retired the standalone Research Question
 * stage; the question is edited INLINE): Select & Build Key Terms → Search Mode → Database Strategies →
 * Results → Documentation → Send to Screening), and the embedded Pecan
 * "Search & Discovery" run surface.
 *
 * 97.md/98.md — the first stage is "Select & Build Key Terms" (stage id `terms`;
 * deep links / aliases unchanged). The stage is a direct Boolean workspace:
 * question tokens (click / Shift-click span / drag-onto-token combine), neutral
 * "Concept N" groups rendered as a HORIZONTAL CONCEPT BOARD (98.md §9 — active
 * card carries the editing surfaces; compact cards activate on click; AND/OR
 * connector buttons between cards), chip drag (reorder = insertion line;
 * onto-chip = merge ring; onto a CONCEPT CARD = move; onto "＋ New concept" =
 * move to a new group), the dark-red exact-duplicate chip state, the MeSH
 * details popover, and the explicit Regenerate button + confirmation dialog.
 *
 * It COMPOSES the shared `ShellNav` (chrome + overlays) rather than re-implementing
 * nav. Tab-content locators are scoped to the workspace tool body
 * (`.stitch-tool-body`) so they never collide with the persistent nav / rail.
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

  /** The workspace tool body — scopes all tab-content locators. */
  /** The workspace body scroller. Public so a spec can assert a testid is ABSENT
   *  (100.md §§1-2 retired two surfaces; "it is gone" needs a scope to be gone from). */
  get body(): Locator { return this.page.locator('.stitch-tool-body'); }

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

  /** The white side-menu stepper / in-body rail union (exactly one is present). */
  get stageNav(): Locator {
    return this.page.locator('[data-testid="stitch-workflow-stepper"], [data-testid="search-workspace-rail"]');
  }
  /** A stage pip by (partial) label, in whichever navigation surface is present. */
  stageStep(name: RegExp | string): Locator {
    return this.stageNav.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });
  }
  /** The staged workspace's stage surface (`data-stage` = active stage id). */
  get stageSurface(): Locator { return this.page.getByTestId('search-workspace-stage'); }

  /** Open ?tab=search and wait for the STAGED workspace (flags may propagate). */
  async openStagedWorkspace(projectId: string): Promise<void> {
    await expect(async () => {
      await this.gotoSearch(projectId);
      await expect(this.stageSurface).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** Deep-link a staged Search stage (`?tab=search&stage=<id>`), retrying while
   *  flags propagate until the stage surface reports the requested stage. */
  async gotoStage(projectId: string, stageId: string): Promise<void> {
    await expect(async () => {
      await this.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=search&stage=${encodeURIComponent(stageId)}`);
      await expect(this.stageSurface).toHaveAttribute('data-stage', stageId, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /* ── 98.md §3/§4 — the INLINE research-question editor (terms stage) ── */

  get questionEditor(): Locator { return this.body.getByTestId('search-question-editor'); }
  get inlineQuestionEditor(): Locator { return this.body.getByTestId('sw-inline-question-editor'); }
  get editQuestionButton(): Locator { return this.body.getByTestId('sb-edit-question'); }
  get addQuestionButton(): Locator { return this.body.getByTestId('sb-add-question'); }
  get questionDoneButton(): Locator { return this.body.getByTestId('sw-question-done'); }

  /** Write the research question on the question stage (whole-project autosave),
   *  then poll the server until it persisted (see 96.md race notes). */
  async setQuestion(projectId: string, text: string): Promise<void> {
    // 98.md §3/§4 — the question stage is retired; edit INLINE on the terms stage.
    await this.gotoStage(projectId, 'terms');
    if (!(await this.inlineQuestionEditor.isVisible().catch(() => false))) {
      const opener = (await this.addQuestionButton.isVisible().catch(() => false))
        ? this.addQuestionButton : this.editQuestionButton;
      await opener.click();
    }
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
    // Close the editor so the workspace below is unobstructed for the caller.
    if (await this.questionDoneButton.isVisible().catch(() => false)) {
      await this.questionDoneButton.click();
    }
  }

  /**
   * Wait until the builder's DEBOUNCED autosave (800ms) has landed the strategy on
   * the server. Any spec that mutates the strategy and then hard-navigates MUST
   * call this first (navigation destroys the page before the debounce fires).
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

  /** Seed the whole strategy document directly through the API (hermetic — no
   *  live vocabulary lookups; putSearch stores `concepts` as sent). */
  async seedStrategy(projectId: string, concepts: unknown[]): Promise<void> {
    const r = await this.page.request.put(`/api/search-builder/${encodeURIComponent(projectId)}`, {
      data: { concepts },
    });
    expect(r.ok(), 'seeding the strategy via PUT /api/search-builder').toBe(true);
  }

  /* ── 97.md — Select & Build Key Terms: the central workspace ─────────────── */

  /** The research-question phrase-selection card (source section). */
  get questionCard(): Locator { return this.body.getByTestId('sb-question-card'); }
  /** A clickable question token/phrase (aria-pressed carries the selected state). */
  phraseToken(text: string | RegExp): Locator {
    return this.questionCard.getByRole('button', { name: text });
  }
  /** The manual "add a concept" box on the question card (98 §8 wording). */
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

  /** Terms stage — the 98.md §9 horizontal concept board. */
  get conceptBoard(): Locator { return this.body.getByTestId('sb-concept-board'); }
  /** Any concept card (active or compact) whose rename input names `name`. */
  conceptCard(name: string): Locator {
    return this.body.locator('[data-testid="sb-active-concept"], [data-testid="sb-concept-card"]')
      .filter({ has: this.page.getByLabel(new RegExp(`Concept name: .*${name}`, 'i')) });
  }
  /** Compact (inactive) cards only. */
  get compactCards(): Locator { return this.body.getByTestId('sb-concept-card'); }
  /** The AND/OR connector buttons between cards (98 §9). */
  get andConnectors(): Locator { return this.body.getByTestId('sb-and-connector'); }
  /** The §6 empty-state block + its primary action. */
  get emptyBoard(): Locator { return this.body.getByTestId('sb-empty-board'); }
  get createFirstConcept(): Locator { return this.body.getByTestId('sb-create-first-concept'); }
  get activeConcept(): Locator { return this.body.getByTestId('sb-active-concept'); }
  get addTermInput(): Locator { return this.body.getByTestId('sb-add-term-input'); }
  get addTermButton(): Locator { return this.body.getByTestId('sb-add-term-btn'); }
  get addStatusLine(): Locator { return this.body.getByTestId('sb-add-status'); }
  /** A term chip's EDIT button (the whole chip) inside the active group. EXACT so a
   *  free-text term never aliases a longer MeSH descriptor containing it. */
  termChip(term: string): Locator {
    return this.activeConcept.getByRole('button', { name: `Edit ${term}`, exact: true });
  }
  /** A term chip's separate remove button (pinned aria contract; EXACT). */
  termChipRemove(term: string): Locator {
    return this.activeConcept.getByRole('button', { name: `Remove ${term}`, exact: true });
  }
  get termEditor(): Locator { return this.body.getByTestId('sb-term-editor'); }
  get suggestionsArea(): Locator { return this.body.getByTestId('sb-suggestions'); }
  suggestionRow(text: string): Locator {
    return this.body.getByTestId('sb-suggestion-row').filter({ hasText: text });
  }
  /** 100.md §§6-11 — the read-only plain-language reading of the live strategy. It
   *  replaces the retired "Your search so far" panel (`sb-strategy-preview`) AND the
   *  always-on per-database previews (`sb-db-previews`); the exact database strings
   *  now hide inside its closed "Exact database queries" disclosure, and are fully
   *  editable on the Database Strategies stage / the automated run surface. */
  get searchMeaning(): Locator { return this.body.getByTestId('sb-search-meaning'); }
  get meaningSummary(): Locator { return this.body.getByTestId('sm-summary'); }
  get meaningGroups(): Locator { return this.body.getByTestId('sm-group'); }
  get meaningJoins(): Locator { return this.body.getByTestId('sm-join'); }
  /** The §11 technical disclosure inside the meaning panel (closed by default). */
  get databaseQueriesDisclosure(): Locator {
    return this.searchMeaning.getByRole('group').filter({ hasText: 'Exact database queries' });
  }
  dbQuery(dbId: string): Locator { return this.body.getByTestId(`sm-db-query-${dbId}`); }
  get saveStatus(): Locator { return this.body.getByTestId('sb-save-status').first(); }
  /** The undo snackbar is portaled-fixed at the page level (not body-scoped). */
  get undoSnackbar(): Locator { return this.page.getByTestId('sb-undo'); }

  /* ── 97.md — new surfaces ────────────────────────────────────────────────── */

  /** Quiet inline hints (the Search Quality Check card is REMOVED). */
  get inlineHints(): Locator { return this.body.getByTestId('sb-inline-hints'); }
  /** Dark-red exact-duplicate badge on a chip (icon + "Duplicate" + SR label). */
  get dupBadges(): Locator { return this.body.getByTestId('sb-dup-badge'); }
  /** Soft "Possible variant" chip hint. */
  get variantBadges(): Locator { return this.body.getByTestId('sb-dup-variant'); }
  /** "kept intentionally" chip marker (valid dupOverride). */
  get intentionalBadges(): Locator { return this.body.getByTestId('sb-dup-intentional'); }
  /** Blocked same-group duplicate notice with "Find existing term". */
  get dupBlockedNotice(): Locator { return this.body.getByTestId('sb-dup-blocked'); }
  /** The duplicate action block inside the term editor popover. */
  get dupActions(): Locator { return this.termEditor.getByTestId('sb-dup-actions'); }
  /** The MeSH details popover (hover/focus on a controlled chip). */
  get meshPopover(): Locator { return this.body.getByTestId('sb-mesh-popover'); }
  /** The keyboard affordance that opens the MeSH popover for a descriptor. */
  meshInfoButton(descriptor: string): Locator {
    return this.activeConcept.getByRole('button', { name: `MeSH details for ${descriptor}`, exact: true });
  }
  /** Drag visuals (prop-driven; asserted during pointer gestures). */
  get insertLine(): Locator { return this.body.getByTestId('sb-insert-line'); }
  get mergeTarget(): Locator { return this.body.getByTestId('sb-merge-target'); }
  get newGroupTarget(): Locator { return this.body.getByTestId('sb-new-group-target'); }
  /** The Regenerate button (terms-stage toolbar) + its confirmation dialog. */
  get regenerateButton(): Locator { return this.body.getByTestId('sb-regenerate-btn'); }
  get regenerateDialog(): Locator { return this.page.getByTestId('sb-regenerate-dialog'); }
  /** Stale-write reconcile notice (Phase 16). */
  get conflictNotice(): Locator { return this.body.getByTestId('sb-conflict-notice'); }

  /** Type into the active group's add box and commit with the explicit Add button. */
  async addTermToActiveConcept(term: string): Promise<void> {
    await expect(this.addTermInput).toBeVisible();
    await this.addTermInput.fill(term);
    await this.addTermButton.click();
  }

  /**
   * Hand-rolled pointer drag from one locator's centre onto another's centre.
   * `holdMs` keeps the pointer hovering before release — REQUIRED for merge drops
   * (the merge target arms only after the ~350ms hover threshold; reorder/move
   * drops need no hold). Moves in steps so pointermove hit-testing runs.
   */
  async dragTo(source: Locator, target: Locator, opts: { holdMs?: number; offsetX?: number } = {}): Promise<void> {
    // The terms workspace is TALLER than the viewport. mouse.* coordinates are
    // viewport-relative and events aimed outside it never reach the page, so an
    // off-screen endpoint silently no-ops the whole gesture: bring both ends into
    // view FIRST (they sit near each other on every drag surface), then measure.
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const src = await source.boundingBox();
    const dst = await target.boundingBox();
    if (!src || !dst) throw new Error('dragTo: source or target has no bounding box');
    const from = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
    const to = { x: dst.x + dst.width / 2 + (opts.offsetX || 0), y: dst.y + dst.height / 2 };
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await this.page.mouse.move(to.x, to.y, { steps: 8 });
    if (opts.holdMs) await this.page.waitForTimeout(opts.holdMs);
    await this.page.mouse.up();
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
