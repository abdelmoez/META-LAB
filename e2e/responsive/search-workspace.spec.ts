/**
 * search-workspace.spec.ts — 85.md + 96.md responsive validation for the central
 * Terms & Vocabulary workspace (question phrase card + master-detail + preview).
 *
 * Runs under the responsive device projects (mobile-chrome / tablet run e2e
 * responsive/** only) AND pins explicit viewports so the file is self-contained on
 * the default chromium project.
 *
 * 96.md — the workspace renders whenever `searchEngine` is ON (global-setup enables
 * it); no searchWorkspaceV2 flag flipping any more. New projects seed EMPTY, so each
 * test creates its concept group via the question card's manual add box first.
 *
 * Assertions per width (768 tablet portrait, 1024 small laptop):
 *   - the question card, concept navigator, add-term box and strategy preview are
 *     all reachable (visible after scroll) on the Terms & Vocabulary stage;
 *   - the document body NEVER scrolls horizontally (wide content scrolls inside
 *     its own container instead);
 *   - a retired ?stage=concepts deep link lands on Terms & Vocabulary.
 */
import { type Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';

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

test.describe('96.md — responsive Terms & Vocabulary workspace', () => {
  /** Open Terms & Vocabulary (retry while flags propagate) and seed one group. */
  async function openTermsWithGroup(sp: SearchPage, projectId: string, label: string): Promise<void> {
    await sp.gotoStage(projectId, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.addConceptGroup(label);
    await expect(sp.activeConcept).toBeVisible();
  }

  for (const bp of WIDTHS) {
    test(`terms workspace: question card, navigator, add box and preview reachable at ${bp.label}; no body overflow`, async ({ page, tmpProject }) => {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      const sp = new SearchPage(page);
      await openTermsWithGroup(sp, tmpProject.id, 'asthma');

      // The workspace surfaces are all reachable.
      await expect(sp.questionCard).toBeVisible();
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

    test(`retired ?stage=concepts deep link lands on terms at ${bp.label}; no body overflow`, async ({ page, tmpProject }) => {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      const sp = new SearchPage(page);
      await expect(async () => {
        await sp.shell.goto(`/app/project/${encodeURIComponent(tmpProject.id)}?tab=search&stage=concepts`);
        await expect(sp.stageSurface).toHaveAttribute('data-stage', 'terms', { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });

      await expect(sp.questionCard).toBeVisible();
      await expectNoHorizontalOverflow(page, `alias-redirect @ ${bp.label}`);
    });
  }
});
