/**
 * fullscreen.spec.ts — 114.md §1 (Focus Mode is TRUE browser fullscreen) and the
 * 117.md §42–§45 rework of what happens around it.
 *
 * The layout half of Focus Mode (which chrome is hidden, what the workspace
 * becomes) is covered by tests/unit/focus/focusMode.test.jsx. What can only be
 * proven in a real browser is:
 *
 *   - our control actually puts the DOCUMENT ELEMENT into the Fullscreen API, so
 *     the browser's tabs/address bar go too (a CSS-only "big page" would leave
 *     document.fullscreenElement null — that is the whole point of asserting it);
 *   - 117.md §44: every exit path leaves BOTH halves consistent, and "consistent"
 *     now means IDENTICAL. An external end of our fullscreen — Escape, F11, the
 *     window manager — returns the NORMAL application layout, with no stale
 *     attribute left on <html>. This deliberately reverses 114-r2 §2, which
 *     degraded to a focused-but-windowed state and is what §44 calls a bug;
 *   - the one exception §44 keeps: an Escape an APP OVERLAY consumed (a dialog, the
 *     focus nav drawer). The browser leaves fullscreen for that press whatever the
 *     page does, and ejecting the workspace because a dialog was dismissed is a
 *     worse bug than the one being fixed — so that press degrades instead;
 *   - 117.md §42/§43: the navigation Focus Mode hides is still reachable, by the
 *     left edge and by the hamburger, and both drive the SAME drawer;
 *   - the Previous/Next bar keeps working while fullscreen.
 *
 * Chromium only: fullscreen grants depend on the window manager, and the WebKit /
 * Firefox harnesses refuse or hang on requestFullscreen headlessly (WebKit is the
 * worst of the three — a headless grant simply never resolves). The API wiring
 * itself (including the webkit-prefixed dialect and the denial fallback) is
 * unit-tested against a hand-rolled document instead.
 *
 * ONE HONEST LIMITATION, stated where it is relied on below: Playwright cannot
 * deliver the BROWSER-level half of an Escape press. `keyboard.press('Escape')`
 * reaches the page, but the user-agent's own "leave fullscreen" handling is not
 * driven by a synthetic key event. Where a test needs both halves of one physical
 * press it stages them together in a single page.evaluate — the app code under
 * test (the latch, the policy, the listener) is entirely real; only the browser's
 * side of the press is simulated.
 */
import { test, expect } from '../fixtures/stitch-test';
import { ShellNav } from '../page-objects/ShellNav';

test.describe('114.md §1 / 117.md §44 — Focus Mode and true browser fullscreen', () => {
  test.skip(({ browserName }) => browserName !== 'chromium',
    'Fullscreen grants are unreliable outside the Chromium harness; the API contract is unit-tested.');

  /** Is the PAGE ITSELF fullscreen (not merely a wide viewport)? */
  const rootIsFullscreen = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.fullscreenElement === document.documentElement);
  const anyFullscreen = (page: import('@playwright/test').Page) =>
    page.evaluate(() => !!document.fullscreenElement);
  /** 117.md §44/§45 — the attributes that must not outlive the mode. */
  const rootAttr = (page: import('@playwright/test').Page, name: string) =>
    page.evaluate((n) => document.documentElement.getAttribute(n), name);

  /**
   * The PICO stage of the project workspace — a real workspace surface, so the
   * focus bar is StitchProjectWorkspace's own FocusNavBar (Previous/Next/exit)
   * rather than the shell's minimal fallback bar.
   */
  async function openWorkspace(page: import('@playwright/test').Page, projectId: string) {
    const shell = new ShellNav(page);
    await shell.goto(`/app/project/${encodeURIComponent(projectId)}?tab=pico`);
    await shell.expectShell();
    return shell;
  }

  /** Enter Focus Mode from the header toggle and wait for the real grant. */
  async function enterFullscreen(page: import('@playwright/test').Page) {
    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    await expect.poll(() => rootIsFullscreen(page), {
      timeout: 10_000,
      message: 'the control never requested real fullscreen on documentElement',
    }).toBe(true);
  }

  test('the toggle enters fullscreen with the focus bar, and toggling again clears both', async ({ page, tmpProject }) => {
    const shell = await openWorkspace(page, tmpProject.id);
    const toggle = page.getByTestId('focus-toggle');
    const bar = page.getByTestId('focus-nav-bar');

    await expect(bar).toHaveCount(0);
    expect(await anyFullscreen(page)).toBe(false);

    // ENTER — the layout mode AND the browser's own chrome.
    await toggle.click();
    await expect(bar).toBeVisible();
    await expect(shell.topHeader).toHaveCount(0);
    await expect.poll(() => rootIsFullscreen(page), {
      timeout: 10_000,
      message: 'the control never requested real fullscreen on documentElement',
    }).toBe(true);
    // 114.md §1 — the workspace really fills the display, not just the viewport.
    const covered = await page.evaluate(() => window.innerHeight >= window.screen.height * 0.9);
    expect(covered).toBe(true);

    // 114.md §7 — "focus is not lost". The header toggle the user just pressed is
    // unmounted by the transition, which drops document.activeElement to <body>
    // and restarts a keyboard user's Tab order at the top of the document. The
    // control that replaces it takes the focus back.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null), { timeout: 5_000 })
      .toBe('focus-toggle');

    // The one control Focus Mode keeps is the one that gets back out.
    await toggle.click();
    await expect(bar).toHaveCount(0);
    await expect(shell.topHeader).toBeVisible();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });

  test('Escape leaves fullscreen AND the focus layout together (no false full-screen state)', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');

    await enterFullscreen(page);

    // A PLAIN Escape — nothing focused that wants it, nobody typing — is a
    // deliberate "get me out", and it is one press: the window keydown handler
    // sees it and unwinds the layout and fullscreen together. (The keydown
    // reaching the page and the browser's own fullscreen exit can both fire from
    // one physical press; the exit path is idempotent, so whichever lands first
    // the result below is the same.)
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
  });

  test('117.md §44 — fullscreen ending OUTSIDE the app returns the NORMAL layout', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');

    await enterFullscreen(page);
    // While we really are fullscreen, the exit control says so.
    await expect(page.getByTestId('focus-exit')).toHaveAttribute('aria-label', /leave full screen/);
    await expect(page.getByTestId('focus-fullscreen')).toHaveCount(0);
    expect(await rootAttr(page, 'data-focus-mode')).toBe('on');

    // Stand in for every exit the app cannot intercept: F11, the window manager,
    // the browser's own fullscreen control.
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);

    // 117.md §44 — RE-PINNED DELIBERATELY. Until 117 this asserted the opposite:
    // the layout survived as focused-but-windowed (114-r2 §2). §44 calls that the
    // bug — "PecanRev must return to the normal application layout … no stale
    // fullscreen class/state should remain" — so the full application chrome comes
    // back, and nothing is left on <html> claiming otherwise.
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
    await expect(page.getByTestId('focus-edge-zone')).toHaveCount(0);
    await expect(page.getByTestId('focus-nav-drawer')).toHaveCount(0);
    expect(await rootAttr(page, 'data-focus-mode')).toBe(null);
    expect(await rootAttr(page, 'data-fullscreen-phase')).toBe(null);
  });

  test('117.md §44 — an Escape an overlay consumed closes the overlay, never the workspace', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');
    const drawer = page.getByTestId('focus-nav-drawer');

    await enterFullscreen(page);
    await page.getByTestId('focus-nav-menu').click();
    await expect(drawer).toBeVisible();

    // ONE physical press, both halves — see the file header for why they are
    // staged together here. The keydown is dispatched at `document`, which is
    // exactly where the drawer (and every Stitch dialog, via useFocusTrap)
    // listens in the capture phase; the exitFullscreen that follows in the same
    // task is what the user agent would have done for the same key.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return document.exitFullscreen();
    });

    await expect(drawer).toBeHidden();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);

    // The WORKSPACE stays. Being dropped back to full chrome mid-thought because a
    // dialog was dismissed is the regression this test exists to prevent — it is
    // the one case 117.md §44 leaves to 114-r2 §2's degrade.
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('stitch-top-header')).toHaveCount(0);
    expect(await rootAttr(page, 'data-focus-mode')).toBe('on');

    // …but nothing may keep CLAIMING a full screen that is gone: the exit copy
    // drops the promise, and the way back up appears.
    await expect(page.getByTestId('focus-exit')).toHaveAttribute('aria-label', 'Exit focus mode — restore navigation');
    await expect(page.getByTestId('focus-toggle')).toHaveAttribute('aria-label', 'Exit focus mode — restore navigation');
    await expect(page.getByTestId('focus-fullscreen')).toBeVisible();

    // A deliberate Escape, with no overlay to claim it, still leaves in one press.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('stitch-top-header')).toBeVisible();
  });

  test('the way back UP: windowed focus can re-enter real fullscreen with one gesture', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    await enterFullscreen(page);

    // A RELOAD is the documented windowed-focus state (114.md): sessionStorage
    // restores the layout, but no browser grants fullscreen without a fresh user
    // gesture, so the page comes back focused-but-windowed. It is also the only
    // way to reach that state on purpose now that §44 exits on an external end.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible({ timeout: 20_000 });
    expect(await anyFullscreen(page)).toBe(false);
    await expect(page.getByTestId('focus-fullscreen')).toBeVisible();

    // A fresh user gesture is exactly what the browser was missing — which is why
    // this is a button and not something the app can do on its own after a reload.
    await page.getByTestId('focus-fullscreen').click();
    await expect.poll(() => rootIsFullscreen(page), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId('focus-fullscreen')).toHaveCount(0);

    await page.getByTestId('focus-exit').click();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });

  test('Previous/Next still navigates while the page is fullscreen', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    await enterFullscreen(page);

    const before = page.url();
    await page.getByTestId('focus-nav-next').click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toBe(before);

    // The route change must NOT eject fullscreen — that is why documentElement is
    // the fullscreen element rather than a shell div that remounts.
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    expect(await rootIsFullscreen(page)).toBe(true);

    // Leave the tab in a clean state for the next spec sharing the browser.
    await page.getByTestId('focus-exit').click();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });

  /* ═══════════ 117.md §79 — the twelve-step script, in order ═══════════ */

  test('117.md §79 — enter, reveal, toggle, Escape, and nothing stale left behind', async ({ page, tmpProject }) => {
    const shell = await openWorkspace(page, tmpProject.id);
    const bar = page.getByTestId('focus-nav-bar');
    const drawer = page.getByTestId('focus-nav-drawer');
    const menu = page.getByTestId('focus-nav-menu');

    // 1. enter app fullscreen  2. verify browser fullscreen
    await enterFullscreen(page);
    expect(await rootAttr(page, 'data-focus-mode')).toBe('on');
    // 117.md §45 — the phase is a real, observable state, not a private boolean.
    await expect.poll(() => rootAttr(page, 'data-fullscreen-phase'), { timeout: 5_000 }).toBe('fullscreen');

    // 3. verify workspace view — the work is there, the chrome is not.
    await expect(page.getByTestId('stitch-main-content')).toBeVisible();
    await expect(shell.topHeader).toHaveCount(0);
    await expect(shell.projectRail).toHaveCount(0);
    await expect(drawer).toBeHidden();
    await expect(drawer).toHaveAttribute('data-state', 'hidden');

    // 4. move the cursor to the far-left edge  5. verify the sidebar appears
    const midY = await page.evaluate(() => Math.round(window.innerHeight / 2));
    await page.mouse.move(600, midY);
    await page.mouse.move(1, midY);
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    await expect(drawer).toHaveAttribute('data-state', 'open');
    // …and it is the REAL navigation, not a second nav model built for this bar.
    await expect(shell.projectRail).toBeVisible();

    // §42 — "it may hide after a short intelligent delay unless pinned".
    await page.mouse.move(900, midY);
    await expect(drawer).toBeHidden({ timeout: 5_000 });

    // 6. click the hamburger  7. verify the menu toggles
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(drawer).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(shell.projectRail).toBeVisible();
    await menu.click();
    await expect(drawer).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    // 8. press Esc  9. browser fullscreen exits  10. application fullscreen exits
    await page.keyboard.press('Escape');
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
    await expect(bar).toHaveCount(0);

    // 11. standard navigation returns
    await expect(shell.topHeader).toBeVisible();
    await expect(shell.projectRail).toBeVisible();

    // 12. no stale CSS state — asserted explicitly, both attributes, plus the
    // focus-only chrome. 117.md §45: nothing may be left claiming a transition.
    expect(await rootAttr(page, 'data-focus-mode')).toBe(null);
    expect(await rootAttr(page, 'data-fullscreen-phase')).toBe(null);
    await expect(page.getByTestId('focus-edge-zone')).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('117.md §43 — the pin keeps the drawer open, and survives leaving Focus Mode', async ({ page, tmpProject }) => {
    await openWorkspace(page, tmpProject.id);
    const drawer = page.getByTestId('focus-nav-drawer');
    const menu = page.getByTestId('focus-nav-menu');

    await enterFullscreen(page);
    await menu.click();
    await expect(drawer).toBeVisible();

    await page.getByTestId('focus-nav-pin').click();
    await expect(drawer).toHaveAttribute('data-state', 'pinned');

    // Pinned means auto-hide does not apply: the pointer can go anywhere.
    const midY = await page.evaluate(() => Math.round(window.innerHeight / 2));
    await page.mouse.move(1, midY);
    await page.mouse.move(900, midY);
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-state', 'pinned');

    // Leaving Focus Mode takes the drawer with it; re-entering restores the pin
    // (sessionStorage, like the mode itself — never the server-backed rail pin).
    await page.getByTestId('focus-exit').click();
    await expect(page.getByTestId('focus-nav-bar')).toHaveCount(0);
    await expect(drawer).toHaveCount(0);

    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();
    await expect(page.getByTestId('focus-nav-drawer')).toHaveAttribute('data-state', 'pinned');

    // Clean up for the next spec sharing the browser: unpin, then leave.
    await page.getByTestId('focus-nav-pin').click();
    await page.getByTestId('focus-exit').click();
    await expect.poll(() => anyFullscreen(page), { timeout: 10_000 }).toBe(false);
  });
});
