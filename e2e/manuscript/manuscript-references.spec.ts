/**
 * manuscript-references.spec.ts — 117.md §78 "Reference workflow" and §91 "Final
 * reference-manager test", plus the §26-§41 contract they are the acceptance tests
 * for.
 *
 * Why this is an e2e and not a unit test: every pure piece (the resolver seam, the
 * alias map, the range collapse, the style formatters, the parsers) is unit-tested
 * in tests/unit/manuscript/referenceLibrary117*.test.*. What CANNOT be asserted in
 * Node is the thing the researcher actually experiences — that a citation inserted
 * from a searchable picker becomes a numbered chip in a contentEditable, that citing
 * something EARLIER renumbers the sentence that was already written, that deleting a
 * citation updates the bibliography, and that merging two references leaves every
 * citation still pointing somewhere real. Those are properties of the DOM, the
 * browser's native undo stack and the autosave round trip.
 *
 * Network: the smart lookup is stubbed at OUR proxy route (`/api/citation/*`). That
 * is deliberate — the thing under test is our plumbing (proxy → parse → preview →
 * confirm → stored entry), not CrossRef's uptime, and a live external call would
 * make the suite flaky and rate-limited.
 *
 * §78 steps: add by DOI → resolve metadata → insert citation → add a second citation
 * EARLIER → verify numbering updates → delete a citation → verify the bibliography
 * updates.
 * §91 steps: manual entry, RIS import, merge a duplicate, edit an author, change the
 * citation style, export.
 */
import { test, expect } from '../fixtures/stitch-test';
import { attachPdfToFirstRecord } from '../helpers/pdf';

type Page = import('@playwright/test').Page;
type APIRequestContext = import('@playwright/test').APIRequestContext;

/** Two included studies, so the library is non-empty before anything is added. */
async function seedStudies(request: APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.studies = [
    { id: 's1', title: 'Alpha trial of the intervention', authors: 'Alpha A', year: '2019', journal: 'Lancet', doi: '10.1000/alpha' },
    { id: 's2', title: 'Beta trial of the intervention', authors: 'Beta B', year: '2021', journal: 'NEJM', doi: '10.1000/beta' },
  ];
  const put = await request.put(`/api/projects/${projectId}/autosave`, { data: proj });
  expect(put.ok()).toBeTruthy();
}

/**
 * Two included studies that are the SAME publication, so §91's merge step has
 * something to merge.
 *
 * They must not be byte-identical: 117.md §32's resolver deduplicates the derived
 * set itself, on an exact DOI → PMID → normalized-title+year key, and records an
 * ALIAS for every copy it drops. Two rows carrying the same title and year are
 * therefore collapsed before the panel ever sees them (their citations already
 * survive, by alias — that is the §32 guarantee, unit-tested in
 * referenceLibrary117), and the duplicate CARD correctly has nothing to offer.
 *
 * What the card is actually for is the pair that exact-key dedupe cannot collapse
 * — which is the realistic one: the same trial harvested from two databases, one
 * record carrying the DOI and the other only the PMID. Different keys, so both
 * survive the resolver; `classifyPair` still calls them a probable duplicate; and
 * the merge has real work to do (the survivor gains the PMID it lacked).
 */
async function seedDuplicate(request: APIRequestContext, projectId: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.studies = [
    { id: 's1', title: 'Alpha trial of the intervention', authors: 'Alpha A; Gamma G', year: '2019', journal: 'Lancet', doi: '10.1000/alpha' },
    { id: 's2', title: 'Alpha trial of the intervention', authors: 'Alpha A; Gamma G', year: '2019', journal: 'Lancet', pmid: '31234567' },
  ];
  const put = await request.put(`/api/projects/${projectId}/autosave`, { data: proj });
  expect(put.ok()).toBeTruthy();
}

/** Stub OUR citation proxy so the DOI lookup is deterministic and offline. */
async function stubCrossref(page: Page) {
  await page.route('**/api/citation/crossref?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: {
          DOI: '10.1056/NEJMoa2035389',
          title: ['Efficacy and safety of the study vaccine'],
          author: [{ family: 'Polack', given: 'F P' }, { family: 'Thomas', given: 'S J' }],
          'container-title': ['New England Journal of Medicine'],
          issued: { 'date-parts': [[2020]] },
          volume: '383',
          issue: '27',
          page: '2603-2615',
          publisher: 'Massachusetts Medical Society',
          type: 'journal-article',
        },
      }),
    });
  });
}

async function openManuscript(page: Page, projectId: string) {
  // 119.md §3 — Section View is the non-default view now; this file drives the
  // single-section editor, so it asks for it by name.
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
}

async function openEditorSection(page: Page, section: string) {
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = page.getByTestId('stitch-manuscript-rich-editor');
  await expect(editor).toBeVisible();
  return editor;
}

const citeChips = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor').locator('.ms-cite');

/**
 * Insert a citation at the caret through the toolbar picker.
 * `expectOptions` pins how many references the search was supposed to narrow to —
 * pass 1 when the test depends on citing one PARTICULAR reference, so a fixture
 * that stops being unambiguous fails loudly instead of citing the wrong one.
 */
async function insertCitation(page: Page, search: string, expectOptions?: number) {
  await page.getByTestId('stitch-manuscript-insert-citation').click();
  const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
  await expect(popover).toBeVisible();
  await popover.getByTestId('stitch-manuscript-insert-citation-search').fill(search);
  if (expectOptions != null) await expect(popover.getByRole('option')).toHaveCount(expectOptions);
  await popover.getByRole('option').first().click();
  await expect(popover).toHaveCount(0);
}

test.describe('Manuscript reference manager (117.md §26-§41, §78, §91)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§78: add by DOI → cite it → cite earlier → numbering updates → delete a citation → bibliography updates', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    await stubCrossref(page);
    await openManuscript(page, tmpProject.id);

    /* 1-2. §28/§29 — Add Reference, resolved from a DOI. */
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await page.getByTestId('stitch-manuscript-add-reference-open').click();
    const dialog = page.getByTestId('stitch-manuscript-add-reference');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('stitch-manuscript-lookup-value').fill('10.1056/NEJMoa2035389');
    await dialog.getByTestId('stitch-manuscript-lookup-run').click();

    // The lookup FILLS the form — the researcher confirms. Volume/issue/pages are
    // real now (they used to dead-end in the parser).
    await expect(dialog.getByTestId('stitch-manuscript-reffield-title')).toHaveValue(/Efficacy and safety/);
    await expect(dialog.getByTestId('stitch-manuscript-reffield-journal')).toHaveValue(/New England Journal/);
    await expect(dialog.getByTestId('stitch-manuscript-reffield-volume')).toHaveValue('383');
    await expect(dialog.getByTestId('stitch-manuscript-reffield-pages')).toHaveValue('2603-2615');
    await expect(dialog.getByTestId('stitch-manuscript-lookup-filled')).toBeVisible();

    // §29 — a manual correction before saving is honoured verbatim.
    await dialog.getByTestId('stitch-manuscript-reffield-year').fill('2021');
    await dialog.getByTestId('stitch-manuscript-reference-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Efficacy and safety of the study vaccine')).toBeVisible();

    /* 3. §34 — insert a citation to it from the editor. */
    const editor = await openEditorSection(page, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The vaccine trial reported strong efficacy ');
    await insertCitation(page, 'Efficacy and safety');
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });

    /* 4-5. §36 — a SECOND citation EARLIER in the manuscript renumbers the first. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('Earlier work established the baseline ');
    await insertCitation(page, 'Alpha');
    await expect(citeChips(page)).toHaveCount(2);
    // document order: the Alpha citation is now first, the vaccine one second
    await expect(citeChips(page).nth(0)).toHaveText('[1]', { timeout: 10_000 });
    await expect(citeChips(page).nth(1)).toHaveText('[2]', { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    // §40 — the References tab lists them in citation order.
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    const listed = page.locator('[data-testid^="stitch-manuscript-reference-"]').filter({ hasText: 'Alpha trial' });
    await expect(listed.first()).toBeVisible();

    /* 6-7. §38/§40 — delete a citation from its chip menu; the bibliography follows. */
    await openEditorSection(page, 'results');
    await citeChips(page).nth(1).click();
    const menu = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(menu).toBeVisible();
    await menu.getByTestId('stitch-manuscript-cite-remove').click();
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    // The reference itself survives the citation's removal (§38's promise).
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await expect(page.getByText('Efficacy and safety of the study vaccine')).toBeVisible();
    // …and it is now honestly marked as uncited.
    await expect(page.locator('[data-testid^="stitch-manuscript-reference-uncited-"]').first()).toBeVisible();
  });

  test('§35/§38: a multi-select insertion is ONE chip, and its menu previews every reference', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    const editor = await openEditorSection(page, 'results');

    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Several studies reported similar findings ');
    await page.getByTestId('stitch-manuscript-insert-citation').click();
    const popover = page.getByTestId('stitch-manuscript-insert-citation-popover');
    await expect(popover).toBeVisible();
    // §35 — check TWO references, then insert once.
    await popover.getByTestId('stitch-manuscript-insert-citation-check-s1').click();
    await popover.getByTestId('stitch-manuscript-insert-citation-check-s2').click();
    await expect(popover.getByTestId('stitch-manuscript-insert-citation-picked')).toContainText('2 selected');
    await popover.getByTestId('stitch-manuscript-insert-citation-insert').click();

    // ONE chip, reading "[1,2]" — not two adjacent chips.
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1,2]', { timeout: 10_000 });

    // §38 — hover previews the references behind it.
    await citeChips(page).first().hover();
    const hover = page.getByTestId('stitch-manuscript-cite-hover');
    await expect(hover).toBeVisible();
    await expect(hover).toContainText('Alpha trial of the intervention');
    await expect(hover).toContainText('Beta trial of the intervention');

    // §38 — removing ONE reference leaves the other citation intact.
    await citeChips(page).first().click();
    const menu = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(menu).toBeVisible();
    await menu.getByTestId('stitch-manuscript-cite-remove-s1').click();
    await expect(citeChips(page)).toHaveCount(1);
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });
  });

  /**
   * 118.md §8.1 — the ABSTRACT is a citing surface like any other.
   *
   * It is the one section rendered by a DIFFERENT component: `AbstractEditor`
   * mounts one rich editor per labelled subsection. Those editors used to be
   * mounted without the citation layer, so a citation inserted in the abstract
   * rendered as a bare numeric chip that did nothing when clicked, while the same
   * citation in Methods rendered "(Alpha, 2019)" and opened an action menu. Both
   * halves are asserted here: the STYLE-AWARE label, and the menu.
   */
  test('§8.1: a citation in the ABSTRACT gets the styled label and the same action menu', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();

    // Generate, so the abstract is the STRUCTURED editor (labelled subsections)
    // rather than the free-form fallback — the subsection editors are the ones the
    // props never reached.
    await page.getByTestId('stitch-manuscript-generate').click();
    await page.getByTestId('stitch-manuscript-section-abstract').click();
    await expect(page.getByTestId('stitch-manuscript-abstract-editor')).toBeVisible({ timeout: 20_000 });

    // Put the caret in the FIRST subsection editor. (Its generated text is a manual-
    // input placeholder chip — atomic and non-editable by design, 102.md §3 — so this
    // test cites rather than types; the citation layer is what §8.1 is about.)
    const field = page.getByTestId('stitch-manuscript-abstract-field-0');
    const abstractChips = field.locator('.ms-cite');
    const before = await abstractChips.count();

    await field.click();
    await page.keyboard.press('ControlOrMeta+End');
    await insertCitation(page, 'Alpha', 1);
    await expect(abstractChips).toHaveCount(before + 1, { timeout: 10_000 });

    // The chip label follows the DRAFT'S citation style — the abstract editors now
    // know what it is. Harvard is the differential: with no style threaded the chip
    // falls back to a numeric "[n]".
    await page.getByLabel('Citation style').selectOption('harvard');
    await expect(abstractChips.last()).toHaveText(/\(Alpha.*2019\)/, { timeout: 15_000 });

    // …and clicking it opens the citation action menu, anchored in the same page
    // layer the body sections use (the popovers live in the panel, not the editor).
    await abstractChips.last().click();
    const abstractMenu = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(abstractMenu).toBeVisible();
    // the menu names the citation it acts on and offers the same actions it offers
    // for a chip in the body — before the fix there was no menu at all
    await expect(abstractMenu).toContainText('(Alpha, 2019)');
    await expect(abstractMenu.getByTestId('stitch-manuscript-cite-remove')).toBeVisible();
    await expect(abstractMenu.getByTestId('stitch-manuscript-cite-goto-references')).toBeVisible();

    // The write really landed in the ABSTRACT — the abstract serializes every
    // subsection back into the ONE markdown string the engine persists, and the chip
    // callbacks report the owning section, so nothing can edit a different one.
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 25_000 });
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const draft = (proj.manuscripts || [])[0] || {};
      const abstract = String(draft.sections?.abstract?.content || '');
      expect(abstract).toContain('[[cite:s1]]');
      // still the STRUCTURED abstract — citing did not flatten the subsections
      expect(abstract).toContain('**Background.**');
      expect(abstract).toContain('**Conclusions.**');
    }).toPass({ timeout: 25_000 });
  });

  test('§91: manual entry → RIS import → merge a duplicate → edit an author → change style → export', async ({ page, request, tmpProject }) => {
    await seedDuplicate(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-references').click();

    /* §28 — a MANUAL entry of a non-article type. */
    await page.getByTestId('stitch-manuscript-add-reference-open').click();
    const dialog = page.getByTestId('stitch-manuscript-add-reference');
    await dialog.getByTestId('stitch-manuscript-reference-type').selectOption('guideline');
    // §28 — the type changed which fields exist: a guideline has no journal volume.
    await expect(dialog.getByTestId('stitch-manuscript-reffield-volume')).toHaveCount(0);
    await dialog.getByTestId('stitch-manuscript-reffield-title').fill('National clinical guideline on the intervention');
    await dialog.getByTestId('stitch-manuscript-reffield-authors').fill('Institute of Health');
    await dialog.getByTestId('stitch-manuscript-reffield-year').fill('2023');
    await dialog.getByTestId('stitch-manuscript-reference-save').click();
    await expect(page.getByText('National clinical guideline on the intervention')).toBeVisible();

    /* §30 — RIS import, with a dedup preview before anything lands. */
    await page.getByTestId('stitch-manuscript-import-open').click();
    const importDialog = page.getByTestId('stitch-manuscript-import-references');
    await expect(importDialog).toBeVisible();
    await importDialog.getByTestId('stitch-manuscript-import-text').fill([
      'TY  - JOUR',
      'AU  - Delta, D',
      'TI  - Delta cohort of long-term outcomes',
      'JO  - BMJ',
      'PY  - 2022',
      'VL  - 377',
      'IS  - 2',
      'SP  - 100',
      'EP  - 110',
      'DO  - 10.1136/bmj.delta',
      'ER  - ',
    ].join('\n'));
    await importDialog.getByTestId('stitch-manuscript-import-parse').click();
    await expect(importDialog.getByTestId('stitch-manuscript-import-preview')).toBeVisible();
    await importDialog.getByTestId('stitch-manuscript-import-confirm').click();
    await expect(importDialog).toHaveCount(0);
    // The imported reference carries the volume/issue/pages the parser used to drop.
    await expect(page.getByText(/Delta cohort of long-term outcomes/)).toBeVisible();
    await expect(page.getByText(/2022;377\(2\):100-110/)).toBeVisible();

    /* §32 — the two seeded copies of the same trial are offered as a merge, and
       merging must not break a citation already written against the LOSING id.
       "Merge into the first" keeps the pair's FIRST reference (s1, the DOI copy),
       so the citation written here has to point at the second one (s2) or the
       merge would prove nothing — hence the search by s2's PMID, which is the one
       field that tells the two apart. */
    const editor = await openEditorSection(page, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The duplicated record is cited here ');
    await insertCitation(page, '31234567', 1);
    await expect(citeChips(page)).toHaveCount(1);
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i, { timeout: 20_000 });

    await page.getByTestId('stitch-manuscript-subtab-references').click();
    const dupCard = page.getByTestId('stitch-manuscript-reference-duplicates');
    await expect(dupCard).toBeVisible();
    await dupCard.getByTestId('stitch-manuscript-merge-s1-s2').click();
    // The loser is gone from the list; it survives only as an alias (and, being a
    // derived reference, as a restorable hidden one).
    await expect(dupCard).toHaveCount(0);

    // The citation still resolves after the merge (never "[?]").
    await openEditorSection(page, 'results');
    await expect(citeChips(page).first()).toHaveText('[1]', { timeout: 10_000 });
    await expect(citeChips(page).first()).not.toHaveAttribute('data-cite-broken', 'true');

    /* §29 — edit an author; the correction sticks and is never re-derived away. */
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await page.locator('[data-testid^="stitch-manuscript-reference-edit-"]').first().click();
    const editDialog = page.getByTestId('stitch-manuscript-add-reference');
    await expect(editDialog).toBeVisible();
    await editDialog.getByTestId('stitch-manuscript-reffield-authors').fill('Alpha AA; Gamma GG');
    await editDialog.getByTestId('stitch-manuscript-reference-save').click();
    await expect(editDialog).toHaveCount(0);
    // Vancouver keeps a two-initial run whole ("Alpha AA"), so the correction is
    // legible in the bibliography rather than silently collapsed back to "Alpha A".
    await expect(page.getByText(/Alpha AA/)).toBeVisible();

    // §29 — the correction is an OVERLAY PATCH on the derived reference: the study
    // record is untouched, which is what makes "a refresh can never win over the
    // correction" structural. Asserted against the persisted blob, which also gives
    // the shell's debounced autosave a deterministic point to have landed by — a
    // reload that outran it would be testing the debounce, not the overlay.
    await expect.poll(async () => {
      const p = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const edits = (p.referenceLibrary && p.referenceLibrary.edits) || {};
      return (edits.s1 && edits.s1.authors) || '';
    }, { timeout: 20_000 }).toBe('Alpha AA; Gamma GG');

    // …and it survives a full reload (the overlay is persisted, not view state).
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await expect(page.getByText(/Alpha AA/)).toBeVisible();

    /* §37 — change the citation style; the bibliography re-renders derivationally. */
    const styleSelect = page.getByLabel('Citation style');
    await styleSelect.selectOption('harvard');
    // The correction survives the style change — spelled Harvard's way ("Alpha,
    // A. A."), which is the point: the metadata is stored once and FORMATTED per
    // style, never stored per style.
    await expect(page.getByText(/Alpha, A\. A\./)).toBeVisible();
    // Harvard quotes the title and puts the year in parentheses after the authors.
    await expect(page.getByText(/\(2019\)/).first()).toBeVisible();
    // §37 — the in-text marker follows the style too.
    await openEditorSection(page, 'results');
    await expect(citeChips(page).first()).toHaveText(/\(Alpha.*2019\)/, { timeout: 10_000 });

    /* §41 — export. The manuscript must still produce a real .docx with all of it.
       The canonical export button lives on the OVERVIEW panel: the Export panel
       renders the same control without test ids so the id stays unique (the same
       place manuscript.spec.ts exports from). */
    await styleSelect.selectOption('vancouver');
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('stitch-manuscript-export-word').click();
    // Validation warnings (uncited references while drafting) are allowed through.
    // The review only appears AFTER prepareExport resolves, so this waits for it
    // rather than sampling visibility on the same tick; a clean model downloads
    // with no dialog at all, which is why the wait is allowed to time out.
    const review = page.getByTestId('stitch-manuscript-export-validation');
    const reviewed = await review.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    if (reviewed) await page.getByTestId('stitch-manuscript-export-anyway').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.docx$/);
  });

  /**
   * 117.md §38 / §J.3 — "Open PDF" is a FEATURE now, not a seam.
   *
   * Nothing writes `pdfAttachmentId`, and nothing needs to: an included study that
   * came through screening names its screening record, and that record's attachment
   * is resolved on demand through the pre-117 listing endpoint. So this seeds a REAL
   * PDF on a REAL screening record (through the real upload route, exactly as
   * files-pdf.spec.ts does), links a study to it, and asserts the chip menu offers
   * the action — and that a reference with no screening record still does not, which
   * is the half that keeps the button honest.
   *
   * The screeningProject fixture is used rather than tmpProject because the
   * attachment lives on a screening record; the manuscript project is the same
   * META·LAB project the workspace belongs to.
   */
  test('§J.3: "Open PDF" appears for a screening-linked reference and opens the in-app viewer', async ({ page, request, screeningProject }) => {
    const attached = await attachPdfToFirstRecord(request, screeningProject.siftId);

    const proj = await (await request.get(`/api/projects/${screeningProject.project.id}`)).json();
    proj.studies = [
      {
        id: 'p1', title: 'Screened trial with a full text', authors: 'Lee K', year: '2020',
        journal: 'Lancet', doi: '10.1000/withpdf',
        screeningRecordId: attached.recordId, screeningProjectId: screeningProject.siftId,
      },
      // No screening linkage at all — the action must NOT appear for this one.
      { id: 'p2', title: 'Typed by hand with no record', authors: 'Roe B', year: '2021', journal: 'BMJ' },
    ];
    expect((await request.put(`/api/projects/${screeningProject.project.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await openManuscript(page, screeningProject.project.id);
    const editor = await openEditorSection(page, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The full text was reviewed ');
    await insertCitation(page, 'Screened trial', 1);
    await expect(citeChips(page)).toHaveCount(1);

    /* The chip is addressed by its reference id, not by position: the picker inserts
       at the caret, and this spec deliberately does not care where that is. */
    const chipFor = (id: string) => page.getByTestId('stitch-manuscript-rich-editor').locator(`.ms-cite[data-cite="${id}"]`);

    // Resolution is LAZY: it starts when the action menu opens, so the action
    // appears a moment later rather than on first paint.
    await chipFor('p1').click();
    const menu = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('stitch-manuscript-cite-pdf-p1')).toBeVisible({ timeout: 15_000 });

    // …and it opens the SAME viewer the screening surface uses (no new route).
    await menu.getByTestId('stitch-manuscript-cite-pdf-p1').click();
    const viewer = page.getByTestId('stitch-manuscript-reference-pdf');
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    await expect(viewer).toContainText('Screened trial with a full text');
    await viewer.getByTestId('stitch-manuscript-reference-pdf-close').click();
    await expect(viewer).toHaveCount(0);

    // The reference with no screening record offers no PDF action at all.
    await openEditorSection(page, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' and the manual reference too ');
    await insertCitation(page, 'Typed by hand', 1);
    await expect(citeChips(page)).toHaveCount(2);
    await chipFor('p2').click();
    const menu2 = page.getByTestId('stitch-manuscript-cite-menu');
    await expect(menu2).toBeVisible();
    await expect(menu2.getByTestId('stitch-manuscript-cite-edit-p2')).toBeVisible();
    await expect(menu2.getByTestId('stitch-manuscript-cite-pdf-p2')).toHaveCount(0);
  });

  /**
   * 117.md §J.16 — a merged-away reference is UNMERGED, never "restored".
   *
   * The shipped behaviour listed it in the hidden-references card with a Restore
   * button, and pressing it brought the duplicate back beside its survivor (the alias
   * stops applying the moment the id is a reference again). This walks the whole
   * loop in the browser: merge → the card says what happened → Unmerge → both
   * references are back and the survivor has given up the metadata the merge filled.
   */
  test('§J.16: a merged reference is shown as merged, and Unmerge puts both back', async ({ page, request, tmpProject }) => {
    await seedDuplicate(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-references').click();

    // The merge survivor (s1, the DOI copy) gains the PMID the loser carried.
    const dupCard = page.getByTestId('stitch-manuscript-reference-duplicates');
    await expect(dupCard).toBeVisible();
    await dupCard.getByTestId('stitch-manuscript-merge-s1-s2').click();
    await expect(dupCard).toHaveCount(0);
    await expect(page.getByTestId('stitch-manuscript-reference-s2')).toHaveCount(0);

    // §J.16 — the hidden card names the survivor and offers Unmerge, NOT Restore.
    const hidden = page.getByTestId('stitch-manuscript-reference-hidden');
    await expect(hidden).toBeVisible();
    await expect(hidden.getByTestId('stitch-manuscript-reference-mergedinto-s2')).toContainText('Merged into Alpha');
    await expect(hidden.getByTestId('stitch-manuscript-reference-restore-s2')).toHaveCount(0);

    // The merge recorded its own inverse (what it filled on the survivor), which is
    // what makes the Unmerge below exact rather than approximate.
    await expect.poll(async () => {
      const p = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const lib = p.referenceLibrary || {};
      return JSON.stringify({
        into: ((lib.merges || {}).s2 || {}).into || '',
        pmid: ((lib.edits || {}).s1 || {}).pmid || '',
      });
    }, { timeout: 20_000 }).toBe(JSON.stringify({ into: 's1', pmid: '31234567' }));

    // Unmerge separates them again and gives the filled metadata back.
    await hidden.getByTestId('stitch-manuscript-reference-unmerge-s2').click();
    await expect(page.getByTestId('stitch-manuscript-reference-s2')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-reference-hidden')).toHaveCount(0);

    // The overlay is back to having no merge at all (asserted against the blob, which
    // also gives the debounced autosave a deterministic point to have landed by).
    await expect.poll(async () => {
      const p = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const lib = p.referenceLibrary || {};
      return JSON.stringify({
        aliases: lib.aliases || {}, removed: lib.removed || [],
        merges: lib.merges || {}, edits: lib.edits || {},
      });
    }, { timeout: 20_000 }).toBe(JSON.stringify({ aliases: {}, removed: [], merges: {}, edits: {} }));
  });

  test('§33: the library manager searches, filters and hides/restores derived references', async ({ page, request, tmpProject }) => {
    await seedStudies(request, tmpProject.id);
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-references').click();

    // §31 — the panel says out loud that included studies are already here.
    await expect(page.getByTestId('stitch-manuscript-references-derived-note')).toBeVisible();

    // §33 — search narrows the list.
    await page.getByTestId('stitch-manuscript-reference-search').fill('Beta');
    await expect(page.getByText('Beta trial of the intervention')).toBeVisible();
    await expect(page.getByText('Alpha trial of the intervention')).toHaveCount(0);
    await page.getByTestId('stitch-manuscript-reference-search').fill('');

    // §33 — the cited/uncited filter (nothing is cited yet).
    await page.getByTestId('stitch-manuscript-reference-filter-cited').selectOption('cited');
    await expect(page.getByTestId('stitch-manuscript-reference-nomatch')).toBeVisible();
    await page.getByTestId('stitch-manuscript-reference-filter-cited').selectOption('all');

    // §31 — hiding a derived reference removes it from the list but keeps it restorable.
    await page.getByTestId('stitch-manuscript-reference-hide-s2').click();
    await expect(page.getByTestId('stitch-manuscript-reference-s2')).toHaveCount(0);
    const hidden = page.getByTestId('stitch-manuscript-reference-hidden');
    await expect(hidden).toBeVisible();
    await hidden.getByTestId('stitch-manuscript-reference-restore-s2').click();
    await expect(page.getByTestId('stitch-manuscript-reference-s2')).toBeVisible();
  });
});
