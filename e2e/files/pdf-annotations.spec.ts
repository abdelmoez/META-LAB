/**
 * pdf-annotations.spec.ts — 116.md §75-§100 (Part VII). The collaborative PDF
 * annotation subsystem, end-to-end through the real UI and the real API.
 *
 * The whole flow the directive describes, in one arc:
 *   drag-select text → the small context control appears → Highlight → it persists →
 *   add a comment → RELOAD → both survive → recolour → Ctrl+Z reverts the recolour.
 *
 * Plus the two behaviours that are easy to regress silently:
 *   §86 "immediately after creating a highlight, Ctrl+Z removes it" — and it must
 *        remove the HIGHLIGHT, not the screening decision underneath it;
 *   §96 a scanned (image-only) PDF has no text layer, so the highlight control simply
 *        never appears — the product must not pretend text exists.
 *
 * Selection is created with a real Range + a real bubbling `mouseup` on the text layer,
 * which is exactly the path a mouse drag takes into the capture listener. Driving raw
 * mouse coordinates over pdf.js glyph boxes is not deterministic in CI; this is. The
 * last spec drops the `mouseup` entirely to cover the §100 keyboard path, where a
 * `selectionchange` is the only event the browser fires.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import { attachPdfToFirstRecord, FIXTURE_SELECTABLE } from '../helpers/pdf';

function workbenchPath(projectId: string): string {
  return `/app/project/${encodeURIComponent(projectId)}?tab=screening&screen=screening`;
}

const PDF_PANEL_LABEL = 'Full-text PDF';

/** Open the T&A workbench, wait for the PDF panel, and open the inline viewer. */
async function openViewer(page: Page, projectId: string): Promise<ShellNav> {
  const shell = new ShellNav(page);
  await shell.goto(workbenchPath(projectId));
  await shell.expectShell();
  await expect(shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('group', { name: /PDF viewer/i })).toBeVisible();
  // Wait for page 1's text layer to exist before trying to select in it.
  await expect(page.locator('.mlpdf-tl > span').first()).toBeAttached({ timeout: 30_000 });
  return shell;
}

/**
 * Select the text run containing `needle` inside page 1's text layer and fire the
 * bubbling `mouseup` the capture listener waits for. Returns 'ok' | 'no-text-layer' |
 * 'no-match' so a spec can assert the scanned-PDF case honestly.
 */
async function selectPdfText(page: Page, needle: string, opts: { mouseup?: boolean } = {}): Promise<string> {
  return page.evaluate(({ text, withMouseup }: { text: string; withMouseup: boolean }) => {
    const tl = document.querySelector('.mlpdf-tl');
    if (!tl) return 'no-text-layer';
    const spans = Array.from(tl.querySelectorAll(':scope > span')) as HTMLElement[];
    const target = spans.find((s) => ((s.dataset.t ?? s.textContent) || '').includes(text));
    if (!target) return 'no-match';
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    if (!sel) return 'no-selection';
    sel.removeAllRanges();
    sel.addRange(range);
    // withMouseup:false leaves the selection exactly as a Shift+Arrow user leaves it —
    // changed, with no mouse event anywhere. That is the §100 path.
    if (withMouseup) target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'ok';
  }, { text: needle, withMouseup: opts.mouseup !== false });
}

/** Every painted highlight rectangle carries data-annotation-id. */
const marks = (page: Page) => page.locator('[data-annotation-id]');

test.describe('PDF annotations — the full collaborative arc', () => {
  // 116.md §20 (validation) — THE 1600×900 PIN IS GONE. It used to read: "the
  // annotation gesture needs a viewer big enough to annotate in; the T&A workbench
  // splits the window between four columns, so at the 1280px default the PDF panel is
  // ~74px wide and fit-width lands at ~0.09×, where a 12pt line is a single pixel tall
  // and the popover is wider than the panel."
  //
  // That was a layout defect, not a property of the annotation flow: the record list
  // and the filters sidebar were both `flexShrink: 0` and the centre column had no
  // floor, so every missing pixel came out of the centre. With
  // src/frontend/screening/lib/workbenchLayout.js the same 1280×720 default now gives
  // the panel a 362px reading column at ~0.57×, which is the reviewing situation §75
  // describes — so this suite runs at the project default like every other spec.
  // (The low-zoom capture behaviour itself stays pinned by
  // tests/unit/annotations/pdfAnnotationModel.test.js, where it can be asserted exactly.)

  test('highlight → comment → reload → persists → recolour → undo @smoke', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 2 });
    await openViewer(page, screeningProject.project.id);

    /* §75 — 1. drag-select, 2. a small context control appears. */
    expect(await selectPdfText(page, FIXTURE_SELECTABLE)).toBe('ok');
    const highlightBtn = page.getByRole('button', { name: 'Highlight selected text' });
    await expect(highlightBtn).toBeVisible();

    /* §75 — 3. choose Highlight, 4. it persists. */
    await highlightBtn.click();
    await expect(marks(page).first()).toBeVisible();
    // §89 optimistic: it is on screen immediately; §100: the label names author + colour.
    await expect(page.getByRole('button', { name: /yellow highlight by you/i })).toBeVisible();
    // The §98 list agrees with the overlay.
    await expect(page.getByRole('button', { name: /Highlights \(1\)/ })).toBeVisible();

    /* §79 — click the highlight, add a comment, autosave. */
    await marks(page).first().click();
    const popover = page.getByRole('dialog', { name: /Highlight by/i });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Highlighted by you');
    await expect(popover).toContainText(FIXTURE_SELECTABLE.slice(0, 30));
    await popover.getByRole('button', { name: 'Add comment' }).click();
    await popover.locator('textarea').fill('Is this the intention-to-treat population?');
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect(popover).toContainText('Is this the intention-to-treat population?');

    /* §87/§89 — RELOAD: the highlight and the comment came from the server, not memory. */
    await page.reload();
    await openViewer(page, screeningProject.project.id);
    await expect(marks(page).first()).toBeVisible({ timeout: 30_000 });
    await marks(page).first().click();
    const reopened = page.getByRole('dialog', { name: /Highlight by/i });
    await expect(reopened).toContainText('Is this the intention-to-treat population?');

    /* §77 — recolour from the popover palette. */
    await reopened.getByRole('button', { name: 'Change colour to Blue' }).click();
    await expect(page.getByRole('button', { name: /blue highlight by you/i })).toBeVisible();

    /* §86 — Ctrl+Z reverts the RECOLOUR (the last annotation action), in the PDF's own
       history scope. The screening decision underneath is untouched. */
    await page.locator('[data-pdf-annotations="1"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: /yellow highlight by you/i })).toBeVisible();
  });

  test('§86 — Ctrl+Z immediately after creating a highlight removes it', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1 });
    await openViewer(page, screeningProject.project.id);

    expect(await selectPdfText(page, FIXTURE_SELECTABLE)).toBe('ok');
    await page.getByRole('button', { name: 'Highlight selected text' }).click();
    await expect(marks(page).first()).toBeVisible();

    await page.locator('[data-pdf-annotations="1"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(marks(page)).toHaveCount(0);

    // …and it is gone on the server too, not just in this tab.
    await page.reload();
    await openViewer(page, screeningProject.project.id);
    await expect(marks(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Highlights \(0\)/ })).toBeVisible();
  });

  test('§85 — "Clear my annotations" removes them after an explicit confirmation', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1 });
    await openViewer(page, screeningProject.project.id);

    expect(await selectPdfText(page, FIXTURE_SELECTABLE)).toBe('ok');
    await page.getByRole('button', { name: 'Highlight selected text' }).click();
    await expect(marks(page).first()).toBeVisible();

    await page.getByRole('button', { name: /Highlights \(1\)/ }).click();
    await page.getByRole('button', { name: 'Clear my annotations' }).click();
    // A confirmation step, not an instant destructive action.
    const confirm = page.getByRole('alertdialog', { name: 'Clear my annotations' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('the PDF itself is not deleted');
    await confirm.getByRole('button', { name: 'Clear my annotations' }).click();

    await expect(marks(page)).toHaveCount(0);
    // §85 — the PDF itself is untouched: the viewer is still mounted and rendering.
    await expect(page.getByRole('group', { name: /PDF viewer/i })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('§96 — a scanned PDF with no text layer never offers the highlight control', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1, textLayer: false });

    const shell = new ShellNav(page);
    await shell.goto(workbenchPath(screeningProject.project.id));
    await shell.expectShell();
    await expect(shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('group', { name: /PDF viewer/i })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

    // There is nothing to select, so nothing can be highlighted — and the page renders.
    expect(await selectPdfText(page, FIXTURE_SELECTABLE)).toBe('no-match');
    await expect(page.getByRole('button', { name: 'Highlight selected text' })).toHaveCount(0);
    await expect(marks(page)).toHaveCount(0);
  });

  test('§75 — Escape dismisses the control without destroying the selection', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1 });
    await openViewer(page, screeningProject.project.id);

    expect(await selectPdfText(page, FIXTURE_SELECTABLE)).toBe('ok');
    await expect(page.getByRole('button', { name: 'Highlight selected text' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Highlight selected text' })).toHaveCount(0);
    await expect(marks(page)).toHaveCount(0);

    // The browser selection survives, so the reviewer can still copy what they selected.
    const stillSelected = await page.evaluate(() => String(window.getSelection() || ''));
    expect(stillSelected).toContain(FIXTURE_SELECTABLE.slice(0, 20));
  });

  test('§100 — a selection made with no mouse at all still offers the control', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1 });
    await openViewer(page, screeningProject.project.id);

    // Selecting with Shift+Arrow fires `selectionchange` and NOTHING else — no
    // mousedown, no mouseup. A capture path bound only to `mouseup` leaves a keyboard
    // reviewer with no way to reach the Highlight control at all, which is the gap
    // §100 ("comments and controls need keyboard focus") closes.
    expect(await selectPdfText(page, FIXTURE_SELECTABLE, { mouseup: false })).toBe('ok');
    const highlightBtn = page.getByRole('button', { name: 'Highlight selected text' });
    await expect(highlightBtn).toBeVisible();
    // And it is a real, reachable control: focus it from the keyboard and activate it.
    await highlightBtn.focus();
    await expect(highlightBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(marks(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Highlights \(1\)/ })).toBeVisible();
  });
});
