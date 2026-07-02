/**
 * responsive.spec.ts — responsive layout + off-canvas drawer nav for the Stitch shell.
 *
 * The Stitch shell (StitchAppShell.jsx) flips at the 1024px breakpoint:
 *   · < 1024px → `.stitch-desktop-nav` is hidden (`display:none !important`), the
 *     header hamburger `.stitch-mobile-only` (testid `stitch-drawer-toggle`) appears,
 *     and the nav lives in an off-canvas StitchDrawer (`role=dialog` name "Navigation",
 *     focus-trapped, Escape/backdrop to close).
 *   · >= 1024px → the hamburger is hidden and the desktop primary rail is visible.
 * The design contract also forbids horizontal page overflow at every width, and the
 * project workspace rail reflows the layout when pinned (`data-pinned`).
 *
 * Playwright's `--project=responsive` runs these at mobile/tablet device sizes, but we
 * ALSO pin an explicit viewport per describe with `test.use({ viewport })` so the file
 * is fully self-contained on the default chromium project too.
 *
 * Reset facts: useSidebarPin mirrors the pin pref to localStorage; the server pref is
 * canonical but the local mirror seeds first paint. We clear it in beforeEach so a pin
 * toggled by a prior test can't bleed in. (The real key is `pecanrev.projectSidebarPinned`;
 * we also clear the legacy `stitch-sidebar-pinned` name defensively.)
 */
import { test, expect } from '../fixtures/stitch-test';
import type { Page } from '@playwright/test';
import { ShellNav } from '../page-objects/ShellNav';

const TABLET = { width: 820, height: 1100 };   // < 1024px → drawer nav
const DESKTOP = { width: 1280, height: 900 };   // >= 1024px → desktop rail

// Representative widths spanning the documented breakpoints (1024 drawer; 880–980 grids).
const BREAKPOINTS = [
  { w: 390, h: 844, label: 'mobile' },
  { w: 768, h: 1024, label: 'tablet' },
  { w: 1000, h: 800, label: 'small-laptop (<1024)' },
  { w: 1280, h: 900, label: 'desktop' },
];

const OVERFLOW_TOLERANCE = 2; // px — sub-pixel rounding only; real overflow is many px.

test.beforeEach(async ({ page }) => {
  // Clear the sidebar-pin local mirror before the test navigates (applies to its goto).
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('pecanrev.projectSidebarPinned');
      window.localStorage.removeItem('stitch-sidebar-pinned');
    } catch { /* storage unavailable */ }
  });
});

/** Assert the document does not scroll horizontally (no content wider than the viewport). */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: `horizontal overflow at ${label}` },
    )
    .toBeLessThanOrEqual(OVERFLOW_TOLERANCE);
}

test.describe('responsive — mobile/tablet drawer (<1024px)', () => {
  test.use({ viewport: TABLET });

  test('@smoke desktop nav hides and the drawer toggle appears below 1024px', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');

    // The whole desktop nav column is display:none below 1024px...
    await expect(page.locator('.stitch-desktop-nav')).toBeHidden();
    // ...so its primary rail is not reachable either.
    await expect(shell.primaryRail).toBeHidden();
    // ...and the hamburger (mobile-only) is shown instead.
    await expect(shell.drawerToggle).toBeVisible();
  });

  test('opening the drawer reveals the Navigation dialog; Escape closes it', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');

    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeHidden(); // closed by default (not in the DOM)

    await shell.drawerToggle.click();
    await expect(dialog).toBeVisible();
    // The off-canvas nav surfaces real navigation (the same back-to-projects/global items).
    await expect(dialog.getByRole('button').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('clicking the backdrop closes the drawer', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');

    await shell.drawerToggle.click();
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();

    // The drawer backdrop has no testid; it's the full-screen layer behind the panel,
    // and mousedown on it (target === backdrop) closes the drawer. Click just to the
    // right of the left-anchored panel, where only the backdrop is painted.
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    const x = Math.min(Math.round(box!.x + box!.width + 80), TABLET.width - 8);
    await page.mouse.click(x, Math.round(TABLET.height / 2));

    await expect(dialog).toBeHidden();
  });
});

test.describe('responsive — desktop rail (>=1024px)', () => {
  test.use({ viewport: DESKTOP });

  test('@smoke drawer toggle hides and the primary rail is visible at desktop width', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');

    await expect(shell.drawerToggle).toBeHidden();
    await expect(page.locator('.stitch-desktop-nav')).toBeVisible();
    await expect(shell.primaryRail).toBeVisible();
  });
});

test.describe('responsive — no horizontal overflow', () => {
  test.use({ viewport: DESKTOP });

  test('the /app dashboard never overflows horizontally across breakpoints', async ({ page }) => {
    const shell = new ShellNav(page);
    await shell.goto('/app');

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      await expectNoHorizontalOverflow(page, `/app @ ${bp.label} (${bp.w}px)`);
    }
  });

  test('a project workspace never overflows horizontally across breakpoints', async ({ page, tmpProject }) => {
    const shell = new ShellNav(page);
    await shell.goto(`/app/project/${tmpProject.id}`);
    await expect(shell.projectRail).toBeVisible();

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.w, height: bp.h });
      await expectNoHorizontalOverflow(page, `project @ ${bp.label} (${bp.w}px)`);
    }
  });
});

test.describe('responsive — project rail pin reflow', () => {
  test.use({ viewport: DESKTOP });

  test('pinning the project rail reflows the layout and flips data-pinned', async ({ page, tmpProject }) => {
    const shell = new ShellNav(page);
    await shell.goto(`/app/project/${tmpProject.id}`);

    const rail = shell.projectRail;
    await expect(rail).toBeVisible();

    const initialPinned = (await rail.getAttribute('data-pinned')) ?? 'false';
    const beforeBox = await shell.mainContent.boundingBox();
    expect(beforeBox).not.toBeNull();
    const beforeWidth = Math.round(beforeBox!.width);

    // The pin control sits inside the collapsed rail (opacity:0 + clipped by the 72px
    // overflow:hidden rail). The rail expands on hover OR keyboard focus-within; focus
    // works even on touch-emulated projects, so focus the control to paint + unclip it,
    // then click it.
    await shell.pinControl.focus();
    await expect(shell.pinControl).toBeFocused();
    await shell.pinControl.click();

    // Optimistic toggle flips data-pinned immediately (before the PUT /api/profile lands).
    const flipped = initialPinned === 'true' ? 'false' : 'true';
    await expect(rail).toHaveAttribute('data-pinned', flipped);

    // Move the pointer off the rail so a lingering hover-overlay can't mask the change.
    // Use an absolute mouse move (no actionability check) to a point deep in the main
    // column — a Locator.hover here can time out when the expanded rail overlay covers
    // the target point.
    await page.mouse.move(Math.round(DESKTOP.width * 0.7), Math.round(DESKTOP.height * 0.5));
    await expect
      .poll(async () => {
        const b = await shell.mainContent.boundingBox();
        return b ? Math.round(b.width) : null;
      }, { message: 'main content width should change when the rail pin reflows' })
      .not.toBe(beforeWidth);

    // Restore the original pin state — the pref persists server-side; do not bleed it.
    await shell.pinControl.focus();
    await shell.pinControl.click();
    await expect(rail).toHaveAttribute('data-pinned', initialPinned);
  });
});
