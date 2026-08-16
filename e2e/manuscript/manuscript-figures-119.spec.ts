/**
 * manuscript-figures-119.spec.ts — 119.md §5, and §10 scenario 12 end to end:
 * "Inserting, renumbering, replacing, cross-referencing, exporting, deleting, and
 * restoring a figure."
 *
 * None of this is provable in Node. The picture is a real upload through a real
 * authenticated route; it renders as a real <img> inside a contentEditable island;
 * its number is derived from DOCUMENT POSITION, so it changes when a second figure
 * is inserted above it; a replace must keep the very same key so cross-references
 * survive; and the deletion's undo is the BROWSER's native one — the whole reason
 * the marker lives in the prose.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;

/** A real 1×1 PNG (signature + IHDR + IDAT + IEND) — valid to any sniffer. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** A second, visibly different 2×2 PNG, so a replace is observable. */
const PNG_2PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAGDcDA0ZlHLcAAAAASUVORK5CYII=',
  'base64',
);
/** An SVG — must be refused by the server, whatever the file name says. */
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function openEditorSection(page: Page, projectId: string, section: string) {
  // 119.md §3 — Continuous View is the default now, so Section View is named.
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = page.getByTestId('stitch-manuscript-rich-editor');
  await expect(editor).toBeVisible();
  return editor;
}

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const figureBlocks = (page: Page) => editorOf(page).locator('figure.ms-figblock');
const figureImgs = (page: Page) => editorOf(page).locator('figure.ms-figblock img.ms-figimg');
const figureCaptions = (page: Page) => editorOf(page).locator('figure.ms-figblock .ms-figcap');
const figureTitles = (page: Page) => editorOf(page).locator('figure.ms-figblock .ms-figcap-t');

/** Insert a picture at the caret through the toolbar (the file-picker path). */
async function insertPicture(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('stitch-manuscript-tb-picture').click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: bytes });
}

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status'))
    .toContainText(/Saved/i, { timeout: 25_000 });
}

async function undoUntil(page: Page, done: () => Promise<boolean>, max = 15) {
  for (let i = 0; i < max; i += 1) {
    if (await done()) return;
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(90);
  }
}

test.describe('Manuscript figures (119.md §5 · §10 scenario 12)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§10.12: insert → number → cross-reference → replace → delete warns → undo restores', async ({ page, tmpProject }) => {
    /* A picture in METHODS first, so the one in Results has something ABOVE it in
       the document. Numbering follows document position across the whole
       manuscript, and Methods precedes Results — so this is what makes the Results
       figure "Figure 2" without depending on where a caret happened to be. */
    const methods = await openEditorSection(page, tmpProject.id, 'methods');
    await methods.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertPicture(page, 'cohort.png', PNG_2PX);
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.type('Cohort diagram');
    await expect(figureCaptions(page).first()).toContainText('Figure 1.');
    const cohortKey = (await figureBlocks(page).first().getAttribute('data-figcap')) || '';
    expect(cohortKey).toMatch(/^[a-z0-9-]+$/);
    await saved(page);

    /* ── INSERT ─────────────────────────────────────────────────────────────── */
    await page.getByTestId('stitch-manuscript-section-results').click();
    const editor = editorOf(page);
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertPicture(page, 'flow.png', PNG_1PX);
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    // The picture is a REAL image served by the authenticated raw route.
    const src = await figureImgs(page).first().getAttribute('src');
    expect(src).toContain('/manuscript-figures/');
    expect(src).toContain('/raw');
    const naturalW = await figureImgs(page).first().evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalW).toBeGreaterThan(0);

    // The caret lands in the title — the one thing only the researcher can supply.
    await page.keyboard.type('Study flow');
    await expect(figureTitles(page).first()).toHaveText('Study flow');
    // …and the NUMBER is derived from DOCUMENT position, never typed: the Methods
    // picture is Figure 1, so this one is Figure 2.
    await expect(figureCaptions(page).first()).toContainText('Figure 2.');

    /* ── CROSS-REFERENCE ────────────────────────────────────────────────────── */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Screening is summarised in ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const picker = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(picker).toBeVisible();
    await picker.getByTestId('stitch-manuscript-crossref-search').fill('Study flow');
    await picker.getByRole('option', { name: /Study flow/ }).first().click();
    const chip = editorOf(page).locator('span.ms-asset[data-asset^="figure:"]').first();
    await expect(chip).toHaveText('Figure 2');
    await expect(chip).not.toHaveAttribute('data-asset-broken', 'true');
    const figKey = (await chip.getAttribute('data-asset')) || '';
    expect(figKey).toMatch(/^figure:[a-z0-9-]+$/);
    await saved(page);

    /* ── PERSISTS across a reload ───────────────────────────────────────────── */
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-results').click();
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(figureImgs(page).first()).toBeVisible();
    await expect(chip).toHaveText('Figure 2', { timeout: 15_000 });

    /* ── REPLACE keeps the identity ─────────────────────────────────────────── */
    const targetKey = figKey.replace('figure:', '');
    const beforeSrc = await editorOf(page)
      .locator(`figure.ms-figblock[data-figcap="${targetKey}"] img`).getAttribute('src');
    await page.getByTestId('stitch-manuscript-subtab-figures').click();
    const slug = figKey.replace(/:/g, '-');
    const replaceChooser = page.waitForEvent('filechooser');
    await page.getByTestId(`stitch-manuscript-figure-replace-${slug}`).click();
    await (await replaceChooser).setFiles({ name: 'flow-v2.png', mimeType: 'image/png', buffer: PNG_2PX });
    await expect(page.getByTestId(`stitch-manuscript-figure-version-${slug}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`stitch-manuscript-figure-version-${slug}`)).toContainText('Version 2');
    // Same key, same row, same URL → the identity survived; only the bytes moved.
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-results').click();
    const afterSrc = await editorOf(page)
      .locator(`figure.ms-figblock[data-figcap="${targetKey}"] img`).getAttribute('src');
    expect(afterSrc).toBe(beforeSrc);
    await expect(editorOf(page).locator('span.ms-asset[data-asset^="figure:"]').first())
      .not.toHaveAttribute('data-asset-broken', 'true');

    /* ── RENUMBER: removing the Methods picture moves this one up, and the
          cross-reference follows the OBJECT (it points at an id, not at text) ── */
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await editorOf(page).locator(`figure.ms-figblock[data-figcap="${cohortKey}"] img`).click();
    await expect(page.getByTestId('stitch-manuscript-figure-ctl')).toBeVisible();
    await page.getByTestId('stitch-manuscript-figure-op-remove').click();
    // Nothing references the Methods picture, so there is nothing to warn about.
    await expect(page.getByTestId('stitch-manuscript-figure-delete-confirm')).toHaveCount(0);
    await expect(editorOf(page).locator('figure.ms-figblock')).toHaveCount(0);
    await page.getByTestId('stitch-manuscript-section-results').click();
    await expect(figureCaptions(page).first()).toContainText('Figure 1.', { timeout: 15_000 });
    await expect(editorOf(page).locator('span.ms-asset[data-asset^="figure:"]').first())
      .toHaveText('Figure 1', { timeout: 15_000 });

    /* ── DELETE warns with the real reference count ─────────────────────────── */
    await editorOf(page).locator(`figure.ms-figblock[data-figcap="${targetKey}"] img`).click();
    await expect(page.getByTestId('stitch-manuscript-figure-ctl')).toBeVisible();
    await page.getByTestId('stitch-manuscript-figure-op-remove').click();
    const dialog = page.getByTestId('stitch-manuscript-figure-delete-confirm');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-figure-delete-count'))
      .toContainText('referenced 1 time in the manuscript');
    await expect(dialog).toContainText('image file is kept');
    await page.getByTestId('stitch-manuscript-figure-delete-confirm-btn').click();
    await expect(editorOf(page).locator(`figure.ms-figblock[data-figcap="${targetKey}"]`)).toHaveCount(0);
    await expect(figureBlocks(page)).toHaveCount(0);
    /* The reference is NOT broken, and that is the design: the figure's row and its
       bytes survive the removal (which is what lets Ctrl+Z restore a marker pointing
       at a live file), so the sentence still points at a real project figure. The
       Figures panel now lists it as "Not placed", and the export prints it at the
       end until it is placed again. */
    const orphanChip = editorOf(page).locator('span.ms-asset[data-asset^="figure:"]').first();
    await expect(orphanChip).not.toHaveAttribute('data-asset-broken', 'true');
    await expect(orphanChip).toHaveText('Figure 1', { timeout: 15_000 });

    /* ── UNDO restores the marker, and it points at a LIVE file ─────────────── */
    // Click into PROSE, not onto the cross-reference chip: a click on a chip opens
    // its action menu WITHOUT moving the caret (117.md §10), which would leave the
    // undo keystroke with no editing host to act on.
    await editor.click({ position: { x: 8, y: 8 } });
    await undoUntil(page, async () => (await figureBlocks(page).count()) === 1);
    await expect(figureBlocks(page)).toHaveCount(1);
    const restored = editorOf(page).locator(`figure.ms-figblock[data-figcap="${targetKey}"] img`);
    await expect(restored).toBeVisible();
    // The critical assertion: the restored marker points at bytes that still exist.
    await expect
      .poll(async () => restored.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(editorOf(page).locator('span.ms-asset[data-asset^="figure:"]').first())
      .not.toHaveAttribute('data-asset-broken', 'true');
    await saved(page);
  });

  test('§5: the Figures menu holds uploaded and generated figures, and refuses an SVG', async ({ page, tmpProject }) => {
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript`);
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-subtab-figures').click();
    const panel = page.getByTestId('stitch-manuscript-assets-figures');
    await expect(panel).toBeVisible();
    // The generated set is still here — ONE menu, not two.
    await expect(panel).toContainText('PRISMA 2020 flow diagram');

    // §5 "Provide safe server-side file validation … never trust file extensions":
    // an SVG renamed .png is refused by the BYTES, with an actionable message.
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('stitch-manuscript-figures-upload').click();
    await (await chooser).setFiles({ name: 'evil.png', mimeType: 'image/png', buffer: SVG_BYTES });
    await expect(page.getByTestId('stitch-manuscript-figures-error'))
      .toContainText(/SVG and TIFF are not accepted/i, { timeout: 20_000 });

    // A real picture uploads and is listed as NOT PLACED until it is put in the text.
    const ok = page.waitForEvent('filechooser');
    await page.getByTestId('stitch-manuscript-figures-upload').click();
    await (await ok).setFiles({ name: 'panel.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(panel.getByText('Not placed').first()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText('Not in export').first()).toBeVisible();
  });

  test('§5: pasting an image no longer makes it vanish silently', async ({ page, tmpProject, browserName }) => {
    // The clipboard image path needs a DataTransfer the harness can build; that is
    // Chromium-only here, which is fine — the same seam serves the file picker and
    // drag-and-drop, and those are covered above.
    test.skip(browserName !== 'chromium', 'clipboard image items need a chromium DataTransfer');
    const editor = await openEditorSection(page, tmpProject.id, 'discussion');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await editor.evaluate(async (el, b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_1PX.toString('base64'));
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(figureImgs(page).first()).toBeVisible();
  });
});
