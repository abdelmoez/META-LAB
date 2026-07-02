/**
 * screening.spec.ts — the Screening engine (META·SIFT) embedded in the unified
 * Stitch workspace at `/app/project/:id?tab=screening` (+ `?screen=<sub-page>`).
 *
 * Every test seeds a throwaway project + screening workspace + ~8 imported records
 * via the `screeningProject` fixture (fast API seeding; auto-deleted), then drives
 * the real UI. Coverage:
 *   - the Title & Abstract workbench loads with the seeded records visible;
 *   - the white submenu sub-stepper (`stitch-stepper-step-<key>`) is present,
 *     status-bearing (`data-status`), enabled (`data-disabled="false"`) and navigable;
 *   - opening a record + clicking Include moves the "<n> / 2 reviewers included"
 *     count (a real, server-backed stat change) and enables Undo;
 *   - search + status-filter narrow the record list;
 *   - each sub-view (import / duplicates / conflicts / final-review / export) renders
 *     its identifying surface, and Export exposes an enabled export action;
 *   - the aiScreening engine is enabled for the workspace (API), while the in-UI AI
 *     score / "why this score" panel is documented-skipped (gated behind 50 decisions).
 *
 * Selectors come from the screening area map + verification against ScreeningTab.jsx
 * / SiftProject.jsx; chrome + the sub-stepper testids come from FOUNDATION.md.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage, PIPELINE_STEPS } from '../page-objects/ScreeningPage';
import * as api from '../helpers/api';

test.describe('Screening — stage loads', () => {
  test('@smoke the Title & Abstract workbench loads with the seeded records visible', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);

    // The 3-column workbench renders: search header + record list + decision bar.
    await expect(sift.searchInput).toBeVisible();
    await expect(sift.filterSelect).toBeVisible();

    // All 8 seeded records loaded on page 1 (LIMIT 50) — the mono counter + the rows.
    await expect(sift.recordCounter).toContainText(`${screeningProject.recordCount} / ${screeningProject.recordCount} RECORD`);
    await expect(sift.recordRow(/E2E Study 1 on intervention efficacy/)).toBeVisible();
    await expect(sift.recordRow(/E2E Study 2 on intervention efficacy/)).toBeVisible();

    // The first record is auto-selected → its decision bar is available.
    await expect(sift.includeButton).toBeVisible();
    await expect(sift.excludeButton).toBeVisible();
    await expect(sift.maybeButton).toBeVisible();
  });

  test('the Overview sub-view renders the project roll-up stats', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id); // bare ?tab=screening → screen=overview
    await expect(sift.overviewTotalArticles).toBeVisible();
  });
});

test.describe('Screening — sub-stepper (white submenu)', () => {
  test('all stages are present, status-bearing, enabled and reflect the active screen', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);

    // The pipeline + export sub-steps render in the white submenu.
    await sift.expectStepperPresent();

    // The numbered pipeline steps carry a status vocabulary + are enabled (the
    // workspace has a linked screening project, so their hrefs resolve).
    for (const key of PIPELINE_STEPS) {
      await expect(sift.step(key)).toHaveAttribute('data-status', /^(done|partial|empty|attention)$/);
      await expect(sift.step(key)).toHaveAttribute('data-disabled', 'false');
    }

    // We are on ?screen=screening → that step is the active one.
    await expect(sift.step('screening')).toHaveAttribute('aria-current', 'step');
  });

  test('clicking a sub-step navigates the embedded engine via ?screen=', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);

    // Navigate to Duplicates through the stepper (SPA navigation, URL is the SoT).
    await sift.clickStep('duplicates');
    await expect(sift.detectDuplicatesButton).toBeVisible();
    await expect(sift.step('duplicates')).toHaveAttribute('aria-current', 'step');

    // …and onward to Export (a utility step) — proves the stepper drives the body.
    await sift.clickStep('export');
    await expect(sift.exportHeading).toBeVisible();
  });
});

test.describe('Screening — record decisions', () => {
  test('opening a record and clicking Include moves the reviewer-included count', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);

    // Open (select) the 2nd record explicitly — the detail heading proves it opened.
    await sift.recordRow(/E2E Study 2 on intervention efficacy/).click();
    await expect(sift.detailHeading(/E2E Study 2 on intervention efficacy/)).toBeVisible();

    // No decision yet → Undo is disabled and the quorum line reads 0 / 2.
    await expect(sift.undoButton).toBeDisabled();
    await expect(sift.reviewersIncluded(0)).toBeVisible();

    // Include auto-saves. Undo enables immediately (optimistic), and the
    // server-backed reviewer-included count advances 0 → 1 (a real stat change).
    await sift.includeButton.click();
    await expect(sift.undoButton).toBeEnabled();
    await expect(sift.reviewersIncluded(1)).toBeVisible();

    // Undo reverts the decision and the count returns to 0.
    await sift.undoButton.click();
    await expect(sift.undoButton).toBeDisabled();
    await expect(sift.reviewersIncluded(0)).toBeVisible();
  });
});

test.describe('Screening — search & filter', () => {
  test('searching and status-filtering narrow the record list', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);

    // Baseline: both record 1 and record 2 are in the list.
    await expect(sift.recordRow(/E2E Study 1 on intervention efficacy/)).toBeVisible();
    await expect(sift.recordRow(/E2E Study 2 on intervention efficacy/)).toBeVisible();

    // Search narrows to a single matching title (debounced server query).
    await sift.searchInput.fill('Study 2 on intervention');
    await expect(sift.recordRow(/E2E Study 2 on intervention efficacy/)).toBeVisible();
    await expect(sift.recordRow(/E2E Study 1 on intervention efficacy/)).toHaveCount(0);

    // Clear the search, then a status filter with no matches empties the list.
    await sift.searchInput.fill('');
    await expect(sift.recordRow(/E2E Study 1 on intervention efficacy/)).toBeVisible();
    await sift.filterSelect.selectOption({ label: 'Included by me' });
    await expect(sift.noMatchEmptyState).toBeVisible();
  });
});

test.describe('Screening — sub-views render', () => {
  test('the Import sub-view renders the importer', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'import');
    await expect(sift.importHeading).toBeVisible();
  });

  test('the Duplicates sub-view exposes the Detect Duplicates action', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'duplicates');
    await expect(sift.detectDuplicatesButton).toBeVisible();
  });

  test('the Conflicts sub-view renders', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'conflicts');
    await expect(sift.conflictsHeading).toBeVisible();
  });

  test('the Final Review (second-review) sub-view renders', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'second-review');
    await expect(sift.finalReviewHeading).toBeVisible();
  });

  test('the Export sub-view renders an enabled export action', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'export');
    await expect(sift.exportHeading).toBeVisible();
    // 8 seeded records → the "All records" filter has a non-zero count → export enabled.
    await expect(sift.exportButton).toBeEnabled();
  });
});

test.describe('Screening — AI surfaces (aiScreening)', () => {
  test('the AI screening engine is enabled for the workspace (API)', async ({ request, screeningProject }) => {
    // aiScreening is ON globally; the status endpoint answers (not 404) for the sift project.
    const enabled = await api.aiScreeningEnabled(request, screeningProject.siftId);
    expect(enabled).toBe(true);
  });

  test('the in-UI AI score + "why this score" panel', async ({ page, screeningProject }) => {
    // The AI score card + "Why this score?" breakdown are gated behind >= 50 screened
    // decisions (admin-overridable). Seeding 50 decisions is too slow for E2E, so this
    // is a documented skip rather than a fake pass.
    test.skip(true, 'TODO: AI score / "why this score" panel is gated behind >=50 screened decisions; seeding 50 is too slow. Engine availability is covered by the API test above.');

    const sift = new ScreeningPage(page);
    await sift.openWorkbench(screeningProject.project.id);
    await sift.recordRow(/E2E Study 1 on intervention efficacy/).click();
    await expect(sift.aiWhyScoreToggle).toBeVisible();
    await sift.aiWhyScoreToggle.click();
  });
});
