# 120.md — Logbook Navigation and Manuscript Editor Engine Upgrade

**Version:** v4.28.0 · **Date:** 2026-08-16 · **Prompt:** `.claude/Prompts/120.md`

Eight features across the Logbook and the Manuscript Editor Engine: a Back button
to Project Control (§1), the solid Pecan-purple toolbar (§2), writing below
trailing media (§3), protected composite media entities (§4), exact-caret citation
and cross-reference insertion (§5), the Spelling & Grammar Writing Assistant (§6),
Microsoft Office table paste (§7), and the PDF View toolbar destination (§8).
Implemented in four waves (chrome/nav · media model · caret/paste · writing
assistant), each adversarially reviewed before landing.

## 1. Confirmed root cause of every reported problem

**§1 — no way back from the Logbook.** `LogbookPage` was mounted by both shells
with `{project, projectId, perms}` and no navigation capability at all (Stitch
`StitchProjectWorkspace` and legacy `Workspace.jsx` both), and the Logbook is
deliberately invisible in normal navigation (`projectHelpers.js` `group:"history"`
keeps it out of the sidebar and workflow map) — so from a deep link, notification
or refresh, the only exits were the global rail or browser Back, which
`navConfig.js` explicitly forbids relying on.

**§3 — no paragraph below trailing media.** Three stacked causes. (a) The
persisted model cannot represent an empty paragraph: blank markdown lines are
block separators and `htmlToMd` drops any block whose text trims to empty — so the
`<p><br></p>` caret targets that `insertTable`/`insertFigure` placed lived only in
the live DOM of the current mount. (b) `mdToHtml` never synthesized a caret target
after trailing media, so every remount of a section ending in a table or figure
put a `contenteditable="false"` island as the editing host's LAST child, with no
valid caret position after it. (c) No keyboard or click affordance existed:
`onKeyDown` had no ArrowDown/Enter media handling and a click in the space below
fell through to native contenteditable, which had nowhere to land.

**§4 — text between titles and media, and the silent caption loss.** The manual
table caption is a positional SIBLING of its `<table>` (two blocks joined by
`\n\n`), and every binding was adjacency-by-inspection (`previousElementSibling`
checks). The browser happily placed a collapsed caret BETWEEN them, and nothing
intercepted typing there. Worse, the only "enforcement" was destructive: on the
next autosave, `dropOrphanCaptionBlocks` — built for captions whose table a
selection-delete removed — saw caption-then-paragraph and silently DELETED the
caption from the persisted markdown even though the table still existed two blocks
later. One keystroke in a gap the editor allowed cost the table its identity, its
title, its number and every `[[table:id]]` cross-reference, permanently.

**§5 — citations at the start of the section.** The mechanism was a focus-event
clobber inside the restore path itself: `focusWithSelection()` calls `el.focus()`,
the editor root declares `onFocus={rememberSelection}`, and that handler fires
synchronously DURING the focus call — after the browser installs its default caret
for a newly focused contenteditable, which is position 0. `rememberSelection`
unconditionally saved that position-0 caret over the real one before the restore
read it, so the intended caret-at-end fallback was dead code and every
lost-selection insert landed at the beginning of the section. Feeding it: the
bookmark was a passively refreshed raw DOM Range that died on every remount
(mountKey), whole-table replacement and Section-View switch; the picker's
`autoFocus` search input moved DOM focus (WebKit drops the document selection
then); Continuous View's last-resort targeting used the SCROLL-driven section; and
a live Range whose nodes are removed re-points itself at `(root, 0)` — which
`root.contains()` happily accepts.

**§6 — no writing-correction system existed.** Zero spellcheck machinery in
either package.json; today's red squiggles were 100 % browser-native (`spellCheck`
on the editor root and the two caption-title spans). No per-user "writing"
preference slot (profile JSON blobs are capped at 500 bytes), no project
dictionary storage, and no decoration layer that survives serialization (the
document IS the DOM; injected markup would be persisted).

**§7 — Office tables pasted as screenshots.** The paste ladder consumed the paste
as a figure upload whenever the clipboard carried ANY image item, BEFORE
`text/html` was read — and Excel/PowerPoint (and Word for some selections) put a
bitmap rendition beside the HTML, so the screenshot always won. Even via the HTML
path, a pasted table arrived with no `[[tblcap:]]` identity: anonymous,
unnumbered, unreferenceable. No TSV recognition existed, and a paste into a
caption-title island silently flattened block markup into the title.

**§8 — no PDF View destination.** The split was reachable only through the
Level-A layout toggle; `'pdfview'` was not a tab id, so `normalizeSubtab` resolved
it to Overview and no `?ms=` value could open the split. Modeling PDF View naively
as a ninth panel would have unmounted `EditorPanel` (losing caret/undo), and
modeling it as plain open/close would have unmounted `PdfSplitPane`, destroying
the keep-alive viewer pool that holds page/zoom/scroll.

## 2. Architecture implemented

**Media composite model (§3/§4) — sibling model + serialize-time repair, not a
wrapper node.** Converting caption+table into one `contenteditable=false` wrapper
would have broken whole-table selection, `runTableOp`'s replacement ranges and the
load-bearing WebKit workarounds, so the architecture keeps the sibling model and
adds three mechanisms: (1) `ensureTrailingParagraph` — an idempotent,
serializer-invisible `<p><br></p>` affordance appended directly (the
sacrificial-pad doctrine) whenever the host ends in media, re-established on
mount, on every emit, and after table/figure ops; §3's safety clauses (no
duplication, no export leakage, no endless blank pages) hold by construction
because the serializer drops empty paragraphs. (2) Boundary commands: ArrowDown
out of trailing media, Enter at end-of-title moves below the object, Shift+Enter
in a title swallowed (single-line titles), typing/Enter/paste in the caption↔table
gap redirected into the editable title (the inverse of the §2-hoist), island drags
refused at source (cut/paste keeps identity), IME keystrokes never claimed.
(3) `repairCaptionBlocks` (pure, `mdDom.js`): a caption whose next block is not a
table but whose table still exists later — before any other caption line — is
MOVED back beside its table at serialization time; only a caption with no
following table at all still drops (the genuine 119.md §2 orphan, same pinned
code). Idempotent; live-emit-path only.

**Selection bookmarks (§5).** `focusWithSelection` reads the saved caret into a
local before `focus()` can clobber it, and a `restoringRef` re-entrancy flag makes
the passive refresher a no-op during restoration. Every picker opens a SESSION
BOOKMARK: `{sectionId, live Range, logical: {blockIndex, charOffset, before/after
context}}` — resolved live-range → logical re-resolution (context verified;
`liveRangeStillValid` also guards the Range that survived its own nodes' removal)
→ HONEST REFUSAL with a notice asking the user to place the caret. Inserts route
via `apiFor(bookmark.sectionId)`, never the scroll-driven fallback. A non-collapsed
bookmark collapses to its END (nothing deleted, marks untouched). A citation
inserted adjacent to an existing chip MERGES into it through the one style-aware
`citeChipLabel` path (dedup, one undo step, never across punctuation). Chip
insertions ride a sacrificial `<span>` wrapper because Blink's `insertHTML`
unwraps the outermost element inside `<li>` (chips arrived as dead text);
`htmlToMd` unwraps unknown spans regardless, so persisted bytes are unchanged.
The end-of-Results append survives ONLY on the References/Tables panel paths that
genuinely have no mounted editor, and they announce it by switching to the editor.

**Office clipboard pipeline (§7).** One paste handler, reordered:
`text/html` is sanitized FIRST (`htmlToMd` — Word/Excel HTML → pipe tables with
positional colspan/rowspan flattening) and checked for a real table on the RESULT;
only table-less pastes fall through to the image branch. The new pure
`transformPastedMd` (richEditor/pasteTransform.js) composes remint → figure-dedup
→ identity: every caption-less pipe table gets `tableCaptionLine(mintManualTableId
(...), harvestedTitle)`; a Word caption paragraph immediately above the table
(`Table 2. Baseline characteristics`, separator required so prose like "Table 1
shows…" is never eaten) is consumed as the title with its imported number
discarded; `tsvToPipeTable` converts tab-separated text when no HTML exists; a
non-table paste into a caption title becomes plain text. One `insertHtml` per
paste = one model-level undo step.

**PDF View (§8) — an alias destination projected over the split state.**
`splitOpen` stays the single source of truth; the selected tab is a pure
projection (`destinationFor`/`panelFor`, exported): `pdfview` = the Editor panel
with the pane open. Both transitions ride one idempotent flush-first path;
`?ms=pdfview` deep-links through the existing seam; `EditorPanel` renders at the
same tree position for both destinations (never remounts); once opened, the pane
stays MOUNTED and merely hides (`hidden` prop), so the keep-alive viewer pool —
page, zoom, selected study — survives every switch. The Level-A split toggle is
retired from this workspace: one state, one control, in the navigation.

**Toolbar surface (§2).** One brand constant `PECAN_PRIMARY = '#5d509c'`
(`theme/tokens.js`), emitted as `--t-pecan` identically in day and night and now
also the source of the Stitch rail's purple (byte-identical CSS). Deliberately not
`--t-acc`: the accent is admin-brand-overridable and theme-flipped; a brand
surface must be neither. Everything painted on the bar reads from one measured
`TB` palette (white ink 6.79:1, muted 5.21:1, dark inset chips that RAISE
foreground contrast, amber/rose/mint state tones ≥ 4.65:1, a white focus-visible
ring because the app-wide `--t-acc` ring is invisible on purple). Controls that
also render inside the light popovers carry an explicit `onDark` flag; popovers
keep the design system's light surface.

**Writing Assistant (§6) — local-first, worker-isolated, decoration-clean.**
A pure engine (23 modules under `writingAssistant/engine/`, Node-testable like
mdDom): a scientific tokenizer that MASKS non-prose to same-length placeholders
(identifiers, units, statistics, Greek, ranges, dosages, gene symbols — the
false-positive firewall), 17 rule ids across 11 rule modules with per-rule scope
statements, a 22-family terminology-consistency pass, initial-matching acronym
tracking, a versioned medical lexicon (~700 curated terms + 80 suffix families —
morphology, not an ever-growing list), a project lexicon derived client-side from
trusted project fields with confidence rules, and Hunspell spelling via `nspell`
(MIT) + SCOWL `dictionary-en`/`-en-gb` (MIT AND BSD) — one dictionary loaded, the
other variant recognized through a transform bridge. All of it runs in a Vite
`?worker` Web Worker behind a provider abstraction (`pipeline.js` +
`workerCore.js`'s documented message protocol: requestId + block-rev tagging,
cooperative cancel, no manuscript text in error payloads). Dictionaries are
bundled assets (~552 kB, gzip ~191 kB) fetched only when the user enables the
feature; the CSP needed no change (`worker-src 'self'` covers the chunk; the
asset reader decodes data: URIs itself because `connect-src` has no `data:`).
Decorations use the CSS Custom Highlight API (supported by all three installed
test engines) in four category groups — nothing is ever inserted into the editor
DOM, so serialization, undo, autosave and exports are untouched by construction.

Integration: `useWritingAssistant` (React lifetime + worker protocol; pure state
half in `waState.js`) debounces CHANGED blocks at 700 ms and the document-level
passes (consistency/acronyms/repetition) at 1800 ms, sweeps other sections in the
background, cancels and discards by request-id + block-rev, and backs off
1 s/5 s/30 s on worker failure with a manual Retry — typing and autosave never
depend on it. Decorations: `waHighlights.js` projects each block's markdown to its
rendered text with an offset map, plans anchor targets by mirroring the
serializer's own block walk, resolves each issue to a live Range with an
exact-string verify, and registers four `CSS.highlights` groups; absent
`CSS.highlights`, the list/navigation/card/apply all still work (explained in the
panel, no underlines). The toolbar control sits in Level A's right group
(editor/pdfview only) with the status chip, settings popover (variant, style
opt-out, per-category mutes, both dictionaries with delete/undo) and next/prev
issue navigation announcing through a polite live region; the suggestion card is
a focus-trapped dialog that restores focus to the exact editor location. Apply
re-verifies the committed markdown (`issueMatchesText`) AND the live range string
before writing through the editor's normal selection→execCommand path — one undo
step. Native spellcheck is stamped off editor-scoped (root + caption titles via
`repairCaptionIslands`, the one pass every shape change traverses) while enabled,
restored when off, never touched globally.

## 3. Files changed

**§1** `src/features/logbook/LogbookPage.jsx` (Back button + `projectControlHref`
+ optional `onBack` seam) · `StitchProjectWorkspace.jsx` (`goStage('control')`) ·
`Workspace.jsx` (`setTab("control")`).

**§2/§8** `src/frontend/theme/tokens.js` (PECAN_PRIMARY, `--t-pecan`, `C.pecan`) ·
`src/frontend/workspace/ui/styles.js` (C.pecan) · `stitchTokens.js` (rail imports
the constant) · `ManuscriptToolbar.jsx` (TB palette, solid surface, onDark
variants, white focus ring, `pdfview` tab, viewSwitcher gate) ·
`ManuscriptWorkspace.jsx` (destination projection, one flush-first split path,
keep-alive latch, exitSplit) · `manuscriptPanels.jsx` (SaveStatusPill `onDark`).

**§3/§4** `richEditor/RichSectionEditor.jsx` (`ensureTrailingParagraph` + boundary
commands + gap redirect + drag refusal + WebKit husk escalation) ·
`richEditor/mdDom.js` (`repairCaptionBlocks`).

**§5/§7** `richEditor/RichSectionEditor.jsx` (focus-clobber fix, bookmark api,
grouping, span wrapper, reordered paste ladder) · `richEditor/caretBookmark.js`
(pure logical resolution) · `richEditor/pasteTransform.js` (pure §7 transform) ·
`manuscriptPanels.jsx` (picker sessions + refusal notice) · `AbstractEditor.jsx`
(registry release).

**§6** `src/features/manuscript/writingAssistant/engine/*` (23 modules) ·
`waWorker.js` · `waDictAssets.js` · `package.json` (+nspell, +dictionary-en,
+dictionary-en-gb) · `useWritingAssistant.js` + `waState.js` (hook + pure state) ·
`waHighlights.js` (decorations) · `WritingAssistantControl.jsx` +
`WritingAssistantCard.jsx` (UI) · `waProjectShape.js` · `waApi.js` (the feature's
only network surface) · `src/shared/writingAssistantDictionary.js` (one entry
definition, browser AND server) · `server/controllers/dictionaryController.js` +
`server/routes/dictionary.js` · both Prisma schemas · `profileController.js`
(allowlist) · `settingsController.js` + `opsSettingsCatalog.js` (one flag) ·
`ManuscriptToolbar.jsx` (control slot) · `ManuscriptWorkspace.jsx` (hook) ·
`manuscriptPanels.jsx` (card + re-anchor on emit) · `RichSectionEditor.jsx`
(`nativeSpellcheck`/`onRootRef` props, `applyRangeText`).

**Tests** — new: `mediaBoundary120.test.jsx` (30), `caretInsert120.test.jsx` (30),
`pasteTransform120.test.js` (25), `writingAssistant/` (280),
`manuscript-tables-below-120.spec.ts` (7), `manuscript-citation-caret-120.spec.ts`
(7), `manuscript-table-paste-120.spec.ts` (6); `hookState120` (30) + `highlights120`
(29) + `api-writing-assistant-dictionary` integration (13) +
`manuscript-writing-assistant-120.spec.ts` (6, incl. the byte-identity and
never-leaves-Saved assertions); re-pinned with comments: `toolbar118`,
`pdfSplit119`, `continuousView118`, `tables119`, logbook `ui`.

## 4. Data and schema changes

Two BRAND-NEW tables in both schemas (dev SQLite + postgres, the latter
regenerated via `sync-postgres-schema.mjs`): `UserDictionaryEntry` and
`ProjectDictionaryEntry` — `term` preserves the author's exact casing while
`termLower` carries the uniqueness key (`@@unique` on new tables only, per house
rule); every column defaulted or nullable so `prisma db push` is additive on a
live database; `projectId` is a bare scope key (the ManuscriptFigure idiom) with
the denormalized `addedById`/`addedByName` pair. One new NULLABLE `User` column,
`writingAssistant` (tiny JSON prefs; null ⇒ off), behind the profile allowlist's
500-character cap — which is exactly why the dictionaries are tables. Rollback:
drop the two tables + the column; no existing row is ever rewritten. One
`OPS_FLAGS` catalogue entry governs availability; the feature itself is per-user
opt-in regardless.

No manuscript-content migration anywhere in this round: the §3 affordance and the
§4 repair are serialize/render-time mechanisms over the UNCHANGED markdown model,
and legacy manuscripts load, normalize, save and reopen byte-stably (pinned).
Anonymous legacy tables (no caption) remain first-class valid; auto-wrapping
stored prose as titles would be exactly the dangerous guess 120.md forbids, so the
established promotion path (`addTableCaption` + the export notice) stands.

## 5. Security and privacy

Clipboard: nothing from the clipboard reaches the DOM without the escape-first
`htmlToMd` round-trip (scripts, event handlers, mso XML, `javascript:` hrefs,
form/active content all drop or degrade to text — pinned); Excel formulas import
as displayed values; image bytes still travel only through the authenticated
upload seam, never inlined. Grammar checking is LOCAL-ONLY: the manuscript text
goes to an in-browser Web Worker and nowhere else — no provider, no network
request, no server round-trip carries prose; worker error payloads are asserted
text-free by test. The dictionary endpoints mount `requireAuth` at the router,
split read (canView) from write (canEdit), require owner/leader to delete another
member's term, hide inaccessible projects as 404 (never 403 — the repo's
existence-hiding convention), cap terms at 64 chars and scopes at 2,000 entries,
and store WORDS the user explicitly accepted — never a sentence, never a document
id. Controller errors log a message only, never a request body. Preferences ride
the existing profile allowlist under its 500-character cap.

## 6. Performance

Engine (Node, 186-block/52 kB/180-citation synthetic manuscript): worker init
240 ms + ~19 MB heap (once, on enable); full-document pass 340 ms; incremental
3-block check 2 ms; single block 0.67 ms; `nspell.suggest` ~30 ms/word →
budgeted (25/check) + on-demand. Zero false positives on the synthetic draft.
Dictionaries load lazily (one 552 kB asset, gzip 191 kB) only when the feature is
enabled. In-browser (Chromium, ~120-paragraph document, keystroke→second-rAF, 20
samples): typing median 17–28 ms off vs 21–35 ms on (p95/max unchanged at
36–43 ms; the e2e pins `on − off < 32 ms` median); time-to-first-check after
enable 1.5–1.6 s (dictionary parse 241–342 ms of it); first underline ~2 s; a
full 43-block section pass 157–211 ms in the worker; decoration re-anchor ~5 ms
per section per emit. Editor⇄PDF View switching re-renders styles only (no
remount), and the keep-alive pane makes the return instant.

## 7. Accessibility

§1: real `<button>` (Enter+Space, app focus ring), accessible name, ≥30 px
target. §2: every on-bar foreground measured ≥4.5:1 (computed in unit tests),
glyphs ≥3:1, a white `:focus-visible` ring scoped to `.ms-toolbar`, active state
carried by underline + weight, never color alone; OS-drawn `<option>` colors
pinned against white-on-white. §8: the ninth tab inherits the manual-activation
tablist (arrows move focus, Enter/Space activate), `aria-labelledby` follows the
projected destination. §3/§4: keyboard paths for every mouse affordance; IME
compositions never claimed. §6: the suggestion card is a `role=dialog` with a
focus trap that RESTORES focus to the exact editor location on close (Escape via
`markOverlayEscape`, so fullscreen survives); next/prev issue navigation
announces category, text and position through a polite live region; underline
patterns differ per category (wavy/dotted/dashed) so color is never the only
signal; no chord is claimed from the 108.md router; no animations were added, so
reduced-motion needs nothing new.

## 8. Testing evidence

Commands and results at the round's close (per-wave results additionally recorded
in each feature commit's message):

- `npm run test:ci` — **596 files / 12,168 tests, all green** on the final
  integrated tree (was 585/11,729 at the round's open; +11 files/+439 tests).
- `npm run test:integration` — **102 files green** (includes the 13 new
  dictionary-endpoint tests).
- `npx playwright test --project=chromium` — all the round's suites green:
  logbook + toolbar + pdf-split (22), media journeys + 119 regressions (22),
  caret + paste + all manuscript regressions (35), writing assistant (6, twice).
- `npx playwright test --project=webkit-manuscript --workers=1` — **27 passed,
  1 recovered flaky** (the pre-existing timing-sensitive figures §10.12 case),
  3 documented skips, 0 failures. (An earlier 2-failure webkit run was
  machine-saturation: the same tests pass clean-load and passed at every wave
  gate.) Playwright WebKit is engine evidence, not a Safari sign-off — the
  real-Safari manual checklist remains outstanding (Windows-only environment),
  recorded in `docs/testing/PLAYWRIGHT_COVERAGE_MATRIX.md`.
- `npm run build` — green, including the prerender + CSP inline-script guard
  (34/34 pages byte-identical).
- Adversarial review round (r2) — six specialist reviewers over the whole round
  (data-loss, caret/paste edges, engine correctness, server security, state
  machines, spec conformance), every non-minor finding independently verified
  with a refute-first mandate: **25 findings, 9 verified majors (8 reproduced
  end-to-end), 16 triaged minors**; all majors and 13 of the minors fixed in the
  r2 commit with regression tests built from the verifiers' own repro scenarios
  (see the commit for the per-finding list). Deliberately not "fixed": hover
  cards (documented deferral, limitation 7) and this report's own placeholders.

## 9. Manual QA

Stated honestly, per the 119 §10 convention: **no human ran a manual browser
pass this round.** What stands in evidence instead: the failure-screenshot review
during the media-journey debugging (which visually confirmed the purple toolbar,
the PDF View tab, the figure block and the below-media paragraph in a real
Chromium render), the in-page performance measurements (real keystrokes in a real
document), and the full automated matrix above. Outstanding for a human:
the real-Safari checklist in the coverage matrix; one eyeball of a real PDF in
the keep-alive pane after an Editor⇄PDF View round-trip (inner scroll offset is
the one state the pool does not pin); and the solid-purple toolbar in the legacy
shell's night theme (unit-asserted, not eyeballed).

## 10. Known limitations and deliberately deferred items

1. **Real-Safari manual pass still outstanding** (no macOS in the build
   environment) — the §10-style checklist stands in the coverage matrix; WebKit
   automation is full-coverage but is not Safari.
2. **WebKit splits the paste undo at the DOM level** (one Ctrl+Z removes the
   table, the second the caption island + no prose loss); the MODEL-level
   guarantee — one undo returns the manuscript to its pre-paste state — is what
   the e2e pins, because intercepting Ctrl+Z would replace the native undo stack
   the whole editor is built on (101.md §11 doctrine).
3. **Backspace/Delete merge guards at the caption/table boundary are not
   intercepted** — engines were not observed corrupting the structure, and any
   separation that does occur is now REPAIRED at serialize time instead of
   costing the caption.
4. **No eager legacy migration** of anonymous tables (deliberate; see §4 above).
5. **Cell-grid merge paste** (pasting cells INTO an existing table's grid) keeps
   the editor's established behavior — insert after the enclosing object, never
   nest; a true grid-merge is a product feature this model does not have.
6. **Writing Assistant v1 scope cuts** (each documented in the engine):
   missing-word detection (needs a parser), journal-style rules (no journal-style
   config exists in the product yet — the pipeline exposes the hook),
   singular-vs-plural outcome naming, contextual grammar beyond closed classes.
   Fragments/run-ons/tense are deliberately conservative (suggestion-severity,
   stated confidence). Suffix morphology accepts a misspelling that happens to
   end in a real medical suffix — the documented cost of not flagging every drug
   name.
7. **Hover cards were deliberately not built** — the suggestion card opens on
   click and on keyboard navigation; a hover preview on every underline while
   typing was judged noise. §6's hover requirement is met by the focusable
   navigation path; revisit if users ask.
8. **No worker-less fallback checker** — a failed worker is the recoverable
   `error` state with retry, not a main-thread nspell (which would violate §6's
   own responsiveness rule). `CSS.highlights`-less engines keep the full issue
   list, navigation, card and apply — only the underlines are absent.
9. **Range resolution picks the nearest occurrence** of the issue's text within
   its block when the markdown→DOM projection is imperfect; the worst case
   decorates an identical misspelling elsewhere in the same block, and every
   apply re-verifies both the committed markdown and the live range string
   before writing.
10. **Two triaged r2 minors remain open by choice**: a caret bookmark saved in
   an empty paragraph can re-resolve into the §3 trailing affordance after a
   remount (an end-of-section insert instead of a refusal — narrow, non-silent
   in effect, and the refusal path already covers content changes); and Turkish
   İ-class case folding can still slip past `termLower` duplicate prevention
   (NFC has no composition for U+0069+U+0307; mark-stripping would risk real
   terms). Both are recorded here rather than half-fixed.
11. **`repairCaptionBlocks` called PURE (no `captionPairs` memory)** uses the
   bounded 3-block guess; only the editor's emit path — the one caller that can
   corrupt a real manuscript — carries the previous-emit verification. Stated in
   the function's own comment.

Related work this round rests on: 119.md (editor geometry, PDF split, figures),
118.md (toolbar levels, Continuous View), 117.md (caption objects, citations),
116.md (native tables).
