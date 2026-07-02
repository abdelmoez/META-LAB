/**
 * extraction.spec.ts — the Data Extraction stage (/app/project/:id?tab=extraction).
 *
 * The Stitch workspace embeds the proven legacy ExtractionTab (extractionTabs.jsx) at
 * `?tab=extraction`; the Extract category opens a 2-item white submenu stepper
 * (Data Extraction → Risk of Bias), and the purple rail marks the active category.
 *
 * HONEST FINDING vs the brief's premise ("extraction is locked until screening
 * produces records"): in the Stitch nav, extraction is a PHASE step and phase steps
 * ALWAYS carry an href, so `stitch-stepper-step-extraction` is never
 * `data-disabled="true"`. The "Available once screening is set up" lock applies only
 * to the SCREEN sub-steps (their href is null until a sift workspace exists). The
 * real gating users see is at the CONTENT level: a fresh project's extraction surface
 * shows a "No studies yet" setup state. This spec proves both the setup state and the
 * nav contrast, then exercises the reachable study-CRUD + 2×2 risk-ratio validation
 * (a manual "Add study" path exists, so no finished screening is required). Persistence
 * across reload is documented-skipped — see the TODO at the bottom.
 */
import { test, expect } from '../fixtures/stitch-test';
import type { Page } from '@playwright/test';
import { ShellNav } from '../page-objects/ShellNav';

const extractionUrl = (id: string) => `/app/project/${id}?tab=extraction`;

test.describe('Data extraction — surface & workflow nav', () => {
  test('@smoke a fresh project shows the extraction setup/empty state', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(tmpProject.id));
    await nav.expectShell();

    // The embedded ExtractionTab renders its real header (SectionHeader <h2>) + the
    // no-data "setup" state. The stepper's "Data Extraction" label is a <button>, so
    // the heading role uniquely targets the tab content.
    await expect(page.getByRole('heading', { name: 'Data Extraction' }).first()).toBeVisible();
    await expect(page.getByText('No studies yet')).toBeVisible();
    await expect(page.getByRole('button', { name: /add first study/i })).toBeVisible();
  });

  test('the rail + white-submenu stepper reflect the active Extract stage', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(tmpProject.id));

    // The purple-rail CATEGORY id is `extract` (not `extraction`); it is the active step.
    await expect(nav.workflowStep('extract').first()).toHaveAttribute('aria-current', 'step');

    // The Extract category opens the shared 2-item workflow stepper.
    await expect(nav.workflowStepper.first()).toBeAttached();
    const step = nav.stepperStep('extraction').first();
    await expect(step).toHaveAttribute('aria-current', 'step');
    // Fresh project ⇒ no extraction data yet ⇒ the early/"empty" status.
    await expect(step).toHaveAttribute('data-status', 'empty');
  });

  test('the extraction step is NOT screening-locked — only the screen sub-steps are', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);

    // Extraction is a phase step → it always resolves an href → never disabled, even
    // with zero studies. This is the documented counter to the "locked" premise.
    await nav.goto(extractionUrl(tmpProject.id));
    await expect(nav.stepperStep('extraction').first()).toHaveAttribute('data-disabled', 'false');

    // Contrast: the SCREEN sub-steps ARE the gated ones. With no linked screening
    // workspace, `import` has a null href → it renders disabled (the lock affordance).
    await nav.goto(`/app/project/${tmpProject.id}?tab=screening`);
    await expect(nav.stepperStep('import').first()).toHaveAttribute('data-disabled', 'true');
  });

  test('the extraction surface loads on a project that already has screening records', async ({ page, screeningProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(screeningProject.project.id));
    await nav.expectShell();

    // The surface loads regardless of whether screening rows have been promoted to
    // extraction studies — a RIS import alone does not populate project.studies, so
    // this asserts the durable signal (the tab renders) rather than a study count.
    await expect(page.getByRole('heading', { name: 'Data Extraction' }).first()).toBeVisible();
  });
});

test.describe('Data extraction — study CRUD & 2×2 validation (reachable via manual add)', () => {
  // Drive the legacy AddStudyModal's "Manual" path to create a blank study — there is
  // no fast API for project.studies and the screening→extraction promotion needs a
  // full screening pass, so the manual add IS the reachable entry point. On the empty
  // state BOTH a toolbar "+ Add Study" and an "+ Add First Study" CTA exist → .first().
  async function addBlankStudy(page: Page): Promise<void> {
    await page.getByRole('button', { name: /add (first )?study/i }).first().click();
    await page.getByRole('button', { name: 'Manual', exact: true }).click();
    await page.getByRole('button', { name: /add blank study/i }).click();
    await expect(page.getByText('New Study')).toBeVisible(); // modal closed, card present
  }

  test('a study can be added (create) and removed (delete) in-session', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(tmpProject.id));
    await expect(page.getByText('No studies yet')).toBeVisible();

    await addBlankStudy(page);
    await expect(page.getByText('No studies yet')).toHaveCount(0);

    // Expand the card, then remove the study; the empty state returns.
    await page.getByText('New Study').click();
    await page.getByRole('button', { name: /remove study/i }).click();
    await expect(page.getByText('No studies yet')).toBeVisible();
  });

  test('the 2×2 risk-ratio calculator rejects incomplete and double-zero inputs', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(tmpProject.id));
    await addBlankStudy(page);

    // Expand the study card to reveal the inline effect-size calculator.
    await page.getByText('New Study').click();

    // The calculator's measure <select> is the only one carrying a "Cohen's d" option;
    // switch it to a 2×2 dichotomous measure (Odds Ratio) to expose the a/b/c/d cells.
    const calcSelect = page.locator('select', { has: page.locator('option', { hasText: "Cohen's d" }) });
    await calcSelect.selectOption('OR');

    const calcBtn = page.getByRole('button', { name: /calculate.*apply/i });

    // (1) all four cells blank → "Enter all four 2×2 cells".
    await calcBtn.click();
    await expect(page.getByText(/enter all four/i)).toBeVisible();

    // (2) both event cells (a & c) zero for OR → not estimable as a relative effect.
    await page.getByPlaceholder('a (event/Exp)').fill('0');
    await page.getByPlaceholder('b (no event/Exp)').fill('10');
    await page.getByPlaceholder('c (event/Ctrl)').fill('0');
    await page.getByPlaceholder('d (no event/Ctrl)').fill('10');
    await calcBtn.click();
    await expect(page.getByText(/both event cells are zero/i)).toBeVisible();
  });

  // TODO(orchestrator): persistence-across-reload is intentionally skipped.
  // The legacy ExtractionTab autosaves via updateProject() with an unspecified debounce,
  // and there is no fast API helper to seed/read project.studies, so a reload-based
  // persistence assertion is non-deterministic here. Re-enable once either a
  // project.studies seed/read helper exists or the app exposes a stable
  // "autosave settled" signal to await before reloading.
  test.skip('extraction edits persist across a reload (autosave)', async ({ page, tmpProject }) => {
    const nav = new ShellNav(page);
    await nav.goto(extractionUrl(tmpProject.id));
    // Body intentionally minimal — see the TODO above for why this is skipped.
  });
});
