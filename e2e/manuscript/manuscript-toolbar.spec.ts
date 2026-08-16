/**
 * manuscript-toolbar.spec.ts — 118.md §3-§9, §41-§44, §46-§48, §52-§54, §58.
 *
 * The dedicated Manuscript Editor header: two levels (document controls above,
 * workspace navigation below), sticky inside the manuscript engine, driven by the
 * `?ms=` URL sub-param, and responsive without ever hiding a core action.
 *
 * What this file proves that a unit test cannot: that the bar really stays pinned
 * while a long document scrolls, that switching destinations does not lose an edit
 * that is still inside the two autosave debounces, that Back/Forward walks the
 * destinations, that the badge shows the REAL number of pending updates, and that
 * the responsive condensation obeys its own breakpoints against a measured width.
 *
 * Drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { test, expect, Page } from '../fixtures/stitch-test';

const HEADER = 'stitch-manuscript-header';

async function openManuscript(page: Page, projectId: string, ms?: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript${ms ? `&ms=${ms}` : ''}`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(HEADER)).toBeVisible({ timeout: 20_000 });
}

/**
 * The project rails cost ~594px, so the default 1280×720 test viewport leaves the
 * toolbar ~686px and it condenses Level A into '⋯' — correct behaviour, but it means
 * a spec about the INLINE controls has to ask for a wider window first. 1800px is the
 * measured width at which the bar has its full ≥1100px budget (1800 − 594 rails − 28
 * of its own padding = 1178). The condensation itself is what the §41 case covers.
 */
async function desktop(page: Page) {
  await page.setViewportSize({ width: 1800, height: 950 });
}

/* 118.md §41 — pinned here rather than imported: the spec asserts the CONTRACT the
   component publishes, and a shared constant would let both sides drift together.
   NOTE the widths are the TOOLBAR's, not the viewport's: the project rails cost
   ~594px at desktop widths and disappear entirely on the mobile layout, so viewport
   width is not even monotonic in toolbar width — which is exactly why the component
   measures itself with a ResizeObserver instead of using a media query. */
const PAD_X = 14;               // the bar's own horizontal padding, per side
const COMPACT_AT = 1100;        // content width below which the bar condenses in place
const OVERFLOW_AT = 700;        // …below which Draft / New draft / the notice move to ⋯
const MINIMAL_AT = 520;         // …below which the two selects follow them

/** The density the toolbar SHOULD be at for the room its controls actually get. */
function expectedDensity(contentWidth: number) {
  if (contentWidth < MINIMAL_AT) return 'minimal';
  if (contentWidth < OVERFLOW_AT) return 'overflow';
  if (contentWidth < COMPACT_AT) return 'compact';
  return 'full';
}

/** Which Level-A controls the bar keeps inline at each density (the rest are in ⋯). */
const INLINE_AT: Record<string, string[]> = {
  full: ['template', 'citation', 'newDraft', 'autoDraft'],
  compact: ['template', 'citation', 'newDraft', 'autoDraft'],
  overflow: ['template', 'citation'],
  minimal: [],
};
const CONTROL_TESTID: Record<string, string> = {
  template: 'stitch-manuscript-template-select',
  citation: 'stitch-manuscript-citation-select',
  newDraft: 'stitch-manuscript-new-draft',
  autoDraft: 'stitch-manuscript-autodraft',
};

test.describe('Manuscript toolbar (118.md)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true });
  });

  /* ── §3-§6: the bar exists, in two levels, with real semantics ─────────────── */

  test('§3-§6: two-level header — document controls above, a TAB LIST below', async ({ page, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    const header = page.getByTestId(HEADER);

    // Level A — identity + the document controls that used to float in the body.
    await expect(page.getByTestId('stitch-manuscript-header-level-a')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-wordmark')).toContainText('Manuscript');
    await expect(page.getByTestId('stitch-manuscript-template-select')).toContainText('Template:');
    await expect(page.getByTestId('stitch-manuscript-citation-select')).toContainText('Citation style:');
    await expect(page.getByTestId('stitch-manuscript-save-status')).toBeVisible();

    // §5 — the banner is now a chip; the FULL sentence is on the info trigger.
    await expect(page.getByTestId('stitch-manuscript-autodraft')).toContainText('Auto-draft');
    await expect(page.getByTestId('stitch-manuscript-autodraft')).toContainText('Verify generated content before submission');
    await expect(page.getByTestId('stitch-manuscript-autodraft-info')).toHaveAttribute(
      'aria-label', /verify all content and numbers against your extracted data before submission/i,
    );
    // …and it is keyboard reachable, which is what makes the tooltip reachable (§42).
    await page.getByTestId('stitch-manuscript-autodraft-info').focus();
    await expect(page.getByRole('tooltip')).toContainText(/verify all content and numbers/i);

    // §9 — the old free-standing banner is gone from the document body. Scoped to
    // the panel: the same sentence is legitimately present in the toolbar's tooltip,
    // which is the whole point of the §5 condensation.
    await expect(page.getByTestId('stitch-manuscript-panel')
      .getByText('Auto-draft — verify all content and numbers')).toHaveCount(0);
    await page.getByTestId('stitch-manuscript-wordmark').click(); // dismiss the tooltip

    // Level B — a tablist, not eight CTA buttons.
    const nav = page.getByTestId('stitch-manuscript-nav');
    await expect(nav).toHaveAttribute('role', 'tablist');
    await expect(nav.getByRole('tab')).toHaveCount(8);
    await expect(page.getByTestId('stitch-manuscript-subtab-overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('stitch-manuscript-subtab-editor')).toHaveAttribute('aria-selected', 'false');

    // …wired to the one tabpanel that hosts the destination's content.
    const panelId = await page.getByTestId('stitch-manuscript-subtab-editor').getAttribute('aria-controls');
    await expect(page.locator(`#${panelId}`)).toHaveAttribute('role', 'tabpanel');

    /* §42 — the tablist is arrow-navigable (APG roving tabindex), with MANUAL
       activation (r2). APG reserves "selection follows focus" for panels that are
       cheap to show; these are not — arrowing past Updates used to MOUNT Updates,
       firing the deliberately lazy sync plan, and each arrow press pushed a ?ms=
       history entry, so walking the row took seven Backs to undo. Arrows move
       FOCUS; Enter/Space selects. */
    await page.getByTestId('stitch-manuscript-subtab-overview').focus();
    const urlBefore = page.url();
    await page.keyboard.press('ArrowRight');
    // focus moved …
    await expect(page.getByTestId('stitch-manuscript-subtab-updates')).toBeFocused();
    // … the selection did NOT, and nothing was pushed to history
    await expect(page.getByTestId('stitch-manuscript-subtab-updates')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('stitch-manuscript-subtab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(page.url()).toBe(urlBefore);
    await page.keyboard.press('End');
    await expect(page.getByTestId('stitch-manuscript-subtab-export')).toBeFocused();
    await expect(page.getByTestId('stitch-manuscript-subtab-export')).toHaveAttribute('aria-selected', 'false');
    expect(page.url()).toBe(urlBefore);
    // Enter is what activates — one destination change, one history entry.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stitch-manuscript-subtab-export')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/ms=export/);
    await page.goBack();
    await expect(page.getByTestId('stitch-manuscript-subtab-overview')).toHaveAttribute('aria-selected', 'true');

    // The header never grows a second copy of the save pill (§44 — one home).
    await expect(page.getByTestId('stitch-manuscript-save-status')).toHaveCount(1);
    await expect(header).toBeVisible();
  });

  /* ── §7: sticky INSIDE the manuscript engine ───────────────────────────────── */

  test('§7: the header stays pinned while the document scrolls, and never leaves the engine', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible();
    // Give the page something to scroll.
    await page.getByTestId('stitch-manuscript-generate').click();
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 20_000 });

    const header = page.getByTestId(HEADER);
    const scroller = page.getByTestId('stitch-main-content');
    const topBefore = (await header.boundingBox())!.y;
    const scrollerTop = (await scroller.boundingBox())!.y;

    await scroller.evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(async () => Math.round((await scroller.evaluate((el) => el.scrollTop)) as number))
      .toBeGreaterThan(100);

    const topAfter = (await header.boundingBox())!.y;
    // Pinned to the ENGINE's scroller edge — not scrolled away, not floated over
    // the rest of the application (§8).
    await expect(header).toBeInViewport();
    expect(Math.abs(topAfter - scrollerTop)).toBeLessThanOrEqual(2);
    expect(topAfter).toBeLessThanOrEqual(topBefore + 2);
    // The nav is still usable from the scrolled position.
    await expect(page.getByTestId('stitch-manuscript-subtab-tables')).toBeVisible();
  });

  test('§7: Focus Mode keeps the header flush with the engine scroller (no gap, no overlap)', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-generate').click();
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 20_000 });

    await page.getByTestId('focus-toggle').click();
    await expect(page.getByTestId('focus-nav-bar')).toBeVisible();

    const header = page.getByTestId(HEADER);
    const scroller = page.getByTestId('stitch-main-content');
    const focusBar = page.getByTestId('focus-nav-bar');
    await expect(header).toBeVisible();

    await scroller.evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(async () => Math.round((await scroller.evaluate((el) => el.scrollTop)) as number))
      .toBeGreaterThan(100);

    const h = (await header.boundingBox())!;
    const s = (await scroller.boundingBox())!;
    const f = (await focusBar.boundingBox())!;
    // Pinned flush to the scroller it sticks inside — no gap …
    expect(Math.abs(h.y - s.y)).toBeLessThanOrEqual(2);
    // … and entirely below the focus bar, which is a SIBLING of that scroller. That
    // is why the sticky offset inside the engine is 0 and NOT the focus-bar height:
    // the scroller's own top edge is already below the bar. Verified, not assumed.
    expect(h.y).toBeGreaterThanOrEqual(f.y + f.height - 2);
  });

  /* ── §46: switching destinations must never lose work ──────────────────────── */

  test('§46: an edit inside the autosave debounce survives switching destinations', async ({ page, request, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    const editor = page.getByTestId('stitch-manuscript-rich-editor');
    await expect(editor).toBeVisible();

    await editor.click();
    const marker = `Tab-switch marker ${Date.now()}`;
    await page.keyboard.type(marker);

    // NO wait: both debounces (600 ms field patch → 800 ms blob autosave) are armed.
    // `useManuscript` is mounted ABOVE the destinations, so the pending patch has to
    // survive the switch — that is the contract, not a timing accident.
    await page.getByTestId('stitch-manuscript-subtab-tables').click();
    await expect(page.getByTestId('stitch-manuscript-subtab-tables')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('stitch-manuscript-subtab-references').click();
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(marker, { timeout: 15_000 });

    // …and it really landed on the server, so a reload shows the same text.
    await expect(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      expect(JSON.stringify(proj.manuscripts || [])).toContain(marker);
    }).toPass({ timeout: 20_000 });
  });

  /* ── §47/§48: the ?ms= sub-param ───────────────────────────────────────────── */

  test('§47/§48: destinations are real URL state — deep link, push, Back and Forward', async ({ page, tmpProject }) => {
    // Deep link straight into a destination.
    await openManuscript(page, tmpProject.id, 'references');
    await expect(page.getByTestId('stitch-manuscript-subtab-references')).toHaveAttribute('aria-selected', 'true');

    // Clicking a tab pushes the sub-param (the host route keeps `?tab=manuscript`).
    await page.getByTestId('stitch-manuscript-subtab-tables').click();
    await expect(page).toHaveURL(/\?tab=manuscript&ms=tables/);
    await page.getByTestId('stitch-manuscript-subtab-prisma').click();
    await expect(page).toHaveURL(/\?tab=manuscript&ms=prisma/);
    await expect(page.getByTestId('stitch-manuscript-subtab-prisma')).toHaveAttribute('aria-selected', 'true');

    // Back walks the destinations — it does NOT eject the user from the editor (§48).
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=manuscript&ms=tables/);
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible();
    await expect(page.getByTestId('stitch-manuscript-subtab-tables')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page.getByTestId('stitch-manuscript-subtab-references')).toHaveAttribute('aria-selected', 'true');

    // …and Forward returns.
    await page.goForward();
    await expect(page.getByTestId('stitch-manuscript-subtab-tables')).toHaveAttribute('aria-selected', 'true');

    // An unknown destination resolves to the workspace home instead of a blank panel.
    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&ms=not-a-destination`);
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stitch-manuscript-subtab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  /* ── §53/§54: the semantic dropdowns still drive the manuscript ─────────────── */

  test('§53/§54: Template and Citation style are single controls that still update the manuscript', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    // Scoped to the header ON PURPOSE: the Overview panel still renders its own
    // template/citation selects (118.md §32 removes them in the Overview wave), so an
    // unscoped label lookup would be ambiguous rather than wrong.
    const header = page.getByTestId(HEADER);

    // The label + value read as one control, and the value is a native select.
    await expect(page.getByTestId('stitch-manuscript-template-select')).toContainText('Template:');
    await header.getByLabel('Template').selectOption('jama');
    await header.getByLabel('Citation style').selectOption('harvard');

    await expect.poll(async () => {
      const p = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      const d = (p.manuscripts || [])[0] || {};
      return `${d.templateId}|${d.citationStyle}`;
    }, { timeout: 20_000 }).toBe('jama|harvard');

    // …and the toolbar reads the persisted values back after a reload.
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(header.getByLabel('Template')).toHaveValue('jama');
    await expect(header.getByLabel('Citation style')).toHaveValue('harvard');
  });

  /* ── §52: New draft safety ─────────────────────────────────────────────────── */

  test('§52: New draft explains that it is ADDITIVE, and Cancel does nothing', async ({ page, request, tmpProject }) => {
    await desktop(page);
    await openManuscript(page, tmpProject.id);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    const editor = page.getByTestId('stitch-manuscript-rich-editor');
    await editor.click();
    const marker = `Original draft text ${Date.now()}`;
    await page.keyboard.type(marker);
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 20_000 });

    // The confirmation names the safety property instead of just asking "are you sure".
    await page.getByTestId('stitch-manuscript-new-draft').click();
    const popover = page.getByTestId('stitch-manuscript-new-draft-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/adds/i);
    await expect(popover).toContainText(/Nothing is overwritten or deleted/i);

    // Cancel is inert.
    await popover.getByTestId('stitch-manuscript-new-draft-cancel').click();
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId('stitch-manuscript-draft-select')).toHaveCount(0);

    // Confirm ADDS a draft — the Draft selector appears and the original is still there.
    await page.getByTestId('stitch-manuscript-new-draft').click();
    await page.getByTestId('stitch-manuscript-new-draft-confirm').click();
    await expect(page.getByTestId('stitch-manuscript-draft-select')).toBeVisible();
    await expect.poll(async () => {
      const p = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      return (p.manuscripts || []).length;
    }, { timeout: 20_000 }).toBe(2);

    const draftSelect = page.getByTestId('stitch-manuscript-draft-select').locator('select');
    await expect(draftSelect.locator('option')).toHaveCount(2);
    // Switching back to the first draft shows the untouched text.
    const first = await draftSelect.locator('option').first().getAttribute('value');
    await draftSelect.selectOption(first!);
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-introduction').click();
    await expect(page.getByTestId('stitch-manuscript-rich-editor')).toContainText(marker, { timeout: 15_000 });
  });

  /* ── §41: responsive condensation ──────────────────────────────────────────── */

  test('§41: the toolbar condenses by its own width, and never hides a core action', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    const header = page.getByTestId(HEADER);

    const seen: string[] = [];
    for (const width of [1440, 1100, 900]) {
      await page.setViewportSize({ width, height: 900 });
      // Let the ResizeObserver settle before reading the density it produced. This
      // IS the §41 contract: the density the bar chooses matches the room it has.
      await expect.poll(async () => {
        const el = await header.evaluate((n) => ({ w: (n as HTMLElement).clientWidth, d: (n as HTMLElement).dataset.density }));
        const content = el.w - PAD_X * 2;
        return el.d === expectedDensity(content) ? 'ok' : `${el.d}@${content}`;
      }, { timeout: 10_000 }).toBe('ok');

      const density = (await header.getAttribute('data-density'))!;
      seen.push(density);

      // §41 non-negotiables at EVERY width: all eight destinations and the save
      // state stay visible; nothing scrolls out of reach.
      await expect(page.getByTestId('stitch-manuscript-nav').getByRole('tab')).toHaveCount(8);
      await expect(page.getByTestId('stitch-manuscript-subtab-export')).toBeVisible();
      await expect(page.getByTestId('stitch-manuscript-save-status')).toBeVisible();

      const inline = INLINE_AT[density];
      const overflowed = Object.keys(CONTROL_TESTID).filter((k) => !inline.includes(k));

      for (const k of inline) await expect(page.getByTestId(CONTROL_TESTID[k])).toBeVisible();

      if (overflowed.length) {
        // Whatever left the bar is in the MENU — reachable, live, and not duplicated.
        for (const k of overflowed) await expect(page.getByTestId(CONTROL_TESTID[k])).toHaveCount(0);
        const more = page.getByTestId('stitch-manuscript-toolbar-overflow');
        await expect(more).toBeVisible();
        await more.click();
        const menu = page.getByTestId('stitch-manuscript-toolbar-overflow-menu');
        await expect(menu).toBeVisible();
        for (const k of overflowed) await expect(menu.getByTestId(CONTROL_TESTID[k])).toBeVisible();
        // …and a control still WORKS from in there.
        if (overflowed.includes('citation')) {
          await menu.getByLabel('Citation style').selectOption('ama');
          await expect(menu.getByLabel('Citation style')).toHaveValue('ama');
        } else {
          await menu.getByTestId('stitch-manuscript-new-draft').click();
          await expect(page.getByTestId('stitch-manuscript-new-draft-popover')).toBeVisible();
          await page.keyboard.press('Escape');
        }
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      } else {
        await expect(page.getByTestId('stitch-manuscript-toolbar-overflow')).toHaveCount(0);
      }
    }

    // The three widths really did produce different layouts — the ResizeObserver is
    // driving this, not a constant. (Roominess is NOT monotonic in the VIEWPORT: the
    // shell drops its 594px of rails on the mobile layout, so 900px of viewport gives
    // the bar more room than 1100px does. That is the shell's contract, not a bug —
    // asserting monotonicity here would pin a falsehood.)
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  /* ── r2 §41/§51: the overflow menu has to be ON SCREEN to be a route ───────── */

  test('r2 §41: the ⋯ menu and its nested popover stay inside the viewport at narrow widths', async ({ page, tmpProject }) => {
    await openManuscript(page, tmpProject.id);

    for (const width of [480, 640]) {
      await page.setViewportSize({ width, height: 900 });

      const more = page.getByTestId('stitch-manuscript-toolbar-overflow');
      await expect(more).toBeVisible({ timeout: 10_000 });
      await more.click();

      // The menu holds every Level-A control that left the bar; §41's "another
      // access route" is only true if that route is reachable with a pointer.
      const menu = page.getByTestId('stitch-manuscript-toolbar-overflow-menu');
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box, `menu has no box at ${width}px`).toBeTruthy();
      expect(box.x, `menu clipped off the LEFT at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `menu clipped off the RIGHT at ${width}px`).toBeLessThanOrEqual(width);

      // …and so does the 288px New-draft popover NESTED inside the 268px menu.
      await menu.getByTestId('stitch-manuscript-new-draft').click();
      const pop = page.getByTestId('stitch-manuscript-new-draft-popover');
      await expect(pop).toBeVisible();
      const pbox = (await pop.boundingBox())!;
      expect(pbox, `popover has no box at ${width}px`).toBeTruthy();
      expect(pbox.x, `New-draft popover clipped off the LEFT at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(pbox.x + pbox.width, `New-draft popover clipped off the RIGHT at ${width}px`)
        .toBeLessThanOrEqual(width);
      // Reachable means CLICKABLE — its own controls answer the pointer.
      await expect(menu.getByTestId('stitch-manuscript-new-draft-cancel')).toBeVisible();
      await menu.getByTestId('stitch-manuscript-new-draft-cancel').click();
      await expect(pop).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });

  /* ── §6/§69: the Updates badge is a real number ────────────────────────────── */

  test('§6/§69: the Updates badge shows the REAL number of pending updates', async ({ page, request, tmpProject }) => {
    await openManuscript(page, tmpProject.id);
    // A fresh manuscript is in sync → NO badge (never a "0" chip, never a hardcoded 6).
    await expect(page.getByTestId('stitch-manuscript-updates-badge')).toHaveCount(0);

    // Generate, then change a Methods dependency server-side so real sections go stale.
    await page.getByTestId('stitch-manuscript-subtab-updates').click();
    await expect(page.getByTestId('stitch-manuscript-freshness').first()).not.toContainText(/unknown/i, { timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-generate').click();
    await expect(page.getByTestId('stitch-manuscript-save-status')).toContainText(/Saved/i, { timeout: 20_000 });

    let proj: any = null;
    await expect(async () => {
      proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      expect(proj?.manuscripts?.[0]?.sections?.methods?.inputsHash).toBeTruthy();
    }).toPass({ timeout: 20_000 });
    proj.analysisSettings = { ...(proj.analysisSettings || {}), tau2Method: 'REML' };
    expect((await request.put(`/api/projects/${tmpProject.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });

    const badge = page.getByTestId('stitch-manuscript-updates-badge');
    await expect(badge).toBeVisible({ timeout: 20_000 });
    const shown = Number((await badge.innerText()).trim());
    expect(shown).toBeGreaterThan(0);

    // …and the number matches what the Updates destination actually lists.
    await page.getByTestId('stitch-manuscript-subtab-updates').click();
    await expect(page.locator('[data-testid^="stitch-manuscript-update-"]').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.locator('[data-testid^="stitch-manuscript-update-"]')
      .filter({ has: page.getByTestId('stitch-manuscript-update-accept') }).count(), { timeout: 15_000 })
      .toBe(shown);
  });
});
