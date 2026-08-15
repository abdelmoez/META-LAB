/**
 * pdf-annotations-drag.spec.ts — 117.md §46-§50, §80, §93.
 *
 * WHY THIS FILE EXISTS, next to pdf-annotations.spec.ts.
 *
 * That suite creates its selection with a synthetic `Range` + a dispatched `mouseup`.
 * That is deterministic and it is the right tool for the flows it covers — but it is
 * incapable of catching the bug 117 is about. A synthetic Range is built by the TEST,
 * so no engine can get it wrong; the browser's own drag-to-select over an absolutely
 * positioned, `scaleX`-transformed pdf.js text layer is what WebKit gets wrong, and
 * that path is only reachable through real pointer input.
 *
 * So everything here goes through `page.mouse` over the ACTUAL glyph boxes reported by
 * the text layer, and the file runs under `chromium` AND the `webkit-pdf` project
 * (playwright.config.ts) — §50: "do not simply test Chromium and declare Safari fixed".
 *
 * Assertions are deliberately tolerant about WHICH glyphs a drag caught (font metrics
 * and hit-testing differ per engine, and pinning them would make this a flake factory)
 * and strict about the things that are supposed to be engine-independent:
 *   - a drag over text produces a real document selection;
 *   - the Highlight control appears and its click creates a mark;
 *   - the mark lands on the RIGHT PAGE and OVERLAPS the region that was dragged;
 *   - a comment attaches, and both survive a full reload (they came from the server);
 *   - zoom and a viewport resize only re-project it: its position RELATIVE TO THE PAGE
 *     is unchanged, which is the §76 anchor claim stated as something observable;
 *   - delete removes it everywhere.
 *
 * HONEST SCOPE: Playwright's WebKit is not Safari. It is the same engine family and it
 * reproduces the text-layer selection model, but final sign-off on real Safari/macOS
 * (§93) is a manual step this suite cannot perform.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';
import { attachPdfToFirstRecord, FIXTURE_SELECTABLE } from '../helpers/pdf';

function workbenchPath(projectId: string): string {
  return `/app/project/${encodeURIComponent(projectId)}?tab=screening&screen=screening`;
}

const PDF_PANEL_LABEL = 'Full-text PDF';

/** Every painted highlight rectangle carries data-annotation-id. */
const marks = (page: Page) => page.locator('[data-annotation-id]');

/** Open the T&A workbench, wait for the PDF panel, and open the inline viewer. */
async function openViewer(page: Page, projectId: string): Promise<ShellNav> {
  const shell = new ShellNav(page);
  await shell.goto(workbenchPath(projectId));
  await shell.expectShell();
  await expect(shell.mainContent.getByText(PDF_PANEL_LABEL, { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('group', { name: /PDF viewer/i })).toBeVisible();
  await expect(page.locator('.mlpdf-tl > span').first()).toBeAttached({ timeout: 30_000 });
  return shell;
}

interface GlyphBox {
  /** Viewport coordinates — what page.mouse needs. */
  left: number; top: number; right: number; bottom: number; width: number; height: number;
  /** The same run relative to its page container — what survives a scroll. */
  pageLeft: number; pageTop: number; pageRight: number; pageBottom: number;
}

/**
 * The viewport box of the text run containing `needle` on page 1 — i.e. where the
 * glyphs the reviewer would drag across actually are, as the ENGINE measures them.
 * Returns null when the run is not there (a scanned page, a text layer that failed).
 *
 * It SCROLLS THE RUN INTO VIEW first, which is not a convenience: the T&A workbench
 * puts the PDF panel inside a scrolling record column under a sticky decision bar and
 * pager, so at the project's default viewport the fixture's body line starts BELOW the
 * fold. `getBoundingClientRect` still reports where it would be, and a mouse press at
 * those coordinates lands on the pager button that covers them — a drag that selects
 * nothing, for a reason that has nothing to do with the text layer. A reviewer scrolls
 * the line into view before dragging across it; so does this.
 *
 * Both coordinate systems are returned. Viewport coords drive `page.mouse`; the
 * page-relative ones are what the later assertions compare, because Playwright may
 * auto-scroll the container to reach a control and viewport numbers captured before
 * that would then be measuring a different thing.
 */
async function glyphBox(page: Page, needle: string): Promise<GlyphBox | null> {
  return page.evaluate((text: string) => {
    const tl = document.querySelector('.mlpdf-tl');
    if (!tl) return null;
    const spans = Array.from(tl.querySelectorAll(':scope > span')) as HTMLElement[];
    const target = spans.find((s) => ((s.dataset.t ?? s.textContent) || '').includes(text));
    if (!target) return null;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const r = target.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const pageEl = target.closest('[data-page]');
    const p = pageEl ? pageEl.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      pageLeft: r.left - p.left, pageTop: r.top - p.top, pageRight: r.right - p.left, pageBottom: r.bottom - p.top,
    };
  }, needle);
}

/**
 * A REAL drag across `box`, in steps, the way a reviewer selects a line. Returns the
 * horizontal span actually traversed, in PAGE-RELATIVE px, so the caller can assert the
 * highlight overlaps it no matter what the container scrolled to in between.
 */
async function dragAcross(page: Page, box: GlyphBox): Promise<{ x0: number; x1: number }> {
  const y = box.top + box.height / 2;
  const inset = Math.max(1, Math.min(6, box.width * 0.04));
  const x0 = box.left + inset;
  const x1 = box.right - inset;

  // The press must actually land on a glyph run of THIS text layer. If something is
  // covering it, every assertion below would fail as "the drag selected nothing", which
  // says nothing about the engine's selection behaviour — the thing this file exists to
  // test. Checked, not assumed, so the failure names itself.
  const onText = await page.evaluate(([px, py]: number[]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return 'nothing is at the drag point';
    const span = el.closest('.mlpdf-tl > span');
    return span ? '' : `the drag point is covered by <${el.tagName.toLowerCase()}>`;
  }, [x0 + Math.max(2, (x1 - x0) * 0.1), y]);
  expect(onText, 'the drag never reached the text layer').toBe('');

  await page.mouse.move(x0, y);
  await page.mouse.down();
  // Several intermediate moves: a single jump to the end is not a drag in any engine's
  // selection state machine, and WebKit in particular resolves the extension per move.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y, { steps: 2 });
  }
  await page.mouse.up();
  return { x0: box.pageLeft + inset, x1: box.pageRight - inset };
}

/** The first mark's box expressed as fractions of the page-1 container box. */
async function markRelativeToPage(page: Page): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return page.evaluate(() => {
    const pageEl = document.querySelector('[data-page="1"]');
    const mark = document.querySelector('[data-annotation-id]');
    if (!pageEl || !mark) return null;
    const p = pageEl.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    if (!(p.width > 0) || !(p.height > 0)) return null;
    return { x: (m.left - p.left) / p.width, y: (m.top - p.top) / p.height, w: m.width / p.width, h: m.height / p.height };
  });
}

/** The first mark's box in page-relative CSS px (the frame the drag was recorded in). */
async function markPageBox(page: Page): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  return page.evaluate(() => {
    const pageEl = document.querySelector('[data-page="1"]');
    const mark = document.querySelector('[data-annotation-id]');
    if (!pageEl || !mark) return null;
    const p = pageEl.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    if (!(m.width > 0) || !(m.height > 0)) return null;
    return { x0: m.left - p.left, y0: m.top - p.top, x1: m.right - p.left, y1: m.bottom - p.top };
  });
}

test.describe('117.md §46-§50 — PDF highlighting driven by a real mouse drag', () => {
  test('a drag over real glyphs highlights them, comments attach, and both survive reload, zoom and resize', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 2 });
    await openViewer(page, screeningProject.project.id);

    /* §80 "PDF opens" + the precondition every later assertion depends on: there IS a
       text layer here, and it reports measurable glyph boxes. */
    const box = await glyphBox(page, FIXTURE_SELECTABLE);
    expect(box, 'page 1 reported no measurable glyph box for the fixture line').not.toBeNull();
    // §47 — the text layer must not have failed silently; that stamp is the tell.
    await expect(page.locator('[data-page="1"][data-tl-error]')).toHaveCount(0);

    /* §80 "text selection works" — through the browser's own drag, not a synthetic Range. */
    const dragged = await dragAcross(page, box!);
    const selectedText = await page.evaluate(() => String(window.getSelection() || ''));
    expect(selectedText.replace(/\s+/g, ' ').trim().length,
      'the drag produced no document selection at all').toBeGreaterThan(3);

    /* §80 "highlight creation works" — the §75 control, then the mark. */
    const highlightBtn = page.getByRole('button', { name: 'Highlight selected text' });
    await expect(highlightBtn).toBeVisible();
    await highlightBtn.click();
    await expect(marks(page).first()).toBeVisible();
    // §46 — the control survived its own mousedown: on the broken path WebKit collapsed
    // the selection there, the control unmounted, and this click never landed.
    await expect(page.getByRole('button', { name: /Highlights \(1\)/ })).toBeVisible();

    /* The mark is on the page that was dragged, and it covers what was dragged. Both
       boxes are page-relative, so an auto-scroll on the way to a control cannot make
       this pass or fail for the wrong reason. */
    await expect(page.locator('[data-page="1"] [data-annotation-id]').first()).toBeVisible();
    await expect(page.locator('[data-page="2"] [data-annotation-id]')).toHaveCount(0);
    const markBox = await markPageBox(page);
    expect(markBox, 'the painted highlight had no measurable box').not.toBeNull();
    const TOL = 8;   // px: engines disagree about glyph edges, not about which line
    expect(markBox!.x0, 'the highlight starts past the end of the drag').toBeLessThan(dragged.x1 + TOL);
    expect(markBox!.x1, 'the highlight ends before the start of the drag').toBeGreaterThan(dragged.x0 - TOL);
    expect(markBox!.y0, 'the highlight sits below the dragged line').toBeLessThan(box!.pageBottom + TOL);
    expect(markBox!.y1, 'the highlight sits above the dragged line').toBeGreaterThan(box!.pageTop - TOL);

    /* §80 "comment creation works" — through the popover, with real keyboard input. */
    await marks(page).first().click();
    const popover = page.getByRole('dialog', { name: /Highlight by/i });
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: 'Add comment' }).click();
    const textarea = popover.locator('textarea');
    await textarea.click();
    await page.keyboard.type('Confirm the denominator for this line.\nSecond line of the note.');
    await expect(textarea).toHaveValue(/Second line of the note\./);
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect(popover).toContainText('Confirm the denominator for this line.');

    /* §80 "highlight persists" / "comment persists" — from the SERVER, not memory. */
    await page.reload();
    await openViewer(page, screeningProject.project.id);
    await expect(marks(page).first()).toBeVisible({ timeout: 30_000 });
    const beforeZoom = await markRelativeToPage(page);
    expect(beforeZoom).not.toBeNull();

    /* §80 "zoom preserves positions" — §76 says the anchor is a property of the
       DOCUMENT, so the mark's position RELATIVE TO ITS PAGE may not move at all. */
    const zoomIn = page.getByRole('group', { name: /PDF viewer/i }).getByRole('button', { name: 'Zoom in' });
    await zoomIn.click();
    await zoomIn.click();
    await expect(marks(page).first()).toBeVisible();
    const afterZoom = await markRelativeToPage(page);
    expect(afterZoom).not.toBeNull();
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Math.abs(afterZoom![k] - beforeZoom![k]), `zoom moved the highlight's ${k}`).toBeLessThan(0.02);
    }

    /* §48 "resizing viewer" — the same claim under a container-width change, which is
       also what entering/leaving a fullscreen workspace does to this panel. */
    await page.setViewportSize({ width: 1100, height: 820 });
    await expect(marks(page).first()).toBeVisible();
    const afterResize = await markRelativeToPage(page);
    expect(afterResize).not.toBeNull();
    for (const k of ['x', 'y', 'w', 'h'] as const) {
      expect(Math.abs(afterResize![k] - beforeZoom![k]), `resize moved the highlight's ${k}`).toBeLessThan(0.03);
    }

    /* The comment is still attached to it after all of that. */
    await marks(page).first().click();
    await expect(page.getByRole('dialog', { name: /Highlight by/i }))
      .toContainText('Confirm the denominator for this line.');
  });

  test('§80 — a real drag can reopen a highlight, and delete removes it everywhere', async ({ page, request, screeningProject }) => {
    await attachPdfToFirstRecord(request, screeningProject.siftId, { pages: 1 });
    await openViewer(page, screeningProject.project.id);

    const box = await glyphBox(page, FIXTURE_SELECTABLE);
    expect(box).not.toBeNull();
    await dragAcross(page, box!);
    await page.getByRole('button', { name: 'Highlight selected text' }).click();
    await expect(marks(page).first()).toBeVisible();

    /* Clicking the painted mark opens its popover — the §49 "click highlight → open
       comment" path, reached with a real click on real coordinates. */
    await marks(page).first().click();
    const popover = page.getByRole('dialog', { name: /Highlight by/i });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Highlighted by you');

    await popover.getByRole('button', { name: 'Delete' }).click();
    await expect(marks(page)).toHaveCount(0);

    // …and it is gone on the server, not just in this tab.
    await page.reload();
    await openViewer(page, screeningProject.project.id);
    await expect(marks(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Highlights \(0\)/ })).toBeVisible();
    // §85 — the PDF itself is untouched by an annotation delete.
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
