/**
 * manuscript-prisma-sync.spec.ts — 117.md §12/§14/§18/§21/§57/§90.
 *
 * §14 is a statement about TWO SCREENS: "If Screening shows 2,481 records
 * identified … Manuscript Editor must show the same values." No unit test can
 * assert that, because the defect lived in the wiring between the hook, the
 * fetched flow and the counts adapter — every pure part was already correct. So
 * this spec drives the real app against a real screening workspace and compares
 * the Manuscript Editor's PRISMA tab against the canonical flow endpoint that
 * Screening itself renders.
 *
 * It also covers the §21 override contract end to end (both numbers visible, a
 * per-field revert, the §22 audit line) because that is a multi-write flow whose
 * value is in the round trip through autosave, not in any single function.
 */
import { test, expect } from '../fixtures/stitch-test';
import * as api from '../helpers/api';

/** The canonical flow — the SAME payload the Screening PRISMA tab draws from. */
async function canonicalFlow(request: import('@playwright/test').APIRequestContext, siftId: string) {
  const res = await request.get(`/api/screening/projects/${encodeURIComponent(siftId)}/prisma`);
  expect(res.ok(), `GET /prisma failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body as { flow: any; reconciliation: any; empty: boolean };
}

async function openManuscriptPrisma(page: import('@playwright/test').Page, projectId: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stitch-manuscript-subtab-prisma').click();
}

/**
 * The "n" cell of one stage row in the PRISMA counts table.
 * The label is matched as a LITERAL: "Records excluded (screening)" is a real stage
 * name, and interpolating it raw made "(screening)" a regex group — the anchored
 * pattern then only matched a label without the brackets, i.e. nothing on the page.
 */
function stageRow(page: import('@playwright/test').Page, stage: string) {
  const literal = stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('tr', { has: page.locator('td', { hasText: new RegExp(`^${literal}$`) }) }).first();
}

test.describe('Manuscript PRISMA is a synchronized view of the canonical flow', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  test('§14 — the counts the editor reports ARE the flow endpoint\'s counts', async ({ page, request, screeningProject }) => {
    const { project, siftId } = screeningProject;

    // A deliberately STALE legacy blob — exactly what MetaSiftPrismaSync stamps in.
    // Before 117.md the manuscript preferred this forever; now the flow outranks it.
    const proj = await (await request.get(`/api/projects/${project.id}`)).json();
    proj.prisma = { dbs: '999', reg: '0', other: '0', dedupe: '111', excTA: '222', excFull: '33', reasons: [], included: '44', quant: '44' };
    expect((await request.put(`/api/projects/${project.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    const { flow, empty } = await canonicalFlow(request, siftId);
    expect(empty).toBeFalsy();
    const identified = flow.boxes.identified_db.n + flow.boxes.identified_other.n;
    const included = flow.boxes.included_studies.n;
    const reports = flow.boxes.included_reports.n;

    await openManuscriptPrisma(page, project.id);

    // The record-derived totals, not the blob's.
    await expect(stageRow(page, 'Records identified')).toContainText(String(identified));
    await expect(stageRow(page, 'Studies included in review')).toContainText(String(included));
    await expect(page.getByText('999', { exact: true })).toHaveCount(0);

    // §15 — the retrieval stage and the reports/studies split only exist on the
    // canonical path, and they are what the legacy counter model could not report.
    await expect(stageRow(page, 'Reports sought for retrieval')).toBeVisible();
    await expect(stageRow(page, 'Reports not retrieved')).toBeVisible();
    await expect(stageRow(page, 'Reports of included studies')).toContainText(String(reports));

    // Every count is a record set, so the Source column says so.
    await expect(stageRow(page, 'Records identified')).toContainText('records');
  });

  test('§12/§57 — the editor draws the SAME two-column PRISMA 2020 figure as Screening', async ({ page, screeningProject }) => {
    const { project } = screeningProject;
    await openManuscriptPrisma(page, project.id);

    const figure = page.locator('svg').filter({ hasText: 'Identification of studies via databases and registers' }).first();
    await expect(figure).toBeVisible({ timeout: 20_000 });
    // The legacy single-column builder has no other-methods column and no
    // retrieval boxes — their presence proves which builder ran.
    await expect(page.locator('svg [data-box="sought_db"]').first()).toBeAttached();
    await expect(page.locator('svg [data-box="included_reports"], svg [data-box="included_studies"]').first()).toBeAttached();
  });

  test('§21/§22 — an override shows both numbers, reverts, and is audited', async ({ page, request, screeningProject }) => {
    const { project, siftId } = screeningProject;
    const { flow } = await canonicalFlow(request, siftId);
    const autoIdentified = flow.boxes.identified_db.n + flow.boxes.identified_other.n;

    await openManuscriptPrisma(page, project.id);

    const field = page.getByTestId('prisma-override-identified');
    await expect(field).toBeVisible();
    const input = field.locator('input');
    await input.fill(String(autoIdentified + 5));
    await input.blur();

    // §21 — "Automated value: N → Manual override: M", never a silent replacement.
    await expect(field).toContainText('Automated value:');
    await expect(field).toContainText(String(autoIdentified));
    await expect(field).toContainText('Manual override:');
    await expect(field).toContainText(String(autoIdentified + 5));

    // The counts table follows the override, and labels it as one.
    await expect(stageRow(page, 'Records identified')).toContainText(String(autoIdentified + 5));
    await expect(stageRow(page, 'Records identified')).toContainText('override');

    // §22 — the change is recorded with the automated value it displaced.
    await expect(page.getByTestId('prisma-override-log')).toBeVisible();
    await expect(page.getByTestId('prisma-override-log')).toContainText('Records identified');

    // §21 — revert to automatic restores the derived number exactly.
    await field.getByRole('button', { name: 'Revert to automatic' }).click();
    await expect(field).not.toContainText('Manual override:');
    await expect(stageRow(page, 'Records identified')).toContainText(String(autoIdentified));
    await expect(stageRow(page, 'Records identified')).toContainText('records');

    // The override SURVIVES a reload as a revert (it was persisted, not local state).
    await page.reload();
    await page.getByTestId('stitch-manuscript-subtab-prisma').click();
    await expect(stageRow(page, 'Records identified')).toContainText(String(autoIdentified));
  });

  /**
   * §13 — "changes anywhere affecting PRISMA must automatically propagate… no
   * refresh button".
   *
   * The decision is issued by a SECOND reviewer, and that is not incidental: the
   * realtime bus deliberately EXCLUDES the acting user from `decision.saved`
   * (`emitToProjectMembers(..., { exclude: req.user.id })`), because the surface
   * that made the change already shows it. A decision issued from this browser's
   * own session would therefore emit no frame to this browser at all, and the only
   * thing left to catch it would be the 20 s `visibilitychange` throttle the hook
   * keeps for the same-user second-tab case — so a test that decided as itself
   * would be asserting that fallback (or nothing), never the propagation §13 is
   * about. A collaborator screening while the author drafts is also the honest
   * shape of the requirement.
   */
  test('§13 — a screening decision propagates without a refresh button', async ({ page, request, screeningProject, normalContext }) => {
    const { project, siftId } = screeningProject;
    await openManuscriptPrisma(page, project.id);

    /* The counts TABLE reports project-level scalars (`flow.counts.*`), not the
       drawn boxes. The difference is load-bearing here: PRISMA 2020 gives the
       other-methods column no "records screened"/"records excluded" box, so
       `boxes.excluded_screening` is DATABASE-ARM ONLY — and the fixture's records
       come from a bare RIS upload with no declared database, i.e. the other arm.
       Reading the box would watch a number that is 0 before and after, whoever
       decides. `counts.excludedScreen` is the both-arms figure the row renders. */
    const excludedScreen = async () => (await canonicalFlow(request, siftId)).flow.counts.excludedScreen;
    const before = await excludedScreen();
    await expect(stageRow(page, 'Records excluded (screening)')).toContainText(String(before));

    // A second reviewer joins the screening workspace (the screening.spec.ts pattern).
    const second = await api.me(normalContext.request);
    expect(second?.email, 'the seeded normal user must be resolvable').toBeTruthy();
    await api.addProjectMember(request, siftId, { email: second!.email, preset: 'reviewer' });

    // They exclude one record through the real domain action (never a direct DB poke).
    const list = await (await request.get(`/api/screening/projects/${encodeURIComponent(siftId)}/records?limit=1`)).json();
    const rid = (list.records || [])[0]?.id;
    expect(rid, 'no screening record to decide on').toBeTruthy();
    const dec = await normalContext.request.post(`/api/screening/projects/${encodeURIComponent(siftId)}/records/${encodeURIComponent(rid)}/decision`, {
      data: { decision: 'exclude', stage: 'title_abstract' },
    });
    expect(dec.ok(), `saveDecision failed: ${dec.status()}`).toBeTruthy();
    // The canonical flow really did move — otherwise the assertion below could pass
    // for the wrong reason (or fail for a counting reason, not a delivery one).
    await expect.poll(excludedScreen, { timeout: 15_000 }).toBe(before + 1);

    // No reload, no refresh control: the SSE poke → debounced source refetch.
    // Generous timeout — the client debounce is ~2s on top of delivery.
    await expect(stageRow(page, 'Records excluded (screening)')).toContainText(String(before + 1), { timeout: 30_000 });
  });
});
