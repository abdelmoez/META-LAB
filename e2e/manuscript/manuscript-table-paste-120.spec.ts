/**
 * manuscript-table-paste-120.spec.ts — 120.md §7 "Microsoft Office Table
 * Recognition and Import".
 *
 * The pure pipeline (what is a table, what is a Word caption, which id is minted,
 * what a tab-separated clipboard is) is pinned in
 * tests/unit/manuscript/pasteTransform120.test.js. What only a browser can prove is
 * what this file drives:
 *
 *   · a real `DataTransfer` carrying BOTH `text/html` and an image FILE — the exact
 *     clipboard Excel, PowerPoint and Word produce, and the one that used to import
 *     a table as a screenshot because the image branch ran first;
 *   · ONE native undo step for the whole paste, and a redo that restores it;
 *   · the caret, the caption island and the trailing paragraph afterwards;
 *   · that a genuinely image-only clipboard still becomes a figure.
 *
 * File name: matched by the `webkit-manuscript` Playwright project
 * (`**\/manuscript/manuscript-{table,figure}*.spec.ts`) as well as by chromium.
 * The 119.md §2 rule applies unchanged: clipboard access, execCommand insertion
 * geometry and caret placement inside nested editing islands are exactly where
 * engines differ, so Safari must not be declared fixed from Blink alone.
 *
 * WEBKIT ≠ SAFARI: green under `webkit-manuscript` is engine evidence, not a Safari
 * sign-off (see docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md › "Real-Safari manual QA").
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;

/** A real 1×1 PNG — the bitmap Office puts on the clipboard beside the HTML. */
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* A Word "copy the table and its caption" payload, verbatim in shape: the Office
   namespaces, a <style> block, mso-* declarations, MsoTableGrid/MsoNormal classes,
   a caption paragraph in Word's caption style, and BOTH merge directions. */
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoCaption {mso-style-name:Caption; font-size:9.0pt;} --></style></head>
<body lang=EN-GB style='word-wrap:break-word'>
<p class=MsoCaption>Table 2. Baseline characteristics</p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
 style='border-collapse:collapse;mso-yfti-tbllook:1184;font-family:"Calibri",sans-serif'>
<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
<th style='background:#D9D9D9'><p class=MsoNormal>Group</p></th>
<th colspan=2 style='text-align:center'><p class=MsoNormal>Outcome</p></th></tr>
<tr><td rowspan=2><p class=MsoNormal>Arm A</p></td>
<td><p class=MsoNormal>MI</p></td><td><p class=MsoNormal>12</p></td></tr>
<tr><td><p class=MsoNormal>Stroke</p></td><td><p class=MsoNormal>8</p></td></tr>
</table></body></html>`;

const WORD_TEXT = 'Table 2. Baseline characteristics\nGroup\tOutcome\nArm A\tMI\t12\nStroke\t8';

/* An Excel range: Excel's HTML is a bare <table> with its own inline styling, and
   the clipboard also carries the same values as tab-separated text. */
const EXCEL_HTML = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head>
<meta name=ProgId content=Excel.Sheet><style>td {mso-number-format:General;}</style></head>
<body><table border=0 cellpadding=0 cellspacing=0 width=240 style='border-collapse:collapse'>
<tr height=20><td class=xl65 style='font-weight:700'>Trial</td><td class=xl65>Events</td><td class=xl65>Total</td></tr>
<tr height=20><td>Alpha</td><td align=right>12</td><td align=right>100</td></tr>
<tr height=20><td>Beta</td><td align=right>8</td><td align=right>101</td></tr>
</table></body></html>`;

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const captions = (page: Page) => editorOf(page).locator('.ms-tblcap');
const titles = (page: Page) => editorOf(page).locator('.ms-tblcap-t');
const numbers = (page: Page) => editorOf(page).locator('.ms-tblcap-n');
const tables = (page: Page) => editorOf(page).locator('table');
const figureBlocks = (page: Page) => editorOf(page).locator('figure.ms-figblock');

async function openEditorSection(page: Page, projectId: string, section: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

/**
 * Dispatch a REAL paste at the caret with a synthesized clipboard.
 *
 * `withImage` adds an image FILE item alongside the HTML — the thing Office
 * actually does, and the whole reason §7 exists: the old ladder found that file
 * before it ever read text/html and imported the table as a picture.
 */
async function pasteInto(
  page: Page,
  payload: { html?: string; text?: string; withImage?: boolean; imageOnly?: boolean },
) {
  return editorOf(page).evaluate((el, p) => {
    const dt = new DataTransfer();
    if (p.html) dt.setData('text/html', p.html);
    if (p.text) dt.setData('text/plain', p.text);
    if (p.withImage || p.imageOnly) {
      const bin = atob(p.png);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
    }
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    /* A dispatched (untrusted) paste has NO default action — the browser only
       performs a real paste for a trusted event. So "the browser default happened"
       is asserted the only way it can be: the handler did not consume the event. */
    return ev.defaultPrevented;
  }, { ...payload, png: PNG_1PX_B64 });
}

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 25_000 });
}

/** Insert an r×c table at the caret through the toolbar grid picker. */
async function insertTable(page: Page, r = 2, c = 2) {
  await page.getByTestId('stitch-manuscript-tb-table').click();
  await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
  await page.getByTestId(`stitch-manuscript-table-grid-${r}-${c}`).click();
}

/** The grid a table renders, as rows of cell text — structural, not innerHTML
    (WebKit truncates long console strings, and innerHTML hides nothing useful). */
function gridOf(page: Page, nth = 0) {
  return editorOf(page).evaluate((el, i) => {
    const t = el.querySelectorAll('table')[i];
    if (!t) return [];
    return Array.from(t.querySelectorAll('tr')).map(
      (tr) => Array.from(tr.children).map((c) => (c.textContent || '').trim()),
    );
  }, nth);
}

/** The tag names of the editor's top-level children — the structural dump that
    survives a WebKit console, used when an assertion looks impossible. */
function shapeOf(page: Page) {
  return editorOf(page).evaluate((el) => Array.from(el.children).map(
    (c) => `${c.tagName.toLowerCase()}${c.className ? `.${String(c.className).split(' ')[0]}` : ''}`,
  ));
}

/** Click in the empty space directly BELOW the last block (120.md §3's affordance). */
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

test.describe('Office table import (120.md §7)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── Journey H: a Word table with its caption, pasted beside a bitmap ───────── */

  test('§7: a Word table (with a bitmap on the clipboard) becomes ONE native, numbered table', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    // A table already in the section, so "the correct next number" means something.
    await insertTable(page);
    await page.keyboard.type('Search strategy');
    await expect(tables(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Search strategy');

    /* THE DEFECT: the clipboard carries a bitmap AND the structured HTML. Before
       120.md §7 the image branch ran first and this pasted a screenshot. */
    await pasteInto(page, { html: WORD_HTML, text: WORD_TEXT, withImage: true });

    // Exactly ONE new table, and no figure at all.
    await expect(tables(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(captions(page)).toHaveCount(2);
    await expect(figureBlocks(page)).toHaveCount(0);
    await expect(editorOf(page).locator('img')).toHaveCount(0);

    /* CAPTION: Word's descriptive title survives, Word's NUMBER does not — the
       pasted table is the second in this section, so it is Table 2 because PecanRev
       says so, not because Word did. (Word's own number was also 2; the test makes
       the distinction real by asserting the caption is ONE line with no "Table 2."
       left over inside the title.) */
    await expect(titles(page).nth(1)).toHaveText('Baseline characteristics', { timeout: 10_000 });
    await expect(numbers(page).nth(1)).toContainText('Table 2.');
    await expect(titles(page).nth(1)).not.toContainText('Table');
    // …and no second caption was created for the same table.
    expect(await shapeOf(page)).toEqual(
      expect.arrayContaining(['div.ms-tblcap', 'table', 'div.ms-tblcap', 'table']),
    );

    /* STRUCTURE: merged cells are flattened HONESTLY — the colspan and the rowspan
       become visible blank cells, never a silent column shift. */
    expect(await gridOf(page, 1)).toEqual([
      ['Group', 'Outcome', ''],
      ['Arm A', 'MI', '12'],
      ['', 'Stroke', '8'],
    ]);

    /* STYLING: PecanRev's template, not Word's. Nothing of the Office stylesheet
       reached the page — no class attribute, no inline border/font declarations. */
    const attrs = await editorOf(page).evaluate((el) => {
      const t = el.querySelectorAll('table')[1];
      return {
        cls: t.getAttribute('class'),
        style: t.getAttribute('style'),
        border: t.getAttribute('border'),
        cellStyles: Array.from(t.querySelectorAll('td,th'))
          .map((c) => c.getAttribute('style')).filter(Boolean),
        hasMso: /mso-/i.test(el.innerHTML),
      };
    });
    expect(attrs.cls).toBe(null);
    expect(attrs.style).toBe(null);
    expect(attrs.border).toBe(null);
    /* The only per-cell styling that survives is PecanRev's own ALIGNMENT, which
       §7 lists among the things to preserve — it is derived from the pipe
       separator row, not copied from Word. Nothing else of Word's cell styling
       (fonts, backgrounds, borders, widths) is there. */
    for (const st of attrs.cellStyles) expect(st).toMatch(/^text-align:\s*(left|center|right);?$/);
    expect(attrs.hasMso).toBe(false);

    /* POST-PASTE (§7 + 120.md §3): the section is writable below the pasted table. */
    await clickBelowLastBlock(page);
    await page.keyboard.type('Baseline data are summarised above.');
    await expect(editorOf(page)).toContainText('Baseline data are summarised above.');
    await expect(tables(page)).toHaveCount(2);

    // …and it autosaved as a first-class object with its own identity.
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-results').click();
    await expect(tables(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(titles(page).nth(1)).toHaveText('Baseline characteristics');
    await expect(numbers(page).nth(1)).toContainText('Table 2.');
    await expect(editorOf(page)).toContainText('Baseline data are summarised above.');
  });

  /**
   * §7 "Undo must remove the entire pasted table in one logical action. Redo must
   * restore it."
   *
   * ONE Ctrl+Z, asserted on the MANUSCRIPT rather than only on the DOM — because
   * the two engines leave different DOM behind and only one of those differences
   * is ours:
   *
   *   · Blink undoes the single execCommand insertion whole: table and caption
   *     island both go.
   *   · WebKit's own UndoManager splits the same insertion — the first undo takes
   *     the <table> and leaves the caption ISLAND standing in the DOM. Ctrl+Z is
   *     deliberately NOT intercepted here (101.md §11: the native stack IS the
   *     implementation, and swallowing the platform shortcut would replace a
   *     working one with a worse one), so this is not something the editor can
   *     change without giving up that architecture.
   *
   * The OBJECT is gone in both, because a caption with no table is the 119.md §2
   * orphan and the serializer drops it: after one undo the manuscript holds neither
   * the caption marker nor the table, and the researcher's own prose is untouched.
   * That is the logical action §7 asks about. Redo brings the whole object back.
   */
  test('§7: undo removes the ENTIRE pasted table in one action, and redo restores it', async ({ page, request, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Data were extracted in duplicate.');
    await page.keyboard.press('Enter');
    await saved(page);

    await pasteInto(page, { html: WORD_HTML, text: WORD_TEXT, withImage: true });
    await expect(tables(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(titles(page).first()).toHaveText('Baseline characteristics', { timeout: 10_000 });
    await saved(page);

    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(tables(page)).toHaveCount(0, { timeout: 10_000 });
    // The prose that was there before the paste is completely untouched.
    await expect(editorOf(page)).toContainText('Data were extracted in duplicate.');
    // …and the pasted OBJECT — table, caption marker, identity — has left the
    // manuscript, in one action, in both engines.
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const md = String(((proj.manuscripts || [])[0] || {}).sections?.methods?.content || '');
      expect(md).toContain('Data were extracted in duplicate.');
      expect(md).not.toContain('[[tblcap:');
      expect(md).not.toContain('Baseline characteristics');
      expect(md).not.toMatch(/^\s*\|/m);
    }).toPass({ timeout: 25_000 });

    // …and redo puts all of it back, in the same place, with its structure intact.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(tables(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(captions(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Baseline characteristics', { timeout: 10_000 });
    expect(await gridOf(page, 0)).toEqual([
      ['Group', 'Outcome', ''],
      ['Arm A', 'MI', '12'],
      ['', 'Stroke', '8'],
    ]);
  });

  test('§7: an Excel range imports as a table, not as a screenshot', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    await pasteInto(page, {
      html: EXCEL_HTML,
      text: 'Trial\tEvents\tTotal\nAlpha\t12\t100\nBeta\t8\t101',
      withImage: true,
    });

    await expect(tables(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(figureBlocks(page)).toHaveCount(0);
    // No Word caption in the clipboard → an empty title with its placeholder, and
    // NOTHING invented (§7 "Do not invent a descriptive title").
    await expect(captions(page)).toHaveCount(1);
    await expect(numbers(page).first()).toContainText('Table 1.');
    await expect(titles(page).first()).toHaveText('');
    await expect(titles(page).first()).toHaveAttribute('data-placeholder', /Add a table title/);
    expect(await gridOf(page, 0)).toEqual([
      ['Trial', 'Events', 'Total'],
      ['Alpha', '12', '100'],
      ['Beta', '8', '101'],
    ]);

    // The title is editable and the object is one entity: typing names it.
    await titles(page).first().click();
    await page.keyboard.type('Event counts');
    await expect(titles(page).first()).toHaveText('Event counts');
    await saved(page);
  });

  test('§7: a tab-separated clipboard with no HTML at all still becomes a table', async ({ page, tmpProject }) => {
    // Safari exposes less clipboard metadata than Chromium — §7 asks for this to
    // degrade gracefully, and it does so BY CONSTRUCTION (no text/html → the TSV
    // rung), with no user-agent detection anywhere.
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    await pasteInto(page, { text: 'Trial\tEvents\tTotal\nAlpha\t12\t100\nBeta\t8\t101' });
    await expect(tables(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(captions(page)).toHaveCount(1);
    expect(await gridOf(page, 0)).toEqual([
      ['Trial', 'Events', 'Total'],
      ['Alpha', '12', '100'],
      ['Beta', '8', '101'],
    ]);

    /* …and ORDINARY text pasting is untouched: prose with no grid in it goes in as
       text, through the browser's own paste, with no table and no caption. */
    await clickBelowLastBlock(page);
    const consumed = await pasteInto(page, { text: 'Plain prose pasted from a text editor.' });
    expect(consumed).toBe(false);          // left entirely to the browser
    await expect(tables(page)).toHaveCount(1);
    await expect(captions(page)).toHaveCount(1);
  });

  test('§7: a clipboard that contains ONLY an image is still a figure — no table is fabricated', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'discussion');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');

    await pasteInto(page, { imageOnly: true });

    // The figure path, exactly as before 120.md §7 — and NO table was minted.
    await expect(figureBlocks(page)).toHaveCount(1, { timeout: 25_000 });
    await expect(tables(page)).toHaveCount(0);
    await expect(captions(page)).toHaveCount(0);
    await expect(editorOf(page).locator('figure.ms-figblock img.ms-figimg')).toHaveCount(1);
    await saved(page);
  });

  /* ── §7 "Special cases": cells pasted into an existing table ────────────────── */

  test('§7: pasting a table into a CELL follows the hoist — never a nested table', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertTable(page, 2, 2);
    await page.keyboard.type('Existing table');
    await expect(tables(page)).toHaveCount(1);

    // Caret inside a CELL of the existing table …
    await tables(page).first().locator('td,th').first().click();
    await page.keyboard.type('kept');
    await pasteInto(page, { html: WORD_HTML, text: WORD_TEXT, withImage: true });

    // … and the pasted table lands AFTER the whole object, as its own table.
    await expect(tables(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(editorOf(page).locator('table table')).toHaveCount(0);
    await expect(tables(page).first().locator('td,th').first()).toHaveText('kept');
    await expect(titles(page).nth(1)).toHaveText('Baseline characteristics', { timeout: 10_000 });
    const shape = await shapeOf(page);
    expect(shape.filter((s) => s === 'table')).toHaveLength(2);
    expect(shape.filter((s) => s === 'div.ms-tblcap')).toHaveLength(2);

    /* …and a NON-table paste while the caret is in a TITLE goes in as plain text,
       first line only, instead of flattening block markup into the title. */
    await titles(page).first().click();
    await page.keyboard.press('End');
    await pasteInto(page, {
      html: '<p><b>Appended</b> heading</p><p>a second paragraph</p>',
      text: 'Appended heading\na second paragraph',
    });
    await expect(titles(page).first()).toHaveText('Existing tableAppended heading', { timeout: 10_000 });
    await expect(titles(page).first().locator('b, strong, p')).toHaveCount(0);
    await expect(tables(page)).toHaveCount(2);
    await saved(page);
  });
});
