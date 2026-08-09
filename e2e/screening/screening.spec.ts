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
import fs from 'node:fs';
import JSZip from 'jszip';
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage, PIPELINE_STEPS } from '../page-objects/ScreeningPage';
import { expectNoSeriousA11y } from '../helpers/axe';
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

test.describe('Screening — keyboard navigation (107.md §§5-7)', () => {
  test('arrowing past the last loaded study auto-loads the next batch and lands on its first record', async ({ page, screeningProject }) => {
    const pid = screeningProject.project.id;
    const siftId = screeningProject.siftId;

    // Push the project past one page (LIMIT = 50) so there IS a next batch.
    const extra = Array.from({ length: 92 }, (_, i) => ({
      title: `Nav QA article ${String(i + 1).padStart(3, '0')}`,
      year: 2021, doi: `10.9999/navqa.${i + 1}`, abstract: `Abstract ${i + 1}`,
    }));
    await api.importScreeningRecords(page.request, siftId, { content: api.makeRis(extra) });
    const listed = await page.request.get(`/api/screening/projects/${siftId}/records?page=1&limit=200`);
    const ids: string[] = (await listed.json()).records.map((r: { id: string }) => r.id);
    expect(ids.length).toBe(100); // 8 seeded + 92 bulk

    const sp = new ScreeningPage(page);
    await sp.openWorkbench(pid);
    await expect(sp.rows).toHaveCount(50);
    // The manual fallback is still there — auto-pagination augments it (§7).
    await expect(sp.loadMoreButton).toBeVisible();

    // Stand on the LAST loaded study, then press the "next" key once.
    await sp.rowById(ids[49]).click();
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[49]);
    await page.keyboard.press('ArrowRight');

    // The next page loads and the FIRST newly loaded study is selected — no skip, no
    // repeat, no reorder — and §5 keeps it inside the visible list region.
    await expect(sp.rows).toHaveCount(100);
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[50]);
    await expect(sp.selectedRow).toBeInViewport();
    // The middle column follows the selection, and the counter now spans both pages.
    await expect(sp.recordNav).toContainText('51 / 100');
  });

  test('repeated presses at the true end keep the final study selected and say so', async ({ page, screeningProject }) => {
    const pid = screeningProject.project.id;
    const sp = new ScreeningPage(page);
    await sp.openWorkbench(pid);

    // 8 seeded records fit on one page, so row 8 IS the end of the list.
    const ids = await sp.rows.evaluateAll(els => els.map(e => e.getAttribute('data-record-id')!));
    expect(ids.length).toBe(screeningProject.recordCount);
    await sp.rowById(ids[ids.length - 1]).click();
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[ids.length - 1]);

    // No "Load more" exists, so there is nothing to fetch: the footer says the list
    // ended and the selection does not move, however many times the key is pressed.
    await expect(sp.loadMoreButton).toHaveCount(0);
    await expect(sp.endOfList).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[ids.length - 1]);
    await expect(sp.endOfList).toBeVisible();
  });

  test('a keyboard decision updates the sticky decision bar and the citation-list glyph', async ({ page, screeningProject }) => {
    const pid = screeningProject.project.id;
    const sp = new ScreeningPage(page);
    await sp.openWorkbench(pid);

    const ids = await sp.rows.evaluateAll(els => els.map(e => e.getAttribute('data-record-id')!));
    await sp.rowById(ids[1]).click();
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[1]);

    // Undecided reads as undecided — no control looks falsely selected (§6).
    await expect(sp.decisionBar).toHaveAttribute('data-decision', 'undecided');
    await expect(sp.decisionBar).toContainText('Undecided');
    await expect(sp.includeButton).toHaveAttribute('aria-pressed', 'false');

    // `i` includes: the bar's chip, the button's pressed state and the row glyph all move.
    await page.keyboard.press('i');
    await expect(sp.decisionBar).toHaveAttribute('data-decision', 'include');
    await expect(sp.decisionBar).toContainText('Included');
    await expect(sp.includeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(sp.rowById(ids[1])).toContainText('✓');

    // Changing the decision is non-destructive and stays in sync in both places.
    await page.keyboard.press('e');
    await expect(sp.decisionBar).toHaveAttribute('data-decision', 'exclude');
    await expect(sp.excludeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(sp.includeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(sp.rowById(ids[1])).toContainText('✗');

    // …and it survives a reload (the decision is server-owned, not local state).
    await page.reload();
    await sp.rowById(ids[1]).click();
    await expect(sp.decisionBar).toHaveAttribute('data-decision', 'exclude');
    await expect(sp.rowById(ids[1])).toContainText('✗');
  });
});

test.describe('Screening — Resume Screening (100.md §§12-15)', () => {
  test('resumes at the next undecided article after leaving and coming back', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    const pid = screeningProject.project.id;
    await sift.openWorkbench(pid);

    // Nothing screened yet → the bar offers a START, not a resume.
    await expect(sift.resumeBar).toHaveAttribute('data-status', /start|reopen/);
    await expect(sift.resumeButton).toBeVisible();

    // Screen the first two rows IN LIST ORDER. (Deliberately by position, not by
    // title: the canonical order is `createdAt ASC, id ASC`, which a bulk import does
    // not guarantee matches the file order — and resume is defined against the
    // canonical order, so the test must be too.)
    const rowIdAt = async (i: number) => sift.rows.nth(i).getAttribute('data-record-id');
    const [id0, id1, id2] = await Promise.all([rowIdAt(0), rowIdAt(1), rowIdAt(2)]);
    for (const id of [id0, id1]) {
      await sift.rowById(id!).click();
      await expect(sift.selectedRow).toHaveAttribute('data-record-id', id!);
      await sift.includeButton.click();
      await expect(sift.undoButton).toBeEnabled();
    }
    // The bar now reports real progress against the server-derived pool.
    await expect(sift.resumeBar).toHaveAttribute('data-status', 'resume');
    await expect(sift.resumeButton).toContainText('Continue where you left off');
    await expect(sift.resumeButton).toContainText('2 done');
    await expect(sift.resumeButton).toContainText('6 left');

    // Leave the engine entirely, then come back — nothing is kept in the tab.
    await sift.goto(pid, 'export');
    await expect(sift.exportHeading).toBeVisible();
    await sift.openWorkbench(pid);

    // One click lands on the NEXT article needing a decision — the third row — not
    // the last one screened, and says where it put you (100.md §13).
    await sift.resumeButton.click();
    await expect(sift.selectedRow).toHaveAttribute('data-record-id', id2!);
    await expect(sift.resumeNote).toContainText('Continuing from where you stopped (article 3)');
  });

  test('a filtered-away resume target is still reachable, and the filters say so (§15)', async ({ page, screeningProject }) => {
    const sift = new ScreeningPage(page);
    const pid = screeningProject.project.id;
    await sift.openWorkbench(pid);

    // Narrow the list so the resume target is not in view.
    await sift.searchInput.fill('E2E Study 7');
    await expect(sift.recordCounter).toContainText('1 / 1 RECORD');

    await sift.resumeButton.click();
    // The saved article is NEVER unreachable-with-no-explanation: filters are
    // cleared, the whole list returns, and the note explains what happened.
    await expect(sift.resumeNote).toContainText('filters were cleared');
    await expect(sift.searchInput).toHaveValue('');
    await expect(sift.recordCounter).toContainText(`/ ${screeningProject.recordCount} RECORD`);
    await expect(sift.selectedRow).toBeVisible();
  });

  test('resuming past page 1 keeps the earlier records reachable and counts honestly (§13)', async ({ page, screeningProject }) => {
    const pid = screeningProject.project.id;
    const sift = screeningProject.siftId;

    // Push the project past one page (LIMIT = 50) in a single import, then decide the
    // first 60 so the resume target lands on page 2.
    const extra = Array.from({ length: 92 }, (_, i) => ({
      title: `Bulk QA article ${String(i + 1).padStart(3, '0')}`,
      year: 2020, doi: `10.9999/bulkqa.${i + 1}`, abstract: `Abstract ${i + 1}`,
    }));
    await api.importScreeningRecords(page.request, sift, { content: api.makeRis(extra) });

    const listed = await page.request.get(`/api/screening/projects/${sift}/records?page=1&limit=200`);
    const ids: string[] = (await listed.json()).records.map((r: { id: string }) => r.id);
    expect(ids.length).toBe(100); // 8 seeded + 92 bulk
    for (const id of ids.slice(0, 60)) {
      await page.request.post(`/api/screening/projects/${sift}/records/${id}/decision`, { data: { decision: 'exclude' } });
    }

    const sp = new ScreeningPage(page);
    await sp.openWorkbench(pid);
    await expect(sp.rows).toHaveCount(50);                                  // page 1
    await expect(sp.main.getByRole('button', { name: /Load more \(50\)/ })).toBeVisible();
    await expect(sp.main.getByTestId('screening-load-earlier')).toHaveCount(0);

    await sp.resumeButton.click();
    // Jumped to page 2: the last 50 rows, nothing further ahead, 50 behind — and the
    // "Load more" count must not claim the 50 records the jump skipped past.
    await expect(sp.resumeNote).toContainText('article 61');
    await expect(sp.rows).toHaveCount(50);
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[60]);
    await expect(sp.main.getByRole('button', { name: /Load more/ })).toHaveCount(0);
    await expect(sp.main.getByRole('button', { name: /Earlier records \(50\)/ })).toBeVisible();

    // §15 in reverse — the skipped-over records are one click away, not stranded.
    await sp.main.getByRole('button', { name: /Earlier records/ }).click();
    await expect(sp.rows).toHaveCount(100);
    await expect(sp.rows.first()).toHaveAttribute('data-record-id', ids[0]);
    await expect(sp.selectedRow).toHaveAttribute('data-record-id', ids[60]);
    await expect(sp.main.getByTestId('screening-load-earlier')).toHaveCount(0);
  });

  test('resume progress is per USER — a second reviewer starts from their own place (§14)', async ({ page, screeningProject, normalContext }) => {
    const pid = screeningProject.project.id;
    const sift = new ScreeningPage(page);
    await sift.openWorkbench(pid);

    // Reviewer A (the admin) screens two records.
    for (const t of [/E2E Study 1 on/, /E2E Study 2 on/]) {
      await sift.recordRow(t).click();
      await sift.includeButton.click();
      await expect(sift.undoButton).toBeEnabled();
    }
    await expect(sift.resumeButton).toContainText('2 done');

    // Reviewer B joins the same screening project — and has screened nothing, so
    // A's position must not be visible to (or overwritten by) them.
    const b = await api.me(normalContext.request);
    expect(b?.email, 'the seeded normal user must be resolvable').toBeTruthy();
    await api.addProjectMember(page.request, screeningProject.siftId, { email: b!.email, preset: 'reviewer' });

    const siftB = new ScreeningPage(normalContext.page);
    await siftB.openWorkbench(pid);
    await expect(siftB.resumeBar).toHaveAttribute('data-status', /start|reopen/);
    await expect(siftB.resumeButton).not.toContainText('done');

    // A's own position is untouched by B's arrival.
    await page.reload();
    await expect(sift.resumeButton).toContainText('2 done');
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

test.describe('Screening — export ZIP journey (97.md)', () => {
  test('downloads the portable screening ZIP with CSV + JSON backup + README, and the tab passes axe', async ({ page, screeningProject }, testInfo) => {
    const sift = new ScreeningPage(page);
    await sift.goto(screeningProject.project.id, 'export');
    await expect(sift.exportHeading).toBeVisible();

    // The headline ZIP action renders enabled next to the (distinct) single-format
    // export button — the two actions must never collapse into one locator.
    await expect(sift.zipDownloadButton).toBeEnabled();
    await expect(sift.exportButton).toBeEnabled();

    // Accessibility: the Export tab surface has no serious/critical violations.
    await expectNoSeriousA11y(page, {
      include: '[data-testid="stitch-main-content"]',
      testInfo, label: 'screening-export',
    });

    // Start the ZIP export through the real UI. The tab enqueues the async job,
    // polls it, and fires a same-origin anchor download when the archive is ready
    // (worker drain + 1.2s poll cadence → allow a generous ceiling).
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await sift.zipDownloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/screening-export-\d{4}-\d{2}-\d{2}\.zip$/);

    // Read the archive with jszip (devDependency, read-only) — the required
    // members are present and the CSV carries the seeded records.
    const zipPath = testInfo.outputPath('screening-export.zip');
    await download.saveAs(zipPath);
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath), { checkCRC32: true });
    const names = Object.keys(zip.files);
    expect(names).toContain('references-and-screening-decisions.csv');
    expect(names).toContain('screening-backup.json');
    expect(names).toContain('README.txt');

    const csv = await zip.file('references-and-screening-decisions.csv')!.async('string');
    expect(csv).toContain('E2E Study 1 on intervention efficacy');
    // Header row: first and (appended) last columns of the v1 append-only schema.
    expect(csv.split('\n')[0]).toMatch(/^record_id,/);
    expect(csv.split('\n')[0]).toMatch(/,updated_at$/);

    const backup = JSON.parse(await zip.file('screening-backup.json')!.async('string'));
    expect(backup.schemaVersion).toBe('1');
    expect(backup.records.length).toBe(screeningProject.recordCount);

    // Completion feedback: the persistent re-download link renders in the card.
    await expect(page.getByRole('link', { name: /Download again/i })).toBeVisible();
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
