/**
 * workbenchLayout116.test.jsx — 116.md §20/§126 (validation).
 *
 * The measured defect: in the Title & Abstract workbench the record list (300px) and
 * the filters sidebar (320px) both had `flexShrink: 0` and the centre column had no
 * `minWidth`, so every pixel of shortfall came out of the centre. Measured at
 * 1280×720 with the workspace rail pinned, the workbench gets 752px:
 *
 *     .sift-rl 299 · .sift-mid 132 · .sift-rt 320 → PDF viewer 74px → fit-width 0.095×
 *
 * This file pins the rule that closes it, in the two layers the project allows:
 *   1. the ARITHMETIC as a pure function (no jsdom — plain Node);
 *   2. the COMPONENTS via renderToStaticMarkup, proving the default/unmeasured render
 *      is byte-for-byte the shipped wide layout and the floors only appear once a
 *      width has actually been measured.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import {
  WORKBENCH_COLUMNS, rightPanelMinWidth, resolveWorkbenchLayout,
  readPanelPrefs, DEFAULT_PANEL_PREFS,
} from '../../../src/frontend/screening/lib/workbenchLayout.js';
import { MiddleColumn } from '../../../src/frontend/screening/tabs/ScreeningTab.jsx';

/** The three viewports the defect was measured at, as WORKBENCH width (window minus
 *  the pinned 248px workspace rail and the 280px engine submenu). */
const W1280 = 752;
const W1440 = 912;
const W1920 = 1392;

/** What the flex row actually gives the centre for a resolved layout. */
function midWidth(width, layout, { leftCollapsed = false } = {}) {
  const { leftWidth, railWidth, rightWidth } = WORKBENCH_COLUMNS;
  const rightUsed = layout.rightCollapsed ? railWidth : rightWidth;
  const leftFloor = leftCollapsed ? railWidth : (layout.leftMinWidth ?? leftWidth);
  const leftWanted = leftCollapsed ? railWidth : leftWidth;
  const free = width - leftWanted - rightUsed;
  // `flex: 1` takes the free space; its min-width then borrows back from the record
  // list, which can give up to (leftWanted - leftFloor).
  return Math.max(free, Math.min(layout.midMinWidth ?? 0, width - leftFloor - rightUsed));
}

/** The PDF panel and pdf.js fit-width scale that a centre column of `mid` produces.
 *  Both constants are measured, not assumed: viewer = mid − 58 (28px page padding
 *  either side + the panel border), canvas = viewer − 16, US-Letter page = 612pt. */
const viewerWidth = (mid) => mid - 58;
const fitWidthScale = (mid) => (viewerWidth(mid) - 16) / 612;

/* ── 1. The arithmetic ───────────────────────────────────────────────────────── */

describe('resolveWorkbenchLayout — unmeasured (SSR / first paint)', () => {
  it('resolves to the shipped wide layout: no collapse, no floors', () => {
    for (const width of [undefined, null, 0, -1, NaN, 'wide']) {
      const l = resolveWorkbenchLayout({ width });
      expect(l.measured).toBe(false);
      expect(l.rightCollapsed).toBe(false);
      expect(l.rightAutoCollapsed).toBe(false);
      // `null` means "emit no such CSS property", i.e. today's markup exactly.
      expect(l.leftMinWidth).toBeNull();
      expect(l.midMinWidth).toBeNull();
    }
  });

  it('still honours an explicit choice made before the first measurement', () => {
    expect(resolveWorkbenchLayout({ width: 0, rightPreference: true }).rightCollapsed).toBe(true);
  });
});

describe('resolveWorkbenchLayout — the automatic narrow-window collapse', () => {
  it('keeps both side columns open on a wide workbench (1920×1080 is unchanged)', () => {
    const l = resolveWorkbenchLayout({ width: W1920 });
    expect(l.rightCollapsed).toBe(false);
    expect(midWidth(W1920, l)).toBe(772); // exactly what it measured before the fix
    expect(l.leftMinWidth).toBe(WORKBENCH_COLUMNS.leftMinWidth); // shrinkable, but unused
  });

  it('collapses the filters sidebar exactly at its own threshold, not one px early', () => {
    const t = rightPanelMinWidth();
    expect(t).toBe(WORKBENCH_COLUMNS.leftMinWidth + WORKBENCH_COLUMNS.rightWidth + WORKBENCH_COLUMNS.midMinWidth);
    expect(resolveWorkbenchLayout({ width: t }).rightCollapsed).toBe(false);
    expect(resolveWorkbenchLayout({ width: t - 1 }).rightCollapsed).toBe(true);
  });

  it('uses a LOWER threshold when the reviewer already collapsed the record list', () => {
    expect(rightPanelMinWidth({ leftCollapsed: true }))
      .toBeLessThan(rightPanelMinWidth({ leftCollapsed: false }));
    // 800px with the record list on a rail seats both: 38 + 320 + 420 = 778.
    expect(resolveWorkbenchLayout({ width: 800, leftCollapsed: true }).rightCollapsed).toBe(false);
    expect(resolveWorkbenchLayout({ width: 800, leftCollapsed: false }).rightCollapsed).toBe(true);
  });

  it('never collapses the record list itself — it is the primary navigation', () => {
    // The only lever the rule has on the left column is a shrink floor, never a hide.
    for (const width of [400, 752, 912, 1392]) {
      const l = resolveWorkbenchLayout({ width });
      expect(Object.keys(l)).not.toContain('leftCollapsed');
      expect(l.leftMinWidth).toBe(WORKBENCH_COLUMNS.leftMinWidth);
    }
  });
});

describe('resolveWorkbenchLayout — the centre gets a readable PDF at every measured size', () => {
  const cases = [
    { name: '1280×720 (rail pinned)', width: W1280 },
    { name: '1440×900 (rail pinned)', width: W1440 },
    { name: '1920×1080 (rail pinned)', width: W1920 },
    { name: '1280×720 (rail unpinned)', width: 1280 - 72 - 280 },
    { name: '1440×900 (rail unpinned)', width: 1440 - 72 - 280 },
  ];
  for (const { name, width } of cases) {
    it(`${name}: fit-width lands in a readable range, never 0.095×`, () => {
      const mid = midWidth(width, resolveWorkbenchLayout({ width }));
      expect(mid).toBeGreaterThanOrEqual(WORKBENCH_COLUMNS.midMinWidth);
      expect(viewerWidth(mid)).toBeGreaterThan(300);
      expect(fitWidthScale(mid)).toBeGreaterThanOrEqual(0.5);
    });
  }

  it('the 1280×720 regression case specifically: 132px centre → 420px centre', () => {
    const l = resolveWorkbenchLayout({ width: W1280 });
    expect(l.rightCollapsed).toBe(true);
    expect(l.rightAutoCollapsed).toBe(true);
    expect(midWidth(W1280, l)).toBe(420);
    expect(viewerWidth(420)).toBe(362);
    expect(fitWidthScale(420)).toBeGreaterThan(0.55);
  });
});

describe('resolveWorkbenchLayout — an explicit choice outranks the width rule', () => {
  it('a reviewer who opens the sidebar on a narrow window keeps it open', () => {
    const l = resolveWorkbenchLayout({ width: W1280, rightPreference: false });
    expect(l.rightCollapsed).toBe(false);
    expect(l.rightAutoCollapsed).toBe(false); // the rail must not claim the app did it
  });

  it('a reviewer who closes the sidebar on a wide window keeps it closed', () => {
    const l = resolveWorkbenchLayout({ width: W1920, rightPreference: true });
    expect(l.rightCollapsed).toBe(true);
    expect(l.rightAutoCollapsed).toBe(false);
  });

  it('the forced-open narrow case still beats the shipped bug and never overflows', () => {
    const l = resolveWorkbenchLayout({ width: W1280, rightPreference: false });
    const { leftMinWidth, rightWidth } = WORKBENCH_COLUMNS;
    // The floor is CLAMPED to what is left, so the row can never exceed its container
    // (which would clip a side column behind `overflow: hidden`).
    expect(l.leftMinWidth + rightWidth + l.midMinWidth).toBeLessThanOrEqual(W1280);
    expect(l.midMinWidth).toBe(W1280 - leftMinWidth - rightWidth); // 192
    expect(l.midMinWidth).toBeGreaterThan(132); // the measured pre-fix centre
  });

  it('clamps to no floor at all rather than overflowing a genuinely tiny container', () => {
    const l = resolveWorkbenchLayout({ width: 400, rightPreference: false });
    expect(l.midMinWidth).toBeNull();
  });
});

describe('readPanelPrefs — what counts as an explicit choice', () => {
  it('treats a missing / unusable blob as "no choice made"', () => {
    for (const v of [null, undefined, '', 0, 'nope', []]) {
      expect(readPanelPrefs(v)).toEqual(DEFAULT_PANEL_PREFS);
    }
    expect(readPanelPrefs({})).toEqual(DEFAULT_PANEL_PREFS);
  });

  it('reads an explicit flag back verbatim, in both directions', () => {
    expect(readPanelPrefs({ rightCollapsed: false, rightChosen: true }))
      .toMatchObject({ rightCollapsed: false, rightChosen: true });
    expect(readPanelPrefs({ rightCollapsed: true, rightChosen: true }))
      .toMatchObject({ rightCollapsed: true, rightChosen: true });
    // Explicitly "let the width decide again" is honoured too.
    expect(readPanelPrefs({ rightCollapsed: true, rightChosen: false }).rightChosen).toBe(false);
  });

  it('infers the flag for pre-116 blobs: a stored collapse WAS a deliberate one', () => {
    expect(readPanelPrefs({ rightCollapsed: true }).rightChosen).toBe(true);
    // …but the shipped default never becomes a "choice" that would defeat the rule.
    expect(readPanelPrefs({ rightCollapsed: false }).rightChosen).toBe(false);
    expect(readPanelPrefs({ leftCollapsed: true }).rightChosen).toBe(false);
  });

  it('feeds resolveWorkbenchLayout so a legacy collapse still wins on a wide screen', () => {
    const prefs = readPanelPrefs({ rightCollapsed: true }); // pre-116 blob
    const l = resolveWorkbenchLayout({
      width: W1920,
      rightPreference: prefs.rightChosen ? prefs.rightCollapsed : null,
    });
    expect(l.rightCollapsed).toBe(true);
    expect(l.rightAutoCollapsed).toBe(false);
  });

  it('coerces junk values rather than leaking them into the layout', () => {
    const p = readPanelPrefs({ leftCollapsed: 'yes', rightCollapsed: 1, rightChosen: 'maybe' });
    expect(p).toEqual({ leftCollapsed: true, rightCollapsed: true, rightChosen: true });
  });
});

/* ── 2. The components (SSR static markup — project convention, no jsdom) ─────── */

const midProps = (over = {}) => ({
  record: { id: 'r1', title: 'A trial of something', includeCount: 0 },
  loading: false, canScreen: true, pid: 'p1',
  decision: '', excReason: '', notes: '', rating: 0,
  reasons: [], labels: [], chosenLabels: [],
  setExcReason() {}, setNotes() {}, setRating() {}, setReasons() {}, toggleLabel() {},
  onDecisionClick() {}, onUndo() {}, onSaveDetails() {},
  recordIndex: 0, recordCount: 8, totalCount: 8, onPrev() {}, onNext() {},
  ...over,
});

/** The `style` of the OUTER .sift-mid element only (the subtree is full of the
 *  unrelated `min-width:0` overflow guards every truncating row already carries). */
function rootStyle(html) {
  const m = /^<div class="sift-mid" style="([^"]*)"/.exec(html);
  expect(m, 'MiddleColumn should still render <div class="sift-mid" style="…"> first').not.toBeNull();
  return m[1];
}

describe('MiddleColumn — the reading floor is opt-in, so SSR is unchanged', () => {
  it('emits NO min-width on the column when no floor is supplied (SSR / older callers)', () => {
    // Byte-exact: this IS the shipped wide-case markup, unchanged by 116.
    expect(rootStyle(r(h(MiddleColumn, midProps()))))
      .toBe('display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden');
  });

  it('emits the resolved floor when one is supplied, without losing flex growth', () => {
    expect(rootStyle(r(h(MiddleColumn, midProps({ minWidth: 420 })))))
      .toBe('display:flex;flex-direction:column;flex:1;min-width:420px;min-height:0;overflow:hidden');
  });

  it('applies the same floor to the loading and empty states', () => {
    expect(rootStyle(r(h(MiddleColumn, midProps({ record: null, loading: true, minWidth: 420 })))))
      .toBe('flex:1;min-width:420px;overflow-y:auto;padding:28px');
    expect(rootStyle(r(h(MiddleColumn, midProps({ record: null, loading: false, minWidth: 420 })))))
      .toContain('min-width:420px');
    // …and neither of them carries one without it.
    expect(rootStyle(r(h(MiddleColumn, midProps({ record: null, loading: true })))))
      .toBe('flex:1;overflow-y:auto;padding:28px');
    expect(rootStyle(r(h(MiddleColumn, midProps({ record: null, loading: false })))))
      .not.toContain('min-width');
  });
});
