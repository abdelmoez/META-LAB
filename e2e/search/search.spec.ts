/**
 * search.spec.ts — the `search-protocol` area: Protocol/PICO, the unified 3-step
 * Search wizard (Define → Build → Run) and the embedded Pecan run surface.
 *
 * Flags: searchEngine + pecanSearch + serverBackedWorkflowState are ON globally for
 * the suite (helpers/api ENGINE_FLAGS). Each test still reads the live public flags
 * and `test.skip`s honestly if its precondition is off, so the file stays correct if
 * the rollout changes.
 *
 * Seeding is via the fast `tmpProject` fixture (a throwaway admin project, auto-
 * deleted). The embedded Search Builder seeds the five PICO concept groups on load,
 * so the wizard's Run gate opens without any external NLM round-trip.
 */
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { publicFlags } from '../helpers/api';

test.describe('Search / PICO / Protocol', () => {
  /* ── Protocol / PICO (?tab=pico) ─────────────────────────────────────────── */
  test.describe('Protocol / PICO', () => {
    test('@smoke loads the server-backed PICO module and accepts input', async ({ page, request, tmpProject }) => {
      const flags = await publicFlags(request);
      const sp = new SearchPage(page);
      await sp.gotoPico(tmpProject.id);

      // The Protocol module renders (SectionHeader h2) and the question field is live.
      await sp.waitForPicoReady();

      // serverBackedWorkflowState ON → the module (not the legacy in-blob PICOTab)
      // renders, which is the ONLY variant carrying the status pill.
      test.skip(!flags.serverBackedWorkflowState, 'TODO: serverBackedWorkflowState OFF → legacy PICOTab has no status pill');
      await expect(sp.serverBackedPill).toBeVisible();

      // Accepts input — the controlled textarea reflects what we type.
      const q = `E2E research question ${Date.now()}`;
      await sp.researchQuestion.fill(q);
      await expect(sp.researchQuestion).toHaveValue(q);
    });

    test('PICO question + a PICO field persist across reload (server-backed autosave)', async ({ page, request, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoPico(tmpProject.id);
      await sp.waitForPicoReady();

      const qMarker = `E2E persist Q ${Date.now()}`;
      const pMarker = `E2E persist P ${Date.now()}`;
      await sp.researchQuestion.fill(qMarker);
      await sp.picoField('P').fill(pMarker);
      // Blur out of the PICO inputs → the panel's onBlur flush() sends pending edits.
      await sp.prosperoIdInput.click();

      // Confirm the SERVER reflects it (the "Saved" pill reverts to idle after ~1.5s,
      // so we poll the module-state API rather than racing the pill).
      await expect
        .poll(
          async () => {
            const r = await request.get(`/api/workspaces/${encodeURIComponent(tmpProject.id)}/modules/protocol/state`);
            if (!r.ok()) return null;
            const b = await r.json().catch(() => null);
            return b?.state?.question ?? null;
          },
          { timeout: 15_000, message: 'protocol module never persisted the research question' },
        )
        .toBe(qMarker);

      // Reload and assert the UI restored both fields from the server.
      await sp.gotoPico(tmpProject.id);
      await expect(sp.researchQuestion).toHaveValue(qMarker);
      await expect(sp.picoField('P')).toHaveValue(pMarker);
    });
  });

  /* ── Search wizard (?tab=search) ─────────────────────────────────────────── */
  test.describe('Search wizard', () => {
    test.beforeEach(async ({ request }) => {
      const flags = await publicFlags(request);
      // searchEngine OFF would render the legacy SearchTab (no wizard at all).
      test.skip(!flags.searchEngine, 'TODO: searchEngine OFF → legacy SearchTab, no Define/Build/Run wizard');
    });

    test('@smoke renders the 3-step Define → Build → Run flow with Define active', async ({ page, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();

      await expect(sp.defineStep).toBeVisible();
      await expect(sp.buildStep).toBeVisible();
      await expect(sp.runStep).toBeVisible();
      await sp.expectActiveStep('define');
      await expect(sp.stepIndicator(1)).toBeVisible();
    });

    test('navigates Define → Build and back to Define, preserving the mounted builder', async ({ page, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();

      // Forward to Build via the footer CTA.
      await sp.nextBuildButton.click();
      await sp.expectActiveStep('build');
      await expect(sp.stepIndicator(2)).toBeVisible();
      // A Build-phase surface is mounted (the database picker).
      await expect(sp.databasePicker).toBeVisible();

      // Back to Define via the step pip — the builder is preserved (its Define-phase
      // keyword input reappears) rather than the wizard 404ing or remounting empty.
      await sp.defineStep.click();
      await sp.expectActiveStep('define');
      await expect(sp.stepIndicator(1)).toBeVisible();
      await expect(sp.keywordInput('Population')).toBeVisible();
    });

    test('entering a keyword surfaces it as a selected term', async ({ page, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();

      const term = `e2ekw${Date.now()}`;
      await sp.addKeyword('Population', term);

      // The term lands in the "Selected keywords" tray as a removable chip.
      await expect(sp.selectedKeywordRemove(term)).toBeVisible();
    });

    test('the Pecan estimate control is enabled in Build (pecanSearch ON), not an enable-in-Ops note', async ({ page, request, tmpProject }) => {
      const flags = await publicFlags(request);
      test.skip(!flags.pecanSearch, 'TODO: pecanSearch OFF → BuildEstimates intentionally shows the "enable it in Ops" note');

      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();
      await sp.nextBuildButton.click();
      await sp.expectActiveStep('build');

      // pecanSearch ON → the estimate control renders and the degraded note is absent.
      await expect(sp.estimateButton).toBeVisible();
      await expect(sp.estimatesCard).toBeVisible();
      await expect(sp.pecanDisabledNote).toHaveCount(0);
    });

    test('reaching the Run step mounts the Pecan "Search & Discovery" surface (pecanSearch ON)', async ({ page, request, tmpProject }) => {
      const flags = await publicFlags(request);
      test.skip(!flags.pecanSearch, 'TODO: pecanSearch OFF → Run step shows the "enable the Pecan Search Engine in Ops" note instead of the run surface');

      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();

      await sp.openRunStep(); // Define → Build → (gate opens) → Run

      await expect(sp.pecanHeading).toBeVisible();
      await expect(sp.stepIndicator(3)).toBeVisible();
      // pecanSearch ON → the run engine mounted, NOT the disabled "enable in Ops" note.
      await expect(sp.pecanRunDisabledNote).toHaveCount(0);
    });

    test('search-strategy autosave persists an added keyword across reload', async ({ page, request, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();

      const term = `persistkw${Date.now()}`;
      await sp.addKeyword('Population', term);
      await expect(sp.selectedKeywordRemove(term)).toBeVisible();

      // Wait for the debounced autosave (PUT /api/search-builder/:id) to land server-side.
      await expect
        .poll(
          async () => {
            const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
            if (!r.ok()) return false;
            const b = await r.json().catch(() => null);
            const terms: string[] = Array.isArray(b?.concepts)
              ? b.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []))
              : [];
            return terms.includes(term);
          },
          { timeout: 15_000, message: 'search strategy never autosaved the added keyword' },
        )
        .toBe(true);

      // Reload — the builder reloads the saved strategy and restores the chip.
      await sp.gotoSearch(tmpProject.id);
      await sp.waitForWizard();
      await expect(sp.selectedKeywordRemove(term)).toBeVisible();
    });
  });

  /* ── Protocol / PROSPERO (?tab=prospero) ─────────────────────────────────── */
  test.describe('Protocol (PROSPERO)', () => {
    test('the PROSPERO protocol editor renders', async ({ page, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoProspero(tmpProject.id);

      // SectionHeader h2 + the deterministic draft generator both render (it mounts in
      // both server-backed and blob-fallback modes, so no flag guard is needed).
      await expect(sp.prosperoHeading).toBeVisible();
      await expect(sp.generateDraftButton).toBeVisible();
    });
  });
});
