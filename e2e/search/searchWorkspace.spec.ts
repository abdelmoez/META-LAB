/**
 * searchWorkspace.spec.ts — 74.md: the staged Search Workspace's MODE-SCOPED workflow
 * (flag `searchWorkspaceV2`, OFF by default — flipped ON once in beforeAll via a
 * dedicated admin request context and FORCED back OFF in afterAll; see Flag note).
 *
 * What 74.md demands and this spec drives end-to-end in a real browser:
 *   - the selected search mode controls the ENTIRE visible workflow: automated mode
 *     REMOVES the manual-only Database Strategies stage (renumbered 8-stage rail),
 *     manual mode never mounts the automated run surface;
 *   - switching modes updates the rail IMMEDIATELY (no reload) and never strands the
 *     user on a removed stage (Database Strategies → Test & Refine);
 *   - the choice persists server-side (single-key `searchMode` save) and is restored
 *     on reload, WITHOUT touching the strategy data built in either mode;
 *   - the mode selector is a real radio group: roving tabindex, arrow keys move both
 *     selection and focus.
 *
 * Flag note: feature flags are GLOBAL server state (same caveat as the waitlist
 * spec, and the same pattern): this describe is serial, flips the flag ON once in
 * beforeAll via a dedicated admin request context, and FORCES it back OFF in
 * afterAll — deterministic even when a mid-suite failure serial-skips the rest
 * (a per-test snapshot/restore proved fragile exactly there). CI runs
 * single-worker, so the legacy-wizard spec never observes the temporary flip.
 */
import { request as apiRequest, APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { setFeatureFlags } from '../helpers/api';
import { BASE_URL, adminStatePath } from '../helpers/env';
import { expectNoSeriousA11y } from '../helpers/axe';

test.describe.serial('74.md — mode-scoped staged Search Workspace (searchWorkspaceV2 ON)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await apiRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    await setFeatureFlags(adminCtx, { searchWorkspaceV2: true });
  });

  test.afterAll(async () => {
    try { await setFeatureFlags(adminCtx, { searchWorkspaceV2: false }); }
    finally { await adminCtx?.dispose(); }
  });
  /** Open ?tab=search and wait for the STAGED workspace (not the legacy wizard). 75.md
   *  moved the numbered workflow into the WHITE project side-menu, so the "we are in the
   *  staged workspace" signal is the always-present stage surface (in BOTH shells), NOT
   *  the in-body rail (which `hideRail` drops under the Stitch shell). */
  async function openWorkspace(sp: SearchPage, projectId: string): Promise<void> {
    await sp.openStagedWorkspace(projectId);
  }

  // 75.md — stage navigation happens through whichever surface the shell renders: the
  // white side-menu stepper (Stitch shell) OR the in-body StageRail (hideRail=false).
  // `sp.stageNav` is the union locator; both carry the stage label in each pip's name.
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

  test('@smoke an undecided project renders the full 9-stage rail (Database Strategies included)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 1 of 9')).toBeVisible();
    // No mode chosen yet → no header badge.
    await expect(modeBadge(sp)).toHaveCount(0);
  });

  test('choosing Automated instantly removes Database Strategies and renumbers the rail — and Manual restores it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await openModeStage(sp);

    // Choose AUTOMATED — the interface updates in place (no navigation).
    await automatedCard(sp).click();
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
    await expect(page.getByText('Stage 4 of 8')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Automated search');

    // Back to MANUAL — the manual workflow returns, automated labels leave.
    await manualCard(sp).click();
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 4 of 9')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Manual search');
  });

  test('standing on Database Strategies when switching to Automated lands on Test & Refine — never a blank panel', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // With no mode chosen, walk onto the (still-available) manual-only stage; the
    // slim chooser strip rides above it.
    await dbStrategiesPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    const strip = page.getByTestId('mode-chooser-strip');
    await expect(strip).toBeVisible();

    // Choose Automated FROM the stage that is about to disappear.
    await strip.getByRole('button', { name: /Automated — PecanRev runs it/ }).click();

    // Immediate remap: the workspace lands on Test & Refine, the rail loses the
    // manual-only stage, and no empty panel is left behind.
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'refine');
    // Scoped to the stage surface — the rail pip "Test & Refine" also matches this
    // text case-insensitively.
    await expect(stageSurface(sp).getByText('Test & refine')).toBeVisible();
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
  });

  test('the chosen mode persists server-side and is restored on reload; strategy data survives mode flips', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // Seed some MANUAL-side work first: a keyword on the Concepts stage.
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    const term = `wsmode${Date.now()}`;
    await sp.addKeyword('Population', term);
    await expect(sp.selectedKeywordRemove(term)).toBeVisible();
    // Wait for the builder autosave to land server-side.
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

    // The mode flip preserved the manual-side strategy data (test req 8).
    const saved = await (await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`)).json();
    const savedTerms: string[] = saved.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []));
    expect(savedTerms).toContain(term);

    // Reload — the automated workflow is restored (test req 9).
    await openWorkspace(sp, tmpProject.id);
    await expect(modeBadge(sp)).toContainText('Automated search');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
  });

  test('the Send-to-Screening ready marker survives builder edits (two-writer clobber fixed)', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
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
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    const term = `readykeep${Date.now()}`;
    await sp.addKeyword('Population', term);
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

    // …and the ready marker is STILL true (the autosave no longer re-emits its
    // stale mount-time copy over the Screening-stage toggle).
    expect(await getReady()).toBe(true);
  });

  test('the mode selector is a keyboard radio group: roving tabindex + arrows move selection AND focus', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
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

  /* ════════ 85.md — novice scenario flows over the redesigned Concepts +
     Terms & Vocabulary stages (concept cards, master-detail, preview, undo) ════ */

  test('S1: create concepts → Edit terms → add a synonym → preview reflects it → Next', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // Concepts stage — the keyword picker keeps its pinned placeholders.
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    await expect(sp.conceptCards).toBeVisible();
    await sp.addKeyword('Population', 'diabetes');
    await sp.addKeyword('Intervention / Exposure', 'metformin');
    await expect(sp.selectedKeywordRemove('diabetes')).toBeVisible();

    // The ONE primary card action navigates to Terms & Vocabulary with the concept active.
    await sp.editTermsButton('Population').click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'terms');
    await expect(sp.activeConcept).toBeVisible();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('Population');

    // Add a synonym via the explicit Add button; the chip + outcome line appear.
    await sp.addTermToActiveConcept('hyperglycemia');
    await expect(sp.termChip('hyperglycemia')).toBeVisible();
    await expect(sp.addStatusLine).toContainText(/Added|added/);

    // The strategy preview names the concept and carries the new term.
    await expect(sp.strategyPreview).toBeVisible();
    await expect(sp.strategyPreview).toContainText('Population');
    await expect(sp.strategyPreview).toContainText('hyperglycemia');

    // Blur retention: a half-typed draft survives a navigator switch (round-trip).
    await sp.addTermInput.fill('half-typed');
    await sp.navigatorPill('Intervention').click();
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue(/Intervention/);
    await sp.navigatorPill('Population').click();
    await expect(sp.addTermInput).toHaveValue('half-typed');
    // …and Escape clears it deliberately (no silent commit — the C3 fix).
    await sp.addTermInput.press('Escape'); // closes the dropdown if open
    await sp.addTermInput.press('Escape'); // clears the draft
    await expect(sp.addTermInput).toHaveValue('');
    await expect(sp.termChip('half-typed')).toHaveCount(0);

    // Footer Next continues the staged flow.
    await page.getByRole('button', { name: /Next: Search Mode/ }).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'mode');
  });

  test('S2: vocabulary suggestions — accept adds a subject heading; dismiss persists across reload', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // Seed two terms with known vocabulary (live NLM or the offline core fallback).
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    await sp.addKeyword('Population', 'heart failure');
    await sp.addKeyword('Population', 'hypertension');

    await sp.editTermsButton('Population').click();
    await expect(sp.activeConcept).toBeVisible();

    // The review disclosure lists heading suggestions once lookups attach vocab.
    // Scope rows by their "why" line so a later synonyms-suggestion for the SAME
    // heading can never alias these locators.
    const hfRow = sp.suggestionRow('subject heading for "heart failure"');
    const htnRow = sp.suggestionRow('subject heading for "hypertension"');
    await expect(hfRow).toBeVisible({ timeout: 20_000 });
    await expect(htnRow).toBeVisible({ timeout: 20_000 });

    // Accept one → the descriptor chip (with MeSH badge) joins the included terms. The
    // exact descriptor is vocabulary-dependent (live NLM or the offline core fallback —
    // e.g. "Heart Failure" or "Heart Failure, Diastolic"), so read it off the Accept
    // button's aria-label ("Accept suggestion <descriptor>") and assert THAT chip, which
    // proves the accepted subject heading became a term without pinning a brittle label.
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
    await sp.page.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=terms`);
    await expect(sp.activeConcept).toBeVisible({ timeout: 15_000 });
    await expect(sp.termChip(hfDescriptor)).toBeVisible();
    await expect(sp.suggestionRow('subject heading for "hypertension"')).toHaveCount(0);
  });

  test('S3: edit in place, disable-without-delete, remove → snackbar Undo restores', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await page.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=terms`);
    await expect(sp.activeConcept).toBeVisible();

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

  test('S4-manual: DB catalogue → mark ready → the screening handoff link opens', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // Give the strategy a term so downstream stages are meaningful.
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    await sp.addKeyword('Population', 'asthma');

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

  test('S4-automated: provider run surface is reachable (no run started)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await openModeStage(sp);
    await automatedCard(sp).click();
    await rail(sp).getByRole('button', { name: /Automated Search/ }).click();
    // The Pecan run surface mounts (sources + strategy cards) — we do NOT run. Target the
    // Sources section HEADING specifically: once the sources table loads, the plain word
    // "Sources" also appears in the caption/total-row/footnote, so a loose text match
    // strict-violates as the async content lands (it only passed before by racing the
    // pre-table render).
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'results');
    await expect(stageSurface(sp).getByRole('heading', { name: 'Sources', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  /* ════════ 85.md — axe scans of the two redesigned stages ════════ */

  test('a11y: the Concepts stage has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    await expect(sp.conceptCards).toBeVisible();
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-concepts',
    });
  });

  test('a11y: the Terms & Vocabulary stage has no serious/critical violations', async ({ page, tmpProject }, testInfo) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await page.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=terms`);
    await expect(sp.activeConcept).toBeVisible();
    await sp.addTermToActiveConcept('copd');
    await expect(sp.termChip('copd')).toBeVisible();
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'search-terms',
    });
  });
});
