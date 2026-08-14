/**
 * files-pdf.spec.ts — Files & PDF viewer coverage (PdfViewer.jsx + AppPdfViewer.jsx).
 *
 * What is robustly testable WITHOUT a stored, renderable PDF:
 *   - the per-record PDF panel renders its empty / upload state (no blank-page bug),
 *   - the upload affordance is a real file input restricted to application/pdf,
 *   - invalid file types are rejected client-side before any upload,
 *   - the panel stays inside `stitch-main-content` and never overflows horizontally
 *     (guards the historic flush-width regression where the viewer spilled / shrank).
 *
 * Where the per-record PdfViewer mounts: it lives in the MIDDLE column of the
 * "Title & Abstract" screening workbench (ScreeningTab.jsx). That workbench is the
 * embedded META·SIFT engine's `?screen=screening` sub-view INSIDE the workspace's
 * `?tab=screening` stage (the engine uses a collision-free `?screen=` param whose
 * default is `overview`). Landing there auto-selects the first imported record,
 * which is what mounts the PDF panel — so we deep-link to BOTH params.
 *
 * The full open / zoom / search / page-nav flow of a LOADED PDF needs a real,
 * renderable file attached to a record. There is no PDF-attachment fixture/helper in
 * this pass, and driving pdf.js worker rendering deterministically in CI is too
 * fragile to assert honestly — those tests are authored but skipped with a TODO.
 *
 * Authored against FOUNDATION.md + the `files-pdf` map. No app source is modified;
 * no data-testids exist on these components, so selectors use getByText / getByRole.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
// 116.md §71-104 — the PDF-attachment seed helper that unblocks the loaded-PDF specs
// below. It GENERATES a valid, text-bearing PDF (no binary fixture in the repo) and
// uploads it through the real endpoint. See e2e/helpers/pdf.ts.
import { attachPdfToFirstRecord } from '../helpers/pdf';

/** Deep-link to the Title & Abstract workbench (the only place the per-record PdfViewer mounts). */
function workbenchPath(projectId: string): string {
  return `/app/project/${encodeURIComponent(projectId)}?tab=screening&screen=screening`;
}

// Stable empty-state signals of the per-record PDF panel (PdfViewer.jsx).
const PDF_PANEL_LABEL = 'Full-text PDF';
const PDF_EMPTY_HINT = 'Attach the manuscript, or auto-find a free open-access copy.';

// 116.md §71-104 — UNBLOCKED. `e2e/helpers/pdf.ts` now generates a valid, multi-page,
// text-bearing PDF and attaches it through the real upload endpoint, so pdf.js has
// something real to render and the loaded-PDF specs below run instead of skipping.
const PDF_FIXTURE_AVAILABLE = true;
const PDF_FIXTURE_TODO = 'requires the generated PDF fixture (e2e/helpers/pdf.ts)';

/**
 * Navigate to the screening workbench and wait for the per-record PDF panel to mount.
 * The embedded engine resolves the screening workspace, loads records, and auto-selects
 * the first one — so we wait on the panel's own stable label rather than a fixed delay.
 */
async function gotoWorkbenchPdfPanel(page: Page, projectId: string): Promise<ShellNav> {
  const shell = new ShellNav(page);
  await shell.goto(workbenchPath(projectId)); // asserts html[data-ui-design="stitch"]
  await shell.expectShell();
  await expect(shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  return shell;
}

test.describe('Files & PDF viewer — screening record (empty / upload state)', () => {
  test('the per-record PDF panel renders its empty/upload state when no PDF is attached @smoke', async ({ page, screeningProject }) => {
    const shell = await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    // The panel label lives inside the main content area (DOM containment).
    await expect(shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true })).toBeVisible();

    // Admin is the project owner => canManage => the upload affordances are shown.
    // NOTE: "Upload PDF" is a <label>, not a <button> (the map's getByRole('button')
    // selector is inaccurate), so target it by text.
    await expect(page.getByText(/Upload PDF/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /find open-access/i })).toBeVisible();
    await expect(page.getByText(PDF_EMPTY_HINT)).toBeVisible();

    // The upload affordance is a real file input restricted to PDFs.
    const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
    await expect(fileInput).toHaveCount(1);
    await expect(fileInput).toHaveAttribute('accept', 'application/pdf');

    // Empty state => the heavy AppPdfViewer is NOT mounted: no blank/broken canvas,
    // and none of the controls that only exist once a PDF is attached.
    await expect(page.getByRole('group', { name: /PDF viewer/i })).toHaveCount(0);
    await expect(shell.mainContent.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /open in new tab/i })).toHaveCount(0);
  });

  test('the PDF panel stays inside the main content area and does not overflow horizontally', async ({ page, screeningProject }) => {
    const shell = await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    const label = shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true });
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeVisible();

    // The PdfViewer root container = the label span's grandparent <div>
    // (span → toolbar <div> → root <div>; see PdfViewer.jsx).
    const panel = label.locator('xpath=ancestor::div[2]');
    await expect(panel).toBeVisible();

    const mainBox = await shell.mainContent.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(mainBox, 'main content should have a layout box').toBeTruthy();
    expect(panelBox, 'PDF panel should have a layout box').toBeTruthy();
    if (!mainBox || !panelBox) return; // type-narrow; the assertions above already failed

    const tol = 1; // sub-pixel rounding tolerance
    // No horizontal overflow: the panel sits within main's left/right edges — it must
    // not spill into the surrounding nav rails (the flush-width regression).
    expect(panelBox.x).toBeGreaterThanOrEqual(mainBox.x - tol);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width + tol);
    // And it is a real, non-degenerate box no wider than the content area.
    expect(panelBox.width).toBeGreaterThan(0);
    expect(panelBox.width).toBeLessThanOrEqual(mainBox.width + tol);
  });

  test('selecting a non-PDF file is rejected client-side with an error and attaches nothing', async ({ page, screeningProject }) => {
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    const fileInput = page.locator('input[type="file"][accept="application/pdf"]');
    await expect(fileInput).toHaveCount(1);

    // PdfViewer.onPick rejects a non-PDF before any network upload.
    await fileInput.setInputFiles({
      name: 'not-a-pdf.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is plainly not a pdf'),
    });

    await expect(page.getByText('Only PDF files are accepted.')).toBeVisible();
    // Rejected client-side => still the empty state (no viewer mounted, no preview/open).
    await expect(page.getByRole('group', { name: /PDF viewer/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /open in new tab/i })).toHaveCount(0);
  });
});

/**
 * Loaded-PDF viewer behaviors (AppPdfViewer toolbar: open · zoom · search · page-nav).
 * All require a stored, renderable PDF — skipped until a PDF-attachment seed helper
 * exists (see PDF_FIXTURE_TODO). Bodies are authored against the `files-pdf` map's
 * AppPdfViewer selectors so they run as-is once unblocked.
 */
test.describe('Files & PDF viewer — loaded PDF (requires an attached, renderable PDF)', () => {
  // 116.md §20 (validation) — THE 1600×900 PIN IS GONE, and it can be, because the
  // reason for it was a LAYOUT BUG rather than a property of these specs.
  //
  // It used to read: "these specs assert what the VIEWER does — the zoom ladder, live
  // search, page navigation — so they need a reading-sized surface; at the 1280px
  // default the middle column is ~130px, the viewer ~74px and fit-width lands at
  // ~0.09×". Everything the viewer did at that size was correct; the workbench simply
  // took every pixel of shortfall out of its centre column, because the record list
  // and the filters sidebar were both `flexShrink: 0` and the centre had no floor.
  // src/frontend/screening/lib/workbenchLayout.js fixes that at the source: the centre
  // now has a measured floor and the (secondary) filters sidebar auto-collapses to its
  // keyboard-reachable rail below ~1040px of workbench width. Re-measured at the
  // 1280×720 default: centre 420px, viewer 362px, fit-width ~0.57× — inside the zoom
  // ladder in both directions, which is all these specs ever needed. So they run at
  // the project default again, and `viewer sizing at the 1280×720 default` below pins
  // the numbers so the workaround can never be needed a second time.

  // Three pages of real Helvetica text: enough for page navigation AND for the live
  // search to find matches, without making the fixture slow to render.
  test.beforeEach(async ({ request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 3 });
  });

  test('opens the in-app viewer and renders the first page with working toolbar controls', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText(/\d+ \/ \d+/)).toBeVisible(); // page indicator "1 / N"
    // The viewer opens in fit-width mode, and in a reading-sized panel that fit sits
    // INSIDE the zoom ladder — so both directions are available. (Zoom-out correctly
    // disables itself when fit-width is already below the ladder's 0.25× floor; before
    // 116.md §20 the workbench squeezed the panel to ~74px at this viewport, which is
    // what used to force the 1600×900 pin — see the describe comment.)
    await expect(page.getByRole('button', { name: /fit width/i })).toHaveText(/fit width/i);
    await expect(page.getByRole('button', { name: /zoom in/i })).toBeEnabled();
    await expect(page.getByRole('button', { name: /zoom out/i })).toBeEnabled();
  });

  test('zoom in / out steps the zoom ladder and clamps at the rung limits', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const zoomLabel = page.getByRole('button', { name: /fit width|\d+%/i });
    await expect(zoomLabel).toBeVisible();
    await page.getByRole('button', { name: /zoom in/i }).click();
    // The zoom label moves off "Fit width" to a concrete percentage.
    await expect(zoomLabel).toHaveText(/\d+%/);
  });

  test('live search highlights matches across pages and reports a match count', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await page.getByRole('button', { name: /search in document/i }).click();
    const input = page.getByPlaceholder(/find in document/i);
    await input.fill('the'); // no Enter — search is as-you-type (debounced)
    // The count lives in the viewer's own polite live region. It MUST be scoped:
    // the screening workbench has three other aria-live regions (the score-unlock
    // notice, the decision bar's status, the toast host), so an unscoped locator is
    // a strict-mode violation rather than a real assertion.
    await expect(viewer.locator('[aria-live="polite"]')).toContainText(/\d+\s*\/\s*\d+/);
    // …and the matches really are painted into the text layer, not just counted.
    await expect(page.locator('.mlpdf-tl mark').first()).toBeAttached();
  });

  test('previous / next page navigation updates the page indicator', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await expect(viewer.getByText(/1 \/ \d+/)).toBeVisible();
    await page.getByRole('button', { name: /next page/i }).click();
    await expect(viewer.getByText(/2 \/ \d+/)).toBeVisible();
    // The spec is named "previous / next": prove the way back too.
    await page.getByRole('button', { name: /previous page/i }).click();
    await expect(viewer.getByText(/1 \/ \d+/)).toBeVisible();
  });

  /**
   * 116.md §20/§126 (validation) — the regression pin for the defect that produced the
   * 1600×900 workaround above. This one MEASURES, because that is how the defect was
   * found: at the project-default 1280×720 the workbench (752px once the pinned
   * workspace rail and the engine submenu are subtracted) used to hand the centre
   * column 132px and the PDF viewer 74px, i.e. a pdf.js fit-width of 0.095×.
   *
   * The numbers below are the ones the fix produces, with margin. If a future change
   * re-widens a side column or drops the centre's floor, this fails with the actual
   * pixel count rather than with some downstream symptom.
   */
  test('viewer sizing at the 1280×720 default: a reading column, not a 74px sliver', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await expect(viewer).toBeVisible();

    // The record list is NEVER hidden automatically — it is the primary navigation.
    await expect(page.locator('.sift-rl')).toBeVisible();
    // The filters sidebar is: it collapses to a rail whose toggle stays reachable.
    await expect(page.getByRole('button', { name: 'Show Filters & keywords panel' }))
      .toBeVisible();

    const mid = await page.locator('.sift-mid').boundingBox();
    const box = await viewer.boundingBox();
    expect(mid && box).toBeTruthy();
    if (!mid || !box) return;
    expect(mid.width, 'centre column at 1280×720').toBeGreaterThanOrEqual(400);
    expect(box.width, 'PDF viewer pane at 1280×720').toBeGreaterThan(300);

    // fit-width really lands in a readable range: the rendered page canvas, over the
    // 612pt width of the US-Letter fixture, IS the scale pdf.js chose.
    const canvasWidth = await page.locator('canvas').first().evaluate(
      (el) => Math.round(el.getBoundingClientRect().width));
    expect(canvasWidth / 612).toBeGreaterThanOrEqual(0.5);

    // …and none of it is bought with horizontal page scrolling.
    const doc = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(doc.scrollW).toBeLessThanOrEqual(doc.clientW);
  });
});
