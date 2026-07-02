/**
 * projects.spec.ts — the project LIFECYCLE through the Stitch UI (authed admin).
 *
 * Covers, end-to-end via the real surfaces:
 *   - create (modal → title required guard → success toast + new card),
 *   - rename (empty guard + persists after reload),
 *   - archive ↔ restore,
 *   - delete with the exact, case-sensitive, whitespace-trimmed name confirm
 *     (button disabled until matched; cancel closes; input clears on reopen),
 *   - open a project → overview renders at /app/project/:id?tab=overview,
 *   - long names ellipsize without breaking layout,
 *   - dashboard view persists across reload.
 *
 * All MUTATING flows use the `tmpProject` fixture (or a freshly-created+cleaned
 * project) so the shared seed is never touched. Setup is seeded via the fast API
 * helpers; only the behavior under test is driven through the UI.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ProjectOverviewPage } from '../page-objects/ProjectOverviewPage';
import { listProjects, deleteProject } from '../helpers/api';

const uniqueName = (label: string) => `E2E ${label} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.describe('Dashboard renders @smoke', () => {
  test('overview shows the KPI cards and the New project action', async ({ page }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard();
    await dash.shell.expectShell();
    await expect(page.getByRole('heading', { name: 'Your research at a glance' })).toBeVisible();
    await expect(dash.newProjectButton).toBeVisible();
    for (const label of ['Active projects', 'Owned by you', 'Studies imported', 'Screening records']) {
      await expect(dash.kpiCard(label)).toBeVisible();
    }
  });
});

test.describe('Create project', () => {
  // Created-via-UI projects aren't owned by a fixture; track + clean them up.
  const created: string[] = [];
  test.afterEach(async ({ request }) => {
    if (!created.length) return;
    const all = await listProjects(request).catch(() => []);
    for (const name of created.splice(0)) {
      const hit = all.find((p) => p.name === name);
      if (hit) await deleteProject(request, hit.id);
    }
  });

  test('creating with a title + description shows a success toast and the new card', async ({ page }) => {
    const dash = new ProjectOverviewPage(page);
    const name = uniqueName('Created');
    created.push(name);
    await dash.gotoDashboard();
    await dash.createProjectViaUI(name, 'A short review question for the E2E suite.');
    // The create modal closes and the new card appears in the list (real reload).
    await expect(dash.shell.modal).toBeHidden();
    await expect(dash.card(name)).toBeVisible();
    await expect(dash.cardTitle(name)).toHaveAttribute('title', name);
  });

  test('title is required — empty and whitespace-only titles are rejected', async ({ page }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard();
    await dash.openCreateModal();

    // Empty submit → inline error, modal stays open, nothing created.
    await dash.modalButton('Create project').click();
    await expect(dash.modalError).toHaveText('Please enter a project title.');
    await expect(dash.shell.modalTitle).toHaveText('New project');

    // Whitespace-only is treated as empty (the title is trimmed).
    await dash.createTitleInput.fill('   ');
    await dash.modalButton('Create project').click();
    await expect(dash.modalError).toHaveText('Please enter a project title.');

    // A real title submits successfully and dismisses the modal.
    const name = uniqueName('Guarded');
    created.push(name);
    await dash.createTitleInput.fill(name);
    await dash.modalButton('Create project').click();
    await expect(dash.successToast('Project created')).toBeVisible();
    await expect(dash.shell.modal).toBeHidden();
  });
});

test.describe('Rename project', () => {
  test('rename persists after a reload', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    const newName = uniqueName('Renamed');
    await dash.gotoDashboard();
    await expect(dash.card(tmpProject.name)).toBeVisible();

    await dash.openRenameModal(tmpProject.name);
    await dash.renameInput.fill(newName);
    await dash.modalButton('Save').click();

    await expect(dash.successToast('Project renamed')).toBeVisible();
    await expect(dash.card(newName)).toBeVisible();
    await expect(dash.cardTitle(tmpProject.name)).toHaveCount(0);

    // The rename is durable — reload the dashboard and it survives.
    await page.reload();
    await dash.shell.expectShell();
    await expect(dash.card(newName)).toBeVisible();
    await expect(dash.cardTitle(tmpProject.name)).toHaveCount(0);
  });

  test('rename rejects an empty title', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard();
    await dash.openRenameModal(tmpProject.name);

    await dash.renameInput.fill('');
    await dash.modalButton('Save').click();
    await expect(dash.modalError).toHaveText('Title cannot be empty.');
    await expect(dash.shell.modalTitle).toHaveText('Rename project');

    // Recovering with a valid name still works.
    const newName = uniqueName('Renamed2');
    await dash.renameInput.fill(newName);
    await dash.modalButton('Save').click();
    await expect(dash.successToast('Project renamed')).toBeVisible();
    await expect(dash.card(newName)).toBeVisible();
  });
});

test.describe('Archive and restore', () => {
  test('archiving hides the project from active, then restore returns it', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    const name = tmpProject.name;
    await dash.gotoDashboard();
    await expect(dash.card(name)).toBeVisible();

    // Archive (confirmation modal → confirm).
    await dash.archiveButton(name).click();
    await expect(dash.shell.modalTitle).toHaveText('Archive project?');
    await dash.modalButton('Archive').click();
    await expect(dash.successToast('Project archived')).toBeVisible();
    await expect(dash.cardTitle(name)).toHaveCount(0); // gone from the active list

    // It now lives in the Archived view.
    await dash.gotoDashboard('archived');
    await expect(dash.card(name)).toBeVisible();

    // Restore (confirmation modal → confirm).
    await dash.restoreButton(name).click();
    await expect(dash.shell.modalTitle).toHaveText('Restore project?');
    await dash.modalButton('Restore').click();
    await expect(dash.successToast('Project restored')).toBeVisible();
    await expect(dash.cardTitle(name)).toHaveCount(0); // gone from Archived

    // Back to active.
    await dash.gotoDashboard('overview');
    await expect(dash.card(name)).toBeVisible();
  });
});

test.describe('Delete project (name-match confirm)', () => {
  test('Delete stays disabled until the typed name matches exactly (case-sensitive, trimmed)', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    const name = tmpProject.name;
    await dash.gotoDashboard();
    await dash.openDeleteModal(name);

    const confirm = dash.deleteConfirmInput;
    const deleteBtn = dash.modalButton('Delete project');

    // Empty → disabled.
    await expect(deleteBtn).toBeDisabled();

    // Wrong case → still disabled (the match is case-sensitive).
    await confirm.fill(name.toLowerCase());
    await expect(deleteBtn).toBeDisabled();

    // A partial prefix → still disabled.
    await confirm.fill(name.slice(0, Math.max(1, name.length - 3)));
    await expect(deleteBtn).toBeDisabled();

    // Exact match → enabled.
    await confirm.fill(name);
    await expect(deleteBtn).toBeEnabled();

    // Leading/trailing whitespace is trimmed, so it still matches → enabled.
    await confirm.fill(`  ${name}  `);
    await expect(deleteBtn).toBeEnabled();

    // Cancel closes the modal without deleting.
    await dash.modalButton('Cancel').click();
    await expect(dash.shell.modal).toBeHidden();
    await expect(dash.card(name)).toBeVisible(); // not deleted

    // Reopening clears the confirmation input and re-disables Delete.
    await dash.openDeleteModal(name);
    await expect(dash.deleteConfirmInput).toHaveValue('');
    await expect(dash.modalButton('Delete project')).toBeDisabled();
  });

  test('deleting with the exact name removes the project and shows a toast', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    const name = tmpProject.name;
    await dash.gotoDashboard();
    await dash.openDeleteModal(name);

    await dash.deleteConfirmInput.fill(name);
    await dash.modalButton('Delete project').click();

    await expect(dash.successToast('Project deleted')).toBeVisible();
    await expect(dash.shell.modal).toBeHidden();
    await expect(dash.cardTitle(name)).toHaveCount(0);

    // The deletion is durable across a reload (and the fixture cleanup no-ops).
    await page.reload();
    await dash.shell.expectShell();
    await expect(dash.cardTitle(name)).toHaveCount(0);
  });
});

test.describe('Open project overview', () => {
  test('@smoke clicking Open navigates to the project overview route', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard();
    await dash.openButton(tmpProject.name).click();

    await page.waitForURL(new RegExp(`/app/project/${tmpProject.id}\\b`));
    await dash.expectOverviewRendered(tmpProject.name);
  });

  test('direct /app/project/:id?tab=overview renders the overview', async ({ page, tmpProject }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoProjectOverview(tmpProject.id);
    await dash.expectOverviewRendered(tmpProject.name);
  });
});

test.describe('Long project names', () => {
  test('a long name ellipsizes on its card without breaking layout', async ({ page, request, seed }) => {
    test.skip(!seed.longNameProjectId, 'TODO: no long-name seed project (global-setup did not create one)');

    // Resolve the seeded long name by id (its exact text includes a run tag).
    const all = await listProjects(request);
    const proj = all.find((p) => p.id === seed.longNameProjectId);
    test.skip(!proj, 'TODO: long-name seed project not returned by /api/projects (archived or filtered)');
    const name = proj!.name;
    expect(name.length).toBeGreaterThan(60); // sanity: it really is a long name

    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard();
    const titleEl = dash.cardTitle(name);
    await expect(titleEl).toBeVisible();

    // The full name is preserved in the title attribute (hover tooltip / a11y).
    await expect(titleEl).toHaveAttribute('title', name);

    // It is visually clamped to one ellipsized line — not wrapped or overflowing.
    const box = await titleEl.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        overflowX: cs.overflowX,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        cardWidth: (el.closest('.stitch-fade-in') as HTMLElement | null)?.clientWidth ?? 0,
      };
    });
    expect(box.whiteSpace).toBe('nowrap');
    expect(box.textOverflow).toBe('ellipsis');
    expect(box.overflowX).toBe('hidden');
    // Truncated: the rendered text is wider than the visible box…
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
    // …and the title never overflows its card (layout stays intact).
    expect(box.clientWidth).toBeLessThanOrEqual(box.cardWidth);
  });
});

test.describe('Dashboard persistence', () => {
  test('a non-default view survives a page reload', async ({ page }) => {
    const dash = new ProjectOverviewPage(page);
    await dash.gotoDashboard('mywork');
    await expect(page).toHaveURL(/[?&]view=mywork\b/);
    await expect(page.getByRole('heading', { name: 'My Work' }).first()).toBeVisible();

    await page.reload();
    await dash.shell.expectShell();
    await expect(page).toHaveURL(/[?&]view=mywork\b/);
    await expect(page.getByRole('heading', { name: 'My Work' }).first()).toBeVisible();
  });
});
