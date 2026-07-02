/**
 * meta.spec.ts — Meta-analysis surfaces in the unified Stitch workspace (Analyze
 * category) + Network Meta-Analysis (networkMetaAnalysis flag ON).
 *
 * The Analyze category opens a persistent white-submenu workflow stepper whose
 * sub-stages are analysis → forest → sensitivity → subgroup → nma (GRADE lives under
 * the Report category). Each stage renders inside StitchProjectWorkspace at
 * `/app/project/:id?tab=<stage>`. networkMetaAnalysis is enabled globally by the
 * suite's ENGINE_FLAGS, so the NMA stage renders its live engine (not the disabled
 * note).
 *
 * What we can assert deterministically: the stages load, the stepper exposes each
 * stage (the NMA stage is reachable BECAUSE the flag is ON), and a fresh tmpProject
 * (no extracted/network data) shows the documented empty / not-ready states.
 *
 * What we cannot: a populated forest plot, heterogeneity metrics (I²/τ²) and the
 * export flows need a pooled meta-analysis / connected NMA dataset. The current API
 * helpers only seed screening RIS records — there is no helper to seed project.nma
 * arms or extraction effect sizes — so those flows are written and test.skip'd with
 * a TODO rather than faked.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import { publicFlags } from '../helpers/api';

// Desktop width: the coordinated purple rail + white workflow submenu (the stepper)
// render side-by-side at >= 1024px; below that the off-canvas drawer takes over.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe('@smoke meta-analysis — Analyze workflow', () => {
  test('the Analyze category renders the workflow stepper with Meta-Analysis active', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=analysis`);
    await nav.expectShell();

    // The route resolved to the analysis stage (rail carries the active-stage attr).
    await expect(nav.projectRail).toHaveAttribute('data-active-stage', 'analysis');

    // The shared white-submenu stepper is present, with the analysis step marked
    // active and every Analyze sub-stage (analysis → forest → … → nma) reachable.
    await expect(nav.workflowStepper).toBeVisible();
    await expect(nav.stepperStep('analysis')).toBeVisible();
    await expect(nav.stepperStep('analysis')).toHaveAttribute('aria-current', 'step');
    for (const key of ['forest', 'sensitivity', 'subgroup', 'nma']) {
      await expect(nav.stepperStep(key)).toBeVisible();
    }
    // nma is a navigable (non-disabled) step → the NMA stage is reachable from here.
    await expect(nav.stepperStep('nma')).toHaveAttribute('data-disabled', 'false');

    // The Meta-Analysis surface itself rendered (page-level H1 from the stage label).
    await expect(page.getByRole('heading', { level: 1, name: 'Meta-Analysis', exact: true })).toBeVisible();
  });

  test('the Meta-Analysis surface shows the insufficient-data empty state for a fresh project', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=analysis`);

    // The engine's own section header (a level-2 heading) proves the surface mounted.
    await expect(page.getByRole('heading', { level: 2, name: 'Meta-Analysis', exact: true })).toBeVisible();
    // With no extracted effect sizes the outcome selector shows the empty state.
    await expect(page.getByText(/No studies with an effect size yet/i)).toBeVisible();
  });

  test('the Forest Plot stage loads with its stepper step + empty state', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=forest`);

    await expect(nav.projectRail).toHaveAttribute('data-active-stage', 'forest');
    await expect(nav.stepperStep('forest')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { level: 1, name: 'Forest Plot', exact: true })).toBeVisible();
    await expect(page.getByText(/No studies with an effect size yet/i)).toBeVisible();
  });
});

test.describe('@smoke meta-analysis — Network Meta-Analysis (flag ON)', () => {
  test('the NMA stage is reachable under Analyze and renders its enabled surface', async ({ page, request, tmpProject }) => {
    const flags = await publicFlags(request);
    test.skip(!flags.networkMetaAnalysis, 'TODO: networkMetaAnalysis flag is OFF in this env — NMA renders the disabled note instead of the engine.');

    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=nma`);
    await nav.expectShell();

    // Reachable as a sub-stage of the Analyze category stepper.
    await expect(nav.projectRail).toHaveAttribute('data-active-stage', 'nma');
    await expect(nav.stepperStep('nma')).toBeVisible();
    await expect(nav.stepperStep('nma')).toHaveAttribute('aria-current', 'step');

    // Enabled surface: the stage H1 + the NMA engine's own controls (the Run button
    // and the "Evidence data" view tab) render, and the feature-disabled note does NOT.
    await expect(page.getByRole('heading', { level: 1, name: 'Network Meta-Analysis', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /run analysis/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Evidence data' })).toBeVisible();
    await expect(page.getByText(/this feature is currently disabled/i)).toHaveCount(0);
  });

  test('NMA shows the not-ready empty state with Run disabled for a fresh project', async ({ page, request, tmpProject }) => {
    const flags = await publicFlags(request);
    test.skip(!flags.networkMetaAnalysis, 'TODO: networkMetaAnalysis flag is OFF in this env — NMA renders the disabled note instead of the engine.');

    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=nma`);

    // No network/evidence yet → empty studies copy + "Not ready" readiness signal +
    // the Run button is gated off (readiness not OK).
    await expect(page.getByText(/No studies yet\. Add multi-arm studies/i)).toBeVisible();
    await expect(page.getByText('Not ready', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /run analysis/i })).toBeDisabled();
  });

  // ── Flows that need real pooled / network data we cannot seed via current helpers ──
  test('NMA run renders the forest plot, P-score ranking and heterogeneity metrics', async ({ page, tmpProject }) => {
    test.skip(true, 'TODO: requires a connected NMA dataset (project.nma arms) or extracted effect sizes. Current API helpers only seed screening RIS records — there is no helper to seed project.nma / extraction data — and driving the in-app "Load example" + POST /api/nma/run end-to-end is deferred to a dedicated analysis-data fixture.');

    // Intended assertions once a network can be seeded (kept ready for un-skip):
    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=nma`);
    await page.getByRole('button', { name: /load example/i }).click();
    await page.getByRole('button', { name: /run analysis/i }).click();
    await expect(page.getByRole('img', { name: /forest plot/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ranking' })).toBeVisible();
    await expect(page.getByText(/I²/)).toBeVisible(); // heterogeneity stat tile
  });

  test('NMA results export (CSV/JSON) downloads a file', async ({ page, tmpProject }) => {
    test.skip(true, 'TODO: export controls only render after a successful run, which needs a seeded NMA dataset (see the run test above). Deferred to the analysis-data fixture.');

    const nav = new ShellNav(page);
    await nav.goto(`/app/project/${tmpProject.id}?tab=nma`);
    await page.getByRole('button', { name: /load example/i }).click();
    await page.getByRole('button', { name: /run analysis/i }).click();
    await page.getByRole('tab', { name: 'Ranking' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  });
});
