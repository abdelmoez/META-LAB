/**
 * manuscript-overview.spec.ts — 118.md §28-§40, §49, §69.
 *
 * The Overview as a COMMAND CENTER: the page a first-time user opens and, from the
 * page alone, learns what this is, what is ready, what needs attention and where to
 * start — with every number connected to real application state.
 *
 * What this file proves that a unit test cannot:
 *   - the first-time note is dismissed ONCE and stays dismissed across a reload;
 *   - "Continue writing" really lands in the section the user last edited (the rule
 *     runs against the live hook state, not a fixture);
 *   - "Review updates" really opens the Updates destination with a plan in it, after
 *     a genuine server-side project change;
 *   - the checklist's action buttons really jump to the destination that owns the fix;
 *   - the §39 empty states are what a real, freshly generated manuscript shows.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect, Page } from '../fixtures/stitch-test';

async function openManuscript(page: Page, projectId: string, ms?: string) {
  // 119.md §3 — Section View is now the non-default view, so the specs that drive
  // the single-section editor name it in the URL.
  await page.goto(`/app/project/${projectId}?tab=manuscript${ms ? `&ms=${ms}` : ''}&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stitch-manuscript-header')).toBeVisible({ timeout: 20_000 });
}

/** Wider than the default 1280 so the toolbar keeps its inline controls and the
 *  Overview has its full reading column (the rails cost ~594px). */
async function desktop(page: Page) {
  await page.setViewportSize({ width: 1600, height: 950 });
}

/**
 * A manuscript with content in it. Generation is what the Overview describes, so
 * every case here starts from a REAL generated draft rather than a seeded blob.
 *
 * Sections stamp the source availability they were generated under, so we wait for
 * the live sources to settle first — otherwise freshness is honestly "unknown" and
 * the page (correctly) refuses to claim anything (§69).
 */
async function generateDraft(page: Page) {
  await page.getByTestId('stitch-manuscript-subtab-updates').click();
  await expect(page.getByTestId('stitch-manuscript-freshness').first())
    .not.toContainText(/unknown/i, { timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId('stitch-manuscript-generate').click();
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 20_000 });
}

const overview = (page: Page) => page.getByTestId('stitch-manuscript-overview');

test.describe('Manuscript Overview — the command center (118.md)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── §37 — first-time guidance, dismissed once ─────────────────────────────── */

  test('§37: the first-time note explains the page, and "Got it" sticks across a reload', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);

    // Nothing drafted yet → the first-draft hero owns the page, and the intro does
    // NOT stack on top of it (§37/§39).
    await expect(page.getByTestId('stitch-manuscript-hero')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-overview-intro')).toHaveCount(0);

    await generateDraft(page);
    await page.getByTestId('stitch-manuscript-subtab-overview').click();

    const intro = page.getByTestId('stitch-manuscript-overview-intro');
    await expect(intro).toBeVisible({ timeout: 20_000 });
    await expect(intro).toContainText('How this manuscript works');
    await expect(intro).toContainText(/builds your manuscript from the work you have already done/i);
    await expect(intro).toContainText(/Verify before submission/i);

    await page.getByTestId('stitch-manuscript-overview-intro-dismiss').click();
    await expect(intro).toHaveCount(0);

    // …and it is gone for good (a per-browser preference, never the manuscript blob).
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(overview(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-overview-intro')).toHaveCount(0);
    // the rest of the page is untouched by the dismissal
    await expect(page.getByTestId('stitch-manuscript-readiness')).toBeVisible();
  });

  /* ── §31 — "Continue writing" goes where the user left off ─────────────────── */

  test('§31: "Continue writing" opens the section that was last EDITED, not the Introduction', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateDraft(page);

    // Every section is auto-drafted at this point — nothing has been hand-edited, so
    // the honest destination is the top of the manuscript.
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    await expect(overview(page)).toContainText('the top of the manuscript', { timeout: 20_000 });

    // Now genuinely edit Discussion — the LAST section a generator would pick.
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-discussion').click();
    const editor = page.getByTestId('stitch-manuscript-rich-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    const marker = `Overview continue marker ${Date.now()}`;
    await page.keyboard.type(marker);
    await expect(page.getByTestId('stitch-manuscript-save-status').first())
      .toContainText(/Saved/i, { timeout: 20_000 });

    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    // The CTA NAMES its destination and says why it chose it (§31).
    await expect(overview(page)).toContainText('Opens Discussion', { timeout: 20_000 });
    await expect(overview(page)).toContainText('your most recent edit');
    await expect(page.getByTestId('stitch-manuscript-continue-writing'))
      .toHaveAttribute('aria-label', 'Continue writing in Discussion');

    await page.getByTestId('stitch-manuscript-continue-writing').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-editor')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(marker, { timeout: 15_000 });
  });

  /* ── §34 — updates are explained, and the CTA opens the real plan ──────────── */

  test('§34: a project change is EXPLAINED on the Overview, and "Review updates" opens the plan', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateDraft(page);

    // A freshly generated manuscript is in sync — and says so in words (§39).
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    // (An empty project legitimately has other things to look at — missing search
    //  date, no analysis — so the wording narrows to the updates claim itself.)
    await expect(page.getByTestId('stitch-manuscript-attention'))
      .toContainText(/Manuscript is synchronized with your project\.|No section is waiting for a project update\./, { timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-review-updates')).toHaveCount(0);

    // Wait until the generated draft (with its dependency fingerprints) has LANDED
    // server-side, then change a Methods dependency: τ² estimator DL → REML.
    let proj: any = null;
    await expect(async () => {
      proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      expect(proj?.manuscripts?.[0]?.sections?.methods?.depState).toBeTruthy();
    }).toPass({ timeout: 20_000 });
    proj.analysisSettings = { ...(proj.analysisSettings || {}), tau2Method: 'REML' };
    expect((await request.put(`/api/projects/${tmpProject.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    const attention = page.getByTestId('stitch-manuscript-attention');

    // The headline COUNTS, the row NAMES the section, and the chip says what changed
    // — never a bare "Updates: 1" (§34).
    await expect(attention).toContainText(/\d+ updates? needs? review/, { timeout: 25_000 });
    await expect(page.getByTestId('stitch-manuscript-attention-methods')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-attention-methods')).toContainText(/τ²|estimator|analysis|heterogeneity/i);

    // …and the number on the page is the same number on the nav badge (§34).
    const badge = (await page.getByTestId('stitch-manuscript-updates-badge').innerText()).trim();
    await expect(attention).toContainText(`${badge} update`);

    await page.getByTestId('stitch-manuscript-review-updates').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-updates')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]ms=updates/);
    await expect(page.getByTestId('stitch-manuscript-update-methods')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-update-methods')
      .getByTestId('stitch-manuscript-update-proposed')).toContainText(/restricted maximum likelihood/i);
  });

  /* ── §35 — the checklist reflects real state and jumps to the fix ──────────── */

  test('§35: the before-submission checklist is real, and its actions jump to the right destination', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateDraft(page);
    await page.getByTestId('stitch-manuscript-subtab-overview').click();

    const checklist = page.getByTestId('stitch-manuscript-checklist');
    await expect(checklist).toBeVisible({ timeout: 20_000 });
    await expect(checklist).toContainText('Before submission');
    // Real state, not decoration: this project has no PRISMA counts, and every
    // section is still exactly what the generator wrote.
    await expect(page.getByTestId('stitch-manuscript-checklist-prisma')).toContainText(/incomplete/i);
    await expect(page.getByTestId('stitch-manuscript-checklist-verify-numbers'))
      .toContainText(/auto-drafted section/i);

    // A checklist action jumps to the destination that owns the fix (§35).
    await page.getByTestId('stitch-manuscript-checklist-action-prisma').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-prisma')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]ms=prisma/);

    // …and a section-scoped action opens the Editor at that section. (Which section
    // that is depends on real state — the action names it, so the test reads it
    // rather than assuming one; the landing itself is pinned by the §31 case, which
    // types a marker into Discussion and finds it after the jump.)
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    const openSection = page.getByTestId('stitch-manuscript-checklist-action-verify-numbers');
    await expect(openSection).toContainText(/^Open \w/);
    await openSection.click();
    await expect(page.getByTestId('stitch-manuscript-subtab-editor')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]ms=editor/);
  });

  /* ── §33/§39 — connected project data + honest empty states ────────────────── */

  test('§33/§39: connected project data is named, and empty objects get real sentences (never a "0")', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateDraft(page);
    await page.getByTestId('stitch-manuscript-subtab-overview').click();

    // §33 — the manuscript says WHICH parts of the review it is reading, and when.
    const data = page.getByTestId('stitch-manuscript-data-sources');
    await expect(data).toBeVisible({ timeout: 20_000 });
    await expect(data).toContainText('Connected project data');
    for (const key of ['search', 'screening', 'extraction', 'analysis', 'prisma']) {
      await expect(page.getByTestId(`stitch-manuscript-datasource-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('stitch-manuscript-last-sync')).toContainText(/Last synchronized|Not synchronized yet/);
    // This project has no screening workspace — the page says where the number came
    // from instead of implying a live link (§69).
    await expect(page.getByTestId('stitch-manuscript-datasource-screening'))
      .toContainText(/screening workspace is not linked|Live from the screening workspace/);

    // §39 — an empty object list is a sentence, not a big card with a 0 in it.
    await expect(page.getByTestId('stitch-manuscript-object-figures'))
      .toContainText('No manuscript figures yet. Figures generated from your analysis or added manually will appear here.');
    await expect(page.getByTestId('stitch-manuscript-object-references'))
      .toContainText('References will appear as studies and citations are added.');
    await expect(overview(page)).not.toContainText('0 references');
    await expect(overview(page)).not.toContainText('0 figures');
  });

  /* ── §30/§32/§40 — readiness, structure, and the shape of the page ─────────── */

  test('§30/§32: an honest readiness percentage and a section summary that covers ALL eight sections', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await generateDraft(page);
    await page.getByTestId('stitch-manuscript-subtab-overview').click();

    // §30 — a percentage is shown only WITH its definition.
    const readiness = page.getByTestId('stitch-manuscript-readiness');
    await expect(readiness).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-readiness-pct')).toContainText(/^\d+%$/);
    await expect(readiness).toContainText(/prepared — \d+ of \d+ readiness checks complete/);
    // …and what counts is one disclosure away (§36).
    await page.getByTestId('stitch-manuscript-readiness-explain').click();
    await expect(page.getByTestId('stitch-manuscript-readiness-items')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-readiness-items')).toContainText('PRISMA counts');

    // §32 — the structure summary iterates the manuscript's own sections, including
    // the two the readiness checklist does not cover.
    for (const id of ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion']) {
      await expect(page.getByTestId(`stitch-manuscript-secrow-${id}`)).toBeVisible();
    }
    await page.getByTestId('stitch-manuscript-secrow-open-results').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-editor')).toHaveAttribute('aria-selected', 'true');

    // §40/§53 — the duplicated document controls are gone from the page body; the
    // toolbar owns them now.
    await page.getByTestId('stitch-manuscript-subtab-overview').click();
    await expect(page.getByTestId('stitch-manuscript-panel').locator('select')).toHaveCount(0);
    await expect(overview(page)).not.toContainText('Submission setup');
    // …while the real export action is still the last thing on the page (§28.8).
    await expect(page.getByTestId('stitch-manuscript-export-word')).toBeVisible();
  });
});
