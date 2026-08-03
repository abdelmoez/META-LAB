/**
 * searchWorkspace.spec.ts — 74.md + 96.md + 97.md: the staged Search Workspace.
 *
 * 97.md renames the second stage (label-only) to "Select & Build Key Terms" and
 * turns it into a direct Boolean workspace: neutral "Search Group N" groups,
 * visible OR separators + AND connectors, hand-rolled pointer drag (reorder /
 * combine / move between groups), dark-red exact-duplicate chips with a full
 * resolution menu, individual MeSH acceptance (NO bulk accept-all), the MeSH
 * details popover, the explicit Regenerate button with a snapshot-first
 * confirmation, and global Ctrl/Cmd+Z guarded against typing surfaces.
 *
 * What this spec drives end-to-end in a real browser:
 *   - the 7-stage rail (renamed pip); automated mode still drops Database
 *     Strategies; retired deep links land on the terms stage;
 *   - the terms-centric journey: question → phrase click creates a search group →
 *     add terms → preview updates; drift keep/remove; merge/split/delete + Undo;
 *   - 97.md: drag-combine (token + chip merge targets are DISTINCT from reorder),
 *     chip drag onto a navigator pill MOVES (never clones), duplicate dark-red
 *     journey (find-other / keep-both / persistence), same-group add prevention
 *     with Find existing term, MeSH popover + per-entry-term add (seeded vocab —
 *     no live NLM), Regenerate cancel/confirm/undo (+ "Before regeneration"
 *     snapshot in Versions), Ctrl+Z outside vs inside a text field;
 *   - the mode/persistence/two-writer/keyboard journeys from 96.md, relabeled;
 *   - axe scans of the question + terms stages.
 *
 * Net-new drag surface = the highest flake risk: gestures use explicit
 * mouse.down/move/up with steps, generous hover holds for merge arming, and
 * poll-based API waits before any hard navigation.
 */
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { expectNoSeriousA11y } from '../helpers/axe';

test.describe('97.md — the staged Search Workspace (Select & Build Key Terms)', () => {
  const rail = (sp: SearchPage) => sp.stageNav;
  const stageSurface = (sp: SearchPage) => sp.stageSurface;
  const termsPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Select & Build Key Terms/ });
  const dbStrategiesPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Database Strategies/ });
  const manualCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-manual');
  const automatedCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-automated');
  const modeBadge = (sp: SearchPage) => sp.page.getByTestId('search-mode-badge');

  async function openModeStage(sp: SearchPage): Promise<void> {
    await rail(sp).getByRole('button', { name: /Search Mode/ }).click();
    await expect(manualCard(sp)).toBeVisible();
  }

  /** Open the terms stage and create a search group via the manual add box. */
  async function seedGroup(sp: SearchPage, projectId: string, label: string): Promise<void> {
    await sp.gotoStage(projectId, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.addConceptGroup(label);
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(label);
  }

  test('@smoke an undecided project renders the full 7-stage rail with the renamed terms pip', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);

    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    // 97.md Phase 5 — the renamed pip; the old label is GONE.
    await expect(termsPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Terms & Vocabulary/ })).toHaveCount(0);
    await expect(page.getByText('Stage 1 of 7')).toBeVisible();
    // 96.md — the retired stages never render as pips.
    await expect(rail(sp).getByRole('button', { name: /Test & Refine/ })).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /^Concepts$/ })).toHaveCount(0);
    await expect(modeBadge(sp)).toHaveCount(0);
  });

  test('96.md — retired deep links (?stage=concepts / ?stage=refine) land on the terms stage', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    for (const retired of ['concepts', 'refine']) {
      await expect(async () => {
        await sp.shell.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=${retired}`);
        await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms', { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      await expect.poll(() => new URL(page.url()).searchParams.get('stage')).toBe('terms');
    }
  });

  test('the Research Question stage is an EDITOR whose text feeds the terms workspace', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Do SGLT2 inhibitors reduce hospital readmission in adults with heart failure?';
    await sp.setQuestion(tmpProject.id, q);
    await expect(stageSurface(sp).getByText(/Population \/ Problem/)).toHaveCount(0);

    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await expect(sp.phraseToken('heart failure')).toBeVisible();
  });

  test('@smoke terms journey: phrase click creates a search group; duplicate click focuses/dequeues; preview ANDs groups', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    const q = 'Does metformin reduce mortality in adults with obesity?';
    await sp.setQuestion(tmpProject.id, q);
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // Click a token → a search group appears, active, holding the phrase as a term.
    await sp.phraseToken(/^metformin$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('metformin')).toBeVisible();
    await expect(sp.phraseToken(/metformin/)).toHaveAttribute('aria-pressed', 'true');

    // Add a synonym; the group now holds MORE than its origin term…
    await sp.addTermToActiveConcept('dimethylbiguanide');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();
    // 97.md Phase 8 — the OR relationship is explicit between chips.
    await expect(sp.activeConcept.getByText('OR', { exact: true }).first()).toBeVisible();
    // …so clicking the token again FOCUSES the group (never silently deletes work).
    await sp.phraseToken(/metformin/).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('metformin');
    await expect(sp.termChip('dimethylbiguanide')).toBeVisible();

    // A second group from another phrase; the preview shows both, AND-connected.
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.strategyPreview).toContainText('metformin');
    await expect(sp.strategyPreview).toContainText('mortality');
    await expect(sp.strategyPreview.getByTestId('sb-preview-op').first()).toContainText('AND');

    // 97.md Phase 7 — no "Search Quality Check" card anywhere on the stage.
    await expect(stageSurface(sp).getByText(/Search Quality Check/i)).toHaveCount(0);
  });

  test('97.md Phase 6 — dragging a question token onto another combines the span into one phrase group', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does endoscopic drainage of malignant biliary obstruction improve survival?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await expect(sp.questionCard).toBeVisible();

    // "malignant biliary obstruction" is a CURATED phrase — the tokenizer emits
    // it as ONE token, so the drag-combine journey needs two separate word
    // tokens. Drag "endoscopic" onto "drainage": the merge ring arms after the
    // hover threshold and the drop creates ONE group from the contiguous span.
    const from = sp.phraseToken(/^endoscopic$/);
    const to = sp.phraseToken(/^drainage$/);
    await expect(from).toBeVisible();
    await sp.dragTo(from, to, { holdMs: 600 });
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(/endoscopic drainage/);
    // The combine toast offers Undo (97: "Combined into … — Undo").
    await expect(sp.undoSnackbar).toBeVisible();
    await expect(sp.undoSnackbar).toContainText('Combined into');
    // Undo removes the freshly created group again.
    await sp.undoSnackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(sp.navigatorPill('endoscopic drainage')).toHaveCount(0);
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

  test('97.md Phase 11 — chip drag onto a navigator pill MOVES the term (never clones); explicit copy duplicates', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'obstruction');
    await sp.addTermToActiveConcept('stricture');
    await sp.addConceptGroup('drainage');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('drainage');

    // Work from the FIRST group; drag its chip onto the second group's pill.
    await sp.navigatorPill('obstruction').click();
    await expect(sp.termChip('stricture')).toBeVisible();
    await sp.dragTo(sp.termChip('stricture'), sp.navigatorPill('drainage'));
    // Default drag MOVES: gone here…
    await expect(sp.termChip('stricture')).toHaveCount(0);
    // …present there (with Undo offered — "Moved “stricture” to drainage").
    await expect(sp.undoSnackbar).toContainText('Moved “stricture” to drainage');
    await sp.navigatorPill('drainage').click();
    await expect(sp.termChip('stricture')).toBeVisible();

    // EXPLICIT copy via the popover menu (Phase 9 — duplication is deliberate).
    await sp.termChip('stricture').click();
    await sp.termEditor.getByTestId('sb-copy-btn').click();
    await sp.termEditor.getByRole('button', { name: 'obstruction', exact: true }).click();
    // The copy lands in the other group; this one keeps its chip.
    await sp.navigatorPill('obstruction').click();
    await expect(sp.termChip('stricture')).toBeVisible();
    await sp.navigatorPill('drainage').click();
    await expect(sp.termChip('stricture')).toBeVisible();
  });

  test('drift: editing the question flags groups whose phrase left it — keep/remove, never auto-delete', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does metformin reduce mortality in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.phraseToken(/^mortality$/).click();
    await expect(sp.activeConcept).toBeVisible();
    await sp.awaitStrategySaved(tmpProject.id, 1);

    await sp.setQuestion(tmpProject.id, 'Does metformin reduce cardiovascular events in adults?');
    await sp.gotoStage(tmpProject.id, 'terms');

    await expect(sp.driftBanner).toBeVisible();
    await expect(sp.driftBanner).toContainText('mortality');
    await expect(sp.navigatorPill('mortality')).toBeVisible();

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

  test('97.md Phase 12 — duplicate journey: dark-red chips, find other, keep both intentionally, persistence', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'obstruction');
    await sp.addTermToActiveConcept('EUS');
    await sp.addConceptGroup('drainage');
    await sp.addTermToActiveConcept('EUS'); // exact duplicate ACROSS groups — allowed, warned

    // EVERY affected chip gets the dark-red Duplicate badge (icon + SR label).
    // The workspace is master-detail — only the ACTIVE group's chips render —
    // so assert the badge on each group's copy in turn.
    await expect(sp.dupBadges).toHaveCount(1);
    await expect(sp.dupBadges.first()).toHaveAttribute('aria-label', /Exact duplicate across AND groups/);
    await sp.navigatorPill('obstruction').click();
    await expect(sp.dupBadges).toHaveCount(1);
    await expect(sp.dupBadges.first()).toHaveAttribute('aria-label', /Exact duplicate across AND groups/);
    await sp.navigatorPill('drainage').click();
    await expect(sp.dupBadges).toHaveCount(1);

    // Find other duplicate: scrolls + focuses the other copy (group switches).
    await sp.termChip('EUS').click();
    await expect(sp.dupActions).toBeVisible();
    await sp.dupActions.getByRole('button', { name: 'Find other duplicate' }).click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('obstruction');
    await expect(sp.termChip('EUS')).toBeFocused();

    // Keep both intentionally → warning mutes on BOTH chips; the calm marker shows
    // (checked per group — master-detail renders one group's chips at a time).
    await sp.termChip('EUS').click();
    await sp.dupActions.getByRole('button', { name: 'Keep both intentionally' }).click();
    await expect(sp.dupBadges).toHaveCount(0);
    await expect(sp.intentionalBadges.first()).toBeVisible();
    await sp.navigatorPill('drainage').click();
    await expect(sp.dupBadges).toHaveCount(0);
    await expect(sp.intentionalBadges.first()).toBeVisible();

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
    await expect(sp.intentionalBadges.first()).toBeVisible();
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

  test('97.md Phase 13 — MeSH details popover: informational, per-entry-term add only (seeded vocab, no live NLM)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    // Seed a controlled term WITH its vocab record directly through the API —
    // hermetic: no vocabulary lookups run for already-attached vocab.
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Search Group 1', op: 'AND', source: 'user_added',
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
      id: 'g1', label: 'Search Group 1', op: 'AND', source: 'user_added',
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

  test('97.md Phase 4 — Regenerate: cancel keeps everything; confirm snapshots first, rebuilds, Undo restores', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does endoscopic ultrasound guided drainage reduce mortality in malignant biliary obstruction?');
    await sp.gotoStage(tmpProject.id, 'terms');
    await sp.addConceptGroup('my manual group');
    await sp.addTermToActiveConcept('handmade term');
    await sp.awaitStrategySaved(tmpProject.id, 1);

    // CANCEL leaves all state unchanged.
    await sp.regenerateButton.click();
    await expect(sp.regenerateDialog).toBeVisible();
    await expect(sp.regenerateDialog).toContainText('Regenerate search strategy?');
    await expect(sp.regenerateDialog).toContainText('Your current manual organization may change.');
    await sp.regenerateDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(sp.regenerateDialog).toHaveCount(0);
    await expect(sp.navigatorPill('my manual group')).toBeVisible();
    await expect(sp.termChip('handmade term')).toBeVisible();

    // CONFIRM: a "Before regeneration" snapshot lands in Versions, the groups are
    // rebuilt with neutral names, and the toast offers Undo.
    await sp.regenerateButton.click();
    await sp.regenerateDialog.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(sp.regenerateDialog).toHaveCount(0, { timeout: 15_000 });
    await expect(sp.undoSnackbar).toContainText('Search strategy regenerated.');
    await expect(sp.navigatorPill('Search Group 1')).toBeVisible();
    await expect(sp.navigatorPill('my manual group')).toHaveCount(0);
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
    await expect(sp.navigatorPill('my manual group')).toBeVisible();
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
    await sp.workspaceHeading.click(); // move focus off the input
    await page.keyboard.press('Control+z');
    await expect(sp.termChip('emphysema')).toBeVisible();
  });

  test('the terms stage hosts the per-database previews + estimates + versions', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await seedGroup(sp, tmpProject.id, 'asthma');
    await expect(sp.dbPreviews).toBeVisible();
    await expect(sp.dbPreviews.getByTestId('sb-db-strategy-pubmed')).toBeVisible();
    await sp.estimatesCard.scrollIntoViewIfNeeded();
    await expect(sp.estimatesCard).toBeVisible();
    await expect(stageSurface(sp).getByText(/Versions/)).toBeVisible();
  });

  test('choosing Automated instantly removes Database Strategies and renumbers the rail — and Manual restores it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await sp.openStagedWorkspace(tmpProject.id);
    await openModeStage(sp);

    await automatedCard(sp).click();
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
    await expect(page.getByText('Stage 3 of 6')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Automated search');

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
      }, { timeout: 15_000, message: 'builder never autosaved the concept group' })
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

  test('vocabulary suggestions — one MeSH term per accept; dismiss persists across reload; NO bulk accept-all (seeded vocab, no live NLM)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    // QA M26 — HERMETIC: seed free-text terms WITH their vocab records through
    // the API. pendingSuggestions derives its rows from the vocab already riding
    // on the terms, so this journey performs NO live NLM vocabulary lookups
    // (97: automated tests must not make live external controlled-vocab calls).
    await sp.seedStrategy(tmpProject.id, [{
      id: 'g1', label: 'Search Group 1', op: 'AND', source: 'user_added',
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
    await expect(sp.suggestionRow('Standard MeSH term for "hypertension"')).toHaveCount(0);
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

  test('a11y: the Research Question stage has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await sp.setQuestion(tmpProject.id, 'Does exercise reduce falls in older adults?');
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-question',
    });
  });

  test('a11y: the Select & Build Key Terms stage (incl. a dark-red duplicate chip) has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
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
