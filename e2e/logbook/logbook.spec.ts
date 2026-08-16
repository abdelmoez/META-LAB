/**
 * logbook.spec.ts — 119.md §8 "Add a comprehensive project Logbook".
 *
 * Proves BOTH sides of the rule "Only the project's Owner and Leader may view the
 * Logbook", driven through real browser sessions:
 *
 *   ALLOW  — the owner opens the Logbook from Project Control, sees real recorded
 *            activity, filters it, expands an event's before/after details, switches
 *            to compact table mode, and downloads the CSV/JSON exports.
 *   DENY   — a member (reviewer) gets NO nav entry, an access card instead of the
 *            Logbook when they hand-type ?tab=logbook, and a 403 from the API and
 *            the export endpoint. A leader-role member is allowed, so the boundary
 *            is proven to be LEADERSHIP and not "is the owner".
 *
 * The project is built inline (rather than via the projectWithMembers fixture)
 * because the deny side needs a member with a REAL browser session — the seeded
 * `normal` user — and the allow-a-leader side needs the seeded `mod` user.
 */
import { test, expect } from '../fixtures/stitch-test';
import { createProject, deleteProject, ensureScreeningWorkspace, addProjectMember } from '../helpers/api';

test.describe('Project Logbook — Owner/Leader only (119.md §8)', () => {
  let projectId = '';

  test.afterEach(async ({ request }) => {
    if (projectId) { await deleteProject(request, projectId).catch(() => {}); projectId = ''; }
  });

  /** Create an admin-owned project whose members include the seeded mod (leader) and normal (reviewer). */
  async function seedProject(request: any, seed: any) {
    const p = await createProject(request, `E2E Logbook ${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
    projectId = p.id;
    const siftId = await ensureScreeningWorkspace(request, p.id);
    // Each add is itself a logged event (MEMBER_ADDED) → the Logbook is never empty.
    if (seed.mod) await addProjectMember(request, siftId, { email: seed.mod.email, preset: 'leader' });
    if (seed.normal) await addProjectMember(request, siftId, { email: seed.normal.email, preset: 'reviewer' });
    return { project: p, siftId };
  }

  test('the owner opens the Logbook from Project Control, filters, expands and exports @smoke', async ({ page, request, seed }) => {
    const { project } = await seedProject(request, seed);

    // ── nav visibility: the entry exists for the owner ────────────────────────
    await page.goto(`/app/project/${project.id}?tab=control`);
    const entry = page.getByTestId('logbook-nav-entry');
    await expect(entry).toBeVisible();
    await entry.click();

    const pageRoot = page.getByTestId('logbook-page');
    await expect(pageRoot).toBeVisible();
    await expect(page.getByText('Owner and leaders only')).toBeVisible();
    // §8 "Clear timezone display".
    await expect(page.getByTestId('logbook-timezone')).toContainText('Times are shown in your timezone');

    // ── real recorded activity (member additions were logged) ─────────────────
    await expect(page.getByTestId('logbook-timeline')).toBeVisible();
    const rows = page.locator('[data-testid^="logbook-event-"]');
    await expect(rows.first()).toBeVisible();
    const totalBefore = await rows.count();
    expect(totalBefore).toBeGreaterThan(0);

    // ── expandable details with before/after ──────────────────────────────────
    const firstId = (await rows.first().getAttribute('data-testid'))!.replace('logbook-event-', '');
    await page.getByTestId(`logbook-expand-${firstId}`).click();
    await expect(page.getByTestId(`logbook-details-${firstId}`)).toBeVisible();
    await expect(page.getByTestId(`logbook-when-${firstId}`)).toContainText('UTC');

    // ── search + filters round-trip to the server ─────────────────────────────
    await page.getByTestId('logbook-filter-engine').selectOption('core');
    await expect(page.getByTestId('logbook-timeline')).toBeVisible();
    await expect(rows.first()).toBeVisible();

    // A filter that cannot match anything gives the honest filtered empty state.
    await page.getByTestId('logbook-search').fill('zzz-no-such-event-zzz');
    await expect(page.getByTestId('logbook-empty')).toBeVisible();
    await expect(page.getByTestId('logbook-empty')).toContainText('No events match these filters');
    await page.getByTestId('logbook-clear-filters').click();
    await expect(rows.first()).toBeVisible();

    // ── member-focused view (§8 "everything a selected member did") ───────────
    // Clearing the filters collapsed every row, so re-expand before reaching for
    // the in-details focus action.
    const topId = (await rows.first().getAttribute('data-testid'))!.replace('logbook-event-', '');
    await page.getByTestId(`logbook-expand-${topId}`).click();
    await page.getByTestId(`logbook-focus-member-${topId}`).click();
    await expect(page.getByTestId('logbook-focus-banner')).toContainText('Everything');
    await page.getByTestId('logbook-focus-clear').click();
    await expect(page.getByTestId('logbook-focus-banner')).toHaveCount(0);

    // ── compact table mode shows the same events ──────────────────────────────
    await page.getByTestId('logbook-mode-table').click();
    await expect(page.getByTestId('logbook-table')).toBeVisible();
    await expect(page.locator('[data-testid^="logbook-row-"]').first()).toBeVisible();
    await page.getByTestId('logbook-mode-timeline').click();
    await expect(page.getByTestId('logbook-timeline')).toBeVisible();

    // ── exports hit the authz'd endpoint and really download ──────────────────
    const csvHref = await page.getByTestId('logbook-export-csv').getAttribute('href');
    expect(csvHref).toContain(`/api/logbook/projects/${project.id}/export`);
    expect(csvHref).toContain('format=csv');
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('logbook-export-csv').click(),
    ]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('logbook-export-json').click(),
    ]);
    expect(jsonDl.suggestedFilename()).toMatch(/\.json$/);
  });

  test('a leader-role member is allowed — the boundary is leadership, not ownership', async ({ request, seed, modContext }) => {
    test.skip(!seed.mod, 'no seeded mod session in this run');
    const { project } = await seedProject(request, seed);

    const { page: modPage, request: modRequest } = modContext;
    await modPage.goto(`/app/project/${project.id}?tab=control`);
    await expect(modPage.getByTestId('logbook-nav-entry')).toBeVisible();

    await modPage.goto(`/app/project/${project.id}?tab=logbook`);
    await expect(modPage.getByTestId('logbook-page')).toBeVisible();
    await expect(modPage.getByTestId('logbook-denied')).toHaveCount(0);

    const res = await modRequest.get(`/api/logbook/projects/${project.id}/events?limit=5`);
    expect(res.status()).toBe(200);
  });

  test('a member/reviewer gets NO nav entry, no page, and a refused API @smoke', async ({ request, seed, normalContext }) => {
    test.skip(!seed.normal, 'no seeded normal-user session in this run');
    const { project } = await seedProject(request, seed);

    const { page: memberPage, request: memberRequest } = normalContext;

    // 1. NAVIGATION VISIBILITY — the entry is not rendered at all (not disabled).
    await memberPage.goto(`/app/project/${project.id}?tab=control`);
    await expect(memberPage.getByRole('heading', { name: 'Project Control' })).toBeVisible();
    await expect(memberPage.getByTestId('logbook-nav-entry')).toHaveCount(0);

    // 2. DIRECT URL — hand-typing the stage gives the access card, never the Logbook.
    await memberPage.goto(`/app/project/${project.id}?tab=logbook`);
    await expect(memberPage.getByTestId('logbook-denied')).toBeVisible();
    await expect(memberPage.getByTestId('logbook-page')).toHaveCount(0);
    await expect(memberPage.getByTestId('logbook-timeline')).toHaveCount(0);
    await expect(memberPage.getByText('The Logbook is limited to the project owner and leaders.')).toBeVisible();

    // 3. DIRECT API — the events, facets and export endpoints all refuse, with no body.
    for (const path of ['events?limit=5', 'facets', 'export?format=csv', 'export?format=json']) {
      const res = await memberRequest.get(`/api/logbook/projects/${project.id}/${path}`);
      expect(res.status(), `GET /${path} must refuse a member`).toBe(403);
      const body = await res.text();
      expect(body).not.toContain('MEMBER_ADDED');
      expect(body).not.toContain('"events"');
    }
  });
});
