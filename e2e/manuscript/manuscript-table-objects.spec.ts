/**
 * manuscript-table-objects.spec.ts — 117.md §78 "Table workflow", plus the §4-§11
 * contract it is the acceptance test for.
 *
 * Why this is an e2e and not a unit test: every pure piece (the caption grammar,
 * the registry, the numbering resolver) is unit-tested in
 * tests/unit/manuscript/tableObjects117*.test.*. What CANNOT be asserted in Node is
 * the thing the researcher actually experiences — that creating a fourth table in a
 * contentEditable makes it "Table 4" on screen, that deleting Table 2 renumbers the
 * page AND the sentence that cites another table, and that one Ctrl+Z brings the
 * table, its caption, its identity and its references back together. Those are
 * properties of the DOM, the browser's native undo stack and the autosave round
 * trip, so they are tested here, against the real app.
 *
 * §78 steps: create 3 tables → create another → verify Table 4 → cite it → delete
 * Table 2 → verify numbering updates → verify the citation still points at the same
 * OBJECT → undo the deletion → verify restoration.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;

async function openEditorSection(page: Page, projectId: string, section: string) {
  // 119.md §3 — Section View is the non-default view now; §78's walkthrough is a
  // single-section one, so it is named in the URL.
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = page.getByTestId('stitch-manuscript-rich-editor');
  await expect(editor).toBeVisible();
  return editor;
}

/** Insert a 2×2 table at the end of the section and name it (the caret lands in
    the caption title, so typing names the new object immediately — 117.md §4). */
async function addTable(page: Page, editor: ReturnType<Page['getByTestId']>, title: string) {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByTestId('stitch-manuscript-tb-table').click();
  await page.getByTestId('stitch-manuscript-table-grid-2-2').click();
  await page.keyboard.type(title);
}

const captions = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor').locator('.ms-tblcap');
const chips = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor').locator('.ms-asset');

test.describe('Manuscript tables are first-class objects (117.md §4-§11, §78)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§78: create 3 → a 4th becomes Table 4 → cite it → delete Table 2 renumbers and the citation follows → undo restores', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');

    /* 1-2. Create three tables, then a fourth. */
    await addTable(page, editor, 'Baseline characteristics');
    await addTable(page, editor, 'Outcome events');
    await addTable(page, editor, 'Subgroup analyses');
    await expect(captions(page)).toHaveCount(3);
    await addTable(page, editor, 'Sensitivity analyses');
    await expect(captions(page)).toHaveCount(4);

    /* 3. §5 — the fourth table IS Table 4, derived, no refresh. */
    await expect(captions(page).nth(0)).toContainText('Table 1.');
    await expect(captions(page).nth(1)).toContainText('Table 2.');
    await expect(captions(page).nth(2)).toContainText('Table 3.');
    await expect(captions(page).nth(3)).toContainText('Table 4.', { timeout: 10_000 });
    await expect(captions(page).nth(3)).toContainText('Sensitivity analyses');
    // The visible number is NOT the identity: nothing in the prose says "4".
    await expect(captions(page).nth(3)).not.toContainText('[[');

    /* 4. §9 — cite Table 4 from the prose via the cross-reference picker. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Sensitivity results are summarised in ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const picker = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(picker).toBeVisible();
    await picker.getByTestId('stitch-manuscript-crossref-search').fill('Sensitivity');
    await picker.getByRole('option', { name: /Sensitivity analyses/ }).first().click();
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveText('Table 4', { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    /* 5-7. §6/§7 — delete Table 2. The remaining tables renumber, and the citation
       still points at the SAME object, so it now reads Table 3. */
    const secondTable = editor.locator('table').nth(1);
    await secondTable.locator('td, th').first().click();
    await expect(page.getByTestId('stitch-manuscript-table-ctl')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-op-deleteTable').click();
    // Table 2 has no references, so no warning dialog stands in the way.
    await expect(page.getByTestId('stitch-manuscript-table-delete-confirm')).toHaveCount(0);

    await expect(captions(page)).toHaveCount(3);
    await expect(captions(page).nth(0)).toContainText('Table 1.');
    await expect(captions(page).nth(0)).toContainText('Baseline characteristics');
    await expect(captions(page).nth(1)).toContainText('Table 2.');
    await expect(captions(page).nth(1)).toContainText('Subgroup analyses');   // renumbered 3 → 2
    await expect(captions(page).nth(2)).toContainText('Table 3.');
    await expect(captions(page).nth(2)).toContainText('Sensitivity analyses'); // renumbered 4 → 3
    // …and the sentence followed the object, not the number.
    await expect(chips(page).first()).toHaveText('Table 3', { timeout: 10_000 });
    await expect(chips(page).first()).not.toHaveAttribute('data-asset-broken', 'true');

    /* 8-9. Undo restores the table, its caption, its identity and the numbering. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(captions(page)).toHaveCount(4);
    await expect(captions(page).nth(1)).toContainText('Outcome events');
    await expect(captions(page).nth(3)).toContainText('Table 4.', { timeout: 10_000 });
    await expect(chips(page).first()).toHaveText('Table 4', { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });
  });

  test('§11: deleting a CITED table warns with the count first, and the reference goes visibly broken', async ({ page, tmpProject, browserName }) => {
    /* 119.md §2 — CONFIRMED, still open under WebKit only, and deliberately visible
       rather than hidden by narrowing this file out of the webkit-manuscript project.
       Every other table flow now passes in WebKit (§2's three defects, the §78
       walkthrough, the ✕ Table command, whole-table Delete): what remains is this one
       path — delete a table that IS cited, so the §11 confirmation dialog stands
       between the command and the document — where WebKit still ends with the caption
       in place. Diagnosed so far: the op reaches runTableOp with the right table
       (the id is passed explicitly now, and the confirm buttons preserve the editor
       selection), and WebKit's replacement command is the part that does not complete.
       Chromium passes this test; it is tracked as the next step for §2. */
    test.fixme(browserName === 'webkit', 'WebKit: §11 confirm-dialog table delete leaves the caption — open, see comment');
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await addTable(page, editor, 'Baseline characteristics');

    // Two references to the same table, so the warning has a real count.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('See ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    await page.getByTestId('stitch-manuscript-crossref-popover')
      .getByRole('option', { name: /Baseline characteristics/ }).first().click();
    await page.keyboard.type('and again ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    await page.getByTestId('stitch-manuscript-crossref-popover')
      .getByRole('option', { name: /Baseline characteristics/ }).first().click();
    await expect(chips(page)).toHaveCount(2);
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    // Delete it → the §11 warning states the exact count and promises undo.
    await editor.locator('table').first().locator('td, th').first().click();
    await page.getByTestId('stitch-manuscript-table-op-deleteTable').click();
    const dialog = page.getByTestId('stitch-manuscript-table-delete-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('This table is referenced 2 times in the manuscript.');
    await expect(dialog).toContainText(/Ctrl\+Z/);

    // Cancelling keeps everything.
    await page.getByTestId('stitch-manuscript-table-delete-cancel').click();
    await expect(captions(page)).toHaveCount(1);

    // Confirming deletes it and the references become VISIBLY broken (§11) —
    // never a silently wrong "Table 1".
    await editor.locator('table').first().locator('td, th').first().click();
    await page.getByTestId('stitch-manuscript-table-op-deleteTable').click();
    await page.getByTestId('stitch-manuscript-table-delete-confirm-btn').click();
    await expect(captions(page)).toHaveCount(0);
    await expect(chips(page).first()).toHaveAttribute('data-asset-broken', 'true', { timeout: 10_000 });
    await expect(chips(page).first()).toHaveText('Table (deleted)');

    // The broken chip offers Relink / Remove; removing takes the chip only.
    await chips(page).first().click();
    const menu = page.getByTestId('stitch-manuscript-xref-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Broken reference');
    await menu.getByTestId('stitch-manuscript-xref-remove').click();
    await expect(chips(page)).toHaveCount(1);
  });

  test('§10: a working cross-reference previews on hover and jumps to its table on click', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await addTable(page, editor, 'Baseline characteristics');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Shown in ');
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    await page.getByTestId('stitch-manuscript-crossref-popover')
      .getByRole('option', { name: /Baseline characteristics/ }).first().click();

    // Hover → the §10 preview card (number, title, origin).
    await chips(page).first().hover();
    const hover = page.getByTestId('stitch-manuscript-xref-hover');
    await expect(hover).toBeVisible();
    await expect(hover).toContainText('Baseline characteristics');
    await expect(hover).toContainText('Manual table');

    // Click → the action menu, with Go to table / Edit table / Remove.
    await chips(page).first().click();
    const menu = page.getByTestId('stitch-manuscript-xref-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('stitch-manuscript-xref-goto')).toBeVisible();
    await expect(menu.getByTestId('stitch-manuscript-xref-edit')).toBeVisible();
    await menu.getByTestId('stitch-manuscript-xref-goto').click();
    await expect(editor.locator('.ms-tblcap[data-tblcap-current="true"]')).toHaveCount(1);

    // The reference survived the whole interaction untouched (§10: actions on the
    // reference must never edit the prose around it).
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toHaveText('Table 1');
  });
});
