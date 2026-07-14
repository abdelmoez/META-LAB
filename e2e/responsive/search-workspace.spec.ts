/**
 * search-workspace.spec.ts — 85.md responsive validation for the redesigned Search
 * workspace stages (Concepts + Terms & Vocabulary master-detail).
 *
 * Runs under the responsive device projects (mobile-chrome / tablet run e2e
 * responsive/** only) AND pins explicit viewports so the file is self-contained on
 * the default chromium project.
 *
 * Assertions per width (768 tablet portrait, 1024 small laptop):
 *   - the concept navigator, the add-term box and the strategy preview are all
 *     reachable (visible after scroll) on the Terms & Vocabulary stage;
 *   - the document body NEVER scrolls horizontally (wide content scrolls inside
 *     its own container instead).
 *
 * Flag note: searchWorkspaceV2 is GLOBAL server state — same serial beforeAll
 * ON / afterAll FORCE-OFF pattern as e2e/search/searchWorkspace.spec.ts.
 */
import { request as apiRequest, APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';
import { setFeatureFlags } from '../helpers/api';
import { BASE_URL, adminStatePath } from '../helpers/env';

const WIDTHS = [
  { w: 768, h: 1024, label: 'tablet (768)' },
  { w: 1024, h: 800, label: 'small laptop (1024)' },
];
const OVERFLOW_TOLERANCE = 2; // px — sub-pixel rounding only

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await expect
    .poll(
      async () => page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      { message: `horizontal body overflow at ${label}` },
    )
    .toBeLessThanOrEqual(OVERFLOW_TOLERANCE);
}

test.describe.serial('85.md — responsive Search workspace (searchWorkspaceV2 ON)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await apiRequest.newContext({ baseURL: BASE_URL, storageState: adminStatePath });
    await setFeatureFlags(adminCtx, { searchWorkspaceV2: true });
  });

  test.afterAll(async () => {
    try { await setFeatureFlags(adminCtx, { searchWorkspaceV2: false }); }
    finally { await adminCtx?.dispose(); }
  });

  /** Open the staged workspace's Terms stage, retrying while the flag propagates. */
  async function openTermsStage(sp: SearchPage, projectId: string): Promise<void> {
    await expect(async () => {
      await sp.shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=search&stage=terms`);
      await expect(sp.activeConcept).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  for (const bp of WIDTHS) {
    test(`terms master-detail: navigator, add box and preview reachable at ${bp.label}; no body overflow`, async ({ page, tmpProject }) => {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      const sp = new SearchPage(page);
      await openTermsStage(sp, tmpProject.id);

      // The three master-detail surfaces are all reachable.
      await expect(sp.conceptNavigator).toBeVisible();
      await sp.addTermInput.scrollIntoViewIfNeeded();
      await expect(sp.addTermInput).toBeVisible();
      await expect(sp.addTermButton).toBeVisible();
      await sp.strategyPreview.scrollIntoViewIfNeeded();
      await expect(sp.strategyPreview).toBeVisible();

      // The page body never scrolls horizontally (85.md device validation).
      await expectNoHorizontalOverflow(page, `terms @ ${bp.label}`);

      // The add box still WORKS at this width (not merely painted).
      await sp.addTermInput.scrollIntoViewIfNeeded();
      const term = `resp${bp.w}x${Date.now() % 100000}`;
      await sp.addTermToActiveConcept(term);
      await expect(sp.termChip(term)).toBeVisible();
      await expectNoHorizontalOverflow(page, `terms+chip @ ${bp.label}`);
    });

    test(`concepts stage: cards + keyword picker reachable at ${bp.label}; no body overflow`, async ({ page, tmpProject }) => {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      const sp = new SearchPage(page);
      await expect(async () => {
        await sp.shell.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=concepts`);
        await expect(sp.conceptCards).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });

      await expect(sp.keywordInput('Population')).toBeVisible();
      await sp.conceptCards.scrollIntoViewIfNeeded();
      await expect(sp.editTermsButton('Population')).toBeVisible();
      await expectNoHorizontalOverflow(page, `concepts @ ${bp.label}`);
    });
  }
});
