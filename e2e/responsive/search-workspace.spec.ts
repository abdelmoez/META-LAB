/**
 * search-workspace.spec.ts — 85.md + 96.md + 98.md responsive validation for the
 * central Select & Build Key Terms workspace (question phrase card + the 98.md §9
 * horizontal CONCEPT BOARD + preview).
 *
 * Runs under the responsive device projects (mobile-chrome / tablet run e2e
 * responsive/** only) AND pins explicit viewports so the file is self-contained on
 * the default chromium project.
 *
 * 96.md — the workspace renders whenever `searchEngine` is ON (global-setup enables
 * it); no searchWorkspaceV2 flag flipping any more. New projects seed EMPTY, so each
 * test creates its concept via the question card's manual add box first.
 *
 * Assertions per width (768 tablet portrait, 1024 small laptop):
 *   - the question card, concept board, add-term box and strategy preview are
 *     all reachable (visible after scroll) on the terms stage;
 *   - the document body NEVER scrolls horizontally (wide content scrolls inside
 *     its own container instead);
 *   - a retired ?stage=concepts deep link lands on the terms stage.
 *
 * 98.md §9 — the board flex-WRAPS by viewport width (no horizontal-scroll-only
 * path): at a wide viewport two compact concept cards share one row; at a narrow
 * width they stack (compared via boundingBox y).
 */
import { type Locator, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { SearchPage } from '../page-objects/SearchPage';

const WIDTHS = [
  { w: 768, h: 1024, label: 'tablet (768)' },
  { w: 1024, h: 800, label: 'small laptop (1024)' },
];
const OVERFLOW_TOLERANCE = 2; // px — sub-pixel rounding only

/* 110 review (F3) — the canvas hierarchy is PERCEPTUAL, so it has to be asserted
   numerically. `expect(a).not.toBe(b)` on two getComputedStyle colour strings
   passes on rgb(26,29,38) vs rgb(26,28,37): different strings, one surface. The
   floor below is a channel-sum |Δr|+|Δg|+|Δb|; the weakest shipped combination
   (Stitch light, --t-bg #f7f9ff against --t-card #ffffff) sits at 14, so 12 is
   the tightest bar every theme × design-system pair can actually clear. */
const MIN_SURFACE_DELTA = 12;

function parseRgb(value: string): [number, number, number] {
  const nums = value.match(/-?[\d.]+/g);
  if (!nums || nums.length < 3) throw new Error(`unparseable computed colour: ${value}`);
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

/** Total sRGB channel distance between two computed `backgroundColor` strings. */
function channelDelta(a: string, b: string): number {
  const [ar, ag, ab] = parseRgb(a);
  const [br, bg, bb] = parseRgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

/** Read `backgroundColor` once the .22s cross-fade has settled (3 identical samples). */
async function settledBg(loc: Locator, label: string): Promise<string> {
  let last = '';
  let stable = -1;
  await expect
    .poll(async () => {
      const now = await loc.evaluate((el) => getComputedStyle(el).backgroundColor);
      stable = now === last ? stable + 1 : 0;
      last = now;
      return stable;
    }, { message: `${label} background-color settles after the .22s cross-fade` })
    .toBeGreaterThanOrEqual(2);
  return last;
}

/** Flip the app palette exactly the way tokens.js `applyTheme()` does — the
 *  <html> attribute, the localStorage key ThemeProvider reads, and the
 *  out-of-band event it listens for, so React state and the DOM stay in step. */
async function setTheme(page: Page, theme: 'day' | 'night'): Promise<void> {
  await page.evaluate((t) => {
    try { window.localStorage.setItem('metalab_theme', t); } catch { /* private mode */ }
    document.documentElement.dataset.theme = t;
    window.dispatchEvent(new CustomEvent('metalab:theme-change', { detail: t }));
  }, theme);
  await expect.poll(async () => page.locator('html').getAttribute('data-theme')).toBe(theme);
}

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

test.describe('96.md/98.md — responsive Select & Build Key Terms workspace', () => {
  /** Open the terms stage (retry while flags propagate) and seed one concept. */
  async function openTermsWithGroup(sp: SearchPage, projectId: string, label: string): Promise<void> {
    await sp.gotoStage(projectId, 'terms');
    await expect(sp.questionCard).toBeVisible();
    await sp.addConceptGroup(label);
    await expect(sp.activeConcept).toBeVisible();
  }

  for (const bp of WIDTHS) {
    test(`terms workspace: question card, concept board, add box and preview reachable at ${bp.label}; no body overflow`, async ({ page, tmpProject }) => {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      const sp = new SearchPage(page);
      await openTermsWithGroup(sp, tmpProject.id, 'asthma');

      // The workspace surfaces are all reachable (98.md §9 — the board replaced
      // the master-detail navigator).
      await expect(sp.questionCard).toBeVisible();
      await expect(sp.conceptBoard).toBeVisible();
      await sp.addTermInput.scrollIntoViewIfNeeded();
      await expect(sp.addTermInput).toBeVisible();
      await expect(sp.addTermButton).toBeVisible();
      await sp.searchMeaning.scrollIntoViewIfNeeded();
      await expect(sp.searchMeaning).toBeVisible();

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

  test('98.md §9/§22 — the concept board WRAPS: two compact cards share a row at a wide viewport and stack at a narrow one', async ({ page, tmpProject }) => {
    // Three concepts → the last-created card is ACTIVE (full row); the first two
    // render compact and are the wrap subjects.
    await page.setViewportSize({ width: 1280, height: 900 });
    const sp = new SearchPage(page);
    await openTermsWithGroup(sp, tmpProject.id, 'asthma');
    await sp.addConceptGroup('salbutamol');
    await sp.addConceptGroup('hospital admission');
    await expect(sp.activeConcept.getByLabel(/Concept name/)).toHaveValue('hospital admission');
    await expect(sp.compactCards).toHaveCount(2);
    // The AND connectors join the chain (one LEADS each non-first card).
    await expect(sp.andConnectors).toHaveCount(2);

    // WIDE: the two compact cards sit side by side on ONE row.
    await sp.conceptBoard.scrollIntoViewIfNeeded();
    const wideA = await sp.compactCards.nth(0).boundingBox();
    const wideB = await sp.compactCards.nth(1).boundingBox();
    if (!wideA || !wideB) throw new Error('compact cards have no bounding boxes at 1280px');
    expect(Math.abs(wideA.y - wideB.y)).toBeLessThanOrEqual(2);
    await expectNoHorizontalOverflow(page, 'board @ wide (1280)');

    // NARROW: the same cards STACK (flex-wrap — never a horizontal-scroll path).
    await page.setViewportSize({ width: 480, height: 900 });
    await sp.conceptBoard.scrollIntoViewIfNeeded();
    await expect(sp.compactCards).toHaveCount(2);
    const narrowA = await sp.compactCards.nth(0).boundingBox();
    const narrowB = await sp.compactCards.nth(1).boundingBox();
    if (!narrowA || !narrowB) throw new Error('compact cards have no bounding boxes at 480px');
    expect(narrowB.y).toBeGreaterThan(narrowA.y + narrowA.height - 2);
    await expectNoHorizontalOverflow(page, 'board @ narrow (480)');
  });
  /* 110.md §2 — the Concepts BUILD CANVAS.
     The Concepts area is the Search Engine's centrepiece and must read as a
     WORKSPACE, not as another informational card. The contract is structural
     (a frame that wraps the board without touching it) and perceptual (the
     canvas plane, the cards raised on it, and the de-emphasis of the cards
     that are not open must all be genuinely different computed surfaces —
     a stylesheet regression that flattens them would otherwise pass every
     testid assertion in the suite). Executed under the chromium project in the
     110.md round, where it caught the --t-surf/--t-card token collision on its
     first live run; the perceptual half was re-armed with numeric deltas in the
     110-review round (see MIN_SURFACE_DELTA). */
  test('110.md §2 — the board sits on a build canvas: distinct plane, elevated open card, de-emphasis that follows expand/collapse, no overflow', async ({ page, tmpProject }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sp = new SearchPage(page);
    await openTermsWithGroup(sp, tmpProject.id, 'asthma');
    await sp.addConceptGroup('salbutamol');

    const canvas = page.getByTestId('sb-concept-workspace');
    await expect(canvas).toBeVisible();
    // The frame WRAPS the board — the board keeps its own element and testid
    // (it is the click-outside exemption selector and every e2e locator).
    await expect(canvas.getByTestId('sb-concept-board')).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Concepts' })).toBeVisible();
    await expect(canvas.getByTestId('sb-canvas-count')).toHaveText('2 concepts');

    // HIERARCHY: the canvas plane and the cards ON it are different surfaces,
    // and the open card is elevated off the plane.
    const canvasBg = await canvas.evaluate((el) => getComputedStyle(el).backgroundColor);
    const openBg = await settledBg(sp.activeConcept, 'the open card');
    // 110 review (F3) — a numeric floor, not string inequality: two surfaces one
    // rgb unit apart are different STRINGS and the same SURFACE.
    expect(channelDelta(openBg, canvasBg),
      `the canvas plane (${canvasBg}) and the card on it (${openBg}) must be different surfaces`)
      .toBeGreaterThanOrEqual(MIN_SURFACE_DELTA);
    const openShadow = await sp.activeConcept.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(openShadow).not.toBe('none');

    // The newest concept is open, so the canvas advertises the de-emphasis state
    // and the inactive card settles back toward the plane (its own surface).
    // NB: the emphasis swap is a .22s background-color TRANSITION (that is the
    // "subtle and smooth" part of the contract), so every surface read after a
    // state change must poll — a bare read lands on an intermediate colour.
    await expect(canvas).toHaveAttribute('data-has-active', 'true');
    const dimBg = await settledBg(sp.compactCards.nth(0), 'the de-emphasised card');
    expect(channelDelta(openBg, dimBg),
      `the open card (${openBg}) and the de-emphasised card (${dimBg}) must be different surfaces`)
      .toBeGreaterThanOrEqual(MIN_SURFACE_DELTA);

    // Click-outside restores every card to equal emphasis (99.md behaviour, kept).
    await page.getByTestId('search-workspace-stage').click({ position: { x: 4, y: 4 } });
    await expect(canvas).toHaveAttribute('data-has-active', 'false');
    await expect
      .poll(async () => sp.compactCards.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor),
        { message: 'every card returns to the raised card plane once nothing is open' })
      .toBe(openBg);

    // Clicking a concept expands/focuses it again.
    await sp.compactCards.nth(0).click();
    await expect(canvas).toHaveAttribute('data-has-active', 'true');

    // The canvas padding never buys the body a horizontal scrollbar.
    await expectNoHorizontalOverflow(page, 'canvas @ wide (1280)');
    await page.setViewportSize({ width: 480, height: 900 });
    await sp.conceptBoard.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, 'canvas @ narrow (480)');
  });

  /* 110 review (F1/F2/F3) — the SAME perceptual contract, asserted in BOTH
     palettes. The original guard only ever ran in whichever theme the fixture
     happened to boot in, and the flattening it was written for is a DARK-palette
     failure: --t-acc is a light colour there, so any accent mixed into the plane
     lifts it onto the cards. Both surface pairs are checked per theme; the
     numbers are derived in the SearchBuilderTab `.sb-concept-canvas` comment
     (worst case Stitch light, channel-sum 14). */
  test('110 review — plane vs card and open vs de-emphasised stay perceptibly apart in BOTH day and night', async ({ page, tmpProject }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const sp = new SearchPage(page);
    await openTermsWithGroup(sp, tmpProject.id, 'asthma');
    await sp.addConceptGroup('salbutamol');

    const canvas = page.getByTestId('sb-concept-workspace');
    await expect(canvas).toHaveAttribute('data-has-active', 'true');
    await expect(sp.compactCards).toHaveCount(1);
    // Park the pointer off the board: the de-emphasis is deliberately CANCELLED
    // on hover, so a cursor left on a compact card would read the restored card
    // surface and silently defeat the assertion.
    await page.mouse.move(0, 0);

    for (const theme of ['day', 'night'] as const) {
      await setTheme(page, theme);
      const canvasBg = await settledBg(canvas, `${theme}: the canvas plane`);
      const openBg = await settledBg(sp.activeConcept, `${theme}: the open card`);
      const dimBg = await settledBg(sp.compactCards.nth(0), `${theme}: the de-emphasised card`);

      expect(channelDelta(openBg, canvasBg),
        `${theme}: canvas plane ${canvasBg} vs the card ON it ${openBg}`)
        .toBeGreaterThanOrEqual(MIN_SURFACE_DELTA);
      expect(channelDelta(openBg, dimBg),
        `${theme}: open card ${openBg} vs the de-emphasised card ${dimBg}`)
        .toBeGreaterThanOrEqual(MIN_SURFACE_DELTA);
      // The de-emphasised card is pressed INTO the plane, never floating on it.
      const dimShadow = await sp.compactCards.nth(0).evaluate((el) => getComputedStyle(el).boxShadow);
      expect(dimShadow, `${theme}: the de-emphasised card keeps its inset depression cue`).toContain('inset');
    }
  });
});
