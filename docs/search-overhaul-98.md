# Final Pecan Search Engine redesign + production hardening (98.md) — implementation report

Date: 2026-08-04 · Version: v4.5.0 · Builds on 96.md (docs/search-overhaul-96.md) and 97.md (docs/search-overhaul-97.md).

## 1. What changed

### Search workflow (§3/§13) — the Research Question stage is retired
The Search Engine is now **6 stages** (manual) / **5 stages** (automated):
**Select & Build Key Terms → Search Mode → (Database Strategies) → Results → Documentation → Send to Screening.**
- `searchStages.js`: the `question` row is deleted; `STAGE_ALIASES` gained `question → terms` (the proven 96.md concepts/refine retirement pattern), so old bookmarks/deep links (`?stage=question`) land on the keyword workspace with the URL rewritten — never a broken route. Unknown-stage fallbacks (`stageAfterModeChange`, `navConfig.readSearchStageParam`, `searchStageHref`) all resolve to `terms` now.
- The research-question **data** is untouched: `project.pico.question` remains the authoritative home every consumer reads (Protocol, screening AI snapshot, manuscript, methods text, exports, regenerate).

### Inline research-question editing (§4)
- New `InlineQuestionEditor` (SearchWorkspace.jsx) renders at the top of the terms stage — opened by the question card's "Edit question" control, auto-opened when the project has no question. All 96.md guarantees carry over verbatim: the `pico.question` collaborative field lock shared with the Protocol editor (M18), local-draft + 500 ms debounced commit (L28 — typing never re-renders the heavy builder per keystroke), legacy-PICO helper copy (L24), unmount/Done/Escape flush.
- **Save states are visible** (§4): the host threads the whole-project autosave status (`saving/saved/error/conflict` — the conflict state is the existing `_baseRev` CAS) into the editor.
- **Drift is deferred while editing**: a `questionEditing` flag is threaded into the builder so the silent snapshot refresh and the drift banner wait for the editing session to end — a mid-sentence deletion never flashes "your question changed", and no autosave churn happens per typing pause. Nothing about the 96/97 drift model changed: affected concepts are flagged for review, never deleted.

### Beginner Mode, engine-wide (§5)
- New `beginnerMode.jsx` (context provider + `useBeginnerMode()` + header toggle). The toggle moved from the builder toolbar (where it was unreachable on non-builder stages) to the workspace header — one switch controls explanatory content on **every** Search stage.
- **The default flipped to OFF** (98.md §5: the default experience is the focused professional tool). Users who explicitly chose a mode keep it (same localStorage key `sb-beginner`).
- Text audit results applied: the workspace header paragraph, StageIntro bodies, the mode stage's triplicated "switch any time" copy, ManualRun/SendToScreening how-it-works paragraphs, the ConceptsIntroStrip, the per-concept AND/OR explainer, the build-stage AND/OR explainer, and the question-card span-hint are now Beginner-Mode content (the span-hint keeps a visually-hidden copy so `aria-describedby` still works for screen readers). Essential interface text (empty states, drift/limited/conflict banners, save states, mode decision content, duplicate warnings) stays always-visible. Stale references ("Strategy Builder step", "Terms & Vocabulary") were corrected while touching the copy.

### Empty start (§6)
- New projects already seeded zero groups (96.md); now the seed is **lazy**: no `WorkflowModuleState` row is written until the user actually does something (the pre-98 seed-save fired a PUT ~800 ms after first open, flipping the project-overview Search step to "partial" with zero user action).
- The empty board renders one clean primary action — **"Create first concept"** — plus the phrase-selection path.
- Downstream stages ("Run Externally", "Send to Screening") now unlock on **live terms**, not bare group existence; project-level progress (`searchRule`) counts only live concept groups, so an empty group can never mark Search done.
- An empty strategy can no longer compile a filters-only query: `runRenderer` applies filters only when at least one live concept block exists.

### Selection / split / merge (§7)
Built by 96/97 (token click, Shift-click span, drag-onto-token combine, recorded component boundaries, safe manual split, merge with undo) and preserved; hardened cross-browser this round (see §15 below).

### Concept-group model + terminology (§8)
- The one user-facing noun is **Concept** (group): board labels, ordinals ("Concept N"), toasts, dialogs, aria-labels, drag hints, split/merge/delete controls, default labels (`defaultGroupLabel`, regenerate output) — all swept.
- `migrateLegacyGroupLabels` gained a second one-shot idempotent pass: 97-era default labels `Search Group N` → `Concept N` (same number; user renames untouched; `labelMigrated: 2` marker; byte-stability contract preserved — untouched docs never re-save).
- Stable IDs everywhere (unchanged from 96/97); duplicate handling, move/copy semantics, undo inverses unchanged.

### Horizontal visual builder (§9)
- The master-detail workspace (navigator pills + one active panel) is replaced by the **horizontal concept board**: every concept renders as its own bounded card, side by side, joined by visible **AND/OR connector buttons** (`[Concept 1] AND [Concept 2] AND …`). The connector leads its card in the flex flow, so wrapped rows read "AND [card]" and connectors never strand at row ends; it is a real toggle (96.md D13.4 semantics preserved — `op` between groups can still be OR, honestly displayed, screen-reader named).
- The **active** card expands to the full row with the working surfaces (add box, chips, suggestions, group actions); inactive cards are compact chip summaries that activate on click. Chips keep visible OR separators; controlled vs free-text chips remain visually distinct.
- Drag-and-drop re-homed: cards are the cross-group drop targets (was: pills); the card-header grip (⠿) drags group reorder/merge; the "＋ New concept" drop zone appears during chip drags. Keyboard/menu alternatives remain primary for every gesture.
- Responsive: cards flex-wrap by viewport (no horizontal-overflow-only navigation); at narrow widths they stack full-width.
- ConceptNavigator.jsx is deleted (dead code, §24).

### MeSH / controlled vocabulary (§10)
- Compact chip form `"Descriptor"[MeSH]` (97) now also indicates **explosion state** ("no narrower terms" badge when off) and the **mapped entry-term count** ("+N entry terms").
- The details popover gained a **"Syntax by database"** row — the exact controlled-vocabulary clause each selected database receives, produced by the *real* compilers on a one-term strategy (can never drift from the compiled output), with the Emtree/CINAHL "approx." honesty flag.
- Popover hardening: re-clamps on scroll/resize; action buttons are non-blur-stealing (Safari's no-focus-on-mousedown could unmount the popover before "Add this term" landed); the keyboard/touch info affordance grew to a 24 px hit target (WCAG 2.2).
- All mapped terms remain in the underlying strategy and compiled queries — display only got more compact.

### Suggestions hidden by default (§11)
- `SuggestionsDisclosure` is now controlled: closed by default with a one-click "Show suggestions (N)" toggle; a pending-count change can **never** force it open mid-work (the old `<details open={pending>0}>` re-opened itself and shifted layout); children mount only while open (§20 — no hundreds of hidden synonym rows in the DOM); open state is per-concept session view state (§19).
- Async vocabulary lookups got a **stale-response guard**: a MeSH lookup fired for old term text is dropped if the term changed before the response landed (§19 "old API responses overwriting newer state").

### Query compilation — single source of truth (§12)
- **Real defect fixed**: the builder stamps controlled terms `field:'tiab'`, and the automated-run AST only rendered MeSH for `field:'mesh'` — so the manual preview showed `"Heart Failure"[Mesh]` while the automated PubMed run executed `"Heart Failure"[Title/Abstract]` (explosion + indexing silently lost). `normalizeCanonical` (server/pecanSearch/query/ast.js) now coerces controlled terms with builder-default fields to the vocabulary field at the one choke point every run path crosses — covering legacy saved strategies too.
- The **legacy in-file renderer** in SearchBuilderTab (which had drifted from the compilers: Embase `:ab,ti` vs `:ti,ab`, per-field grouping differences) is deleted; the term-editor preview and the beginner "compiles to" hint now go through `compileStrategy` — one code path for everything the user sees.
- `orGroup` collapses exact-duplicate clauses (legacy in-group duplicates compiled `x OR x`); an empty strategy + saved filters compiles to `''`, never a runnable filters-only string; term text is NFC-normalized with curly quotes/apostrophes folded to ASCII on **both** the client compilers and the server AST (`“Crohn’s disease”` compiles identically to `"Crohn's disease"` in every quote grammar).

### Screening completion truth (§14) — root causes found and fixed
Two real defects made the main page claim screening was complete when it was not (and, conversely, made honest completion unreachable, which pushed users toward the manual flag):
1. **Manual sign-off short-circuit**: `screeningRule` returned done on the leader-editable `progressStatus:'done'` label before looking at any evidence. Sign-off is now corroborated — affirmative counter-evidence (zero records, pending substeps, server `complete:false`) demotes it to "Signed off, but screening work is pending". The server write still succeeds (leader freedom) but returns an itemized `statusWarning` and stamps the audit row.
2. **Mismatched populations**: `decidedCount` (finalStatus ∈ accepted/rejected, no duplicate filter) vs `screenablePool` (isDuplicate:false) — records finalized then swept into duplicate groups counted in the numerator but left the denominator, so `decided >= pool` could fire with live records unscreened; meanwhile TA-excluded records never receive `finalStatus`, so genuinely finished projects could never reach done by the heuristic. Fixed: `isDuplicate:false` on the numerator; a new shared evidence loader (`server/screening/progressEvidence.js`) computes quorum-aware `titleAbstractPending`, `unresolvedConflicts`, `unresolvedDuplicateGroups`, `secondReviewPending` and a server-derived `complete` on the detail path (batched cheap counts on the list path); `screeningRule` consumes them.
- The canonical screening step now carries an additive **`detail` substate** — `not_started | in_progress | awaiting_second_review | conflicts_remaining | completed` — rendered on the project overview (§14's exact vocabulary). A fully-decided screen with zero included studies **is** complete (documented divergence from `isScreeningComplete`'s `includedFinal>0`).
- All surfaces converge on `_progress`: overview + workspace rail (previously fell back to the raw sign-off flag), dashboard cards (`statusOf`/`progressOf` previously used the flag alone; the progress bar caps at 99% while the canonical step says not-done), the "finalized" counter uses the duplicate-free pool, and the optimistic status patch drops the stale `_progress` so it recomputes.
- PRISMA false-done fixed: the auto-sync wrote `included:"0"` (a truthy non-empty string ⇒ done); `prismaRule`/`stepStatus` are numeric-aware and the sync skips all-zero snapshots.

### Extraction click-to-capture (§16)
- **Classic panel** (the default, flag-off surface) now has the engine's semantics: a click **replaces** the active field directly with an aria-live "Replaced X (was A) → B" announcement (the old path opened a blocking Keep/Replace dialog via a hardcoded `existingOrigin:'user-typed'`); prior values are preserved in the notes trail; identical re-clicks announce "no change". Smart lone-number capture is gated on `usesEffectSlot` and the active field clamps when the effect measure or study changes — the "capture appears dead after changing the measure" defect.
- **Engine**: auto-advance now only fires when the target field was previously empty — a correction click lands in the *same* field instead of silently targeting the next one; identical-value no-ops are announced.
- **Safari correctness**: the caret-API result is cross-validated against the character's real geometry (WebKit's `caretRangeFromPoint` mis-maps x on the CSS-scaled pdf.js text layer — right node, wrong offset — which the old `contains()` guard accepted), falling through to the geometric resolver; extracted into a testable `pdfCaret.js` module. Micro-drag clicks that retarget to the text-layer container re-resolve via `elementFromPoint`; `overflow:hidden` fallback for Safari < 16; rotate buttons disabled in click mode (provenance coordinates ignore rotation — matching the region-mode precedent).

### Cross-browser (§15)
- Playwright: a new `webkit-search` project runs the **entire** search-builder journey file under WebKit (drag, merge/split, MeSH popovers, undo chords, autosave-reload) — not just @smoke; extraction capture/replace specs are @smoke-tagged so webkit runs them.
- The hand-rolled pointer-drag hook: `pointercancel` handling (iOS Safari claims gestures via pointercancel, which used to leak the session's window listeners), pointerId guards (a second finger can't drive another finger's drag), and body-level `user-select` suppression during drags (Safari starts page text selections mid-drag regardless of `preventDefault` on pointermove).
- Tab-close autosave: `pagehide` + `fetch keepalive` flush the pending debounced PUT (Safari has no reliable `beforeunload`; the SPA unmount flush never fires on window close). Deliberately not on `visibilitychange` (fires on tab switches and would bypass the CAS envelope for no reason).
- Feature detection only — no user-agent sniffing anywhere in the changes.

## 2. Database / API migrations
**None required.** No schema changes; no data migrations. Two data-shape notes:
- Concept labels: the `Search Group N → Concept N` rename is a lazy, idempotent, in-document migration on first open (97's `labelMigrated` pattern; snapshots/history keep their historical labels).
- `_progress` gained the additive screening `detail` field and richer evidence; `PUT /screen/projects/:id` gained the additive `statusWarning` response field (documented in server/docs/screening-api-contract.md). All additive — old clients unaffected.

## 3. Deployment
1. `git pull` → `npm run build` → restart via PM2 (ecosystem.config.cjs). No prisma migrate needed this round (dev SQLite and Postgres schemas untouched).
2. No cache invalidation; no flag changes (`searchEngine`/`pecanSearch` gate as before; `extractionEngine` remains optional — the classic panel now has the same capture semantics).
3. Watch after release: `statusWarning` rates on screening status writes (leaders signing off incomplete work), and the WebKit e2e lane.

## 4. Testing
(Final verified numbers are recorded in §7 of this document.)
- Unit: stage table/status/nav alias suites rewritten for the 6-stage model; InlineQuestionEditor ports the M18/M24/L28 contracts; board/card, connector, empty-state, controlled-suggestions, badge, migration-v2, compiler (dedup/filters-only/Unicode) and AST-coercion suites added; §14's nine scenario tests added on `projectProgress`.
- E2E: the search journeys were rewritten for the board interactions and inline question editing; `?stage=question` alias redirect asserted; the full search journey file runs under WebKit; extraction capture/replace/measure-change journeys added (@smoke ⇒ WebKit).
- Cross-layer §12 pin: one builder-shaped strategy through BOTH the client compiler and the server PubMed connector asserts the `[Mesh]` clause in both.

## 5. Known limitations
1. **TermEditorPopover is not portaled** (MeshDetailsPopover re-clamps in place; the board itself introduces no clipping containers, but a very narrow viewport can still clip the editor popover against the page scroller). Candidate for the follow-up round.
2. **Beginner Mode preference is per-browser** (localStorage). Server-side per-user persistence was deliberately deferred: the existing profile JSON blobs are replaced whole by their current writers, so piggybacking risked clobbering; a dedicated field is the right follow-up.
3. Within-group Boolean remains fixed OR; NOT remains unsupported (96.md documented decisions — the supported path to AND-between-terms is splitting concepts, which the split affordance links to).
4. ~~Bulk suggestion selection~~ — **solved in the follow-up round**: explicit checkbox multi-select with one "Add N selected" action (nothing preselected, low-confidence MeSH excluded from select-all, duplicates skipped and reported, one undo entry for the batch). The 97.md-banned indiscriminate one-click bundle stays gone — this is the "carefully designed" §11 middle.
5. The list-path (dashboard cards) screening evidence omits the per-record quorum counts (they would be unbounded batched groupBys); finished-but-unsigned projects with TA exclusions can read "In progress" on cards while the detail view says Complete. Documented in code.
6. WebKit-under-Playwright approximates real macOS Safari; the strongest feasible automated validation is in place, and the remaining Safari-only deltas (real caret APIs, real PDF rendering) are covered by the geometric fallbacks + feature detection rather than UA branching.
7. Suggestion-visibility state is session-scoped (deliberate — §19 requires it in the canonical *view* state, not server persistence).

## 6. Removed legacy code
- The standalone Research Question stage (QuestionStage) and its stage-table row/icons/defaults.
- ConceptNavigator.jsx (master-detail pills) — replaced by the concept board.
- The legacy in-file syntax renderer in SearchBuilderTab (renderControlled/freeTextToken/renderSearch/fieldSuffix) — replaced by compileStrategy at every preview seam.
- The builder-toolbar Beginner toggle (moved to the workspace header, one instance).
- The classic extraction panel's decideWrite click-conflict dialog flow (pendingAssign) — replaced by immediate-replace-with-history.

## 7. Verification results (final)
- **Adversarial review**: a 6-dimension finder pass over the full diff produced 27 findings; each was independently adversarially verified — 21 confirmed (1 high: a lazy-seed CAS-409 dead-loop on concepts-less module rows; 1 high: classic-panel Smart-capture clamp regression; the rest medium/low across data-loss, board UI, progress semantics, compile/AST, a11y and cross-browser) and **all 21 were fixed** in this change set; 6 were refuted.
- **Unit + screening unit (hermetic)**: 394 files / **6,071 tests passing, 0 failed** (`npm run test:ci`).
- **Integration (live server, serialized)**: 94 files / **795 passed, 9 skipped, 0 failed**.
- **E2E**: search journeys **31/31 chromium** and **31/31 WebKit** (the new `webkit-search` project — full drag/merge/split/MeSH/undo/autosave coverage under Safari's engine); search smoke 7/7; responsive board wrap 5/5 (mobile-chrome); extraction+screening+a11y chromium subset 40 passed / 2 failed / 2 skipped — both failures verified **pre-existing baseline** (they fail identically with this change set's extraction files reverted; same class documented in docs/search-overhaul-96.md §6 / 97.md §7); firefox + webkit @smoke lanes **102 passed / 9 skipped, 0 failed**.
- **Lint**: eslint clean.
