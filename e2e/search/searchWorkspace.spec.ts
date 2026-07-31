/**
 * searchWorkspace.spec.ts — 74.md + 96.md: the staged Search Workspace.
 *
 * 96.md retired the legacy 3-step wizard and its `searchWorkspaceV2` gate: the
 * workspace renders whenever `searchEngine` is ON (global-setup enables it), so no
 * flag flipping is needed here any more. The workflow is 7 stages — Research
 * Question (an EDITOR now) → Terms & Vocabulary (the central workspace: question
 * phrase-selection → concept groups, vocabulary, group ops, per-database previews,
 * estimates + versions) → Search Mode → Database Strategies (manual only) →
 * Results → Documentation → Send to Screening.
 *
 * What this spec drives end-to-end in a real browser:
 *   - the 7-stage rail; automated mode REMOVES Database Strategies (6 stages) and
 *     never strands the user on a removed stage (Database Strategies → Results);
 *   - retired deep links (?stage=concepts / ?stage=refine) land on Terms & Vocabulary;
 *   - the terms-centric journey: question → phrase click creates a concept group →
 *     synonyms/vocabulary → preview → mode → screening handoff;
 *   - drift: editing the question flags (never deletes) groups whose phrase left it;
 *   - group management: merge / split / reorder / delete with snackbar Undo;
 *   - the choice persists server-side (single-key `searchMode` save) and strategy
 *     data survives mode flips;
 *   - axe scans of the question + terms stages.
 */
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { expectNoSeriousA11y } from '../helpers/axe';

test.describe('96.md — the staged Search Workspace (7 stages, terms-centric)', () => {
  const rail = (sp: SearchPage) => sp.stageNav;
  const stageSurface = (sp: SearchPage) => sp.stageSurface;
  const dbStrategiesPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Database Strategies/ });
  const manualCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-manual');
  const automatedCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-automated');
  const modeBadge = (sp: SearchPage) => sp.page.getByTestId('search-mode-badge');

  async function openModeStage(sp: SearchPage): Promise<void> {
    await rail(sp).getByRole('button', { name: /Search Mode/ }).click();
    await expect(manualCard(sp)).toBeVisible();
  }

  /** Open Terms & Vocabulary and create a concept group via the manual add box. */
  async function seedGroup(sp: SearchPage, projectId: string, label: string): Promise<void> {
    await sp.gotoStage(projectId, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.addConceptGroup(label);
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(label);
  }

  test('@smoke an undecided project renders the full 7-stage rail (no Concepts / Test & Refine)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);

    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Terms & Vocabulary/ })).toBeVisible();
    await expect(page.getByText('Stage 1 of 7')).toBeVisible();
    // 96.md — the retired stages never render as pips.
    await expect(rail(sp).getByRole('button', { name: /Test & Refine/ })).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /^Concepts$/ })).toHaveCount(0);
    // No mode chosen yet → no header badge.
    await expect(modeBadge(sp)).toHaveCount(0);
  });

  test('96.md — retired deep links (?stage=concepts / ?stage=refine) land on Terms & Vocabulary', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    for (const retired of ['concepts', 'refine']) {
      await expect(async () => {
        await sp.shell.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=${retired}`);
        await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms', { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      // …and the URL is rewritten so back/forward never point at the phantom stage.
      await expect.poll(() => new URL(page.url()).searchParams.get('stage')).toBe('terms');
    }
  });

  test('the Research Question stage is an EDITOR whose text feeds the terms workspace', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?';
    await sp.setQuestion(tmpProject.id, q);
    // No PICO cards/copy on the question stage (96.md D1).
    await expect(stageSurface(sp).getByText(/Population \/ Problem/)).toHaveCount(0);

    // The question text appears on the terms stage's phrase-selection card.
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await expect(sp.phraseToken('heart failure')).toBeVisible();
  });

  test('@smoke terms journey: phrase click creates a concept group; duplicate click focuses/dequeues', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Does metformin reduce mortality in adults with obesity?';
    await sp.setQuestion(tmpProject.id, q);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // Click a token → a concept group appears, active, holding the phrase as a term.
    await sp.phraseToken(/^metformin$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('metformin')).toBeVisible();
    // The token reads selected (aria-pressed) — duplicate-phrase prevention.
    await expect(sp.phraseToken(/metformin/)).toHaveAttribute('aria-pressed', 'true');

    // Add a synonym; the group now holds MORE than its origin term…
    await sp.addTermToActiveConcept('dimethylbiguanide');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();
    // …so clicking the token again FOCUSES the group (never silently deletes work).
    await sp.phraseToken(/metformin/).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();

    // A second group from another phrase; the strategy preview shows both AND-ed.
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.strategyPreview).toContainText('metformin');
    await expect(sp.strategyPreview).toContainText('mortality');
    await expect(sp.strategyPreview.getByTestId('sb-preview-op').first()).toContainText('AND');
  });

  test('drift: editing the question flags groups whose phrase left it — keep/remove, never auto-delete', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does metformin reduce mortality in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.activeConcept).toBeVisible();
    // The autosave is debounced — navigating away before it lands would lose the
    // group (and the drift banner would have nothing to flag).
    await sp.awaitStrategySaved(tmpProject.id, 1);

    // Change the question so "mortality" no longer appears.
    await sp.setQuestion(tmpProject.id, 'Does metformin reduce cardiovascular events in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');

    // The banner lists the drifted group with keep/edit/remove — the group SURVIVES.
    await expect(sp.driftBanner).toBeVisible();
    await expect(sp.driftBanner).toContainText('mortality');
    await expect(sp.navigatorPill('mortality')).toBeVisible();

    // Keep → the banner clears (snapshot updated) and the group remains.
    await sp.driftBanner.getByRole('button', { name: /Keep concepts/ }).click();
    await expect(sp.driftBanner).toHaveCount(0);
    await expect(sp.navigatorPill('mortality')).toBeVisible();
  });

  test('group management: merge, split and delete-with-confirm are undoable', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'heart failure');
    await sp.addTermToActiveConcept('cardiac failure');
    await sp.addConceptGroup('cardiomyopathy');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('cardiomyopathy');

    // MERGE cardiomyopathy into heart failure — the term moves, the group goes.
    await sp.groupActions.getByRole('button', { name: /Merge cardiomyopathy into another group/ }).click();
    await sp.page.getByRole('button', { name: 'heart failure', exact: true }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('heart failure');
    await expect(sp.termChip('cardiomyopathy')).toBeVisible();
    await expect(sp.navigatorPill('cardiomyopathy')).toHaveCount(0);
    // Undo restores the merged-away group.
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.navigatorPill('cardiomyopathy')).toBeVisible();

    // SPLIT: move "cardiac failure" out of heart failure into a new group.
    await sp.navigatorPill('heart failure').click();
    await sp.groupActions.getByRole('button', { name: /Split terms out of heart failure/ }).click();
    await expect(sp.splitPanel).toBeVisible();
    await sp.splitPanel.getByLabel(/Select cardiac failure/).check();
    await sp.splitPanel.getByLabel('New group name').fill('cardiac failure');
    await sp.splitPanel.getByRole('button', { name: /Split 1 term/ }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('cardiac failure');
    await expect(sp.termChip('cardiac failure')).toBeVisible();

    // DELETE any group needs an inline confirm; Undo restores it.
    await sp.groupActions.getByRole('button', { name: /Delete group cardiac failure/ }).click();
    await sp.groupActions.getByRole('button', { name: /Confirm delete cardiac failure/ }).click();
    await expect(sp.navigatorPill('cardiac failure')).toHaveCount(0);
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.navigatorPill('cardiac failure')).toBeVisible();
  });

  test('Terms & Vocabulary hosts the per-database previews + estimates + versions', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');
    // Compiled per-database preview cards (the DbStrategyPanel affordances).
    await expect(sp.dbPreviews).toBeVisible();
    await expect(sp.dbPreviews.getByTestId('sb-db-strategy-pubmed')).toBeVisible();
    // The relocated estimates + versions panels (formerly Test & Refine).
    await sp.estimatesCard.scrollIntoViewIfNeeded();
    await expect(sp.estimatesCard).toBeVisible();
    await expect(stageSurface(sp).getByText(/Versions/)).toBeVisible();
  });

  test('choosing Automated instantly removes Database Strategies and renumbers the rail — and Manual restores it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);

    // Choose AUTOMATED — the interface updates in place (no navigation).
    await automatedCard(sp).click();
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
    await expect(page.getByText('Stage 3 of 6')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Automated search');

    // Back to MANUAL — the manual workflow returns, automated labels leave.
    await manualCard(sp).click();
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 3 of 7')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Manual search');
  });

  test('standing on Database Strategies when switching to Automated lands on Results — never a blank panel', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);

    // With no mode chosen, walk onto the (still-available) manual-only stage; the
    // slim chooser strip rides above it.
    await dbStrategiesPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    const strip = page.getByTestId('mode-chooser-strip');
    await expect(strip).toBeVisible();

    // Choose Automated FROM the stage that is about to disappear.
    await strip.getByRole('button', { name: /Automated — PecanRev runs it/ }).click();

    // Immediate remap: the workspace lands on Results, the rail loses the
    // manual-only stage, and no empty panel is left behind.
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'results');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
  });

  test('the chosen mode persists server-side and is restored on reload; strategy data survives mode flips', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    const label = `wsmode${Date.now()}`;
    await seedGroup(sp, tmpProject.id, label);
    // Wait for the builder autosave to land server-side (concepts + questionSnapshot ride together).
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return false;
        const b = await r.json().catch(() => null);
        const terms: string[] = Array.isArray(b?.concepts)
          ? b.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []))
          : [];
        return terms.includes(label);
      }, { timeout: 15_000, message: 'builder never autosaved the concept group' })
      .toBe(true);

    // Choose AUTOMATED and wait for the single-key searchMode save.
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

    // The mode flip preserved the strategy data (incl. the group's sourcePhrase).
    const saved = await (await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`)).json();
    const savedTerms: string[] = saved.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []));
    expect(savedTerms).toContain(label);
    expect(saved.concepts.some((c: any) => c?.sourcePhrase === label)).toBe(true);

    // Reload — the automated workflow is restored.
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

    // Mark the strategy ready on the Send to Screening stage (single-key save).
    const sendPip = rail(sp).getByRole('button', { name: /Send to Screening/ });
    await expect(sendPip).toBeEnabled({ timeout: 15_000 }); // opens once the builder reports concepts
    await sendPip.click();
    const markBtn = sp.page.getByRole('button', { name: /Mark strategy ready for screening import/ });
    await expect(markBtn).toBeEnabled({ timeout: 15_000 });
    await markBtn.click();
    await expect.poll(getReady, { timeout: 15_000, message: 'ready marker never persisted' }).toBe(true);

    // Now edit the strategy — the builder's debounced FULL-shape autosave fires…
    await rail(sp).getByRole('button', { name: /Terms & Vocabulary/ }).click();
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

    // …and the ready marker is STILL true (the autosave never re-emits a stale copy).
    expect(await getReady()).toBe(true);
  });

  test('the mode selector is a keyboard radio group: roving tabindex + arrows move selection AND focus', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);

    // Before any choice the group has ONE tab stop: the first card.
    await expect(manualCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '-1');

    // Enter/Space and arrow behaviour.
    await manualCard(sp).focus();
    await page.keyboard.press('Enter');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(automatedCard(sp)).toBeFocused();
    // Roving tab stop follows the selection.
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(manualCard(sp)).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('ArrowLeft');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(manualCard(sp)).toBeFocused();
  });

  test('vocabulary suggestions — accept adds a subject heading; dismiss persists across reload', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'heart failure');
    await sp.addTermToActiveConcept('hypertension');

    // The review disclosure lists heading suggestions once lookups attach vocab.
    const hfRow = sp.suggestionRow('subject heading for "heart failure"');
    const htnRow = sp.suggestionRow('subject heading for "hypertension"');
    await expect(hfRow).toBeVisible({ timeout: 20_000 });
    await expect(htnRow).toBeVisible({ timeout: 20_000 });

    // Accept one → the descriptor chip (with MeSH badge) joins the included terms.
    const hfAccept = hfRow.getByRole('button', { name: /Accept suggestion/ });
    const hfDescriptor = ((await hfAccept.getAttribute('aria-label')) || '').replace(/^Accept suggestion\s*/i, '').trim();
    expect(hfDescriptor.length, 'the subject-heading suggestion names a descriptor').toBeGreaterThan(0);
    await hfAccept.click();
    await expect(sp.termChip(hfDescriptor)).toBeVisible();
    await expect(hfRow).toHaveCount(0);

    // Dismiss the other → it leaves the list…
    await htnRow.getByRole('button', { name: /Dismiss suggestion/ }).click();
    await expect(htnRow).toHaveCount(0);

    // …and the rejection PERSISTS server-side (rejectedSuggestions round-trip).
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
    await expect(sp.termChip(hfDescriptor)).toBeVisible();
    await expect(sp.suggestionRow('subject heading for "hypertension"')).toHaveCount(0);
  });

  test('edit in place, disable-without-delete, remove → snackbar Undo restores', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'copd');

    await sp.addTermToActiveConcept('cardiomyopathy');
    await expect(sp.termChip('cardiomyopathy')).toBeVisible();

    // The whole chip opens the editor popover.
    await sp.termChip('cardiomyopathy').click();
    await expect(sp.termEditor).toBeVisible();

    // Edit the text IN PLACE (replace without delete).
    const textInput = sp.termEditor.getByLabel('Term text');
    await textInput.fill('cardiomyopathies');
    await sp.termEditor.getByRole('button', { name: 'Done' }).click();
    await expect(sp.termChip('cardiomyopathies')).toBeVisible();

    // Disable-without-delete: the chip stays, marked off.
    await sp.termChip('cardiomyopathies').click();
    await sp.termEditor.getByRole('button', { name: 'Disable' }).click();
    await sp.termEditor.getByRole('button', { name: 'Done' }).click();
    await expect(sp.activeConcept.getByText('off', { exact: true })).toBeVisible();

    // Remove → undo snackbar → Undo restores the chip.
    await sp.termChipRemove('cardiomyopathies').click();
    await expect(sp.termChip('cardiomyopathies')).toHaveCount(0);
    await expect(sp.undoSnackbar).toBeVisible();
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.termChip('cardiomyopathies')).toBeVisible();
  });

  test('manual: DB catalogue → mark ready → the screening handoff link opens', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');

    // Manual mode → Database Strategies exists and shows the catalogue.
    await openModeStage(sp);
    await manualCard(sp).click();
    await dbStrategiesPip(sp).click();
    await expect(sp.databasePicker).toBeVisible();

    // Send to Screening: mark ready, then the footer handoff enables with a real href.
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
    // The Pecan run surface mounts (sources + strategy cards) — we do NOT run.
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'results');
    await expect(stageSurface(sp).getByRole('heading', { name: 'Sources', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  /* ════════ axe scans of the reworked stages ════════ */

  test('a11y: the Research Question stage has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-question',
    });
  });

  test('a11y: the Terms & Vocabulary stage has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.phraseToken(/^exercise$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await sp.addTermToActiveConcept('physical activity');
    await expect(sp.termChip('physical activity')).toBeVisible();
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-terms',
    });
  });
});
