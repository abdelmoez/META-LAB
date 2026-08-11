/**
 * searchWorkspace.spec.ts — 74.md + 96.md + 97.md + 98.md: the staged Search
 * Workspace.
 *
 * 98.md redesigns the workspace around the Select & Build Key Terms stage:
 *  - §3 the standalone Research Question stage is RETIRED (6 stages; automated
 *    mode drops Database Strategies → 5). `?stage=question` aliases to terms.
 *  - §4 the question is edited INLINE above the builder (sw-inline-question-editor,
 *    opened from the question card; auto-opens for projects without a question).
 *  - §9 the master-detail navigator is GONE: a HORIZONTAL CONCEPT BOARD renders
 *    one card per concept (active card = full editing surfaces, inactive cards
 *    are compact and activate on click), joined by AND/OR connector buttons.
 *    Cross-group chip drops land ON A CARD; group reorder/merge drags by the
 *    card's grip handle (sb-card-drag-handle).
 *  - §5 Beginner Mode (default OFF) gates all instructional copy engine-wide.
 *  - §6 empty strategy = sb-empty-board + "Create first concept"; gated stages
 *    unlock on live TERMS (an empty concept unlocks nothing).
 *  - §8 the user-facing noun is Concept ("Concept N" defaults, "Delete concept",
 *    "New concept name…", "+ Add concept").
 *  - §11 vocabulary suggestions are hidden behind a "Show suggestions (N)"
 *    toggle; rows are NOT in the DOM while closed.
 *
 * What this spec drives end-to-end in a real browser:
 *   - the 6-stage rail; retired deep links (concepts/refine/question) land on
 *     terms; automated mode renumbers to 5 stages;
 *   - the §22 journey: inline question editing → phrase click creates a concept
 *     card → empty board's "Create first concept" → AND connectors between
 *     cards; drift keep/remove; merge/split/delete + Undo;
 *   - drag surfaces: token-combine, chip merge (distinct from reorder), chip
 *     drop ONTO A CARD moves (never clones), grip-handle reorder + merge;
 *   - duplicates: dark-red journey across cards (both copies visible on the
 *     board now), same-group add prevention, MeSH popover + per-entry-term add
 *     (seeded vocab — no live NLM), Regenerate cancel/confirm/undo, Ctrl+Z;
 *   - the mode/persistence/two-writer/keyboard journeys from 96.md;
 *   - axe scans of the inline question editor + the terms board.
 *
 * Drag gestures use explicit mouse.down/move/up with steps, generous hover
 * holds for merge arming, and poll-based API waits before any hard navigation.
 */
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { expectNoSeriousA11y } from '../helpers/axe';

test.describe('98.md — the staged Search Workspace (concept board)', () => {
  const rail = (sp: SearchPage) => sp.stageNav;
  const stageSurface = (sp: SearchPage) => sp.stageSurface;
  const termsPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Select & Build Key Terms/ });
  const dbStrategiesPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Database Strategies/ });
  const resultsPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Run Externally/ });
  const manualCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-manual');
  const automatedCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-automated');
  const modeBadge = (sp: SearchPage) => sp.page.getByTestId('search-mode-badge');

  async function openModeStage(sp: SearchPage): Promise<void> {
    await rail(sp).getByRole('button', { name: /Search Mode/ }).click();
    await expect(manualCard(sp)).toBeVisible();
  }

  /** Open the terms stage and create a concept via the manual add box. */
  async function seedGroup(sp: SearchPage, projectId: string, label: string): Promise<void> {
    await sp.gotoStage(projectId, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.addConceptGroup(label);
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(label);
  }

  /** 98.md §9 — activate a compact card by clicking its header ordinal (a safe
   *  click surface that can never open a chip's term editor). */
  async function activateCard(sp: SearchPage, name: string): Promise<void> {
    await sp.conceptCard(name).getByTestId('sb-group-ordinal').click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(name);
  }

  test('@smoke an undecided project renders the full 6-stage rail, terms first (question stage retired)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);

    // 98.md §3 — bare ?tab=search lands on the terms stage.
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms');
    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(resultsPip(sp)).toBeVisible();
    await expect(termsPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Terms & Vocabulary/ })).toHaveCount(0);
    await expect(page.getByText('Stage 1 of 6')).toBeVisible();
    // The retired stages never render as pips — Research Question included (98.md §3).
    await expect(rail(sp).getByRole('button', { name: /Research Question/ })).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Test & Refine/ })).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /^Concepts$/ })).toHaveCount(0);
    await expect(modeBadge(sp)).toHaveCount(0);
  });

  test('96.md/98.md — retired deep links (?stage=concepts / refine / question) land on the terms stage', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    for (const retired of ['concepts', 'refine', 'question']) {
      await expect(async () => {
        await sp.shell.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=${retired}`);
        await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms', { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      await expect.poll(() => new URL(page.url()).searchParams.get('stage')).toBe('terms');
    }
  });

  test('98.md §4/§22 — the research question is edited INLINE on the terms stage (auto-open when empty; Edit/Done/Escape)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?';
    await sp.gotoStage(tmpProject.id, 'terms');

    // A project with NO question auto-opens the compact editor above the builder,
    // and the question card offers the explicit CTA.
    await expect(sp.inlineQuestionEditor).toBeVisible();
    await expect(sp.addQuestionButton).toBeVisible();

    // Type the question; blur flushes the commit; it persists on the project.
    await sp.questionEditor.fill(q);
    await expect(sp.questionEditor).toHaveValue(q);
    await sp.questionEditor.blur();
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/projects/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return null;
        const b = await r.json().catch(() => null);
        return (b && b.pico && b.pico.question) || '';
      }, { timeout: 20_000, message: 'research question never persisted to the project' })
      .toBe(q);

    // Done closes the editor; the question card now renders clickable tokens
    // (the curated phrase tokenizer emits "heart failure" as ONE token).
    await sp.questionDoneButton.click();
    await expect(sp.inlineQuestionEditor).toHaveCount(0);
    await expect(sp.phraseToken('heart failure')).toBeVisible();
    await expect(sp.addQuestionButton).toHaveCount(0);

    // "Edit question" re-opens the editor IN PLACE (never a navigation); Escape closes.
    await sp.editQuestionButton.click();
    await expect(sp.inlineQuestionEditor).toBeVisible();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms');
    await sp.questionEditor.press('Escape');
    await expect(sp.inlineQuestionEditor).toHaveCount(0);
    // No standalone question stage surface exists anywhere.
    await expect(stageSurface(sp).getByText(/Population \/ Problem/)).toHaveCount(0);
  });

  test('98.md §6/§22 — empty board → Create first concept → + Add concept; AND connector toggles; stages unlock on live TERMS', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.gotoStage(tmpProject.id, 'terms');

    // §6 — the intentionally empty start: the board renders the empty block with
    // ONE clean primary action.
    await expect(sp.conceptBoard).toBeVisible();
    await expect(sp.emptyBoard).toBeVisible();
    await expect(sp.createFirstConcept).toBeVisible();
    await expect(sp.compactCards).toHaveCount(0);

    // Create first concept → an ACTIVE card named "Concept 1" (98.md §8).
    await sp.createFirstConcept.click();
    await expect(sp.emptyBoard).toHaveCount(0);
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('Concept 1');

    // §6 — an EMPTY concept does not unlock the gated stages; live TERMS do.
    // The footer "Next" gate (Database Strategies → Run Externally) carries the
    // new disabled reason.
    await dbStrategiesPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    const nextResults = page.getByRole('button', { name: /Next: Run Externally/ });
    await expect(nextResults).toBeDisabled();
    await expect(nextResults).toHaveAttribute('title', /Add terms to a concept first — select phrases from your research question or type them in/);

    // Add a live TERM → the gate opens.
    await termsPip(sp).click();
    await expect(sp.activeConcept).toBeVisible();
    await sp.addTermToActiveConcept('alpha blockers');
    await expect(sp.termChip('alpha blockers')).toBeVisible();
    await dbStrategiesPip(sp).click();
    await expect(page.getByRole('button', { name: /Next: Run Externally/ })).toBeEnabled({ timeout: 15_000 });
    await termsPip(sp).click();
    await expect(sp.activeConcept).toBeVisible();

    // "+ Add concept" (the ghost card) grows the AND chain: a second card appears
    // (compact — the first card stays active) with an AND connector LEADING it.
    await page.getByTestId('sb-add-concept-card').click();
    await expect(sp.conceptCard('Concept 2')).toBeVisible();
    await expect(sp.compactCards).toHaveCount(1);
    await expect(sp.andConnectors).toHaveCount(1);
    await expect(sp.andConnectors.first()).toHaveText('AND');

    // §9 — the connector is the between-concept operator TOGGLE and shows the
    // PREVIOUS card's op.
    await sp.andConnectors.first().click();
    await expect(sp.andConnectors.first()).toHaveText('OR');
    await sp.andConnectors.first().click();
    await expect(sp.andConnectors.first()).toHaveText('AND');
  });

  test('@smoke terms journey: phrase click creates a concept card; duplicate click focuses; preview ANDs concepts', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Does metformin reduce mortality in adults with obesity?';
    await sp.setQuestion(tmpProject.id, q);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // Click a token → a concept card appears, active, holding the phrase as a term.
    await sp.phraseToken(/^metformin$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('metformin')).toBeVisible();
    await expect(sp.phraseToken(/metformin/)).toHaveAttribute('aria-pressed', 'true');

    // Add a synonym; the concept now holds MORE than its origin term…
    await sp.addTermToActiveConcept('dimethylbiguanide');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();
    // 97.md Phase 8 — the OR relationship is explicit between chips.
    await expect(sp.activeConcept.getByText('OR', { exact: true }).first()).toBeVisible();
    // …so clicking the token again FOCUSES the card (never silently deletes work).
    await sp.phraseToken(/metformin/).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();

    // A second concept from another phrase; the plain-language reading names both and
    // the board joins the two cards with an AND connector (98.md §9 / 100.md §§6-10).
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.searchMeaning).toContainText('metformin');
    await expect(sp.searchMeaning).toContainText('mortality');
    await expect(sp.meaningSummary).toContainText('Find articles about');
    await expect(sp.meaningJoins.first()).toContainText('the article must ALSO be about:');
    await expect(sp.andConnectors).toHaveCount(1);

    // 97.md Phase 7 — no "Search Quality Check" card anywhere on the stage.
    await expect(stageSurface(sp).getByText(/Search Quality Check/i)).toHaveCount(0);
  });

  test('97.md Phase 6 — dragging a question token onto another combines the span into one phrase concept', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does endoscopic drainage of malignant biliary obstruction improve survival?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // "malignant biliary obstruction" is a CURATED phrase — the tokenizer emits
    // it as ONE token, so the drag-combine journey needs two separate word
    // tokens. Drag "endoscopic" onto "drainage": the merge ring arms after the
    // hover threshold and the drop creates ONE concept from the contiguous span.
    const from = sp.phraseToken(/^endoscopic$/);
    const to = sp.phraseToken(/^drainage$/);
    await expect(from).toBeVisible();
    await sp.dragTo(from, to, { holdMs: 600 });
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(/endoscopic drainage/);
    // The combine toast offers Undo (97: "Combined into … — Undo").
    await expect(sp.undoSnackbar).toBeVisible();
    await expect(sp.undoSnackbar).toContainText('Combined into');
    // Undo removes the freshly created concept card again.
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.conceptCard('endoscopic drainage')).toHaveCount(0);
  });

  test('97.md Phase 6 — chip drag: merge target is DISTINCT from reorder and combines into a phrase (split restores)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'drainage');
    await sp.addTermToActiveConcept('biliary');
    await sp.addTermToActiveConcept('stent');
    await expect(sp.termChip('stent')).toBeVisible();

    // Drag "biliary" ONTO "stent" (centre, hover past the threshold) → merge ring
    // (sb-merge-target) then a combined phrase term "biliary stent".
    await sp.dragTo(sp.termChip('biliary'), sp.termChip('stent'), { holdMs: 600 });
    await expect(sp.termChip('biliary stent')).toBeVisible();
    await expect(sp.termChip('biliary')).toHaveCount(0);
    await expect(sp.undoSnackbar).toContainText('Combined into “biliary stent”');

    // The phrase remembers its components → the popover offers a 2-part split.
    await sp.termChip('biliary stent').click();
    await expect(sp.termEditor).toBeVisible();
    await sp.termEditor.getByTestId('sb-split-phrase-btn').click();
    await expect(sp.termChip('biliary')).toBeVisible();
    await expect(sp.termChip('stent')).toBeVisible();
    await expect(sp.termChip('biliary stent')).toHaveCount(0);
  });

  test('98.md §9 — chip drag onto a CONCEPT CARD moves the term (never clones); explicit copy duplicates', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'obstruction');
    await sp.addTermToActiveConcept('stricture');
    await sp.addConceptGroup('drainage');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('drainage');

    // Work from the FIRST concept; drag its chip onto the second concept's CARD
    // (the whole card is the cross-group drop surface — was the navigator pill).
    await activateCard(sp, 'obstruction');
    await expect(sp.termChip('stricture')).toBeVisible();
    await sp.dragTo(sp.termChip('stricture'), sp.conceptCard('drainage'));
    // Default drag MOVES: gone here…
    await expect(sp.termChip('stricture')).toHaveCount(0);
    // …present there (with Undo offered — "Moved “stricture” to drainage").
    await expect(sp.undoSnackbar).toContainText('Moved “stricture” to drainage');
    await activateCard(sp, 'drainage');
    await expect(sp.termChip('stricture')).toBeVisible();

    // EXPLICIT copy via the popover menu (duplication is deliberate).
    await sp.termChip('stricture').click();
    await sp.termEditor.getByTestId('sb-copy-btn').click();
    await sp.termEditor.getByRole('button', { name: 'obstruction', exact: true }).click();
    // The copy lands in the other concept; this one keeps its chip.
    await activateCard(sp, 'obstruction');
    await expect(sp.termChip('stricture')).toBeVisible();
    await activateCard(sp, 'drainage');
    await expect(sp.termChip('stricture')).toBeVisible();
  });

  test('98.md §9 — the card grip handle drags a concept: edge drop reorders the AND chain; centre drop (held) merges', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'alpha');
    await sp.addConceptGroup('beta');
    await sp.addConceptGroup('gamma');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('gamma');
    await expect(sp.conceptCard('gamma').getByTestId('sb-group-ordinal')).toHaveText('Concept 3');

    // REORDER: drag gamma's grip onto beta's LEFT EDGE (outside the central merge
    // zone, no hold) → the insertion line target → gamma lands BEFORE beta.
    const betaBox = await sp.conceptCard('beta').boundingBox();
    if (!betaBox) throw new Error('beta card has no bounding box');
    await sp.dragTo(
      sp.conceptCard('gamma').getByTestId('sb-card-drag-handle'),
      sp.conceptCard('beta'),
      { offsetX: -(betaBox.width / 2 - 14) },
    );
    await expect(sp.conceptCard('gamma').getByTestId('sb-group-ordinal')).toHaveText('Concept 2');
    await expect(sp.conceptCard('beta').getByTestId('sb-group-ordinal')).toHaveText('Concept 3');

    // MERGE: drag beta's grip onto alpha's CENTRE and HOLD past the arming
    // threshold → beta merges into alpha (terms move; beta's card goes).
    await sp.dragTo(
      sp.conceptCard('beta').getByTestId('sb-card-drag-handle'),
      sp.conceptCard('alpha'),
      { holdMs: 600 },
    );
    await expect(sp.conceptCard('beta')).toHaveCount(0);
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('alpha');
    await expect(sp.termChip('beta')).toBeVisible();
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.conceptCard('beta')).toBeVisible();
  });

  test('drift: editing the question flags concepts whose phrase left it — keep/remove, never auto-delete', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does metformin reduce mortality in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await sp.awaitStrategySaved(tmpProject.id, 1);

    // 98.md §4 — the question edit happens through the INLINE editor now.
    await sp.setQuestion(tmpProject.id, 'Does metformin reduce cardiovascular events in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');

    await expect(sp.driftBanner).toBeVisible();
    await expect(sp.driftBanner).toContainText('mortality');
    await expect(sp.conceptCard('mortality')).toBeVisible();

    await sp.driftBanner.getByRole('button', { name: /Keep concepts/ }).click();
    await expect(sp.driftBanner).toHaveCount(0);
    await expect(sp.conceptCard('mortality')).toBeVisible();
  });

  test('concept management: merge, split and delete-with-confirm are undoable (98.md §8 wording)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'heart failure');
    await sp.addTermToActiveConcept('cardiac failure');
    await sp.addConceptGroup('cardiomyopathy');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('cardiomyopathy');

    // MERGE cardiomyopathy into heart failure — the term moves, the card goes.
    await sp.groupActions.getByRole('button', { name: /Merge cardiomyopathy into another concept/ }).click();
    await sp.page.getByRole('button', { name: 'heart failure', exact: true }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('heart failure');
    await expect(sp.termChip('cardiomyopathy')).toBeVisible();
    await expect(sp.conceptCard('cardiomyopathy')).toHaveCount(0);
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.conceptCard('cardiomyopathy')).toBeVisible();

    // SPLIT: move "cardiac failure" out of heart failure into a new concept.
    await activateCard(sp, 'heart failure');
    await sp.groupActions.getByRole('button', { name: /Split terms out of heart failure/ }).click();
    await expect(sp.splitPanel).toBeVisible();
    await sp.splitPanel.getByLabel(/Select cardiac failure/).check();
    await sp.splitPanel.getByLabel('New concept name').fill('cardiac failure');
    await sp.splitPanel.getByRole('button', { name: /Split 1 term/ }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('cardiac failure');
    await expect(sp.termChip('cardiac failure')).toBeVisible();

    // DELETE any concept needs an inline confirm; Undo restores it.
    await sp.groupActions.getByRole('button', { name: /Delete concept cardiac failure/ }).click();
    await sp.groupActions.getByRole('button', { name: /Confirm delete cardiac failure/ }).click();
    await expect(sp.conceptCard('cardiac failure')).toHaveCount(0);
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.conceptCard('cardiac failure')).toBeVisible();
  });

  test('99.md — expand/collapse: outside click, Escape, chevron, and switching between cards', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'heart failure');
    await sp.addConceptGroup('adults');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('adults');

    // Clicking a COMPACT card transfers the expansion (only one card is ever open).
    await activateCard(sp, 'heart failure');
    await expect(sp.compactCards).toHaveCount(1);

    // Clicking anywhere OUTSIDE the board collapses the working card into the
    // balanced all-compact overview — no active card anywhere on the page.
    // 100.md §1 — the outside-click surface below the board is now the read-only
    // plain-language panel (the retired "Your search so far" preview is gone).
    await page.getByTestId('sb-search-meaning').getByText('What this search is looking for').click();
    await expect(sp.activeConcept).toHaveCount(0);
    await expect(sp.compactCards).toHaveCount(2);

    // Collapsed cards stay informative: term count + a real disclosure chevron.
    const hf = sp.conceptCard('heart failure');
    await expect(hf.getByTestId('sb-term-count')).toHaveText(/1 term/);
    await expect(hf.getByTestId('sb-card-toggle')).toHaveAttribute('aria-expanded', 'false');

    // The chevron expands; on the working card it reports the expanded state.
    await hf.getByTestId('sb-card-toggle').click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('heart failure');
    await expect(sp.activeConcept.getByTestId('sb-card-toggle')).toHaveAttribute('aria-expanded', 'true');

    // Clicks INSIDE the working card never collapse it (the add box keeps focus)...
    await sp.addTermInput.click();
    await expect(sp.activeConcept).toBeVisible();

    // ...and a free Escape (empty draft, no popover) collapses from the keyboard,
    // anchoring focus on the now-compact card so keyboard users are never stranded.
    await sp.addTermInput.press('Escape');
    await expect(sp.activeConcept).toHaveCount(0);
    await expect(sp.conceptCard('heart failure')).toBeFocused();

    // Enter re-expands the focused compact card (the 98.md H14 keyboard path).
    await page.keyboard.press('Enter');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('heart failure');

    // 100.md §§1/8 — the panel below the board is a DESCRIPTION now: clicking it
    // collapses the board (it is outside), and it offers no way to select a concept.
    // Expanding a specific card is the board's own job (card click / chevron / Enter).
    await page.getByTestId('sb-search-meaning').getByText('What this search is looking for').click();
    await expect(sp.activeConcept).toHaveCount(0);
    await expect(sp.searchMeaning.locator('button')).toHaveCount(0);
    await sp.conceptCard('adults').getByTestId('sb-card-toggle').click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('adults');

    // The chevron on the working card collapses it again (round trip).
    await sp.activeConcept.getByTestId('sb-card-toggle').click();
    await expect(sp.activeConcept).toHaveCount(0);
  });

  test('99.md — leaving the terms stage cancels a pending collapse (the board is never stuck collapsed)', async ({ page, tmpProject }) => {
    // Regression: clicking a stage pip runs BOTH the outside-click collapse (which
    // defers its commit into a View Transition) and the stage change. The builder
    // stays mounted across stages, so a commit landing after the phase reset used
    // to leave the board permanently collapsed on return — no working card, and
    // no focusable add box for a keyboard user (the 98.md H14 contract).
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'sepsis');
    await rail(sp).getByRole('button', { name: /Database Strategies/ }).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    await termsPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms');
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('sepsis');
    await expect(sp.addTermInput).toBeVisible();
  });

  test('99.md — reduced motion: expand/collapse works identically without the morph', async ({ page, tmpProject }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'stroke');
    await sp.addConceptGroup('aspirin');
    await activateCard(sp, 'stroke');
    // 100.md §1 — the outside-click surface below the board is now the read-only
    // plain-language panel (the retired "Your search so far" preview is gone).
    await page.getByTestId('sb-search-meaning').getByText('What this search is looking for').click();
    await expect(sp.activeConcept).toHaveCount(0);
    await sp.conceptCard('aspirin').getByTestId('sb-card-toggle').click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('aspirin');
  });

  test('97.md Phase 12 — duplicate journey: dark-red chips on BOTH board cards, find other, keep both, persistence', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'obstruction');
    await sp.addTermToActiveConcept('EUS');
    await sp.addConceptGroup('drainage');
    await sp.addTermToActiveConcept('EUS'); // exact duplicate ACROSS concepts — allowed, warned

    // 98.md §9 — the board renders EVERY concept's chips side by side, so BOTH
    // copies carry the dark-red Duplicate badge at once (icon + SR label).
    await expect(sp.dupBadges).toHaveCount(2);
    await expect(sp.dupBadges.first()).toHaveAttribute('aria-label', /Exact duplicate across AND concepts/);

    // Find other duplicate: activates the other card + focuses the other copy.
    await sp.termChip('EUS').click();
    await expect(sp.dupActions).toBeVisible();
    await sp.dupActions.getByRole('button', { name: 'Find other duplicate' }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('obstruction');
    await expect(sp.termChip('EUS')).toBeFocused();

    // Keep both intentionally → warning mutes on BOTH chips; the calm marker
    // shows on both cards (they all render on the board now).
    await sp.termChip('EUS').click();
    await sp.dupActions.getByRole('button', { name: 'Keep both intentionally' }).click();
    await expect(sp.dupBadges).toHaveCount(0);
    await expect(sp.intentionalBadges).toHaveCount(2);

    // The decision persists (term-level dupOverride rides inside `concepts`).
    await sp.awaitStrategySaved(tmpProject.id, 2);
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return false;
        const b = await r.json().catch(() => null);
        const terms = (b?.concepts || []).flatMap((c: any) => c?.terms || []);
        return terms.some((t: any) => t?.dupOverride && t.dupOverride.key === 'eus');
      }, { timeout: 15_000, message: 'dupOverride never persisted' })
      .toBe(true);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.dupBadges).toHaveCount(0);
    await expect(sp.intentionalBadges).toHaveCount(2);
  });

  test('97.md Phase 12 — same-group exact duplicates are PREVENTED with Find existing term', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'imaging');
    await sp.addTermToActiveConcept('EUS');
    await expect(sp.termChip('EUS')).toBeVisible();

    // The equivalent quoted/cased form is the SAME exact term → blocked, no copy.
    await sp.addTermToActiveConcept('"eus"');
    await expect(sp.termChip('"eus"')).toHaveCount(0);
    await expect(sp.dupBlockedNotice).toBeVisible();
    await sp.dupBlockedNotice.getByRole('button', { name: 'Find existing term' }).click();
    await expect(sp.termChip('EUS')).toBeFocused();
  });

  test('97.md Phase 13 — MeSH details popover: informational, per-entry-term add only + Syntax by database (seeded vocab, no live NLM)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    // Seed a controlled term WITH its vocab record directly through the API —
    // hermetic: no vocabulary lookups run for already-attached vocab.
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Concept 1', op: 'AND', source: 'user_added',
      terms: [{
        id: 'tm1', text: 'heart failure', type: 'controlled', field: 'tiab', source: 'user_added',
        vocab: {
          mesh: 'Heart Failure', meshUI: 'D006333', tree: 'C14.280.434',
          scope: 'Inability of the heart to pump enough blood.',
          synonyms: ['cardiac failure', 'CHF'], children: ['Heart Failure, Systolic'], source: 'core',
        },
      }],
    }]);
    await sp.gotoStage(tmpProject.id, 'terms');
    // The chip renders the exact "Descriptor"[MeSH] form.
    await expect(sp.termChip('heart failure')).toContainText('Heart Failure');
    await expect(sp.termChip('heart failure')).toContainText('[MeSH]');

    // Keyboard path: the info affordance opens the popover (hover also works).
    await sp.meshInfoButton('Heart Failure').click();
    await expect(sp.meshPopover).toBeVisible();
    await expect(sp.meshPopover).toContainText('D006333');
    await expect(sp.meshPopover).toContainText('Include narrower indexed terms');
    await expect(sp.meshPopover).toContainText('not added automatically');
    // 98.md — the popover gained a per-database syntax row.
    await expect(sp.meshPopover).toContainText('Syntax by database');
    await expect(sp.meshPopover.getByTestId('sb-mesh-db-syntax').first()).toBeVisible();

    // ONE entry term is added through its EXPLICIT action; the other is NOT.
    await sp.meshPopover.getByRole('button', { name: 'Add this term: cardiac failure', exact: true }).click();
    await expect(sp.termChip('cardiac failure')).toBeVisible();
    await expect(sp.termChip('CHF')).toHaveCount(0);

    // No bulk acceptance surface exists anywhere on the stage (Phase 13).
    await expect(sp.page.getByTestId('sb-accept-all-headings')).toHaveCount(0);
    await expect(stageSurface(sp).getByRole('button', { name: /Accept all/ })).toHaveCount(0);
  });

  test('97.md Phase 13 (QA M12/M24) — editing a matched MeSH label to unmatched text converts it honestly (no stale descriptor)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    // Hermetic: seeded vocab + a routed no-match lookup — no live NLM anywhere.
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Concept 1', op: 'AND', source: 'user_added',
      terms: [{
        id: 'tm1', text: 'heart failure', type: 'controlled', field: 'tiab', source: 'user_added',
        vocab: { mesh: 'Heart Failure', meshUI: 'D006333', synonyms: ['cardiac failure'], source: 'core' },
      }],
    }]);
    await page.route('**/api/search-builder/mesh', (route) => route.fulfill({ json: null }));
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.termChip('heart failure')).toContainText('[MeSH]');

    // Edit the label to text no heading matches; blur commits the lookup.
    await sp.termChip('heart failure').click();
    await expect(sp.termEditor).toBeVisible();
    const textInput = sp.termEditor.getByLabel('Term text');
    await textInput.fill('bespoke cardiology wording');
    await textInput.press('Tab');
    // The STALE descriptor is dropped — the term enters the explicit unmatched
    // state with the honest conversion affordance (never "still Heart Failure").
    await expect(sp.termEditor).toContainText('This is no longer a MeSH term');
    await sp.termEditor.getByRole('button', { name: 'Convert to free text' }).click();
    await sp.termEditor.getByRole('button', { name: 'Done' }).click();
    const chip = sp.termChip('bespoke cardiology wording');
    await expect(chip).toBeVisible();
    await expect(chip).not.toContainText('[MeSH]');
    await expect(chip).not.toContainText('Heart Failure');
  });

  test('97.md Phase 4 — Regenerate: cancel keeps everything; confirm snapshots first, rebuilds "Concept N" cards, Undo restores', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does endoscopic ultrasound guided drainage reduce mortality in malignant biliary obstruction?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.addConceptGroup('my manual group');
    await sp.addTermToActiveConcept('handmade term');
    await sp.awaitStrategySaved(tmpProject.id, 1);

    // CANCEL leaves all state unchanged. 98.md §8 — "concept groups" dialog copy.
    await sp.regenerateButton.click();
    await expect(sp.regenerateDialog).toBeVisible();
    await expect(sp.regenerateDialog).toContainText('Regenerate search strategy?');
    await expect(sp.regenerateDialog).toContainText('concept groups from the current research question');
    await expect(sp.regenerateDialog).toContainText('Your current manual organization may change.');
    await sp.regenerateDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sp.regenerateDialog).toHaveCount(0);
    await expect(sp.conceptCard('my manual group')).toBeVisible();
    await expect(sp.termChip('handmade term')).toBeVisible();

    // CONFIRM: a "Before regeneration" snapshot lands in Versions, the concepts
    // are rebuilt with neutral "Concept N" names (98.md §8), and the toast offers Undo.
    await sp.regenerateButton.click();
    await sp.regenerateDialog.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(sp.regenerateDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(sp.undoSnackbar).toContainText('Search strategy regenerated.');
    await expect(sp.conceptCard('Concept 1')).toBeVisible();
    await expect(sp.conceptCard('my manual group')).toHaveCount(0);
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}/versions`);
        if (!r.ok()) return '';
        const b = await r.json().catch(() => null);
        return JSON.stringify((b && b.versions) || []);
      }, { timeout: 15_000, message: 'the pre-regeneration snapshot never appeared' })
      .toContain('Before regeneration');

    // UNDO restores the pre-regeneration workspace wholesale.
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.conceptCard('my manual group')).toBeVisible();
    await expect(sp.termChip('handmade term')).toBeVisible();
  });

  test('97.md Phase 6 — global Ctrl/Cmd+Z undoes outside text fields and NEVER while typing', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'copd');
    await sp.addTermToActiveConcept('emphysema');
    await expect(sp.termChip('emphysema')).toBeVisible();

    // Delete the term (undoable), then press Ctrl+Z while FOCUSED IN A TEXT FIELD:
    // the workspace undo must NOT fire (typing surfaces keep native undo).
    await sp.termChipRemove('emphysema').click();
    await expect(sp.termChip('emphysema')).toHaveCount(0);
    await sp.addTermInput.click();
    await sp.addTermInput.fill('draft text');
    await page.keyboard.press('Control+z');
    await expect(sp.termChip('emphysema')).toHaveCount(0); // untouched

    // Outside every typing surface the SAME chord undoes the removal.
    // 99.md — clicking the heading (neutral page surface) also COLLAPSES the
    // board; global undo still works from the collapsed overview, and the
    // restored term is there once the card is re-expanded.
    await sp.workspaceHeading.click(); // move focus off the input (collapses the board)
    await expect(sp.activeConcept).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await activateCard(sp, 'copd');
    await expect(sp.termChip('emphysema')).toBeVisible();
  });

  test('100.md §§2/11 — the terms stage shows MEANING, with the database strings one click away', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');

    // §2 — the always-expanded per-database preview cards are GONE from the
    // search-building screen; they live on the Database Strategies stage.
    await expect(sp.body.getByTestId('sb-db-previews')).toHaveCount(0);
    await expect(sp.body.getByTestId('sb-db-strategy-pubmed')).toHaveCount(0);

    // §§6/9 — the plain-language reading is there instead, and it is live.
    await expect(sp.searchMeaning).toBeVisible();
    await expect(sp.meaningSummary).toContainText('Find articles about asthma');

    // §11 — the exact queries are reachable, but closed by default (no clutter).
    const disclosure = sp.searchMeaning.locator('details');
    expect(await disclosure.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await sp.searchMeaning.getByText(/Exact database queries/).click();
    await expect(sp.dbQuery('pubmed')).toBeVisible();
    await expect(sp.dbQuery('pubmed')).toContainText('asthma[tiab]');

    await sp.estimatesCard.scrollIntoViewIfNeeded();
    await expect(sp.estimatesCard).toBeVisible();
    await expect(stageSurface(sp).getByText(/Versions/)).toBeVisible();
  });

  test('100.md §11 — the Database Strategies stage still owns the editable per-database syntax', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');
    await rail(sp).getByRole('button', { name: /Database Strategies/ }).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    await expect(sp.body.getByTestId('sb-db-strategy-pubmed')).toBeVisible();
    await expect(sp.body.getByTestId('sb-db-strategy-pubmed')).toContainText('asthma[tiab]');
  });

  test('98.md §5 — Beginner Mode (default OFF) gates the instructional copy engine-wide', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // Default = professional experience: toggle OFF, no StageIntro paragraph,
    // no intro strip; the span hint stays in the DOM (aria-describedby keeps
    // working for SR users) but is visually hidden.
    const toggle = page.getByTestId('sw-beginner-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/Build your search here: click or drag the key ideas/)).toHaveCount(0);
    await expect(page.getByTestId('sb-intro-strip')).toHaveCount(0);
    const hint = page.getByTestId('sb-span-hint');
    await expect(hint).toBeAttached();
    expect(((await hint.boundingBox()) || { width: 0 }).width).toBeLessThanOrEqual(1);

    // Toggle ON → instructional surfaces appear: StageIntro, intro strip, the
    // visible span hint and the per-concept AND/OR explainer.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Build your search here: click or drag the key ideas/)).toBeVisible();
    await expect(page.getByTestId('sb-intro-strip')).toBeVisible();
    expect(((await hint.boundingBox()) || { width: 0 }).width).toBeGreaterThan(1);
    await sp.phraseToken(/^exercise$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByText(/any one of them counts as a match/)).toBeVisible();

    // Toggle back OFF → the explainer leaves the DOM again.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(sp.activeConcept.getByText(/any one of them counts as a match/)).toHaveCount(0);
  });

  test('choosing Automated instantly removes Database Strategies and renumbers the rail — and Manual restores it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);

    await automatedCard(sp).click();
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
    await expect(page.getByText('Stage 2 of 5')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Automated search');

    await manualCard(sp).click();
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 2 of 6')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Manual search');
  });

  test('standing on Database Strategies when switching to Automated lands on Results — never a blank panel', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);

    await dbStrategiesPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    const strip = page.getByTestId('mode-chooser-strip');
    await expect(strip).toBeVisible();

    await strip.getByRole('button', { name: /Automated — PecanRev runs it/ }).click();

    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'results');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
  });

  test('the chosen mode persists server-side and is restored on reload; strategy data survives mode flips', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    const label = `wsmode${Date.now()}`;
    await seedGroup(sp, tmpProject.id, label);
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return false;
        const b = await r.json().catch(() => null);
        const terms: string[] = Array.isArray(b?.concepts)
          ? b.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []))
          : [];
        return terms.includes(label);
      }, { timeout: 15_000, message: 'builder never autosaved the concept' })
      .toBe(true);

    await openModeStage(sp);
    await automatedCard(sp).click();
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return null;
        const b = await r.json().catch(() => null);
        return b?.searchMode ?? null;
      }, { timeout: 15_000, message: 'searchMode never persisted' })
      .toBe('automated');

    const saved = await (await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`)).json();
    const savedTerms: string[] = saved.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []));
    expect(savedTerms).toContain(label);
    expect(saved.concepts.some((c: any) => c?.sourcePhrase === label)).toBe(true);

    await sp.openStagedWorkspace(tmpProject.id);
    await expect(modeBadge(sp)).toContainText('Automated search');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
  });

  test('the Send-to-Screening ready marker survives builder edits (two-writer clobber fixed)', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'diabetes');
    const getReady = async () => {
      const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
      if (!r.ok()) return null;
      const b = await r.json().catch(() => null);
      return b?.readyForScreening ?? null;
    };

    const sendPip = rail(sp).getByRole('button', { name: /Send to Screening/ });
    await expect(sendPip).toBeEnabled({ timeout: 15_000 });
    await sendPip.click();
    const markBtn = sp.page.getByRole('button', { name: /Mark strategy ready for screening import/ });
    await expect(markBtn).toBeEnabled({ timeout: 15_000 });
    await markBtn.click();
    await expect.poll(getReady, { timeout: 15_000, message: 'ready marker never persisted' }).toBe(true);

    await termsPip(sp).click();
    await expect(sp.activeConcept).toBeVisible();
    const term = `readykeep${Date.now()}`;
    await sp.addTermToActiveConcept(term);
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return false;
        const b = await r.json().catch(() => null);
        const terms: string[] = Array.isArray(b?.concepts)
          ? b.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []))
          : [];
        return terms.includes(term);
      }, { timeout: 15_000, message: 'builder never autosaved the keyword' })
      .toBe(true);

    expect(await getReady()).toBe(true);
  });

  test('the mode selector is a keyboard radio group: roving tabindex + arrows move selection AND focus', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);

    await expect(manualCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '-1');

    await manualCard(sp).focus();
    await page.keyboard.press('Enter');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(automatedCard(sp)).toBeFocused();
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(manualCard(sp)).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('ArrowLeft');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(manualCard(sp)).toBeFocused();
  });

  test('98.md §11 — suggestions hide behind "Show suggestions (N)"; one MeSH term per accept; dismiss persists; NO bulk accept-all (seeded vocab)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    // QA M26 — HERMETIC: seed free-text terms WITH their vocab records through
    // the API. pendingSuggestions derives its rows from the vocab already riding
    // on the terms, so this journey performs NO live NLM vocabulary lookups
    // (97: automated tests must not make live external controlled-vocab calls).
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Concept 1', op: 'AND', source: 'user_added',
      terms: [
        {
          id: 'tm1', text: 'heart failure', type: 'freetext', field: 'tiab', source: 'user_added',
          vocab: { mesh: 'Heart Failure', meshUI: 'D006333', synonyms: ['cardiac failure'], source: 'core' },
        },
        {
          id: 'tm2', text: 'hypertension', type: 'freetext', field: 'tiab', source: 'user_added',
          vocab: { mesh: 'Hypertension', meshUI: 'D006973', synonyms: ['high blood pressure'], source: 'core' },
        },
      ],
    }]);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.activeConcept).toBeVisible({ timeout: 15_000 });

    // 98.md §11 — CLOSED by default: no suggestion rows in the DOM, only the
    // one-click toggle with the pending count.
    const toggle = page.getByTestId('sb-suggestions-toggle');
    await expect(page.getByTestId('sb-suggestion-row')).toHaveCount(0);
    await expect(toggle).toHaveText(/Show suggestions \(2\)/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Rows derive from the seeded vocab. Locate the MESH rows by their full
    // "why" line: a bare quoted source text would ALSO match the follow-up
    // 'Entry terms for "Heart Failure"' row that appears once the accepted
    // controlled term rides in the group (hasText is case-insensitive).
    const hfRow = sp.suggestionRow('Standard MeSH term for "heart failure"');
    const htnRow = sp.suggestionRow('Standard MeSH term for "hypertension"');
    await expect(hfRow).toBeVisible({ timeout: 15_000 });
    await expect(htnRow).toBeVisible({ timeout: 15_000 });

    // 97.md Phase 13 — the bulk accept-all affordance is GONE.
    await expect(page.getByTestId('sb-accept-all-headings')).toHaveCount(0);

    // Accept one → ONLY that descriptor joins the group (as a "…"[MeSH] chip).
    await hfRow.getByRole('button', { name: /Accept suggestion/ }).click();
    await expect(sp.termChip('Heart Failure')).toBeVisible();
    await expect(sp.termChip('Heart Failure')).toContainText('[MeSH]');
    await expect(hfRow).toHaveCount(0);

    // Dismiss the other → it leaves the list and the rejection persists.
    await htnRow.getByRole('button', { name: /Dismiss suggestion/ }).click();
    await expect(htnRow).toHaveCount(0);
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return null;
        const b = await r.json().catch(() => null);
        return Array.isArray(b?.rejectedSuggestions) ? b.rejectedSuggestions.length : 0;
      }, { timeout: 15_000, message: 'rejection never persisted' })
      .toBeGreaterThan(0);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.activeConcept).toBeVisible({ timeout: 15_000 });
    await expect(sp.termChip('Heart Failure')).toBeVisible();
    // The disclosure re-opens CLOSED (session state); the dismissed row stays
    // gone even with the panel open.
    await expect(page.getByTestId('sb-suggestions-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('sb-suggestions-toggle').click();
    await expect(sp.suggestionRow('Standard MeSH term for "hypertension"')).toHaveCount(0);
  });

  /* 114.md §2 — the red "Build your search" bug, end to end.
     Select & Build Key Terms rendered its description in the DANGER tone because
     a single PENDING VOCABULARY SUGGESTION forced the stage to 'attention' — and
     a suggestion exists for almost every real strategy (any term carrying a
     vocab record), so a complete, runnable search read as a failure. Suggestions
     are advisory now: the stage is 'done' the moment a concept carries a live
     term. Asserted on `data-status` + the aria-label (the a11y contract), never
     on colour, and re-checked after a reload because the rejection/dismissal
     memory that used to keep the red alive is PERSISTED state. */
  test('114.md §2 — a valid strategy reads COMPLETE in the stepper; a pending suggestion never demotes it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const termsStep = page.getByTestId('stitch-stepper-step-terms');

    // Nothing built yet → honestly "Not started" (never a false green).
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(termsStep).toHaveAttribute('data-status', 'empty');

    // A live term WITH a vocab record = a valid strategy that ALSO has one
    // pending suggestion — exactly the state that used to render red.
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Concept 1', op: 'AND', source: 'user_added',
      terms: [{
        id: 'tm1', text: 'heart failure', type: 'freetext', field: 'tiab', source: 'user_added',
        vocab: { mesh: 'Heart Failure', meshUI: 'D006333', synonyms: ['cardiac failure'], source: 'core' },
      }],
    }]);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.activeConcept).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sb-suggestions-toggle')).toHaveText(/Show suggestions \(1\)/);

    await expect(termsStep).toHaveAttribute('data-status', 'done');
    await expect(termsStep).toHaveAttribute('aria-label', /Complete/);
    await expect(termsStep).not.toHaveAttribute('aria-label', /Needs attention/);

    // The suggestion review UI is untouched, and the status survives a reload
    // (advisories recompute from the persisted rejection memory).
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(termsStep).toHaveAttribute('data-status', 'done');

    // Emptying the strategy returns the stage to 'empty' — completion is live.
    await sp.seedStrategy(tmpProject.id, [{ id: 'g1', label: 'Concept 1', op: 'AND', source: 'user_added', terms: [] }]);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(termsStep).toHaveAttribute('data-status', 'empty');
  });

  test('97.md Phase 16 — a stale write is REJECTED (409) and the view reconciles with a visible notice, never clobbering the newer doc', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'imaging');
    await sp.addTermToActiveConcept('EUS');
    await sp.awaitStrategySaved(tmpProject.id, 1);

    // A NEWER document lands via the raw API (page.request bypasses the client
    // save channel AND the poke excludes the acting user), so the mounted
    // builder's known revision goes stale — exactly the stale-collaborator shape.
    const seeded = await page.request.put(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`, {
      data: {
        concepts: [{
          id: 'remote1', label: 'imaging', op: 'AND', source: 'user_added',
          terms: [{ id: 'r-t1', text: 'endosonography', type: 'freetext', field: 'tiab', source: 'user_added' }],
        }],
      },
    });
    expect(seeded.ok()).toBe(true);

    // The user keeps editing on the (now stale) view → the autosave 409s → the
    // builder adopts the fresher document and SAYS SO (sb-conflict-notice).
    await sp.addTermToActiveConcept('MRI');
    await expect(sp.conflictNotice).toBeVisible({ timeout: 15_000 });
    // The newer content is adopted; the stale edit is NOT silently replayed…
    await expect(sp.termChip('endosonography')).toBeVisible();
    await expect(sp.termChip('MRI')).toHaveCount(0);
    // …and the server still holds the newer document (no clobber).
    const after = await (await page.request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`)).json();
    const texts = (after.concepts || []).flatMap((c: any) => (c.terms || []).map((t: any) => t.text));
    expect(texts).toContain('endosonography');
    expect(texts).not.toContain('MRI');
  });

  test('edit in place, disable-without-delete, remove → snackbar Undo restores', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'copd');

    await sp.addTermToActiveConcept('cardiomyopathy');
    await expect(sp.termChip('cardiomyopathy')).toBeVisible();

    await sp.termChip('cardiomyopathy').click();
    await expect(sp.termEditor).toBeVisible();

    const textInput = sp.termEditor.getByLabel('Term text');
    await textInput.fill('cardiomyopathies');
    await sp.termEditor.getByRole('button', { name: 'Done' }).click();
    await expect(sp.termChip('cardiomyopathies')).toBeVisible();

    await sp.termChip('cardiomyopathies').click();
    await sp.termEditor.getByRole('button', { name: 'Disable' }).click();
    await sp.termEditor.getByRole('button', { name: 'Done' }).click();
    await expect(sp.activeConcept.getByText('off', { exact: true })).toBeVisible();

    await sp.termChipRemove('cardiomyopathies').click();
    await expect(sp.termChip('cardiomyopathies')).toHaveCount(0);
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.termChip('cardiomyopathies')).toBeVisible();
  });

  test('manual: DB catalogue → mark ready → the screening handoff link opens', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');

    await openModeStage(sp);
    await manualCard(sp).click();
    await dbStrategiesPip(sp).click();
    await expect(sp.databasePicker).toBeVisible();

    await rail(sp).getByRole('button', { name: /Send to Screening/ }).click();
    const markBtn = page.getByRole('button', { name: /Mark strategy ready for screening import/ });
    await expect(markBtn).toBeEnabled({ timeout: 15_000 });
    await markBtn.click();
    const cont = page.getByTestId('continue-to-screening');
    await expect(cont).not.toHaveAttribute('aria-disabled', 'true');
    await expect(cont).toHaveAttribute('href', /tab=screening&screen=import/);
  });

  test('automated: provider run surface is reachable (no run started)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);
    await automatedCard(sp).click();
    await rail(sp).getByRole('button', { name: /Automated Search/ }).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'results');
    await expect(stageSurface(sp).getByRole('heading', { name: 'Sources', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  /* ════════ axe scans of the reworked stages ════════ */

  test('a11y: the INLINE research-question editor (terms stage) has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    // 98.md §3/§4 — the question stage is retired; scan the terms stage with the
    // inline editor OPEN (the surface that replaced it).
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.editQuestionButton.click();
    await expect(sp.inlineQuestionEditor).toBeVisible();
    await expect(sp.questionEditor).toBeVisible();
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-question-inline',
    });
  });

  test('a11y: the Select & Build Key Terms board (incl. a dark-red duplicate chip) has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.phraseToken(/^exercise$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await sp.addTermToActiveConcept('physical activity');
    await expect(sp.termChip('physical activity')).toBeVisible();
    // Exercise a duplicate so the dark-red state is part of the scanned surface.
    await sp.addConceptGroup('training');
    await sp.addTermToActiveConcept('physical activity');
    await expect(sp.dupBadges.first()).toBeVisible();
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-terms',
    });
  });
});
