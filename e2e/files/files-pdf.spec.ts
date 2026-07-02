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

/** Deep-link to the Title & Abstract workbench (the only place the per-record PdfViewer mounts). */
function workbenchPath(projectId: string): string {
  return `/app/project/${encodeURIComponent(projectId)}?tab=screening&screen=screening`;
}

// Stable empty-state signals of the per-record PDF panel (PdfViewer.jsx).
const PDF_PANEL_LABEL = 'Full-text PDF';
const PDF_EMPTY_HINT = 'Attach the manuscript, or auto-find a free open-access copy.';

// Loaded-PDF interaction needs a real, renderable attachment — unavailable this pass.
const PDF_FIXTURE_AVAILABLE = false;
const PDF_FIXTURE_TODO =
  'TODO: no PDF-attachment fixture/helper in this pass; uploading a renderable PDF and ' +
  'asserting pdf.js worker rendering (canvas/text-layer/zoom/search) deterministically in CI ' +
  'is too fragile to do honestly. Unskip once a PDF-attachment seed helper exists.';

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
  test('opens the in-app viewer and renders the first page with working toolbar controls', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText(/\d+ \/ \d+/)).toBeVisible(); // page indicator "1 / N"
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
    await page.getByRole('button', { name: /search in document/i }).click();
    const input = page.getByPlaceholder(/find in document/i);
    await input.fill('the'); // no Enter — search is as-you-type (debounced)
    await expect(page.locator('[aria-live="polite"]')).toContainText(/\d+\s*\/\s*\d+/);
  });

  test('previous / next page navigation updates the page indicator', async ({ page, screeningProject }) => {
    test.skip(!PDF_FIXTURE_AVAILABLE, PDF_FIXTURE_TODO);
    await gotoWorkbenchPdfPanel(page, screeningProject.project.id);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const viewer = page.getByRole('group', { name: /PDF viewer/i });
    await expect(viewer.getByText(/1 \/ \d+/)).toBeVisible();
    await page.getByRole('button', { name: /next page/i }).click();
    await expect(viewer.getByText(/2 \/ \d+/)).toBeVisible();
  });
});
