/**
 * overlayEscapeCoverage.test.js — 117.md §44 (r2 fix). THE COVERAGE PIN.
 *
 * WHAT THIS EXISTS TO PREVENT
 * ---------------------------
 * §44 makes an external fullscreen exit mean "return to the normal application
 * layout". Escape inside real fullscreen is not cancellable — the browser leaves
 * fullscreen whatever the page does with the key — so an Escape aimed at a DIALOG
 * produces a `fullscreenchange` indistinguishable from a deliberate exit. The single
 * thing that tells them apart is `markOverlayEscape()`, called by the overlay that
 * consumed the key (see src/frontend/focus/overlayEscapeLatch.js).
 *
 * The consequence of forgetting that call is not subtle and not local: dismissing an
 * export dialog, a chat drawer, a MeSH popover or a keyword menu ejects the researcher
 * from Focus Mode mid-thought. It is also invisible in review, because the overlay's
 * own behaviour is completely correct in isolation.
 *
 * So the rule is enforced STRUCTURALLY rather than per component: scan `src/` for every
 * place that consumes an Escape (stopPropagation / stopImmediatePropagation /
 * preventDefault near an `Escape` branch) and require each such FILE either to call
 * `markOverlayEscape` or to appear in the exemption list below WITH A REASON. A new
 * overlay written next year fails this test until its author makes that choice
 * deliberately — which is the only mechanism that keeps §44 true as the app grows.
 *
 * This is source scanning by design (tests/helpers/readSource.js pattern): the repo has
 * no jsdom, the behaviour is a call inside a DOM event handler, and "did every overlay
 * remember" is a property of the codebase, not of one render.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from '../../helpers/readSource.js';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/** Tokens that mean "this handler took the key away from everything above it". */
const CONSUMES = /stopPropagation|stopImmediatePropagation|preventDefault/;
/** How far below an `Escape` mention a consumption still counts as the same handler. */
const WINDOW = 7;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every source file that CONSUMES an Escape, as repo-relative posix paths. */
function escapeConsumers() {
  const hits = new Set();
  for (const file of walk(SRC)) {
    const lines = readSource(file).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('Escape')) continue;
      if (!CONSUMES.test(lines.slice(i, i + WINDOW).join('\n'))) continue;
      hits.add(path.relative(SRC, file).split(path.sep).join('/'));
      break;
    }
  }
  return hits;
}

/**
 * Files allowed to consume an Escape WITHOUT marking the latch. Every entry is a
 * decision, not an oversight; the reason is the point of the list.
 */
const EXEMPT = new Map([
  ['frontend/focus/FocusModeContext.jsx',
    'The CONSUMER of the latch, not a producer — it is the listener §44 is protecting.'],
  ['research-engine/interaction/shortcutRouter.js',
    'Documentation only: the word Escape appears in the tier-model comment, no handler here.'],
  ['frontend/pages/admin/users/RowMenu.jsx',
    'SCAN FALSE POSITIVE. Its Escape branch is `setOpen(false); btn.focus(); return;` — it '
    + 'neither stops propagation nor prevents default; the preventDefault the window '
    + 'catches belongs to the ArrowUp/Down roving-focus branch below it. A non-consuming '
    + 'dismissal has nothing to claim: the provider sees the key and Focus Mode exits, '
    + 'which is the same behaviour it had before 117 and is out of this fix\'s scope.'],
  ['features/manuscript/manuscriptPanels.jsx',
    'SCAN FALSE POSITIVE, same shape: `if (Enter) { preventDefault(); commit(); } '
    + 'if (Escape) reset();` — the preventDefault is on the ENTER branch. (This file is '
    + 'also owned by the concurrent references workstream this round.)'],
]);

/**
 * Files that consume AND mark. Listed explicitly as well as checked structurally, so a
 * deletion is visible in the diff as a removed line rather than only as a scan that
 * quietly finds one fewer file.
 */
const WIRED = [
  // Dialogs / drawers
  'frontend/components/Modal.jsx',
  'frontend/components/ExportDialog.jsx',
  'frontend/components/chat/ChatDrawer.jsx',
  'frontend/screening/ui/components.jsx',
  'frontend/pages/admin/users/primitives.jsx',
  'features/pecanSearch/components/SearchImportProgressModal.jsx',
  'frontend/rob/RobWorkspace.jsx',
  // Menus / popovers
  'frontend/screening/components/KeywordContextMenu.jsx',
  'features/manuscript/FactProvenanceCard.jsx',
  // 118.md §51/§52 — the manuscript toolbar's New-draft confirmation and its
  // '⋯' overflow menu are popovers, and both dismiss on Escape.
  'features/manuscript/ManuscriptToolbar.jsx',
  'features/searchBuilder/components/MeshDetailsPopover.jsx',
  'features/searchBuilder/components/TermEditorPopover.jsx',
  'features/searchBuilder/components/TermChipRow.jsx',
  'features/searchBuilder/components/ActiveConceptPanel.jsx',
  'features/searchBuilder/components/AddTermBox.jsx',
  'features/searchBuilder/SearchBuilderTab.jsx',
  // PDF surfaces
  'frontend/components/PdfAnnotationLayer.jsx',
  'frontend/components/AppPdfViewer.jsx',
  'features/extraction/engine/ArticleWorkspace.jsx',
  // Inline editors and transient gestures
  'frontend/workspace/tabs/analysisTabs.jsx',
  'frontend/rob/NosAssessmentPanel.jsx',
  'features/searchWorkspace/SearchWorkspace.jsx',
  'features/searchBuilder/dnd/useChipDrag.js',
  // The two that shipped with 117.md §44 in the first place
  'frontend/stitch/primitives/overlay.jsx',
  'frontend/stitch/shell/StitchAppShell.jsx',
];

describe('117.md §44 (r2) — every Escape consumer claims the fullscreen exit it causes', () => {
  const consumers = escapeConsumers();

  it('finds the consumers by scanning, not by trusting the list', () => {
    // Sanity: the scan works at all, and the two reference implementations are in it.
    expect(consumers.size).toBeGreaterThan(15);
    expect(consumers.has('frontend/stitch/primitives/overlay.jsx')).toBe(true);
    expect(consumers.has('frontend/screening/ui/components.jsx')).toBe(true);
  });

  it('NO consumer is missing markOverlayEscape unless it is exempt with a reason', () => {
    const missing = [];
    for (const rel of consumers) {
      if (EXEMPT.has(rel)) continue;
      const src = readSource(path.join(SRC, rel));
      if (!src.includes('markOverlayEscape')) missing.push(rel);
    }
    // The failure message IS the fix instruction — this test will be read by whoever
    // wrote the new overlay, months from now, with no other context.
    expect(
      missing,
      'These files consume an Escape but never call markOverlayEscape(). In Focus Mode '
      + 'that means dismissing the overlay also drops the whole workspace layout '
      + '(117.md §44). Import { markOverlayEscape } from the focus/overlayEscapeLatch.js '
      + 'module and call it immediately before the stopPropagation/preventDefault — or, '
      + 'if the key genuinely should leave Focus Mode, add the file to EXEMPT with a reason.',
    ).toEqual([]);
  });

  it('every EXEMPTION is still live — a stale one hides a real gap', () => {
    // Entries that exist to silence the HEURISTIC (an Escape branch that happens to sit
    // near an unrelated preventDefault) are not required to stay flagged: the scan
    // ceasing to trip on them is the good outcome, not a stale exemption. The two real
    // exemptions — the latch's own consumer and a documentation-only match — must still
    // be found, or the reason they are excused no longer applies to anything.
    const real = [...EXEMPT.entries()].filter(([, why]) => !why.startsWith('SCAN FALSE POSITIVE'));
    const stale = real.map(([rel]) => rel).filter((rel) => !consumers.has(rel));
    expect(stale, 'exempted files the scan no longer flags — delete these entries').toEqual([]);
    for (const [, reason] of EXEMPT) expect(reason.length).toBeGreaterThan(40);
  });

  it('every WIRED file really is a consumer, really imports the latch, and really calls it', () => {
    const notConsuming = WIRED.filter((rel) => !consumers.has(rel));
    expect(notConsuming, 'listed as wired but no longer consumes an Escape — drop it from WIRED').toEqual([]);
    for (const rel of WIRED) {
      const src = readSource(path.join(SRC, rel));
      expect(src, `${rel} must import the latch`).toMatch(/overlayEscapeLatch\.js/);
      expect(src, `${rel} must call markOverlayEscape()`).toMatch(/markOverlayEscape\(/);
    }
  });

  it('the latch module stays dependency-free, so any layer can import it', () => {
    const src = readSource(path.join(SRC, 'frontend/focus/overlayEscapeLatch.js'));
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it('the mark is placed BEFORE the key is consumed, in the reference implementations', () => {
    // Order matters in principle (the fullscreenchange is queued by the same press) and
    // reads as intent. Pinned on the two files every new overlay is copied from.
    for (const rel of ['frontend/stitch/shell/StitchAppShell.jsx', 'frontend/screening/ui/components.jsx']) {
      const src = readSource(path.join(SRC, rel));
      const mark = src.indexOf('markOverlayEscape();');
      const stop = src.indexOf('e.stopPropagation();', mark);
      expect(mark, rel).toBeGreaterThan(-1);
      expect(stop, rel).toBeGreaterThan(mark);
    }
  });
});
