# 121.md — Symbols, PDF Split Correctness, Export Reveal, Exact-Line Insertion

**Version:** v4.29.0 · **Date:** 2026-08-17 · **Prompt:** `.claude/Prompts/121.md`

**Validation at close:** unit 601 files / 12,341 tests green · the round's eight
manuscript e2e specs 62 green (chromium) · `webkit-manuscript` 43 green / 3
pre-existing skips · `e2e/focus` 8/8 · production build green. Two review rounds:
r1 (live-browser debugging of the delivered insertion path — four measured root
causes fixed) and r2 (three adversarial lenses + refute-first verification — 10
findings, 5 reproduced majors, all 10 fixed with regression tests; the pad
mechanism's accumulation and formatted-run refusal, the list-ending escape, the
dead asset "Go to it", plus five triaged minors).

Four features on the v4.28.0 editor: a comprehensive Symbols picker (§1), the PDF
split's fullscreen/divider corrections (§2), auto-revealed export validation (§3),
and the intermittent citation-on-the-next-line defect (§4) — consolidated onto one
shared, editor-safe insertion utility per §4's mandate. Two parallel waves
(editor/insertion · workspace/layout), adversarially reviewed before landing.

## 1. Root cause of each defect

**§4 — "inserted on the next line" is a family of five block-boundary caret
errors, not one bug** (each verified with Node reproductions against the pure
bookmark module):

1. *Dominant:* the session bookmark and the selected-text contract both did a bare
   `collapse(false)`. Blink's paragraph/line-granularity selections (triple-click a
   sentence, drag past a line end, Shift+Down) END at `(nextBlock, 0)` — so the
   bookmark honestly recorded the NEXT paragraph at offset 0, every validity check
   passed, and the chip landed at the start of the following line. Explains
   "intermittent" (only boundary-ending selections) and "browser-specific" (WebKit
   triple-click stops at the paragraph end). A `hadSelection` flag that could have
   gated normalization was recorded but never read.
2. Logical resolution into an EMPTY paragraph collapsed AFTER the placeholder
   `<br>` (`selectNodeContents` + `collapse(false)` ⇒ `(p, 1)` by DOM spec), so the
   chip rendered on a second visual line inside the very paragraph the caret was in.
3. Empty-context aliasing (the 120 round's documented open F17, generalized): the
   direct block-index hit had no uniqueness guard and an empty-context bookmark
   matches ANY still-empty block — after a remount drops an unpersisted empty
   paragraph, resolution deterministically found the §3 trailing affordance.
4. Null-logical bookmarks (selection end at root level, e.g. select-all) were
   trusted "best effort" and inserted BETWEEN blocks — which the serializer then
   persisted as the chip's own paragraph: the only variant that survived reload.
5. Soft-break `<br>` invisibility: carets before and after a `<br>` snapshot
   identically (a `<br>` contributes nothing to text offsets), so restored carets
   resolved onto the previous visual line; after a remount the break becomes two
   paragraphs and spanning bookmarks refused.

Exonerated by the audit: the chips' trailing `&nbsp;` (serializer-trimmed —
caused post-remount refusals, not line movement), and every emit-path repair
(attribute-only; the DOM is render-once; renumbering rewrites text in place).

**§2 — "opening the PDF viewer enters fullscreen" was literally true.** Focus
Mode (the rails-hidden layout) and browser fullscreen (the 114.md bridge) are two
states in the code, but `setFocus` had NO layout-only entry — it always called the
bridge's `enter()`, which requests `documentElement.requestFullscreen`. The 119 §4
effect that drives Focus Mode when the split opens therefore auto-fullscreened the
browser on every click-open (and, without user activation on deep links, landed in
a refused/windowed state — so link-open and click-open behaved differently). In
the legacy shell the effect flipped global focus state the shell never renders.
The fullscreen partial-fill had two constraint chains: a hardcoded pane height of
`calc(100vh - 150px)` matching no real chrome configuration (leaving a dead strip
that never resized), and the manuscript stage not being a fullbleed stage (shell
max-width cap + rounded card frame + content padding ≈ 86px of unused width).
The divider was functionally complete (keyboard, ARIA, clamp, 50/50 reset,
persistence) but visually a transparent 16px gutter with a 3px hover-only bar —
undiscoverable, which is exactly what the report said.

**§3 — export feedback rendered above the fold and stayed there.** The validation
dialog and error banner mount above the panel host (correct placement) but nothing
scrolled or focused them; the dialog carried `role="alertdialog"` on a non-modal
in-flow card (announced as a dialog focus never enters); the four per-panel error
boxes had no live-region semantics at all; and the validation layer discarded the
section/asset/reference identities its producing sites already held — which alone
blocked "navigate directly to it", because every needed navigation callback
already existed.

**§1 — no symbols capability existed;** no equation system exists anywhere in the
codebase (confirmed), so the picker targets ordinary prose and caption-title
islands. The model transports plain Unicode losslessly; the only unsafe entries
are ASCII markdown metacharacters and U+00A0 (silently folded to a space on
save) — a catalog-level validation rule, enforced by test.

## 2. Files and components changed

**§1/§4 (editor wave):** `richEditor/symbolCatalog.js` (new — 17 categories, 508
rows/430 unique characters, every row `{ch,name,aliases,latex,cp}` with cp derived;
search haystack over name/alias/char/`U+03B1`/`03b1`/`3b1`/`0x3b1`/LaTeX;
`validateSymbolEntry` + per-user prefs rules) · `richEditor/SymbolPicker.jsx` (new —
popover shell × roving-tabindex keyboard grid, favorites/recents pinned first,
`metalab.symbolPicker.<uid>`) · `richEditor/insertionSession.js` (new — see §3) ·
`RichSectionEditor.jsx` (the five §4 fixes + the r1 debugging fixes + `api.insertSymbol`
+ the symbol font stack + the ribbon mount) · `caretBookmark.js` (nbsp folding,
end-trim tolerance, neighbor context for empty blocks) · `manuscriptPanels.jsx`
(session glue) · `playwright.config.ts` (webkit-manuscript testMatch widened to an
array — naming honesty, no smuggling).

**§2/§3 (workspace wave):** `FocusModeContext.jsx` (`setFocus(on,{fullscreen})`) ·
`ManuscriptWorkspace.jsx` (windowed-focus drive + legacy gating, `splitFills`
bounded column, the reveal effect + `exportRevealKey` + `goToFinding` +
`openEditorDestination`) · `PdfSplitPane.jsx` (`bounded` prop replacing
`calc(100vh−150px)`; the visible divider: hairline + `‹›` grip + shared Tooltip) ·
`StitchProjectWorkspace.jsx` (fullbleed seam keyed on split state, not stage) ·
`manuscriptPanels.jsx` (`ExportFeedbackRegion`, alert/status semantics, per-row
"Go to it") · `exportValidation.js` (structured targets from nine producing sites) ·
`ContinuousView.jsx` (shared scroll-suppress latch, `useReducedMotion`) ·
`ManuscriptOverview.jsx` (echo demoted to unannounced).

## 3. Shared editor utilities introduced or modified

`insertionSession.js` — the §4:168 mandate: one session lifecycle
(begin/end/withBookmarkedCaret) + one payload policy ({kind:'chip'} → sacrificial
span + configurable nbsp separator; {kind:'text'} → raw escaped text, no wrapper,
no nbsp) consumed by citations, cross-references AND symbols; a DEV postcondition
asserts the inserted node's line block equals the bookmarked one.
`prepareCaret`/`commitInsertion` in the editor own the DOM half; the r1 round
added `snapCaretOutOfAtomic` (never insert inside a chip), `rootInlineCaret`
(trust root-level INLINE carets, refuse between-block ones), `endOfBlockPad`
(one serializer-invisible nbsp defeating Blink's measured eject-element-at-
end-of-block behavior), and branch (c) of the boundary snap (a selection ending
inside a media island snaps to the last real line it covered).
`setFocus(on, {fullscreen:false})` — the layout-only Focus entry (rails hidden,
no fullscreen request); the split drives it; the default path is byte-identical.
The export reveal seam — `ExportFeedbackRegion` + one rAF effect keyed on stable
identity, reusing `scrollSectionIntoView`/`nearestScroller`/`stickyFloor`.

## 4. Automated tests added

Unit: `symbols121` (20 — incl. whole-catalog round-trip identity + per-entry
safety invariants), `caretInsert121` (33 — the audit's Node repro boundary cases
as regression pins + r1 pad/branch-(c) pins), `exportReveal121` (30),
`pdfSplit121` (13), `focusMode` +5; deliberate re-pins in caretInsert120,
richEditor, continuousView118, toolbar118, exportUi, pdfSplit119. E2E:
`manuscript-symbols-121` (5), `manuscript-insert-caret-121` (6, triple-click/
cross-block/empty-paragraph/affordance/remount/one-undo journeys),
`manuscript-export-reveal-121` (9, parameterized Section/Continuous × normal/
split + stacked + fullscreen legs), `manuscript-pdf-split` +4 (real mouse drag in
regular AND fullscreen, no-auto-fullscreen assertion, fill measurement); new
shared `e2e/helpers/manuscript.ts`.

## 5. Manual scenarios tested

Per the 119/120 convention, stated honestly: no human manual pass this round. The
r1 debugging round drove the live editor interactively under instrumentation
(wrapped `execCommand`, DOM/selection dumps) — that is how the Blink
eject-at-end-of-block matrix and the WebKit caption-island selection reach were
measured — and every user journey in the §121 testing matrix is automated.
Outstanding for a human: the real-Safari checklist (unchanged), the divider's
feel under a real drag, and the windowed-focus visual in the legacy shell.

## 6. Browser-specific findings

- **Blink**: `execCommand('insertHTML')` moves an inserted ELEMENT out of the
  block when the caret sits at the very end of the block's content (measured
  matrix in-code; text is unaffected). The fix is a single serializer-invisible
  trailing `&nbsp;` pad, made caret-transparent in r2 after review found the
  accumulation and formatted-run refusal cases.
- **Blink**: triple-click/paragraph-granularity selections end at the next
  block's `(0)` — the dominant §4 cause; WebKit's stop at the paragraph end is
  why the defect read as browser-specific.
- **WebKit**: paragraph-granularity selections can reach INTO a following
  caption island (branch (c) of the boundary snap now covers it); headless
  WebKit cannot grant `requestFullscreen`, so fullscreen fill is e2e-proven on
  Chromium and covered by unit pins + the coverage-matrix manual item elsewhere.
- **Pre-existing, flagged not fixed**: WebKit-only, inserting a table with the
  caret at the end of a real paragraph hoists the caption's derived number span
  into that paragraph (119 §2 territory; invisible until the §4 spec inserted
  tables at end-of-paragraph; the WebKit table suite is green so it was left for
  its own round).

## 7. Remaining limitations and follow-ups

1. The WebKit table-insert caption-number hoist above (documented repro in the
   r1 report; belongs to the 119 §2 insertion path).
2. The Symbols picker closes on insert (v1); a stay-open multi-insert needs
   session re-arming and was deliberately not built.
3. `AbstractEditor` fields receive symbols via the shared toolbar routing but
   have no dedicated spec.
4. Statement-anchored citation findings (`statement:<key>`) omit the "Go to it"
   control honestly (no cross-view navigation target exists).
5. The narrow stacked split keeps the legacy pane height (the reported defect
   was the side-by-side layout; extending the bounded column to stacked is a
   two-line follow-up).
6. The remount-while-picker-open e2e accepts either lawful outcome (in-block
   resolve or honest refusal) by design.
7. Real-Safari manual checklist remains outstanding (Windows-only environment).
