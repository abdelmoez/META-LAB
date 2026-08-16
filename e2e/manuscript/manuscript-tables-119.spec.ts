/**
 * manuscript-tables-119.spec.ts — 119.md §2, the three table defects.
 *
 * This file exists because none of these three are provable in Node.
 *
 *  (a) The table title is an editing ISLAND: `<span contenteditable="true">` inside a
 *      `<div contenteditable="false">` caption inside the editable section. Every new
 *      table starts with an EMPTY title, and an empty inline island has no caret
 *      geometry — WebKit focuses the span on click and then discards every keystroke.
 *      Only a real engine can fail that way, which is why this file is matched by the
 *      `webkit-manuscript` Playwright project as well as chromium: §2 says to use
 *      automated WebKit coverage, not to declare Safari fixed from Blink.
 *  (b) One insertion INTENT must produce exactly one table — including when the caret
 *      is still parked inside the previous table's caption title, which is where
 *      insertTable deliberately leaves it. That used to splice the new caption+table
 *      INSIDE the old title: a visible duplicate, and a silent deletion on the next
 *      markdown round trip (the pipe grammar cannot nest a table in a caption). The
 *      reload assertions below are the half that catches the silent one.
 *  (c) Delete/Backspace over a whole table must take the caption with it. Browser
 *      default removes the <table> and leaves the contenteditable=false caption
 *      standing — the orphan "Table 1." users read as "it did not delete".
 *
 * WEBKIT ≠ SAFARI (§10 scenario 1, r2). This file running green under the
 * `webkit-manuscript` project is engine evidence, not a Safari sign-off: Playwright's
 * WebKit carries none of Safari's own caret heuristics, page zoom, IME or VoiceOver.
 * The manual checklist a Safari owner still has to run — and the honest statement that
 * it has NOT been run, because the build environment is Windows-only — is recorded in
 * docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md › "Real-Safari manual QA".
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;

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
/** A table nested inside a caption island — DOM the pipe grammar cannot express. */
const nestedTables = (page: Page) => editorOf(page).locator('.ms-tblcap table');

/** Insert an r×c table at the end of the section through the toolbar grid picker. */
async function insertTable(page: Page, r = 2, c = 2) {
  await page.getByTestId('stitch-manuscript-tb-table').click();
  await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
  await page.getByTestId(`stitch-manuscript-table-grid-${r}-${c}`).click();
}

/** Repeat a key press — a deterministic, engine-agnostic way to select N chars
    inside a nested editing host (Home/Ctrl+A mean different things per engine). */
async function pressN(page: Page, key: string, n: number) {
  for (let i = 0; i < n; i += 1) await page.keyboard.press(key);
}

/** Native undo granularity differs per engine (a typed run may be one step or
    several), so undo until the condition holds rather than guessing a count. */
async function undoUntil(page: Page, done: () => Promise<boolean>, max = 15) {
  for (let i = 0; i < max; i += 1) {
    if (await done()) return;
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(80);
  }
}

/** Native REDO is Ctrl+Shift+Z in both engines (and Ctrl+Y on Windows Blink), and
    its granularity is an engine fact like undo's — so redo until the condition
    holds, trying both chords, rather than pinning a keystroke count. */
async function redoUntil(page: Page, done: () => Promise<boolean>, max = 15) {
  for (let i = 0; i < max; i += 1) {
    if (await done()) return;
    await page.keyboard.press(i % 2 === 0 ? 'ControlOrMeta+Shift+z' : 'Control+y');
    await page.waitForTimeout(80);
  }
}

/** Wait for the debounced field patch + blob autosave to land. */
async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status'))
    .toContainText(/Saved/i, { timeout: 25_000 });
}

test.describe('Manuscript tables (119.md §2)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── (a) the empty-title caret — THE Safari defect ─────────────────────────── */

  test('§2(a): clicking back into an EMPTY table title accepts typing, selection, cut/paste and undo', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await expect(captions(page)).toHaveCount(1);

    /* Leave the title WITHOUT naming it — this is the state every new table starts
       in, and the one the defect report is about. Moving the caret away and clicking
       BACK into the empty island is the exact reported path. */
    await tables(page).first().locator('th,td').first().click();
    const title = titles(page).first();
    await expect(title).toHaveText('');
    await title.click();

    // 1. Normal typing reaches the island.
    await page.keyboard.type('Baseline characteristics');
    await expect(title).toHaveText('Baseline characteristics');

    // 2. Selection inside the island, and typing over it.
    await pressN(page, 'Shift+ArrowLeft', 'characteristics'.length);
    await page.keyboard.type('features');
    await expect(title).toHaveText('Baseline features');

    // 3. Cut removes the selection from the island (the clipboard round trip is a
    //    separate test — see the note on the harness clipboard below).
    await pressN(page, 'Shift+ArrowLeft', 'features'.length);
    await page.keyboard.press('ControlOrMeta+x');
    await expect(title).toHaveText('Baseline');
    await page.keyboard.type(' features');
    await expect(title).toHaveText('Baseline features');

    // 4. Undo unwinds typing in the island (native undo, same stack as the prose).
    await page.keyboard.type(' extra');
    await expect(title).toContainText('extra');
    await undoUntil(page, async () => !((await title.textContent()) || '').includes('extra'));
    await expect(title).not.toContainText('extra');
    await expect(title).toContainText('Baseline');

    // 5. The number is DERIVED and never typed into (117.md §4 — it must survive).
    await expect(captions(page).first()).toContainText('Table 1.');

    // 6. It is real, autosaved content: a reload brings the title back.
    const finalTitle = ((await title.textContent()) || '').trim();
    expect(finalTitle).toContain('Baseline');
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(titles(page).first()).toHaveText(finalTitle, { timeout: 15_000 });
  });

  /* The cut → paste ROUND TRIP needs a real clipboard, which Playwright only backs
     for chromium (its webkit build ships no system clipboard, so Ctrl+V is a no-op
     there — a harness limitation, not an app one; real Safari is covered by the
     manual pass §2 asks for). Everything the editor itself controls — the selection,
     the cut, the typing, the undo — is asserted cross-engine in the test above. */
  test('§2(a): cut and paste round-trip inside the table title', async ({ page, tmpProject, browserName }) => {
    test.skip(browserName !== 'chromium', 'no system clipboard in this Playwright engine build');
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Baseline features');
    const title = titles(page).first();
    await pressN(page, 'Shift+ArrowLeft', 'features'.length);
    await page.keyboard.press('ControlOrMeta+x');
    await expect(title).toHaveText('Baseline');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(title).toHaveText('Baseline features');
  });

  test('§2(a): clicking the derived NUMBER puts the caret in the title instead of nowhere', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await tables(page).first().locator('th,td').first().click();

    // The number span is user-select:none inside a contenteditable=false wrapper, so
    // a click on it used to be a dead end in every engine.
    await captions(page).first().locator('.ms-tblcap-n').click();
    await page.keyboard.type('Named from the number');
    await expect(titles(page).first()).toHaveText('Named from the number');
    // …and the number itself is untouched: it is derived, never edited.
    await expect(captions(page).first()).toContainText('Table 1.');
  });

  /* ── (b) one gesture, one table ────────────────────────────────────────────── */

  test('§2(b): inserting a second table with the caret still in the first title makes ONE table, not a nested one', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    await insertTable(page);
    await page.keyboard.type('First table');
    await expect(captions(page)).toHaveCount(1);

    /* The caret is INSIDE the first caption's title right now — insertTable parks it
       there on purpose, and the toolbar button's mousedown preventDefault preserves
       exactly that selection. This is the geometry that produced two tables. */
    await insertTable(page);
    await page.keyboard.type('Second table');

    await expect(captions(page)).toHaveCount(2);
    await expect(tables(page)).toHaveCount(2);
    await expect(nestedTables(page)).toHaveCount(0);
    await expect(captions(page).nth(0)).toContainText('Table 1.');
    await expect(captions(page).nth(0)).toContainText('First table');
    await expect(captions(page).nth(1)).toContainText('Table 2.');
    await expect(captions(page).nth(1)).toContainText('Second table');

    /* The silent half of the same defect: a nested table is not expressible in the
       pipe grammar, so the round trip through markdown DELETED it and corrupted the
       first title. If both objects survive a reload, nothing was nested. */
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(captions(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(tables(page)).toHaveCount(2);
    await expect(captions(page).nth(0)).toContainText('First table');
    await expect(captions(page).nth(1)).toContainText('Second table');
  });

  test('§2(b): a table can be created with the KEYBOARD, and that gesture also makes exactly one', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    // Open the grid picker from the keyboard: the cells used to be tabIndex={-1},
    // so there was no keyboard path to a table at all (§2's mouse-AND-keyboard
    // scenario had nothing to test).
    await page.getByTestId('stitch-manuscript-tb-table').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();

    // Roving tabindex + arrows move the active cell; Enter inserts it.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(captions(page)).toHaveCount(1);
    await expect(tables(page)).toHaveCount(1);
    // 2×2 — the picker starts on 1×1 and one ArrowRight + one ArrowDown moved it.
    await expect(tables(page).first().locator('tr')).toHaveCount(2);

    // The caret lands in the new title, exactly as on the mouse path.
    await page.keyboard.type('Keyboard table');
    await expect(titles(page).first()).toHaveText('Keyboard table');
  });

  test('§2(b): Escape closes the grid picker without creating anything', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.getByTestId('stitch-manuscript-tb-table').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toHaveCount(0);
    await expect(captions(page)).toHaveCount(0);
    // focus comes back to the control the researcher opened it from
    await expect(page.getByTestId('stitch-manuscript-tb-table')).toBeFocused();
  });

  /* ── (c) whole-table deletion ──────────────────────────────────────────────── */

  /** Drag-select from the first cell to the last one — the reported gesture. */
  async function selectWholeTable(page: Page, index = 0) {
    const table = tables(page).nth(index);
    const cells = table.locator('th,td');
    const first = await cells.first().boundingBox();
    const last = await cells.last().boundingBox();
    if (!first || !last) throw new Error('table cells have no geometry');
    await page.mouse.move(first.x + 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
    await page.mouse.move(last.x + last.width - 2, last.y + last.height - 2, { steps: 4 });
    await page.mouse.up();
  }

  test('§2(c): selecting a whole table and pressing Delete removes the table AND its caption, and undo brings both back', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    /* Prose above the table, so the section is a real manuscript section rather than
       a document whose ENTIRE content is one table. That edge case has a pre-existing
       Chromium limitation — a replacement spanning the whole editing host is not
       restored by native undo — and it affects the "Remove table" menu command
       identically, so it is not this key handler's to fix. */
    await page.keyboard.type('Randomised trials were pooled with a random-effects model.');
    await page.keyboard.press('Enter');
    await insertTable(page);
    await page.keyboard.type('Doomed table');
    await expect(captions(page)).toHaveCount(1);
    await expect(tables(page)).toHaveCount(1);

    await selectWholeTable(page);
    await page.keyboard.press('Delete');

    // Both halves of the ONE object are gone — no orphan "Table 1." left numbering
    // an empty slot, which is what "Delete did not delete the table" really was.
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(0);

    /* Undo restores the object with its title and its number. The number of native
       undo steps is an ENGINE fact, not a contract (WebKit needs one more when it
       leaves an empty caption husk for the editor to clear), so this undoes until
       the object is back rather than pinning a keystroke count. */
    await editor.click();
    await undoUntil(page, async () => (await tables(page).count()) === 1);
    await expect(tables(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(1);
    await expect(captions(page).first()).toContainText('Table 1.');
    await expect(captions(page).first()).toContainText('Doomed table');

    // …and the deletion is real content change: it autosaves and survives a reload.
    await selectWholeTable(page);
    await page.keyboard.press('Backspace');
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(editorOf(page)).toContainText('random-effects model', { timeout: 15_000 });
    await expect(captions(page)).toHaveCount(0);
    await expect(tables(page)).toHaveCount(0);
  });

  /* §10 scenario 6 names REDO explicitly ("undo must restore it, redo must remove it
     again"), and r2 found the file covered only the undo half. The atomic
     caption+table op is where a redo regression would hide: 7a06781 fixed undo
     re-stamping `tableMeta`, and a redo that restored the table while re-nulling
     those stamps would leave a titled table with no metadata behind it — visible
     here as a caption that comes back WITHOUT its title on the following undo. */
  test('§2(c)/§10.6: redo removes the table again, and a further undo brings it back WITH its title', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Prose above, so the table is not the whole document.');
    await page.keyboard.press('Enter');
    await insertTable(page);
    await page.keyboard.type('Redo table');
    await expect(captions(page)).toHaveCount(1);
    await expect(tables(page)).toHaveCount(1);

    await selectWholeTable(page);
    await page.keyboard.press('Delete');
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(0);

    await editor.click();
    await undoUntil(page, async () => (await tables(page).count()) === 1);
    await expect(tables(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(captions(page).first()).toContainText('Redo table');

    // REDO: the object goes away again, both halves together.
    await redoUntil(page, async () => (await tables(page).count()) === 0);
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(0);
    // The prose either side of it is untouched by the round trip.
    await expect(editor).toContainText('Prose above, so the table is not the whole document.');

    // …and undo once more restores the SAME object, title and derived number intact —
    // which is what proves redo did not drop the tableMeta stamps on its way through.
    await undoUntil(page, async () => (await tables(page).count()) === 1);
    await expect(tables(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(1);
    await expect(captions(page).first()).toContainText('Table 1.');
    await expect(captions(page).first()).toContainText('Redo table');
  });

  /* §10 scenario 3: "rapidly clicking table insertion produces exactly one table".
     The re-entrancy guard is a per-GESTURE operation id (RichSectionEditor's
     insertOpIds map + TableGridPicker's opRef/doneRef), and r2 found nothing
     actually firing two clicks at it — the file covered re-entrancy only through the
     caret-parked-in-a-caption geometry and a single keyboard gesture. A guard keyed
     wrongly (per render rather than per gesture) would pass those and fail this. */
  test('§2(b)/§10.3: rapid double-clicking the size cell inserts exactly ONE table', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    await page.getByTestId('stitch-manuscript-tb-table').click();
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    const cell = page.getByTestId('stitch-manuscript-table-grid-2-2');
    // Two clicks as fast as the harness can deliver them, at the same point: the
    // picker closes on the first, so the second must find nothing to insert into.
    await cell.dblclick({ delay: 0 });

    await expect(captions(page)).toHaveCount(1);
    await expect(tables(page)).toHaveCount(1);
    await expect(nestedTables(page)).toHaveCount(0);

    /* A SECOND rapid gesture — with the caret now parked inside the first table's
       caption title, which is the geometry §2(b) is about. One more table, not two,
       and nothing spliced into the caption. */
    await page.getByTestId('stitch-manuscript-tb-table').click();
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-grid-2-2').dblclick({ delay: 0 });
    await expect(tables(page)).toHaveCount(2);
    await expect(captions(page)).toHaveCount(2);
    await expect(nestedTables(page)).toHaveCount(0);

    // The silent half again: nothing nested means the markdown round trip keeps both.
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(tables(page)).toHaveCount(2, { timeout: 15_000 });
  });

  /* §10 scenario 4 — "retrying the insertion request" — is NOT APPLICABLE here, and
     that disposition is recorded rather than left as a silent gap. Table insertion is
     entirely client-side: the grid picker calls the editor API, which mutates the
     contenteditable DOM and emits markdown into the SAME debounced draft queue as
     typing. There is no per-insert network call to retry, and therefore no
     duplicate-on-retry to guard against; the only network write is the project
     autosave, whose idempotency is the blob compare-and-set covered elsewhere. The
     equivalent risk for tables is the double-GESTURE, which is scenario 3 above.
     (Uploaded FIGURES do have a per-insert request — see manuscript-figures-119.) */

  test('§2(c): a selection INSIDE one cell still deletes only that text', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Methods prose above the table.');
    await page.keyboard.press('Enter');
    await insertTable(page);
    await page.keyboard.type('Partial selection table');

    // Put text in the first cell, select it, delete it: the table must survive.
    const firstCell = tables(page).first().locator('th,td').first();
    await firstCell.click();
    await page.keyboard.type('Outcome');
    await expect(firstCell).toHaveText('Outcome');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Delete');

    await expect(firstCell).toHaveText('');
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);
    await expect(captions(page).first()).toContainText('Partial selection table');
  });

  test('§2(c): "Remove table" from the table controls still works', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page);
    await page.keyboard.type('Menu-deleted table');

    // The caret has to be inside the table for the floating controls to appear.
    await tables(page).first().locator('th,td').first().click();
    await expect(page.getByTestId('stitch-manuscript-table-ctl')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-op-deleteTable').click();
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(0);
  });
});
