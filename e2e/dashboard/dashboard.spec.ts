/**
 * dashboard.spec.ts — the Stitch dashboard hub (route `/app`, StitchDashboard.jsx).
 *
 * Authenticated as the seeded admin (Stitch). The dashboard is a single hub with
 * several real `?view=` surfaces (overview / mywork / activity / invitations /
 * archived / resources) plus the overview's KPI cards, project filters, search and
 * recently-updated bento. global-setup seeds ≥4 admin-owned projects (a seed
 * project, a long-name project and two extras) so the list is always populated.
 *
 * Scope (this author): the dashboard read surfaces + view switching + filtering +
 * search + ordering + empty states. Project CRUD (create/rename/archive/delete
 * modals) belongs to the projects author and is intentionally NOT covered here.
 */
import { test, expect } from '../fixtures/stitch-test';
import { DashboardPage, KPI_LABELS, FILTER_LABELS } from '../page-objects/DashboardPage';
import * as api from '../helpers/api';

test.describe('Dashboard — overview & KPIs', () => {
  test('@smoke default /app renders the overview with all KPI cards', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.open('overview');

    // Overview is the bare /app route (no ?view=).
    await expect(page).toHaveURL(/\/app$/);
    await dash.nav.expectShell();
    await expect(dash.pageHeading).toHaveText(/^Your research at a glance$/);

    // All four KPI metric cards render…
    for (const label of KPI_LABELS) await expect(dash.kpiCard(label)).toBeVisible();
    // …and reflect the populated workspace with a real numeric value.
    expect(await dash.kpiValue('Active projects')).toBeGreaterThanOrEqual(1);

    // The recently-updated bento is part of the overview.
    await expect(dash.recentlyUpdatedHeading).toBeVisible();
  });
});

test.describe('Dashboard — view switching', () => {
  test('@smoke the dashboard menu switches views and updates ?view=', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.open('overview');

    // My Work
    await dash.clickMenu('My Work');
    await expect(page).toHaveURL(/\/app\?view=mywork$/);
    await expect(dash.pageHeading).toHaveText(/^My Work$/);
    await expect(dash.menuItem('My Work')).toHaveAttribute('aria-current', 'page');

    // Invitations (the menu item name may carry a pending-count badge → RegExp).
    await dash.clickMenu(/^Invitations/);
    await expect(page).toHaveURL(/\/app\?view=invitations$/);
    await expect(dash.pageHeading).toHaveText(/^Invitations$/);

    // Archived Projects
    await dash.clickMenu('Archived Projects');
    await expect(page).toHaveURL(/\/app\?view=archived$/);
    await expect(dash.pageHeading).toHaveText(/^Archived Projects$/);

    // Resources
    await dash.clickMenu('Resources');
    await expect(page).toHaveURL(/\/app\?view=resources$/);
    await expect(dash.pageHeading).toHaveText(/^Resources$/);

    // Back to overview — returns to the bare /app route and the KPI cards reappear.
    await dash.clickMenu('Workspace Overview');
    await expect(page).toHaveURL(/\/app$/);
    await expect(dash.pageHeading).toHaveText(/^Your research at a glance$/);
    await expect(dash.kpiCard('Active projects')).toBeVisible();
  });

  test('the selected dashboard view persists across a full reload', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.open('mywork'); // navigates to /app?view=mywork
    await expect(dash.pageHeading).toHaveText(/^My Work$/);

    await page.reload();
    await dash.nav.expectStitch();

    // readView() derives the active view from the URL, so a reload keeps it.
    await expect(page).toHaveURL(/\/app\?view=mywork$/);
    await expect(dash.pageHeading).toHaveText(/^My Work$/);
  });
});

test.describe('Dashboard — project filtering & search', () => {
  test('project search filters the grid by name and shows the no-match empty state', async ({ page, tmpProject }) => {
    const dash = new DashboardPage(page);
    await dash.open('overview');

    // The freshly-created throwaway project is in the list.
    await expect(dash.cardTitle(tmpProject.name)).toHaveCount(1);

    // Searching its unique name narrows the grid to exactly that project.
    await dash.search(tmpProject.name);
    await expect(dash.openButtons).toHaveCount(1);
    await expect(dash.cardTitles).toHaveCount(1);
    await expect(dash.cardTitles.first()).toHaveAttribute('title', tmpProject.name);

    // A term that matches nothing shows the "No matching projects" empty state.
    await dash.search('zzz-pecanrev-no-such-project-zzz');
    await expect(dash.openButtons).toHaveCount(0);
    await expect(dash.noMatchEmpty).toBeVisible();
    await expect(dash.noMatchDesc).toBeVisible();

    // Clearing the search restores the project.
    await dash.clearSearch();
    await expect(dash.cardTitle(tmpProject.name)).toHaveCount(1);
  });

  test('status/role filters narrow the grid consistently with their counts', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.open('overview');

    // "All" is the default filter; the grid shows every non-archived project and the
    // chip's count matches the number of cards (both derive from the same state).
    const allCount = await dash.filterCount('All');
    expect(allCount).toBeGreaterThanOrEqual(1); // seed populates the workspace
    await expect(dash.openButtons).toHaveCount(allCount);

    // Each filter shows exactly as many cards as its chip count advertises; a filter
    // that matches nothing surfaces the "No matching projects" empty state.
    for (const label of FILTER_LABELS) {
      await dash.clickFilter(label);
      const c = await dash.filterCount(label);
      if (c === 0) {
        await expect(dash.openButtons).toHaveCount(0);
        await expect(dash.noMatchEmpty).toBeVisible();
      } else {
        await expect(dash.openButtons).toHaveCount(c);
      }
    }

    // Role filter: the admin owns the seed projects, so "Owned by me" is non-empty.
    await dash.clickFilter('Owned by me');
    const owned = await dash.filterCount('Owned by me');
    expect(owned).toBeGreaterThanOrEqual(1);
    await expect(dash.openButtons).toHaveCount(owned);
  });
});

test.describe('Dashboard — recency ordering', () => {
  test('the project grid lists the most recently updated project first', async ({ page, request }) => {
    // Two own-created projects with a shared unique token; NEWER is created last so
    // its updatedAt is the most recent (sequential awaited POSTs → distinct ms).
    const token = `E2E-Recency-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const olderId = (await api.createProject(request, `${token} OLDER`)).id;
    const newerId = (await api.createProject(request, `${token} NEWER`)).id;
    try {
      const dash = new DashboardPage(page);
      await dash.open('overview');

      // Narrow the grid to just these two via the shared token.
      await dash.search(token);
      await expect(dash.cardTitles).toHaveCount(2);

      // The grid sorts by updatedAt descending → NEWER renders before OLDER.
      await expect(dash.cardTitles.first()).toHaveAttribute('title', `${token} NEWER`);
      await expect(dash.cardTitles.last()).toHaveAttribute('title', `${token} OLDER`);
    } finally {
      await api.deleteProject(request, olderId);
      await api.deleteProject(request, newerId);
    }
  });
});
