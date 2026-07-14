# 85.md — Pecan Search Concepts/Terms UX redesign + complete Word table/figure export

Manager/integrator record for the 85.md build. Process: 6 parallel investigation agents
(search workflow as-built, UX heuristic audit, export/OOXML as-built, state/backend,
test infra, design system) → plan → 4 adversarial plan critics (all findings code-verified)
→ revised plan → two parallel implementation pipelines (A: search engine→UI; B: manuscript
engine→export/UI) → integration → adversarial review rounds → full test matrix.

## Pre-existing defects found during investigation (fixed independently)

- `server/searchEngine/searchEngineController.js` referenced `prisma` without importing it
  → every versions/compare/methods-text endpoint threw ReferenceError→500 since 69.md;
  invisible because the client reads versions soft-fail and manuscriptData maps the 500 to
  `dataStatus.search='error'`. Fixed in `15e2cda` (one-line import).
- Generated prose hardcodes "(Table 1)"/"(Figure 1)" while the exporter numbers by
  availability → silent text/number mismatch (motivates the structured-reference layer).
- Dead code: `newSuggestionCount` gated on never-set `picoDirty` and calling an undefined
  `presentPrimaries` (latent ReferenceError).
- `commitAdd` had no dedupe (typed duplicates create real duplicate terms).
- Cached PubMed counts re-stamped "updated just now" on cache hits.

## Objective 1 — Search UX. Key design decisions (critique-integrated)

1. **Term disable-without-delete** = additive `disabled:true` (key DELETED on re-enable so
   signatures stay byte-identical). ONE liveness rule `isLiveTerm` (termLiveness.js) adopted
   by every consumer: compilers/normalize liveTerms, crossConcept checks, conceptStatus,
   methodsText, server pecan `normalizeCanonical`, server `canonicalStrategyProjection`
   (disabled ≡ absent → old hashes unchanged, disables correctly flip `currentMatch`),
   client `loadCanonicalQuery`. PICO re-sync keep-condition extended (`|| t.disabled`).
2. **rejectedSuggestions** persisted key (omit-when-empty; keyed
   `rej:<field>:<termEquivalenceKey>` so family variants stay rejected) + putSearch
   whitelist branch (named-keys contract). "Restore all" clears ignored AND rejections.
3. **Master-detail Terms stage** (concept navigator pills + ONE active-concept panel +
   strategy preview) with critique compensations: dup badges name the other concept,
   move-to-concept first-class in the chip editor, QC panel stays stage-level,
   Hidden-terms restore lives in the review area, Limits panel retained.
4. **Preview renders ACTUAL ops** (never hardcoded AND); OR joins visible read-only in
   beginner mode; op editing moved to the preview panel where both operands are visible.
5. **Chips show the searched term** (MeSH descriptor for controlled, user words secondary);
   unmatched controlled term = explicit warning chip + `renderControlled` falls back to a
   freetext token (was: compiled `"text"[Mesh]` for a nonexistent heading while the editor
   claimed otherwise).
6. **Add box**: Enter = explicit first row `Add "typed"` (kills the Enter-adds-typed-not-
   suggestion trap); blur RETAINS the draft per-concept (never commits half-typed terms —
   the old onBlur committed fragments); paste splits on newline/semicolon ONLY (commas are
   inside MeSH descriptors) with a confirm preview for multi-adds.
7. **Undo**: pure inverse-patch stack (restores `ignored` side effects too) + feature-local
   snackbar; stack cleared on remote adopt/version restore.
8. **Save status** indicator + unmount/stage-switch flush (the 800ms debounce window was
   silently dropped on navigation) + retry.
9. **Stage rail truth**: pure `computeStageStatuses` (P+I required; C/O/T optional so PECO/
   prognosis reviews don't show permanent warnings) replaces positional checkmarks; side-menu
   gets statuses via extended searchModeStore.
10. Beginner/expert toggle exposed in the workspace (localStorage, default beginner);
    CONCEPT_COLORS → CVD-safe CB_SERIES; focus-visible everywhere; ≥24px targets;
    aria-live announcements; MeSH detail keyboard-openable.

## Objective 2 — Word export. Key design decisions (critique-integrated)

1. **Structured asset tokens** `[[table:id]]`/`[[figure:id]]` mirroring the cite-chip
   mechanism (atomic contenteditable=false span, data-asset attr, htmlToMd reverse branch,
   stripInlineMd). Generator emission gated on `assetRefs:true` genOpt — legacy output stays
   byte-identical (pinned).
2. **Asset registry** derived per render (5 engine tables + PRISMA/forest-primary/per-outcome
   forests/RoB traffic light/funnel figures); per-outcome ids = stable slug of pair.key
   (outcome renames degrade to warnings, never hard blocks); non-primary figures default
   excluded, auto-included when referenced. Draft overrides in `draft.assets` (delete-when-
   empty, normalizeDraft-additive); `dataBlocks.enabled` stays dead (never read/written).
3. **Block-level placement**: sections split into block groups (whole lists/pipe tables =
   one block, matching markdownToParagraphs state) → assets spliced AFTER the first-mention
   block in body sections; abstract/title are non-placement zones; repeated refs = number
   only; unmentioned-but-included → end fallback sections + warning. Legacy token-less
   drafts: end-of-document layout preserved; plain-text "Table N" matches produce warnings
   only, never drive placement/numbering.
4. **Numbering**: one resolver (first-mention order per kind, then registry order) feeds the
   editor chips AND the export; counts only emitted assets; editor gates numbers on
   sourcesSettled; `allAnalyses` memo threads identical availability to both.
5. **Tokens resolve inside parseInline** (not pre-replaced) → InternalHyperlink to per-asset
   Bookmarks; statements now render cite + asset markers (fixes the pre-existing cite leak).
6. **Figures**: RASTER-ONLY v1 at ≥300dpi effective (SVG-in-Word deferred: our builders use
   marker-end + glyph arrows that Word's SVG renderer handles poorly; forest arrows converted
   to path triangles regardless); altText on every ImageRun; sequential rasterization with
   yields + progress callback. NEW pure `buildFunnelSVG`; RoB traffic light reuses
   `buildTrafficLightSVG`.
7. **Tables**: FIXED layout with weighted column widths; >8 columns → font step-down +
   validation info; keep-together (row cantSplit + keepNext) only for small tables;
   header-row repeat retained; captions keepNext-bound with bookmarks.
8. **Pre-export validation** (errors block / warnings allow / info): unknown referenced id,
   referenced-but-unavailable (renders "Table ?" + warning), no caption, stale content
   (reuses 84.md computeFreshness), pending saves, mixed token/plain-text mode, user pipe
   tables info. CLEAN report → one-click export with NO dialog (existing e2e contract).
9. **Export freshness**: `refreshSources()` seam re-fetches live sources at export time
   (they were fetched once per open), then freshness+validation recompute on fresh data.

## v1 scope statement (documented limitations)

- Uploaded/user image assets: no upload model exists in the manuscript feature; out of v1
  scope (validation surfaces nothing misleading; tracked as a known limitation).
- NMA network/SUCRA and meta-regression bubble figures: builders partially exist but are
  not wired into the registry in v1.
- SVG vector embedding in Word: deferred pending real-Word verification of our SVG subset.
- User pipe tables stay unnumbered (info notice); auto-numbering them is v2.

## Adversarial review round (Phase 6)

4 finder lenses over the diff `15e2cda..398aa9c` → 21 findings, each independently
verified by 2 refuters (46 agents total; 0 findings rejected). All 21 fixed:

Search engine: Strategy Studio (generator/critic/recall + server loadStoredStrategy)
adopted isLiveTerm — generated paste-ready queries no longer include switched-off
terms; versionDiff treats disabled ≡ absent (diff now reports the change the hash
already saw); re-enabling a kept-while-disabled auto term stamps `kept:true`
(omit-when-absent) so the next PICO sync cannot silently drop it; rejection keys
scope by concept id for manual concepts (identical labels no longer share memory).

Search UI: plain-English mirror / concept stats / copyable strategy table / legacy
renderer all exclude disabled terms; deleting a concept prunes its retained draft,
pending paste, inline status, editor and add-box state (an orphaned draft silently
blocked remote adoption forever); save indicator returns to "Saved" when an edit is
reverted inside the debounce window; switching the active concept closes popovers
belonging to other concepts; bulk "Accept all headings" dedupes by descriptor;
side-menu stage glyphs subscribe to the status store (were stale until an unrelated
re-render); aria-live announcer uses clear-then-set so identical consecutive messages
re-announce, inline add-status self-clears; all-disabled concepts get the delete
confirm (total-terms gate, not live-terms).

Manuscript: EVERY forest/funnel figure id is pair-keyed (primary flip can never
rebind tokens/captions; `figure:forest-primary`/`figure:funnel` live on as resolvable
aliases with read-through overrides); global slug allocation (cross-base collisions
minted duplicate ids); caption override is the asset's own field rendered under the
"Table N. Title" line (was silently dead); funnel plot labels proportions as
percentages with measure-named axes (matches the forest plot); "Export anyway"
re-runs prepareExport and exports the FRESH model (re-shows the dialog if new errors
appeared); asset tokens inside bold/italic/code resolve to hyperlinked references
(leaked raw `[[table:…]]` text); the assets panel commits per-asset field patches
merged at flush time (a mount-time snapshot wholesale-replaced draft.assets);
refreshSources discards stale in-flight resolutions via a generation counter.

## e2e repair

Pre-existing drift found while validating (fails on HEAD~ too): the searchWorkspace
spec waited on the in-body `search-workspace-rail`, which the Stitch shell has hidden
since stages moved to the white side-menu (75.md); local runs additionally raced the
GLOBAL feature-flag flips because Playwright runs parallel workers locally (CI is
workers=1 — always run these suites with --workers=1). Fixes: `stitch-tool-body`
class kept on full-bleed stages as a scoping hook (class-as-hook only, zero CSS);
SearchPage gained a union stage-nav locator (side-menu stepper OR in-body rail),
`openStagedWorkspace`/`gotoStage` wait on the `search-workspace-stage` surface; term
chip locators are exact-match so "heart failure" never aliases "Heart Failure,
Diastolic".
