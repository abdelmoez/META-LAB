/**
 * searchWorkspace.spec.ts — 74.md: the staged Search Workspace's MODE-SCOPED workflow
 * (flag `searchWorkspaceV2`, OFF by default — flipped ON per test via the `setFlags`
 * fixture, which snapshots and restores the original flags on teardown).
 *
 * What 74.md demands and this spec drives end-to-end in a real browser:
 *   - the selected search mode controls the ENTIRE visible workflow: automated mode
 *     REMOVES the manual-only Database Strategies stage (renumbered 8-stage rail),
 *     manual mode never mounts the automated run surface;
 *   - switching modes updates the rail IMMEDIATELY (no reload) and never strands the
 *     user on a removed stage (Database Strategies → Test & Refine);
 *   - the choice persists server-side (single-key `searchMode` save) and is restored
 *     on reload, WITHOUT touching the strategy data built in either mode;
 *   - the mode selector is a real radio group: roving tabindex, arrow keys move both
 *     selection and focus.
 *
 * Flag note: feature flags are GLOBAL server state (same caveat as the waitlist
 * spec, and the same pattern): this describe is serial, flips the flag ON once in
 * beforeAll via a dedicated admin request context, and FORCES it back OFF in
 * afterAll — deterministic even when a mid-suite failure serial-skips the rest
 * (a per-test snapshot/restore proved fragile exactly there). CI runs
 * single-worker, so the legacy-wizard spec never observes the temporary flip.
 */
import { request as apiRequest, APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { setFeatureFlags } from '../helpers/api';
import { BASE_URL, adminStatePath } from '../helpers/env';

test.describe.serial('74.md — mode-scoped staged Search Workspace (searchWorkspaceV2 ON)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await apiRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    await setFeatureFlags(adminCtx, { searchWorkspaceV2: true });
  });

  test.afterAll(async () => {
    try { await setFeatureFlags(adminCtx, { searchWorkspaceV2: false }); }
    finally { await adminCtx?.dispose(); }
  });
  /** Open ?tab=search and wait for the STAGED workspace (not the legacy wizard). The
   *  dispatcher reads /api/settings/public once per mount, so retry the navigation
   *  until the freshly-flipped flag has propagated. */
  async function openWorkspace(sp: SearchPage, projectId: string): Promise<void> {
    await expect(async () => {
      await sp.gotoSearch(projectId);
      await expect(sp.page.getByTestId('search-workspace-rail')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  const rail = (sp: SearchPage) => sp.page.getByTestId('search-workspace-rail');
  const stageSurface = (sp: SearchPage) => sp.page.getByTestId('search-workspace-stage');
  const dbStrategiesPip = (sp: SearchPage) => rail(sp).getByRole('button', { name: /Database Strategies/ });
  const manualCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-manual');
  const automatedCard = (sp: SearchPage) => sp.page.getByTestId('search-mode-card-automated');
  const modeBadge = (sp: SearchPage) => sp.page.getByTestId('search-mode-badge');

  async function openModeStage(sp: SearchPage): Promise<void> {
    await rail(sp).getByRole('button', { name: /Search Mode/ }).click();
    await expect(manualCard(sp)).toBeVisible();
  }

  test('@smoke an undecided project renders the full 9-stage rail (Database Strategies included)', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 1 of 9')).toBeVisible();
    // No mode chosen yet → no header badge.
    await expect(modeBadge(sp)).toHaveCount(0);
  });

  test('choosing Automated instantly removes Database Strategies and renumbers the rail — and Manual restores it', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await openModeStage(sp);

    // Choose AUTOMATED — the interface updates in place (no navigation).
    await automatedCard(sp).click();
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
    await expect(page.getByText('Stage 4 of 8')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Automated search');

    // Back to MANUAL — the manual workflow returns, automated labels leave.
    await manualCard(sp).click();
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(dbStrategiesPip(sp)).toBeVisible();
    await expect(rail(sp).getByRole('button', { name: /Run Externally/ })).toBeVisible();
    await expect(page.getByText('Stage 4 of 9')).toBeVisible();
    await expect(modeBadge(sp)).toContainText('Manual search');
  });

  test('standing on Database Strategies when switching to Automated lands on Test & Refine — never a blank panel', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // With no mode chosen, walk onto the (still-available) manual-only stage; the
    // slim chooser strip rides above it.
    await dbStrategiesPip(sp).click();
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'strategy');
    const strip = page.getByTestId('mode-chooser-strip');
    await expect(strip).toBeVisible();

    // Choose Automated FROM the stage that is about to disappear.
    await strip.getByRole('button', { name: /Automated — PecanRev runs it/ }).click();

    // Immediate remap: the workspace lands on Test & Refine, the rail loses the
    // manual-only stage, and no empty panel is left behind.
    await expect(stageSurface(sp)).toHaveAttribute('data-stage', 'refine');
    // Scoped to the stage surface — the rail pip "Test & Refine" also matches this
    // text case-insensitively.
    await expect(stageSurface(sp).getByText('Test & refine')).toBeVisible();
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
    await expect(rail(sp).getByRole('button', { name: /Automated Search/ })).toBeVisible();
  });

  test('the chosen mode persists server-side and is restored on reload; strategy data survives mode flips', async ({ page, request, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);

    // Seed some MANUAL-side work first: a keyword on the Concepts stage.
    await rail(sp).getByRole('button', { name: /Concepts/ }).click();
    const term = `wsmode${Date.now()}`;
    await sp.addKeyword('Population', term);
    await expect(sp.selectedKeywordRemove(term)).toBeVisible();
    // Wait for the builder autosave to land server-side.
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return false;
        const b = await r.json().catch(() => null);
        const terms: string[] = Array.isArray(b?.concepts)
          ? b.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []))
          : [];
        return terms.includes(term);
      }, { timeout: 15_000, message: 'builder never autosaved the keyword' })
      .toBe(true);

    // Choose AUTOMATED and wait for the single-key searchMode save.
    await openModeStage(sp);
    await automatedCard(sp).click();
    await expect
      .poll(async () => {
        const r = await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`);
        if (!r.ok()) return null;
        const b = await r.json().catch(() => null);
        return b?.searchMode ?? null;
      }, { timeout: 15_000, message: 'searchMode never persisted' })
      .toBe('automated');

    // The mode flip preserved the manual-side strategy data (test req 8).
    const saved = await (await request.get(`/api/search-builder/${encodeURIComponent(tmpProject.id)}`)).json();
    const savedTerms: string[] = saved.concepts.flatMap((c: any) => (Array.isArray(c?.terms) ? c.terms.map((t: any) => t?.text) : []));
    expect(savedTerms).toContain(term);

    // Reload — the automated workflow is restored (test req 9).
    await openWorkspace(sp, tmpProject.id);
    await expect(modeBadge(sp)).toContainText('Automated search');
    await expect(dbStrategiesPip(sp)).toHaveCount(0);
  });

  test('the mode selector is a keyboard radio group: roving tabindex + arrows move selection AND focus', async ({ page, tmpProject }) => {
    const sp = new SearchPage(page);
    await openWorkspace(sp, tmpProject.id);
    await openModeStage(sp);

    // Before any choice the group has ONE tab stop: the first card.
    await expect(manualCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '-1');

    // Enter/Space and arrow behaviour.
    await manualCard(sp).focus();
    await page.keyboard.press('Enter');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(automatedCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(automatedCard(sp)).toBeFocused();
    // Roving tab stop follows the selection.
    await expect(automatedCard(sp)).toHaveAttribute('tabindex', '0');
    await expect(manualCard(sp)).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('ArrowLeft');
    await expect(manualCard(sp)).toHaveAttribute('aria-checked', 'true');
    await expect(manualCard(sp)).toBeFocused();
  });
});
