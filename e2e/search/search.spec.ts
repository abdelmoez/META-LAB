/**
 * search.spec.ts — the `search-protocol` area: Protocol/PICO, the staged Search
 * workspace smoke (96.md — the legacy 3-step wizard is DELETED) and PROSPERO.
 *
 * Flags: searchEngine + pecanSearch + serverBackedWorkflowState are ON globally for
 * the suite (helpers/api ENGINE_FLAGS). Each test still reads the live public flags
 * and `test.skip`s honestly if its precondition is off, so the file stays correct if
 * the rollout changes.
 *
 * 96.md NOTE: with `searchEngine` ON the Search tab ALWAYS renders the staged
 * workspace (7 stages, `?tab=search&stage=<id>`; the old `searchWorkspaceV2` flag is
 * deprecated/ignored). The deep workspace journeys live in
 * e2e/search/searchWorkspace.spec.ts; this file keeps the cheap smoke +
 * persistence checks alongside the Protocol-side surfaces (which KEEP PICO — 96.md
 * removed it from the Search engine only).
 *
 * Seeding is via the fast `tmpProject` fixture (a throwaway admin project, auto-
 * deleted). New projects seed an EMPTY strategy (96.md — no PICO scaffold groups);
 * concept groups are created from the research question or the manual add box.
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

  /* ── Staged Search workspace (?tab=search) ───────────────────────────── */
  test.describe('Staged Search workspace', () => {
    test.beforeEach(async ({ request }) => {
      const flags = await publicFlags(request);
      // searchEngine OFF would render the legacy in-blob SearchTab (no workspace).
      test.skip(!flags.searchEngine, 'TODO: searchEngine OFF → legacy SearchTab, no staged workspace');
    });

    test('@smoke renders the 7-stage workspace with Research Question active', async ({ page, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.openStagedWorkspace(tmpProject.id);
      await expect(sp.stageSurface).toHaveAttribute('data-stage', 'question');
      await expect(page.getByText('Stage 1 of 7')).toBeVisible();
      // The retired stages never appear.
      await expect(sp.stageNav.getByRole('button', { name: /Test & Refine/ })).toHaveCount(0);
      await expect(sp.stageNav.getByRole('button', { name: /^Concepts$/ })).toHaveCount(0);
    });

    test('a concept group created from the manual add box autosaves and survives reload', async ({ page, request, tmpProject }) => {
      const sp = new SearchPage(page);
      await sp.gotoStage(tmpProject.id, 'terms');
      await expect(sp.questionCard).toBeVisible();

      const label = `persistkw${Date.now()}`;
      await sp.addConceptGroup(label);
      await expect(sp.activeConcept).toBeVisible();
      await expect(sp.termChip(label)).toBeVisible();

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
            return terms.includes(label);
          },
          { timeout: 15_000, message: 'search strategy never autosaved the concept group' },
        )
        .toBe(true);

      // Reload — the builder reloads the saved strategy and restores the chip.
      await sp.gotoStage(tmpProject.id, 'terms');
      await expect(sp.termChip(label)).toBeVisible();
    });

    test('the Pecan estimate control rides Terms & Vocabulary (pecanSearch ON), not an enable-in-Ops note', async ({ page, request, tmpProject }) => {
      const flags = await publicFlags(request);
      test.skip(!flags.pecanSearch, 'TODO: pecanSearch OFF → PreviewEstimates intentionally shows the "enable it in Ops" note');

      const sp = new SearchPage(page);
      await sp.gotoStage(tmpProject.id, 'terms');
      await expect(sp.questionCard).toBeVisible();

      // pecanSearch ON → the estimate control renders and the degraded note is absent.
      await sp.estimatesCard.scrollIntoViewIfNeeded();
      await expect(sp.estimateButton).toBeVisible();
      await expect(sp.estimatesCard).toBeVisible();
      await expect(sp.pecanDisabledNote).toHaveCount(0);
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
