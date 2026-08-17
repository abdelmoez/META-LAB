/**
 * manuscript-insert-caret-121.spec.ts — 121.md §4 "Fix Citations and Cross-References
 * Being Inserted on the Next Line".
 *
 * The 120 spec (manuscript-citation-caret-120.spec.ts) proved that a citation goes
 * where the I-beam is when the caret is a plain collapsed caret. §4 is the family of
 * cases where it is NOT, and every one of them is an engine fact:
 *
 *   · a TRIPLE-CLICK selects with paragraph granularity, and Blink reports that
 *     selection as ending at (nextParagraph, 0) — so collapsing it to its end put the
 *     chip at the start of the following line, with no remount and no stale state
 *     involved. This is the dominant path, and it is why the report said
 *     "intermittent": only selections that end at a boundary do it;
 *   · a selection dragged ACROSS a block boundary ends the same way;
 *   · an EMPTY paragraph is `<p><br></p>`, and which SIDE of that placeholder the
 *     caret lands on decides whether the chip renders on the paragraph's own line or
 *     one visual line below it;
 *   · the §3 trailing affordance is re-synthesized on every mount, so a bookmark taken
 *     in an empty paragraph could re-resolve into it — the end-of-section insert
 *     documented as F17;
 *   · a REMOUNT while the picker is open detaches every node the saved Range pointed
 *     at, and a Range survives that by being re-pointed at the root — a position
 *     BETWEEN blocks, which the serializer then writes as its own paragraph.
 *
 * Each journey therefore asserts the PERSISTED MARKDOWN, not just the DOM: the chip
 * must be on the same LINE as the text the caret was in, with no structural newline
 * introduced before the token. That is §4's actual requirement ("no structural newline
 * or paragraph break may be introduced"), and it is the only assertion that survives a
 * reload.
 *
 * The pure rules (the bookmark resolution, the neighbour context, the payload policy,
 * the session lifecycle) are pinned in tests/unit/manuscript/caretInsert121.test.jsx.
 *
 * File name: deliberately NOT `manuscript-{table,figure}*`. Rather than smuggling
 * WebKit coverage through a misleading name, playwright.config.ts's `webkit-manuscript`
 * testMatch is widened to name this file explicitly — 121 §4 is selection and
 * execCommand behaviour, which is precisely where engines differ, so a Blink-only
 * claim would not be a claim about the defect at all.
 *
 * WEBKIT ≠ SAFARI: green under `webkit-manuscript` is engine evidence, not a Safari
 * sign-off (see docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md › "Real-Safari manual QA").
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;
type APIRequestContext = import('@playwright/test').APIRequestContext;

/** Two included studies, so the citation picker has something to search. */
async function seedStudies(request: APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.studies = [
    { id: 's1', title: 'Alpha trial of the intervention', authors: 'Alpha A', year: '2019', journal: 'Lancet', doi: '10.1000/alpha' },
    { id: 's2', title: 'Beta trial of the intervention', authors: 'Beta B', year: '2021', journal: 'NEJM', doi: '10.1000/beta' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const citeChips = (page: Page) => editorOf(page).locator('span.ms-cite[data-cite]');

async function openEditorSection(page: Page, projectId: string, section: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible();
  return editor;
}

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 25_000 });
}

/** The section's persisted markdown — the only place a structural newline is visible. */
async function sectionMd(request: APIRequestContext, projectId: string, section: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  const draft = (proj.manuscripts || [])[0] || {};
  return String((draft.sections || {})[section]?.content || '');
}

/**
 * Assert on the persisted markdown, POLLED.
 *
 * `saved(page)` is not a barrier for the edit that just happened: the status chip
 * still reads "Saved" from the PREVIOUS autosave while the one carrying this insertion
 * is still in flight, so a single read races the debounce. Every persisted-markdown
 * assertion in manuscript-citation-caret-120.spec.ts polls for the same reason.
 */
async function expectMd(
  request: APIRequestContext, projectId: string, section: string, check: (md: string) => void,
) {
  await expect(async () => { check(await sectionMd(request, projectId, section)); })
    .toPass({ timeout: 25_000 });
}

/**
 * Type PARAGRAPHS, then come back to them as real `<p>` blocks.
 *
 * Typing into an EMPTY section leaves Blink's own shape and not the document §4 is
 * about: the first run is a bare TEXT NODE child of the editing host (there is nothing
 * to wrap it in yet) and Enter produces `<div>`s. A paragraph-granularity selection
 * needs paragraphs. Re-opening the section renders the persisted markdown through
 * mdToHtml — which is exactly what a researcher sees when they open a manuscript they
 * wrote yesterday — and every line is then a real `<p>`, including the one the caret
 * started in.
 */
async function seedParagraphs(
  page: Page, request: APIRequestContext, projectId: string, section: string, paragraphs: string[],
) {
  const editor = await openEditorSection(page, projectId, section);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(paragraphs[i]);
  }
  await saved(page);
  await expectMd(request, projectId, section, (md) => {
    for (const p of paragraphs) expect(md).toContain(p);
  });
  const reopened = await openEditorSection(page, projectId, section);
  await expect(reopened.locator('p')).toHaveCount(paragraphs.length);
  return reopened;
}

/** Open the citation picker, SEARCH in it (the focus-stealing step), pick the first. */
async function cite(page: Page, search: string) {
  await page.getByTestId('stitch-manuscript-insert-citation').click();
  const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
  await expect(popover).toBeVisible();
  await popover.getByTestId('stitch-manuscript-insert-citation-search').fill(search);
  await expect(popover.getByRole('option')).toHaveCount(1);
  await popover.getByRole('option').first().click();
  await expect(popover).toHaveCount(0);
}

/**
 * THE ASSERTION §4 IS ABOUT. The citation token must sit on the same LINE as the text
 * it was inserted into — no `\n` introduced before it, and no line of its own.
 */
function tokenIsOnLineWith(md: string, text: string) {
  const line = md.split('\n').find((l) => l.includes(text));
  expect(line, `no line contains ${JSON.stringify(text)} in:\n${md}`).toBeTruthy();
  expect(line).toMatch(/\[\[cite:/);
  // …and no line consists only of the token (the "own paragraph" shape).
  for (const l of md.split('\n')) expect(l.trim()).not.toMatch(/^\[\[cite:[^\]]*\]\]$/);
}

test.describe('Insertion at the exact caret across selection boundaries (121.md §4)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§4: TRIPLE-CLICK then cite — the chip lands at the end of the SELECTED line', async ({ page, request, tmpProject }) => {
    /* The dominant path, and the one that needs no remount at all: a paragraph
       selection ends at (nextParagraph, 0), so the collapse-to-end recorded the NEXT
       paragraph at offset 0 and every validity check passed. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'methods', [
      'Pooled estimates favoured the intervention.',
      'Heterogeneity was moderate across trials.',
    ]);

    // Triple-click the FIRST paragraph, then cite without touching the caret again.
    const first = editor.locator('p').first();
    await first.click({ clickCount: 3 });
    await cite(page, 'Alpha');

    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    // The chip is inside the first paragraph, AFTER the selected words (§5's
    // selected-text contract: nothing is deleted), and the second paragraph is clean.
    await expect(editor.locator('p').first().locator('span.ms-cite')).toHaveCount(1);
    await expect(editor.locator('p').nth(1).locator('span.ms-cite')).toHaveCount(0);
    await expect(editor.locator('p').nth(1)).toHaveText('Heterogeneity was moderate across trials.');

    await saved(page);
    await expectMd(request, tmpProject.id, 'methods', (md) => {
      tokenIsOnLineWith(md, 'Pooled estimates favoured the intervention.');
      expect(md).not.toMatch(/\n\s*\[\[cite:/);
      expect(md.split('\n').find((l) => l.includes('Heterogeneity'))).not.toMatch(/\[\[cite:/);
    });
  });

  test('§4: a selection dragged ACROSS a block boundary keeps the chip on the last selected line', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'results', [
      'First paragraph of the results.',
      'Second paragraph of the results.',
      'Third paragraph of the results.',
    ]);

    /* Select from the middle of paragraph one to the END of paragraph two — a
       multi-block selection whose end sits at a boundary in Blink. */
    await editor.evaluate((el) => {
      const ps = Array.from(el.querySelectorAll('p'));
      const a = ps[0].firstChild as Text;
      const b = ps[1].firstChild as Text;
      const r = document.createRange();
      r.setStart(a, 6);
      r.setEnd(b, (b.nodeValue || '').length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    });
    await cite(page, 'Beta');

    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    // The chip is in the SECOND paragraph (where the selection ended), never the third.
    await expect(editor.locator('p').nth(1).locator('span.ms-cite')).toHaveCount(1);
    await expect(editor.locator('p').nth(2).locator('span.ms-cite')).toHaveCount(0);
    await expect(editor.locator('p').nth(2)).toHaveText('Third paragraph of the results.');
    // …and nothing was deleted by inserting over a selection.
    await expect(editor.locator('p').first()).toContainText('First paragraph of the results.');

    await saved(page);
    await expectMd(request, tmpProject.id, 'results', (md) => {
      tokenIsOnLineWith(md, 'Second paragraph of the results.');
      expect(md).toContain('First paragraph of the results.');
      expect(md.split('\n').find((l) => l.includes('Third paragraph'))).not.toMatch(/\[\[cite:/);
    });
  });

  test('§4: in an EMPTY paragraph mid-document the chip is on that paragraph\'s own line', async ({ page, request, tmpProject }) => {
    /* `<p><br></p>`: collapsing to the END of an empty block yields (p, 1) — AFTER the
       placeholder — and the engine keeps the placeholder, so the chip rendered on a
       second visual line inside the very paragraph the caret was in. */
    await seedStudies(request, tmpProject.id);
    /* The gap is made LIVE, in a document that already has paragraphs: markdown cannot
       represent an empty paragraph (mdDom drops any block that trims to ''), so a
       re-open would erase the very thing this test is about. */
    const editor = await seedParagraphs(page, request, tmpProject.id, 'discussion', ['Above the gap.']);
    await editor.locator('p').first().click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');          // the empty paragraph
    await page.keyboard.press('Enter');
    await page.keyboard.type('Below the gap.');
    // Put the caret back in the empty paragraph.
    await editor.evaluate((el) => {
      const empty = Array.from(el.querySelectorAll('p')).find((p) => !(p.textContent || '').trim());
      if (!empty) throw new Error('no empty paragraph');
      const r = document.createRange();
      r.selectNodeContents(empty);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    });
    await cite(page, 'Alpha');

    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    const chipLine = await citeChips(page).first().evaluate((el) => {
      const p = el.closest('p');
      const kids = p ? Array.from(p.childNodes) : [];
      // Is anything that forces a line break sitting BEFORE the chip in this block?
      const idx = kids.indexOf(el.parentElement && el.parentElement.tagName === 'SPAN' ? el.parentElement : el);
      const before = kids.slice(0, idx < 0 ? kids.length : idx);
      return {
        text: String(p?.textContent || ''),
        brBefore: before.filter((n) => (n as HTMLElement).tagName === 'BR').length,
      };
    });
    // No <br> before the chip: it is on the paragraph's FIRST line, not below it.
    expect(chipLine.brBefore).toBe(0);
    await expect(editor.locator('p').first()).toHaveText('Above the gap.');

    await saved(page);
    await expectMd(request, tmpProject.id, 'discussion', (md) => {
      expect(md).toContain('Above the gap.');
      expect(md).toContain('Below the gap.');
      // the token is its own LINE here only because the paragraph itself is otherwise
      // empty — what must never happen is it joining or splitting a neighbouring line
      expect(md.split('\n').find((l) => l.includes('Above the gap.'))).not.toMatch(/\[\[cite:/);
      expect(md.split('\n').find((l) => l.includes('Below the gap.'))).not.toMatch(/\[\[cite:/);
    });
  });

  test('§4: in the trailing affordance the chip lands there — not somewhere else', async ({ page, request, tmpProject }) => {
    /* The §3 affordance is the empty paragraph synthesized after a media object so the
       caret has somewhere to go. It is re-created on every mount, which is exactly why
       an empty-block bookmark used to re-resolve INTO it from elsewhere (F17). Here the
       caret genuinely IS in it, and the chip must land there. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'methods', ['A paragraph before the table.']);
    await editor.locator('p').first().click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('stitch-manuscript-tb-table').click();
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-grid-2-2').click();
    await expect(editor.locator('table')).toHaveCount(1);

    // Click in the visual space below the table — the §3 affordance click handler.
    const box = await editor.locator('table').boundingBox();
    if (!box) throw new Error('no table box');
    await page.mouse.click(box.x + 20, box.y + box.height + 12);
    await cite(page, 'Beta');

    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    // In a paragraph AFTER the table, not inside a cell and not before the table.
    const where = await citeChips(page).first().evaluate((el) => {
      const p = el.closest('p');
      const inCell = !!el.closest('td, th');
      const afterTable = !!(p && p.previousElementSibling
        && (p.previousElementSibling.tagName === 'TABLE'
          || p.previousElementSibling.querySelector?.('table')));
      return { inCell, afterTable, first: (p?.parentElement?.firstElementChild === p) };
    });
    expect(where.inCell).toBe(false);
    expect(where.first).toBe(false);

    await saved(page);
    await expectMd(request, tmpProject.id, 'methods', (md) => {
      expect(md).toContain('A paragraph before the table.');
      expect(md.split('\n').find((l) => l.includes('A paragraph before the table.'))).not.toMatch(/\[\[cite:/);
      expect(md).toMatch(/\[\[cite:/);
    });
  });

  test('§4: a REMOUNT while the picker is open never inserts between blocks', async ({ page, request, tmpProject }) => {
    /* A DOM Range survives the removal of its own nodes by being re-pointed at the
       surviving parent — the ROOT. That is not a text position: execCommand there puts
       the chip BETWEEN two paragraphs and mdDom serializes the run as its own
       paragraph, the one variant of this defect that survives a reload.
       Two outcomes are allowed and nothing else: the position is re-found in the block
       it belongs to, or the researcher is told. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'results', [
      'Pooled estimates favoured the intervention.',
      'Heterogeneity was moderate across trials.',
    ]);

    // Select the first paragraph (a boundary-ending selection) and open the picker.
    await editor.locator('p').first().click({ clickCount: 3 });
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();

    // Rebuild the whole section underneath it: every saved node is now detached.
    await editor.evaluate((el) => {
      const html = el.innerHTML;
      el.innerHTML = `<p>An earlier paragraph appeared while the picker was open.</p>${html}`;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    await popover.getByTestId('stitch-manuscript-insert-citation-search').fill('Alpha');
    await popover.getByRole('option').first().click();

    const refused = await page.getByTestId('stitch-manuscript-insert-notice').count();
    if (refused) {
      // The honest refusal — nothing was written anywhere.
      await expect(citeChips(page)).toHaveCount(0);
    } else {
      await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
      // …and if it DID resolve, it resolved into a real paragraph, not between two.
      const inABlock = await citeChips(page).first().evaluate((el) => !!el.closest('p, li, td, th, h1, h2, h3, h4'));
      expect(inABlock).toBe(true);
      await saved(page);
      await expectMd(request, tmpProject.id, 'results', (md) => {
        tokenIsOnLineWith(md, 'Pooled estimates favoured the intervention.');
      });
    }
    // Either way: never a chip in the paragraph that appeared while the picker was open.
    const text = await editorOf(page).evaluate((el) => String(el.textContent || ''));
    expect(text).toContain('An earlier paragraph appeared while the picker was open.');
    expect(text).not.toMatch(/^\s*\[1\]/);
  });

  test('§4: a cross-reference follows the same rule — one undo removes it', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'results', ['Baseline characteristics are summarised.']);
    await editor.locator('p').first().click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('stitch-manuscript-tb-table').click();
    await expect(page.getByTestId('stitch-manuscript-table-grid')).toBeVisible();
    await page.getByTestId('stitch-manuscript-table-grid-2-2').click();
    await expect(editor.locator('table')).toHaveCount(1);

    // Triple-click the prose paragraph, then insert a cross-reference.
    await editor.locator('p').first().click({ clickCount: 3 });
    await page.getByTestId('stitch-manuscript-crossref-open').click();
    const pop = page.getByTestId('stitch-manuscript-crossref-popover');
    await expect(pop).toBeVisible();
    await pop.getByRole('option').first().click();

    const chips = editor.locator('span.ms-asset[data-asset]');
    await expect(chips).toHaveCount(1, { timeout: 10_000 });
    await expect(editor.locator('p').first().locator('span.ms-asset')).toHaveCount(1);

    await saved(page);
    await expectMd(request, tmpProject.id, 'results', (md) => {
      const line = md.split('\n').find((l) => l.includes('Baseline characteristics are summarised.'));
      expect(line).toMatch(/\[\[table:/);
    });

    // §4 "Ensure the insertion is a single undoable transaction."
    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.locator('span.ms-asset[data-asset]')).toHaveCount(0, { timeout: 10_000 });
    await expect(editor.locator('p').first()).toContainText('Baseline characteristics are summarised.');
  });

  /* ── 121.md r2 — the three positions the r1 pad and the r1 classifiers got wrong ── */

  test('§4 r2: a citation immediately after a trailing FORMATTED run stays in the paragraph', async ({ page, request, tmpProject }) => {
    /* 121.md's Testing Requirements name "Immediately before and after links and
       formatted text", and nothing covered it. The caret at the end of a trailing
       `<b>` is INSIDE the bold element, so the end-of-block pad's gap range partially
       contains that element — and `cloneContents` clones a partially-contained element
       as a SHELL holding one zero-length text node. `gapHasElement` read those child
       nodes as content, refused the pad, and Blink ejected the chip out of the
       paragraph onto a line of its own, where it survives a reload. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'results', [
      'Risk differed between the two arms.',
    ]);
    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Risk was ');
    await page.getByTestId('stitch-manuscript-tb-bold').click();
    await page.keyboard.type('significantly higher');
    await expect(editor.locator('p').first().locator('b, strong')).toHaveCount(1);

    // The caret is at the end of the bold run, which is also the end of the block.
    await cite(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(editor.locator('p').first().locator('span.ms-cite')).toHaveCount(1);

    await saved(page);
    await expectMd(request, tmpProject.id, 'results', (md) => {
      tokenIsOnLineWith(md, 'significantly higher');
      expect(md).not.toMatch(/\n\s*\[\[cite:/);
    });
  });

  test('§4 r2: a section that ENDS IN A LIST gains no standalone citation paragraph', async ({ page, request, tmpProject }) => {
    /* `isRealLineBlock` rejects UL/OL, so the root-level caret a select-all leaves past
       a trailing list could not be snapped into a line — and `rootInlineCaret` then
       classified that same UL as INLINE and ACCEPTED the caret, so execCommand wrote
       the chip after the `</ul>` and mdDom serialized that root-level run as its own
       paragraph. mdDom has always treated ul/ol as blocks; now both caret classifiers
       do too, and the snap descends to the end of the last item. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'methods', [
      'Inclusion criteria were as follows.',
    ]);
    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.getByTestId('stitch-manuscript-tb-ul').click();
    await page.keyboard.type('adults over eighteen');
    await page.keyboard.press('Enter');
    await page.keyboard.type('randomised comparisons only');
    await expect(editor.locator('ul li')).toHaveCount(2);

    // Ctrl+A — the selection deterministically ends at ROOT level, past the list.
    await page.keyboard.press('ControlOrMeta+a');
    await cite(page, 'Alpha');

    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    // …in the LAST list item, which is the last real line the selection covered.
    await expect(editor.locator('ul li').last().locator('span.ms-cite')).toHaveCount(1);

    await saved(page);
    await expectMd(request, tmpProject.id, 'methods', (md) => {
      tokenIsOnLineWith(md, 'randomised comparisons only');
      // nothing was appended AFTER the list
      expect(md.trimEnd().split('\n').pop()).toContain('randomised comparisons only');
    });

    // …and it survives a reload as part of the list item, not as its own paragraph.
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();
    await expect(editorOf(page).locator('ul li').last().locator('span.ms-cite'))
      .toHaveCount(1, { timeout: 15_000 });
  });

  test('§4 r2: a second citation at the END of the line still GROUPS, and no double space reaches the markdown', async ({ page, request, tmpProject }) => {
    /* The r1 end-of-block pad only refused a second pad when the caret sat BEFORE it.
       Pressing End puts the caret AFTER it, so every insertion at the end of the line
       added another nbsp; the chip-to-caret gap then measured two of them, `joinableGap`
       allows one, and 120.md §5's grouping was refused. The pad that ended up INTERIOR
       folded to a permanent double space in the markdown — byte-stable through every
       reload, the autosave and the .docx. The pad is now transparent to the caret, and
       one that stops being trailing is dropped before the section is serialized. */
    await seedStudies(request, tmpProject.id);
    const editor = await seedParagraphs(page, request, tmpProject.id, 'discussion', [
      'Two trials reported the outcome',
    ]);
    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await cite(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });

    // Back to the TRUE end of the line — the position that sits after the pad.
    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await cite(page, 'Beta');
    await expect(citeChips(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(citeChips(page).first()).toHaveAttribute('data-cite', /s1.*s2|s2.*s1/);

    // …and prose typed at that same end-of-line position is not pushed off the pad.
    await editor.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type('and a cohort agreed.');

    await saved(page);
    await expectMd(request, tmpProject.id, 'discussion', (md) => {
      const line = md.split('\n').find((l) => l.includes('Two trials reported the outcome'));
      expect(line, `no seeded line in:\n${md}`).toBeTruthy();
      expect(line).toMatch(/\[\[cite:s1,s2\]\]|\[\[cite:s2,s1\]\]/);
      // THE regression: not one double space, however many end-of-line inserts ran.
      expect(line).not.toMatch(/ {2}/);
      expect(line).toContain('and a cohort agreed.');
    });
  });
});
