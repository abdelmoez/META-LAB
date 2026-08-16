/**
 * manuscript-tables-below-120.spec.ts — 120.md §3 (create and type in a paragraph
 * BELOW media) and §4 (unified and protected media entities).
 *
 * None of this is provable in Node, which is why the file exists:
 *
 *  §3  The persisted model is a markdown subset and it cannot represent an empty
 *      paragraph — the serializer drops any block whose text trims to ''. So a
 *      section whose markdown ends with a table or a figure MOUNTS with a
 *      `contenteditable="false"` island as the editing host's last child, and there
 *      is no caret position after it at all: clicking below it, pressing ArrowDown
 *      out of the last cell and pressing Enter in the caption all had nowhere to go.
 *      The fix is a synthesized trailing paragraph plus boundary caret commands, and
 *      every part of it is engine behaviour: caret geometry, ArrowDown semantics
 *      inside a table, and the browser's own native undo stack.
 *
 *  §4  A manual table's caption is a separate top-level SIBLING of its <table>, so a
 *      browser will happily park a collapsed caret between them. A keystroke there
 *      created an arbitrary paragraph INSIDE the object — the exact structure §4
 *      forbids — and the previous serialize-time rule then DELETED the caption on
 *      the next save, taking the table's identity, its title, its number and every
 *      cross-reference with it. 120.md §4 replaces that deletion with a repair, and
 *      closes the entry vector in the editor. The data-loss half is reproduced here
 *      by forcing the broken DOM shape directly, because no keystroke should be able
 *      to produce it any more.
 *
 * File name: matched by the `webkit-manuscript` Playwright project
 * (`**\/manuscript/manuscript-{table,figure}*.spec.ts`) as well as by chromium — the
 * 119.md §2 rule applies unchanged here: caret geometry inside a nested editing
 * island is precisely where WebKit differs, so Safari must not be declared fixed
 * from Blink alone.
 *
 * WEBKIT ≠ SAFARI: green under `webkit-manuscript` is engine evidence, not a Safari
 * sign-off (see docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md › "Real-Safari manual QA").
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

async function openEditorSection(page: Page, projectId: string, section: string) {
  // 119.md §3 — Section View is the non-default view now, so it is named in the URL.
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = page.getByTestId('stitch-manuscript-rich-editor');
  await expect(editor).toBeVisible();
  return editor;
}

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const captions = (page: Page) => editorOf(page).locator('.ms-tblcap');
const titles = (page: Page) => editorOf(page).locator('.ms-tblcap-t');
const tables = (page: Page) => editorOf(page).locator('table');
const figureBlocks = (page: Page) => editorOf(page).locator('figure.ms-figblock');
const figureImgs = (page: Page) => editorOf(page).locator('figure.ms-figblock img.ms-figimg');
const figureTitles = (page: Page) => editorOf(page).locator('figure.ms-figblock .ms-figcap-t');

/** Insert an r×c table at the caret through the toolbar grid picker. */
async function insertTable(page: Page, r = 2, c = 2) {
  await page.getByTestId('stitch-manuscript-tb-table').click();
  await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
  await page.getByTestId(`stitch-manuscript-table-grid-${r}-${c}`).click();
}

/** Insert a picture at the caret through the toolbar (the file-picker path). */
async function insertPicture(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('stitch-manuscript-tb-picture').click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: bytes });
}

/** Wait for the debounced field patch + blob autosave to land. */
async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status'))
    .toContainText(/Saved/i, { timeout: 25_000 });
}

/** Native undo/redo granularity is an ENGINE fact (a typed run may be one step or
    several), so drive the condition rather than a keystroke count. */
async function undoUntil(page: Page, done: () => Promise<boolean>, max = 20) {
  for (let i = 0; i < max; i += 1) {
    if (await done()) return;
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(80);
  }
}
async function redoUntil(page: Page, done: () => Promise<boolean>, max = 20) {
  for (let i = 0; i < max; i += 1) {
    if (await done()) return;
    await page.keyboard.press(i % 2 === 0 ? 'ControlOrMeta+Shift+z' : 'Control+y');
    await page.waitForTimeout(80);
  }
}

/** Everything the section says AFTER its last table — the assertion that a
    paragraph is genuinely below the media rather than inside it. */
function textAfterLastTable(page: Page) {
  return editorOf(page).evaluate((el) => {
    const list = el.querySelectorAll('table');
    const t = list[list.length - 1];
    if (!t) return '';
    let out = '';
    let n: Element | null = t.nextElementSibling;
    while (n) { out += `${n.textContent || ''} `; n = n.nextElementSibling; }
    return out.trim();
  });
}

/** …and the same for the last figure island. */
function textAfterLastFigure(page: Page) {
  return editorOf(page).evaluate((el) => {
    const list = el.querySelectorAll('figure.ms-figblock');
    const f = list[list.length - 1];
    if (!f) return '';
    /* Read DOCUMENT order, not sibling order: a Blink undo can restore the figure
       nested one level down (the engine records positions, not our tree shape), and
       a caret parked at the root can leave typed text as a bare text node — both are
       invisible to a nextElementSibling walk from the figure itself. Climb to the
       top-level block first, then take every following sibling INCLUDING text nodes. */
    let top: Element = f;
    while (top.parentElement && top.parentElement !== el) top = top.parentElement;
    let out = '';
    let n: ChildNode | null = top.nextSibling;
    while (n) { out += `${n.textContent || ''} `; n = n.nextSibling; }
    return out.trim();
  });
}

/** Is there a paragraph sitting between a caption island and its table? That DOM
    is the §4 violation: two parts of one object with prose wedged between them. */
function paragraphBetweenCaptionAndTable(page: Page) {
  return editorOf(page).evaluate((el) => {
    const caps = Array.from(el.querySelectorAll('.ms-tblcap'));
    return caps.filter((c) => {
      const next = c.nextElementSibling;
      return !next || next.tagName !== 'TABLE';
    }).length;
  });
}

/** Click in the empty space directly BELOW the last block — 120.md §3's first
    required interaction, and the one a researcher reaches for first. */
async function clickBelowLastBlock(page: Page) {
  const editor = editorOf(page);
  const box = await editor.boundingBox();
  const bottom = await editor.evaluate((el) => {
    const kids = Array.from(el.children);
    const last = kids[kids.length - 1];
    return last ? last.getBoundingClientRect().bottom : el.getBoundingClientRect().top;
  });
  if (!box) throw new Error('the editor has no geometry');
  const y = Math.min(box.height - 4, Math.max(4, bottom - box.y + 10));
  await editor.click({ position: { x: 24, y } });
}

test.describe('A paragraph below media (120.md §3/§4)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── Journey B: the table is the FINAL node of the section ──────────────────── */

  test('§3: a table as the last node — click below it, type, undo/redo, reload', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Randomised trials were pooled with a random-effects model.');
    await page.keyboard.press('Enter');
    await insertTable(page);
    await page.keyboard.type('Baseline characteristics');
    await expect(tables(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Baseline characteristics');

    /* THE DEFECT: the table is the last node, so before 120.md §3 there was no caret
       position after it at all — this click did nothing whatsoever. */
    await clickBelowLastBlock(page);
    await page.keyboard.type('Table 1 shows the pooled baseline data.');

    // The sentence is genuinely BELOW the table — not in a cell, not in the caption.
    await expect.poll(() => textAfterLastTable(page), { timeout: 10_000 })
      .toContain('Table 1 shows the pooled baseline data.');
    await expect(tables(page).first()).not.toContainText('pooled baseline data');
    await expect(titles(page).first()).toHaveText('Baseline characteristics');
    // …and it did not become part of the media block: one table, one caption.
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);

    /* UNDO: typing in the affordance paragraph is ORDINARY text editing, and undoing
       it must never delete or corrupt the media block above it (§3's undo clause). */
    await undoUntil(page, async () => !((await textAfterLastTable(page)) || '').includes('pooled baseline data'));
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);
    await expect(captions(page).first()).toContainText('Table 1.');
    await expect(titles(page).first()).toHaveText('Baseline characteristics');
    await expect(editor).toContainText('random-effects model');

    // REDO puts the paragraph back in the same place (below the table).
    await redoUntil(page, async () => ((await textAfterLastTable(page)) || '').includes('pooled baseline data'));
    await expect.poll(() => textAfterLastTable(page), { timeout: 10_000 }).toContain('pooled baseline data');

    /* RELOAD: the paragraph is real, autosaved content, and the section still ends
       in a reachable position afterwards — the affordance is re-established on the
       next mount rather than persisted (it is not content, so it is not saved). */
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(editorOf(page)).toContainText('pooled baseline data', { timeout: 15_000 });
    await expect(tables(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Baseline characteristics');
    await expect.poll(() => textAfterLastTable(page)).toContain('pooled baseline data');
  });

  test('§3: a table that is the ONLY thing in the section is still writable below, after a reload', async ({ page, tmpProject }) => {
    // The hardest shape: nothing above the media, nothing below it, and a RELOAD in
    // between — i.e. the caret target has to come from the mount pass, not from the
    // insertion. This is the "media as the final node of the entire manuscript" case.
    const editor = await openEditorSection(page, tmpProject.id, 'limitations');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Sensitivity analyses');
    await expect(tables(page)).toHaveCount(1);
    await saved(page);

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-limitations').click();
    await expect(tables(page)).toHaveCount(1, { timeout: 15_000 });

    await clickBelowLastBlock(page);
    await page.keyboard.type('Written after a reload.');
    await expect.poll(() => textAfterLastTable(page), { timeout: 10_000 }).toContain('Written after a reload.');
    await expect(tables(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Sensitivity analyses');
  });

  test('§3: ArrowDown out of the last cell, and Enter from the title, both reach the paragraph below', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Pooled estimates');

    // ── ArrowDown from the LAST cell of a trailing table ──
    await tables(page).first().locator('th,td').last().click();
    await page.keyboard.type('12.4');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('Keyboard-navigated paragraph.');
    await expect.poll(() => textAfterLastTable(page), { timeout: 10_000 })
      .toContain('Keyboard-navigated paragraph.');
    // the cell keeps its own value — the caret left the table, it did not drag text out
    await expect(tables(page).first().locator('th,td').last()).toHaveText('12.4');

    // ── Enter at the END of the caption title ──
    // §4: this must NOT split the entity or leave a paragraph between the title and
    // the table; §3: it is the "move the caret from the final caption to a new
    // paragraph below" interaction.
    await titles(page).first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Written from the caption.');
    await expect(titles(page).first()).toHaveText('Pooled estimates');
    expect(await paragraphBetweenCaptionAndTable(page)).toBe(0);
    await expect.poll(() => textAfterLastTable(page), { timeout: 10_000 })
      .toContain('Written from the caption.');
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);
  });

  test('§3: a picture as the last node — click below it and type', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'discussion');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertPicture(page, 'flow.png', PNG_1PX);
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.type('Study flow');
    await expect(figureTitles(page).first()).toHaveText('Study flow');

    await clickBelowLastBlock(page);
    await page.keyboard.type('The flow diagram summarises screening.');
    await expect.poll(() => textAfterLastFigure(page), { timeout: 10_000 })
      .toContain('The flow diagram summarises screening.');
    // The sentence is NOT inside the island (that would make it part of the caption).
    await expect(figureBlocks(page).first()).not.toContainText('summarises screening');
    await expect(figureTitles(page).first()).toHaveText('Study flow');

    // ArrowDown from the figure title (a figure's caption sits BELOW its picture).
    await figureTitles(page).first().click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type(' Added by keyboard.');
    await expect.poll(() => textAfterLastFigure(page), { timeout: 10_000 }).toContain('Added by keyboard.');
    await expect(figureTitles(page).first()).toHaveText('Study flow');
    await expect(figureBlocks(page)).toHaveCount(1);
  });

  /* ── Journey C: the media entity cannot be pulled apart ────────────────────── */

  test('§4: typing between a caption and its table goes into the TITLE, never between them', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Eligibility criteria');
    await expect(titles(page).first()).toHaveText('Eligibility criteria');

    /* Park the caret in the GAP — the position a browser gives you for free by
       clicking on the hairline between the caption island and the table. Setting it
       through the Range API is the deterministic way to reach the same place in
       every engine (a click there normalises differently per engine). */
    await editorOf(page).evaluate((el) => {
      const cap = el.querySelector('.ms-tblcap');
      if (!cap) throw new Error('no caption');
      const idx = Array.prototype.indexOf.call(el.childNodes, cap);
      (el as HTMLElement).focus();
      const r = document.createRange();
      r.setStart(el, idx + 1);
      r.collapse(true);
      const sel = window.getSelection();
      if (!sel) throw new Error('no selection');
      sel.removeAllRanges();
      sel.addRange(r);
    });

    // A printable key follows the redirected caret into the title …
    await page.keyboard.type('!');
    await expect(titles(page).first()).toHaveText('Eligibility criteria!');
    expect(await paragraphBetweenCaptionAndTable(page)).toBe(0);

    // … and Enter in the gap is swallowed rather than creating a paragraph there.
    await editorOf(page).evaluate((el) => {
      const cap = el.querySelector('.ms-tblcap');
      if (!cap) throw new Error('no caption');
      const idx = Array.prototype.indexOf.call(el.childNodes, cap);
      (el as HTMLElement).focus();
      const r = document.createRange();
      r.setStart(el, idx + 1);
      r.collapse(true);
      const sel = window.getSelection();
      if (!sel) throw new Error('no selection');
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await page.keyboard.press('Enter');
    expect(await paragraphBetweenCaptionAndTable(page)).toBe(0);
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);

    // Shift+Enter in the TITLE inserts no line break either (a title is one line).
    await titles(page).first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await expect(titles(page).first()).toHaveText('Eligibility criteria!');
    await expect(titles(page).first().locator('br')).toHaveCount(0);

    // It all autosaves as one intact object.
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(titles(page).first()).toHaveText('Eligibility criteria!', { timeout: 15_000 });
    expect(await paragraphBetweenCaptionAndTable(page)).toBe(0);
  });

  /**
   * 120.md §4 — THE DATA-LOSS SCENARIO.
   *
   * Before this round, a paragraph between a caption and its table made the very
   * next emit DELETE the caption: the table's identity, its title, its number and
   * every [[table:id]] cross-reference went with it, and the chips flipped to
   * "Table (deleted)". The DOM shape is forced directly here — no keystroke should
   * be able to produce it any more (the test above is that half) — and the
   * assertion is that the object SURVIVES: the caption is reunited with its table
   * on serialization, and the cross-reference stays live across a reload.
   */
  test('§4: a paragraph forced between a caption and its table never costs the caption', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Primary outcomes');
    await expect(titles(page).first()).toHaveText('Primary outcomes');

    // A sentence that cross-references the table — the thing that used to break.
    await clickBelowLastBlock(page);
    await page.keyboard.type('The pooled effect is shown in ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const picker = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(picker).toBeVisible();
    await picker.getByTestId('stitch-manuscript-crossref-search').fill('Primary outcomes');
    await picker.getByRole('option', { name: /Primary outcomes/ }).first().click();
    const chip = editorOf(page).locator('span.ms-asset[data-asset^="table:"]').first();
    await expect(chip).toHaveText('Table 1');
    await expect(chip).not.toHaveAttribute('data-asset-broken', 'true');
    await saved(page);

    /* Force the broken shape and let the editor's own emit see it (a bubbling input
       event is what every real edit produces, and it is what drives autosave). */
    await editorOf(page).evaluate((el) => {
      const cap = el.querySelector('.ms-tblcap');
      if (!cap) throw new Error('no caption');
      const p = document.createElement('p');
      p.textContent = 'An arbitrary paragraph in the gap.';
      el.insertBefore(p, cap.nextSibling);
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    await saved(page);

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-results').click();

    // THE ASSERTIONS: the caption survived, it is adjacent to its table again, and
    // the researcher's interloping text was NOT deleted either (it moved above).
    await expect(captions(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(tables(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Primary outcomes');
    await expect(captions(page).first()).toContainText('Table 1.');
    expect(await paragraphBetweenCaptionAndTable(page)).toBe(0);
    await expect(editorOf(page)).toContainText('An arbitrary paragraph in the gap.');

    // …and the cross-reference still resolves to a live object.
    const after = editorOf(page).locator('span.ms-asset[data-asset^="table:"]').first();
    await expect(after).toHaveText('Table 1', { timeout: 15_000 });
    await expect(after).not.toHaveAttribute('data-asset-broken', 'true');
  });

  test('§4: deleting a selected figure removes the WHOLE entity, and undo restores all of it', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Prose above, so the picture is not the whole document.');
    await page.keyboard.press('Enter');
    await insertPicture(page, 'flow.png', PNG_1PX);
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 20_000 });
    await page.keyboard.type('Screening flow');
    await expect(figureTitles(page).first()).toHaveText('Screening flow');

    // Clicking the picture selects the whole object (its boundary, not its parts) …
    await figureImgs(page).first().click();
    await page.keyboard.press('Delete');
    await expect(figureBlocks(page)).toHaveCount(0, { timeout: 10_000 });

    // … and ONE native undo brings back the picture, its title and its number
    // together, because the marker lives in the prose and the deletion went through
    // the editor's normal selection→execCommand path.
    await editor.click({ position: { x: 8, y: 8 } });
    await undoUntil(page, async () => (await figureBlocks(page).count()) === 1);
    await expect(figureBlocks(page)).toHaveCount(1);
    await expect(figureTitles(page).first()).toHaveText('Screening flow');
    await expect(editorOf(page).locator('figure.ms-figblock .ms-figcap-n').first()).toContainText('Figure 1.');
    await expect(editor).toContainText('Prose above, so the picture is not the whole document.');

    // The section is still writable below the restored picture.
    await clickBelowLastBlock(page);
    await page.keyboard.type('Still writable below.');
    await expect.poll(() => textAfterLastFigure(page), { timeout: 10_000 }).toContain('Still writable below.');
  });
});
