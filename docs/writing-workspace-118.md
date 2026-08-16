# 118.md — The Writing Workspace: Toolbar, Dual Views, Neutral Export, Command-Center Overview

**Version:** v4.25.0 · **Date:** 2026-08-16 · **Prompt:** `.claude/Prompts/118.md`

Workflow per the prompt's model: Fable investigated (4 targeted readers), architected, delegated;
Opus agents implemented in two waves; an adversarial r2 review + fixes followed (§7 below).
Commits: `9252adb` toolbar/shell · `3bccd00` docx-neutral · `e62e628` continuous-view ·
`126d73f` overview (+ r2 fixes commit, see §7).

## 1. What was wrong

- The workspace had NO chrome hierarchy: a control row, a permanent yellow banner and 8
  CTA-styled buttons that all scrolled away and wrapped into the exact "wall of buttons"
  §41 forbids. Sub-tab state was `useState` only — every remount landed on Overview; no
  URLs, no persistence.
- Only one section could ever be edited at a time; there was no whole-document reading or
  editing surface.
- The exported .docx shipped **Word-blue headings** — not from app code, but from docx-lib's
  DefaultStylesFactory defaults (2E74B5/1F4D78), invisible to every existing assertion
  because they live in `word/styles.xml`, not `document.xml`. PRISMA/funnel figures carried
  decorative color into the file; the RoB figure was typeset in the app's UI font because
  `var(--t-font)` can never resolve in the off-DOM rasterizer (a latent bug).
- The Overview was 8-9 stacked card blocks that duplicated the toolbar's selects, buried
  the one honest readiness fraction mid-page, and never explained what the Updates badge
  number meant.

## 2. The toolbar (§3-9, §41-44, §47-48, §51-54)

`ManuscriptToolbar`: Level A — identity chip, Draft select, additive "New draft" with a §52
confirm popover that says nothing is deleted, `Template: X ▾` / `Citation style: X ▾` as
single semantic chips welded to NATIVE selects (keyboard/mobile pickers intact), the
auto-draft notice condensed to a chip with the full sentence on a keyboard-reachable ⓘ, and
the honest SaveStatusPill (now unique — the EditorPanel duplicate is gone). Level B — a
`role=tablist` underline nav with APG roving tabindex, a measured sliding indicator, the
live Updates badge (99+ capping with the true count in the accessible name), and the view
switcher. Sticky within the engine (verified by measurement against both shells and Focus
Mode — the scroller's top edge is already below the focus bar, so the offset is 0 with the
seam documented for hosts with in-scroller chrome). Four-tier ResizeObserver condensation
(full ≥1100 / compact ≥700 / overflow ≥520 / minimal), with a "⋯" overflow holding the
REAL live controls. `?ms=<subtab>` + `?msv=continuous` deep links in Stitch via the
established engine-sub-param contract with working Back/Forward; the legacy shell keeps
component state. Escape in toolbar popovers marks the 117 overlay latch.

## 3. Continuous View (§10-21)

The already-shipped AbstractEditor pattern (N editors, one toolbar via onActivate, one
native undo stack, one autosave path) generalized to section granularity. `ContinuousView`
renders title → abstract → every body section → declarations → a read-only bibliography
inside the ONE `.ms-paper` (~760px page), each section a live `RichSectionEditor` mounted
from the identical `editorProps(sectionId)` factory Section View uses — **one source of
truth by construction** (§13): there is no second manuscript representation, no per-view
buffers (the per-section text buffer was deleted outright), one commit path through
`queueEdit`, whose per-draft patch map already coalesces multi-section edits in one
debounce window. Seams widened per the investigation: `mainApi` → `Map<sectionId, api>`;
numbering from the hook's live-draft `citationOrderMap` memoized on the citation signature
(typing does not renumber 8 editors); popovers keyed by owning section + epoch; heading
navigation scoped per editor root; the reveal retry loops became direct scrolls. §15-17:
the outline sticks below the toolbar, clicks scroll with live-measured offset so headings
land visible, IntersectionObserver picks the topmost section in the reading band with
tops re-measured at decision time (jitter-free by construction; programmatic scrolls defer
the update; no-IO fallback = click-driven). §19: all ~10 sections eager-mount (the
AppPdfViewer precedent forbids blanking; virtualization deliberately rejected); cost is
argued structurally — root-scoped effects, memoized props, one orderMap identity per
citation change. View preference: per-user localStorage + URL, preference wins on first
paint, URL wins after the first toggle so Back/Forward walks view changes.

## 4. Neutral Word export (§22-27)

The audit found the exporter's own runs were already black — and the fix had a trap: the
factory's run merge is SHALLOW, so color-only overrides would have dropped Word's heading
sizes and flattened the §24 hierarchy. `styles.default` now restates title + heading1..6
with sizes and color `000000` (h5/h6 included beyond the brief so `styles.xml` provably
contains no blue for a journal template to inherit — the pin is a checkable property).
Bibliography: 0.25in hanging indent, paragraph-level only. Figures: `opts.monochrome` on
both PRISMA builders and the funnel; the docx + repro export monochrome at the ONE
figures.js seam while in-editor previews keep color — and "same drawing, same numbers" is
now a checked property: stripping every fill/stroke leaves the color and monochrome SVGs
byte-identical. RoB traffic light: Georgia serif like every other export figure (Okabe-Ito
judgment hexes kept — semantic, contract-pinned). Two non-vacuity tests prove the guards
can go red. Kept deliberately: Calibri 11pt, 1in margins, grey 999999 table borders,
Word-blue external links (Word's own convention), plain-black cross-references (§27).

## 5. The Overview command center (§28-40)

One narrative page of grouped rows: dismissible first-time intro → readiness with the
checklist's own honest fraction ("N of 11 readiness checks complete") and a "What counts
towards this?" disclosure → "Continue writing" implementing §31's rule exactly (max
`updatedAt` among USER-EDITED sections — generation stamps `updatedAt` too, which is
pinned — falling back to the first empty section) with a caption saying why → "Needs
attention" whose headline echoes the same count as the nav badge, explaining each outdated
section via cheap dependency diffs (the heavy sync plan is never triggered eagerly —
pinned) → the §32 structure summary over all 8 sections → Connected project data with the
real fetch stamp and a §50 failed-sources line → a Before-submission checklist computed
from `validateExport` codes with action jumps (errors "Blocks export", warnings "Needs a
look" — §55's contract intact) → authors → one canonical Export entry. Attention lists cap
with an honest "+N more" (a real empty project produced a 13-row wall). Everything
live-derived waits on `sourcesSettled` behind same-height skeletons; "unknown" is never
rendered as "synchronized" (§49/§69).

## 6. Verification

Unit: v4.24.1 baseline 556 files / 10,953 → **560 / 11,122** (every wave green; ~170 new
tests). Manuscript e2e grew 21 → **44 specs, all green** against the live stack (toolbar
sticky/URL/responsive/§52; §45 verbatim with server-side persistence checks; §15-18
navigation + in-continuous citation/cross-ref insertion; §16 scroll-activates-Discussion;
overview first-time/CTA/checklist jumps; real .docx download paths). Visual verification
in the running app at 1600px and 1280px caught two layout defects (fixed) and the 13-row
attention wall (capped). Both real .docx export paths exercised end-to-end.

## 7. r2 adversarial review

Two reviewers (one driving the live app, one unzipping a real export) — 11 findings, all
accepted and fixed in the r2 commit:
- **[critical, live-reproduced]** browser Back/Forward walking `?msv=` switched views
  WITHOUT flushing the 600ms debounce — typed text mounted stale in the other view and the
  next keystroke destroyed it permanently. The reconcile effect now flushes like the
  switcher always did; pinned by unit source-pin + an e2e that types across a Back.
- **[major]** in Continuous View, tool gating read the SCROLL-driven active section — a
  locked section entering the reading band disabled formatting/citation tools for a caret
  in an unlocked section. Gating now follows the caret owner.
- **[major]** the '⋯' overflow menu clipped off the left viewport edge at the very
  densities it exists for (measured x=-75 at 480px). Anchoring clamped/flipped.
- **[major]** the Overview checklist mapped a phantom validation code
  ('plain-mention-mismatch' vs the engine's 'plain-mention-out-of-range') — the §35
  numbering line could show Done while the export dialog warned; its unit fixture had
  fabricated the same phantom. Mapped to the real code, test made non-vacuous.
- **[minor ×7]** duplicate history entries on same-tab clicks/arrow roving; no visible
  formatting toolbar 4000px into the continuous document (now sticky under the manuscript
  toolbar); stale `activeApi` after a section regenerate silently no-oping the toolbar;
  ~350 lines of dead panel code deleted + the duplicated section-status rule collapsed
  into one shared module (chip-tone drift had already begun); 'Continue writing' could
  target a LOCKED section; '100% prepared' co-rendered beside '11 items missing' without
  acknowledgment (header now names outstanding missing-info counts); commit-sequencing
  nit — the continuous-view commit imports ManuscriptOverview.jsx one commit before its
  creation (two adjacent local commits; documented rather than rewriting entangled
  history).
What the reviewers VERIFIED (beyond finding bugs): the real exported .docx contains zero
library blue with heading sizes intact; hanging indents present; both embedded figure PNGs
fully monochrome while in-editor previews keep color; the repro bundle matches; the badge
number reconciles with the Overview headline in the staleBlocks corner states; skeleton
gating leaves no number that can flash before sources settle; §55's warnings-never-block
contract held everywhere.

## 8. Remaining limitations

1. ~~Abstract subsection editors don't thread citationStyle/chip-menu callbacks~~ **CLOSED (r3)** —
   `editorProps` now projects a `sharedFieldProps(id)` bag (registry + fact layer + citation
   layer + both chip callbacks), `abstractProps` hands it to `AbstractEditor` as `fieldProps`
   with the owning section reported as `'abstract'`, and every subsection editor spreads it.
   Cite chips in the abstract carry the draft's style (Harvard author-year included) and open
   the same hover card / action menu the body sections do, in BOTH views. `onTableFocus` is
   deliberately NOT threaded: the floating table controls are still not rendered over the
   abstract in Section View, so reporting a caret's table context there would set state
   nothing consumes.
2. ~~`m.liveDraft` overlay can survive a regeneration momentarily~~ **CLOSED (r3)** — each
   pending overlay entry now carries the `lastGeneratedAt` it was typed under, and the drop
   rule (pure `MS.settleLiveSections`) invalidates an entry whose stamp moved. A generation
   rewrites the section, so text typed before it is superseded by definition and can never
   match again; the old match-only rule kept it forever. Per-entry: sections nobody
   regenerated keep their pending text.
3. §19 is verified structurally, not benchmarked against a 50-section manuscript (the real
   maximum is ~10 sections).
4. Toolbar wraps the switcher under the tab row at 'compact' density (reachable, not pretty).
5. (cleaned in r2 — 286 lines of dead panel code deleted; the section-status rule now
   lives in one shared module with the Overview's 4-tone palette canonical.)
5b. Behaviour change worth knowing: the workspace tablist uses APG MANUAL activation —
   arrow keys move focus, Enter/Space activates (kills history spam + accidental heavy
   sync-plan runs; anyone used to automatic activation will notice).
5c. In Continuous View, a popover anchored very near the viewport top can pass under the
   pinned format toolbar (normal sticky-chrome behaviour; Section View unaffected). Tool
   enablement before the first caret click is permissive, with a runtime locked-target
   guard refusing wrong writes.
6. The Overview's checklist validates the live draft (fact tokens unresolved); the export
   dialog remains the authoritative check (codes agree in practice — documented in code).
7. §68 browser matrix: chromium-verified end-to-end; firefox/webkit inherit the 117-era
   engine coverage (the editor surfaces are the same contentEditable machinery), and the
   known machine-level Firefox binary-MIME stall still blocks its PDF-adjacent specs.

## 9. Recommended follow-ups

1. ~~Thread citation style + chip callbacks through AbstractEditor (§8.1).~~ **done (r3)**
2. ~~Fix the liveDraft overlay drop rule after regeneration (§8.2).~~ **done (r3)**
3. ~~Collapse the duplicated section-status rule~~ — already collapsed in r2 (§7, minor 7);
   the r3 pass collapsed the OTHER duplicate the review flagged: Section View's title branch
   (literal hex) and Continuous View's title block (INK) were two copies of the same UI. One
   `TitleBlock` component now serves both (INK canonical — the paper is literally white in
   both themes), testids unchanged (`stitch-manuscript-title-input`, plus a new
   `stitch-manuscript-title-block` wrapper). State stays with each caller: the two views have
   different remount rules for the title buffer and the component stores nothing. One visual
   consequence: Section View's title/keywords rule spacing is now the document's
   (14px above / 10px below instead of 22px / 18px).
4. A journal-template-driven reference indent (the 0.25in hanging indent is conventional).
5. Word SEQ fields for figure/table numbering (behavior change; deliberate 117-era cut).
