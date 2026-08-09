/**
 * keywordShortcuts.spec.ts — 108.md §1. The abstract-selection keyword chords
 * (Cmd/Ctrl+I → inclusion, Cmd/Ctrl+E → exclusion) in the Title & Abstract
 * workbench at `/app/project/:id?tab=screening&screen=screening`.
 *
 * WHY THIS FILE EXISTS
 * 107.md shipped the chords with unit coverage only (a pure guard chain + a thin DOM
 * hook). Users then reported "Ctrl+I does a browser thing instead". 108.md §1 asks
 * for the chord to be PecanRev-owned exactly when PecanRev can process it, and for
 * browser-reserved chords never to be claimed. This suite is the cross-engine pin
 * for both halves of that contract.
 *
 * ── WHAT THIS SUITE CAN PROVE ────────────────────────────────────────────────────
 *   1. The keydown reaches page content at all (it is recorded by a window-CAPTURE
 *      probe installed before the press).
 *   2. Whether PecanRev cancelled it — `event.defaultPrevented`, read back AFTER the
 *      dispatch completed. The probe retains the live event object and the cancelled
 *      flag is sticky, so reading it post-press reports the state after the app's
 *      window-BUBBLE handler (the last listener in the chain) has run.
 *   3. That the app effect happened (or did not): the keyword add is confirmed by the
 *      screening snackbar AND by re-reading the persisted keyword list from the API.
 *   4. That all of the above hold identically under Chromium, Firefox and WebKit
 *      (the @smoke-tagged cases run in all three projects — playwright.config.ts).
 *
 * ── WHAT THIS SUITE CANNOT PROVE ─────────────────────────────────────────────────
 *   Browser-CHROME behaviour is outside the page and outside Playwright's reach:
 *   Firefox's Ctrl+I "Page Info" window, Safari's ⌘I "Email This Page" menu item and
 *   any Edge sidebar/Copilot accelerator are not observable from a page context, and
 *   an automation profile may suppress accelerators a real profile would perform.
 *   Edge is not a Playwright engine here at all (Chromium stands in for it).
 *   So: a passing `defaultPrevented === true` means "PecanRev cancelled the event",
 *   NOT "the browser did nothing". For chords the UA marks RESERVED (Ctrl+Shift+I →
 *   DevTools) cancellation is ignored by the UA entirely — which is exactly why the
 *   fix is to never CLAIM that chord rather than to try to cancel it. 108.md §1
 *   requires the residual, unobservable-from-a-test behaviour to be DOCUMENTED
 *   instead of silently assumed; see the browser matrix in docs/ (108 report §1).
 */
import { Page } from '@playwright/test';
import { test, expect } from '../fixtures/stitch-test';
import { ScreeningPage } from '../page-objects/ScreeningPage';

/** One recorded keydown, flattened out of the browser context. */
type KeyProbeEntry = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Read AFTER the dispatch finished — i.e. did any page listener cancel it. */
  defaultPrevented: boolean;
};

/**
 * Install (or reset) a window-CAPTURE keydown probe. It keeps the live event objects
 * rather than a snapshot: `defaultPrevented` is only meaningful once every listener
 * has run, and the app's handler is a window-BUBBLE listener (the last one). Capture
 * phase guarantees the probe sees the event even if something later stops propagation.
 */
async function installKeyProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __pecanKeyProbe?: KeyboardEvent[]; __pecanKeyProbeBound?: boolean };
    w.__pecanKeyProbe = [];
    if (w.__pecanKeyProbeBound) return;
    w.__pecanKeyProbeBound = true;
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      (w.__pecanKeyProbe as KeyboardEvent[]).push(e);
    }, true);
  });
}

/** Read the probe back, flattening each retained event into a plain record. */
async function readKeyProbe(page: Page): Promise<KeyProbeEntry[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __pecanKeyProbe?: KeyboardEvent[] };
    return (w.__pecanKeyProbe || []).map(e => ({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      defaultPrevented: e.defaultPrevented,
    }));
  });
}

/**
 * Press a chord and return the probe record for its LETTER keydown.
 * `keyboard.press('Control+i')` emits a keydown for each modifier first, so the
 * records are filtered down to the letter (case-insensitively — a Shift'd press
 * reports the upper-case character).
 */
async function pressChord(page: Page, chord: string, letter: 'i' | 'e'): Promise<KeyProbeEntry> {
  await installKeyProbe(page);
  await page.keyboard.press(chord);
  const hits = (await readKeyProbe(page)).filter(r => r.key.toLowerCase() === letter);
  // If this fails the UA swallowed the chord before content saw it — a genuinely
  // different (and unfixable-from-the-page) failure mode than "we did not cancel it".
  expect(hits, `"${chord}" must reach page content as a keydown`).toHaveLength(1);
  return hits[0];
}

/**
 * Select `needle` inside the rendered abstract using the Selection API (a real DOM
 * selection — the same thing a mouse drag produces, but deterministic across engines
 * and immune to the <mark>/<strong> segmentation the abstract renderer applies).
 * Focus is dropped first so the run reproduces the mouse path, where the abstract <p>
 * is not focusable and `document.activeElement` stays on <body>.
 */
async function selectInAbstract(page: Page, needle: string): Promise<void> {
  const selected = await page.evaluate((text: string) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') active.blur();
    const host = document.querySelector('[data-testid="screening-abstract"]');
    if (!host) return '<no abstract>';
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent || '';
      const at = value.indexOf(text);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const sel = window.getSelection();
        if (!sel) return '<no selection api>';
        sel.removeAllRanges();
        sel.addRange(range);
        return String(sel);
      }
      node = walker.nextNode();
    }
    return '<not found>';
  }, needle);
  expect(selected, `"${needle}" must be selectable inside the rendered abstract`).toBe(needle);
}

/** Collapse any live selection (the "no selection" precondition). */
async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });
}

/** The persisted keyword lists, straight from the screening API (no UI in the loop). */
async function readKeywordLists(page: Page, siftId: string): Promise<{ include: string[]; exclude: string[] }> {
  const res = await page.request.get(`/api/screening/projects/${siftId}`);
  expect(res.ok(), 'the screening project must be readable').toBeTruthy();
  const body = await res.json();
  const parse = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[];
    if (typeof v === 'string') { try { return JSON.parse(v) as string[]; } catch { return []; } }
    return [];
  };
  const project = body?.project ?? body;
  return { include: parse(project?.inclusionKeywords), exclude: parse(project?.exclusionKeywords) };
}

/**
 * Phrases chosen from the `screeningProject` fixture abstract
 * ("Background: randomized trial number N. Methods: cohort. Results: significant
 * effect. Conclusion: promising for the systematic review.") that are NOT in
 * defaultKeywords.js — so the add is a real add, not the "already in the list"
 * branch, and the phrase is not already wrapped in a highlight <mark>.
 */
const INCLUDE_PHRASE = 'significant effect';
const EXCLUDE_PHRASE = 'promising';

/** Open the workbench on a record whose abstract is rendered and ready to select in. */
async function openAbstract(page: Page, projectId: string): Promise<ScreeningPage> {
  const sift = new ScreeningPage(page);
  await sift.openWorkbench(projectId);
  await sift.recordRow(/E2E Study 1 on intervention efficacy/).click();
  await expect(sift.main.getByTestId('screening-abstract')).toBeVisible();
  return sift;
}

const snackbar = (page: Page) => page.getByTestId('screening-keyword-snackbar');

/**
 * The positive control every "not handled" assertion needs. On the SAME live
 * workbench, a valid selection + plain Ctrl+I must add the phrase and the
 * confirmation must read "Added …" — never "Already in inclusion keywords". That
 * distinction is what rules out the false pass where the chord under test had in
 * fact added the keyword and the negative assertions merely raced ahead of it.
 */
async function expectChordStillWorks(page: Page): Promise<void> {
  await selectInAbstract(page, INCLUDE_PHRASE);
  const evt = await pressChord(page, 'Control+i', 'i');
  expect(evt.defaultPrevented).toBe(true);
  await expect(snackbar(page)).toContainText('Added');
  await expect(snackbar(page)).toContainText(INCLUDE_PHRASE);
}

test.describe('Screening — abstract keyword chords (108.md §1)', () => {
  test('@smoke a valid abstract selection + Ctrl+I adds an inclusion keyword and PecanRev owns the event', async ({ page, screeningProject }) => {
    const sift = await openAbstract(page, screeningProject.project.id);
    await selectInAbstract(page, INCLUDE_PHRASE);

    const evt = await pressChord(page, 'Control+i', 'i');

    // (a) PecanRev acted — the confirmation surface names the phrase and the list.
    await expect(snackbar(page)).toBeVisible();
    await expect(snackbar(page)).toContainText(INCLUDE_PHRASE);
    await expect(snackbar(page)).toContainText('inclusion keywords');

    // (b) …and it PERSISTED. The confirmation above only renders once the ops POST
    //     has RESOLVED, so a plain read here is deterministic — no polling needed.
    expect((await readKeywordLists(page, screeningProject.siftId)).include).toContain(INCLUDE_PHRASE);

    // (c) …and the browser default was suppressed, which is the only part of
    //     "the browser shortcut does not win" a page context can actually observe.
    expect(evt.ctrlKey).toBe(true);
    expect(evt.shiftKey).toBe(false);
    expect(evt.defaultPrevented).toBe(true);

    // The chord did not disturb the workbench (no navigation, no lost record).
    await expect(sift.main.getByTestId('screening-abstract')).toBeVisible();
  });

  test('@smoke a valid abstract selection + Ctrl+E adds an exclusion keyword and PecanRev owns the event', async ({ page, screeningProject }) => {
    await openAbstract(page, screeningProject.project.id);
    await selectInAbstract(page, EXCLUDE_PHRASE);

    const evt = await pressChord(page, 'Control+e', 'e');

    await expect(snackbar(page)).toBeVisible();
    await expect(snackbar(page)).toContainText(EXCLUDE_PHRASE);
    await expect(snackbar(page)).toContainText('exclusion keywords');
    expect((await readKeywordLists(page, screeningProject.siftId)).exclude).toContain(EXCLUDE_PHRASE);
    expect(evt.defaultPrevented).toBe(true);
  });

  test('@smoke with no selection, Ctrl+I is left to the browser', async ({ page, screeningProject }) => {
    await openAbstract(page, screeningProject.project.id);
    await clearSelection(page);

    const before = await readKeywordLists(page, screeningProject.siftId);
    const evt = await pressChord(page, 'Control+i', 'i');

    // 108.md §1: "If no valid abstract text is selected, the browser should retain
    // its normal behavior" — so the event must NOT be cancelled.
    expect(evt.defaultPrevented).toBe(false);
    await expect(snackbar(page)).toHaveCount(0);
    expect((await readKeywordLists(page, screeningProject.siftId)).include).toEqual(before.include);

    // …and the feature is not merely broken: the same chord over a real selection
    // still works on this very page.
    await expectChordStillWorks(page);
  });

  /**
   * THE §1 REGRESSION PIN. Before 108, `matchesShortcut` ignored `shiftKey`, so
   * Ctrl+Shift+I over a valid selection added a keyword AND opened DevTools (Chromium
   * dispatches the keydown but ignores preventDefault for its reserved accelerators).
   * A chord PecanRev cannot own must never be claimed.
   *
   * The follow-up plain Ctrl+I is the positive control: it proves the selection was
   * valid the whole time, so "nothing happened" cannot be a false pass. (Pressing the
   * two in this order is safe — the rejected chord causes no re-render, so the live
   * selection survives; a SUCCESSFUL add rebuilds the abstract and collapses it.)
   */
  test('@smoke Ctrl+Shift+I over a valid selection is never claimed (DevTools chord)', async ({ page, screeningProject }) => {
    await openAbstract(page, screeningProject.project.id);
    await selectInAbstract(page, INCLUDE_PHRASE);

    const shifted = await pressChord(page, 'Control+Shift+i', 'i');
    expect(shifted.shiftKey).toBe(true);
    expect(shifted.defaultPrevented).toBe(false);
    await expect(snackbar(page)).toHaveCount(0);
    expect((await readKeywordLists(page, screeningProject.siftId)).include).not.toContain(INCLUDE_PHRASE);

    // Positive control on the very same selection. "Added" (not "Already in
    // inclusion keywords") is the assertion that proves the Shift'd press really
    // did nothing, rather than the API read above simply racing it.
    const plain = await pressChord(page, 'Control+i', 'i');
    expect(plain.defaultPrevented).toBe(true);
    await expect(snackbar(page)).toContainText('Added');
    await expect(snackbar(page)).toContainText(INCLUDE_PHRASE);
  });

  test('with focus in the screening search box and no selection, the chord is not handled', async ({ page, screeningProject }) => {
    const sift = await openAbstract(page, screeningProject.project.id);

    // Focusing an input both puts us in an editable context AND collapses the
    // selection — either guard alone must be enough to leave the event alone.
    await sift.searchInput.click();
    await clearSelection(page);
    await expect(sift.searchInput).toBeFocused();

    const evt = await pressChord(page, 'Control+i', 'i');
    expect(evt.defaultPrevented).toBe(false);
    await expect(snackbar(page)).toHaveCount(0);
    // The search field is untouched — the chord did not type into it either.
    await expect(sift.searchInput).toHaveValue('');

    // Leaving the field (and making a real selection) restores ownership.
    await expectChordStillWorks(page);
  });

  /**
   * The meta path. Playwright resolves `ControlOrMeta` per PLATFORM (Meta on macOS
   * runners, Control elsewhere), not per engine — so on a Linux/Windows CI this runs
   * the ctrl path under WebKit rather than the ⌘ path. It is still the closest thing
   * the harness offers to "the chord a Safari user actually presses", and the pure
   * layer's metaKey matrix is pinned exhaustively in
   * tests/unit/screening/selectionShortcut.test.js.
   */
  test('@smoke ControlOrMeta+I adds an inclusion keyword (the platform-native chord)', async ({ page, screeningProject }) => {
    await openAbstract(page, screeningProject.project.id);
    await selectInAbstract(page, INCLUDE_PHRASE);

    const evt = await pressChord(page, 'ControlOrMeta+i', 'i');

    expect(evt.ctrlKey || evt.metaKey).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    await expect(snackbar(page)).toContainText(INCLUDE_PHRASE);
    expect((await readKeywordLists(page, screeningProject.siftId)).include).toContain(INCLUDE_PHRASE);
  });
});
