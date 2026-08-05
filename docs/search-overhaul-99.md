# Dynamic concept expand/collapse — Select & Build Key Terms (99.md) — implementation report

Date: 2026-08-05 · Version: v4.6.0 · Builds on 98.md (docs/search-overhaul-98.md), which introduced the horizontal concept board this round makes interactive.

## 1. The UX approach, and why

**Chosen pattern: in-place card expansion on the existing board, with an explicit all-collapsed overview state.**

98.md already gave every concept its own card on a flex-wrap board, where the *active* card takes the full row with the working surfaces (add box, chips, group actions, suggestions) and inactive cards render compact. What it lacked was a way to say "nothing is being edited": some card was **always** expanded, because the active card fell back to `concepts[0]` whenever no explicit choice existed. Clicking away did nothing, and nothing on the card announced that it opened.

99.md is therefore not a new layout — it is the **missing collapse half** of the interaction, plus the affordances that make the existing expansion legible:

- Expansion stays **in the grid** (no side panel, no modal, no overlay). The board already reflows correctly at every viewport 98.md shipped, drag-and-drop geometry is measured from the same card elements, and the AND/OR connectors stay adjacent to the operands they describe. A detached editing panel would have broken all three.
- Collapse is a **first-class state**, not the absence of one: `boardCollapsed`. Clicking neutral page surface, pressing Escape, or clicking the chevron on the open card returns the board to a balanced all-compact overview where every concept is equally readable.
- The alternatives were considered and rejected: giving the active card more grid *columns* fights the wrap contract at tablet widths; a connected editing panel duplicates state and doubles the drop-target surface; a modal breaks the "see your whole strategy while you edit one part of it" model that the board exists to provide.

Two deliberate decisions worth stating, because they shaped the code more than the CSS did:

1. **`boardCollapsed` is a separate atom from `activeConceptId`.** Collapsing by setting `activeConceptId = null` would have been smaller but wrong: a null id already means "no explicit choice" and falls back to the first concept, and that fallback is load-bearing for the 98.md H14 keyboard contract (a card is always open on first arrival, so a keyboard user lands on a focusable add-term box) as well as for strategy load, remote-collaborator adoption, version restore and undo — none of which set an id. Overloading null would have made every one of those paths render an empty-looking board. The two atoms compose: `boardCollapsed` wins when set; otherwise the fallback behaves exactly as it did before 99.md.
2. **Expansion state is session UI state, never persisted.** It is not part of the serialized strategy signature, so the byte-stability contract is untouched: opening, collapsing and re-opening concepts produces zero PUTs. It resets when the project changes or the user leaves the terms phase.

## 2. Files changed

| File | Change |
| --- | --- |
| `src/features/searchBuilder/SearchBuilderTab.jsx` | `boardCollapsed` state; the coalescing board scheduler (`scheduleBoardChange`, `animate`-via-View-Transition, `selectConcept`, `activatePlain`, `collapseBoard`); outside-click listener pair; board-level Escape; phase/project resets; motion CSS; every activation call site rerouted; delete-confirm Escape + focus fix |
| `src/features/searchBuilder/components/ActiveConceptPanel.jsx` | Chevron disclosure button (`aria-expanded`/`aria-controls`); "N terms" collapsed badge; `sb-card-shell` hover/focus classes; disclosure body wrapper; operability hint; phrase-editor Escape layering |
| `src/features/searchBuilder/components/AddTermBox.jsx` | Layered Escape: close suggestion list → clear draft → let a "free" Escape reach the board |
| `src/features/searchBuilder/components/TermChipRow.jsx` | MeSH info Escape consumed only when it actually closed the popover |
| `src/features/searchBuilder/components/StrategyPreviewPanel.jsx` | Collapse-exempt the AND/OR toggle and the estimate retry (both act on concepts) |
| `tests/unit/searchBuilderUi.test.jsx` | 9 new SSR contract tests |
| `e2e/search/searchWorkspace.spec.ts` | 2 new journeys; 1 existing test updated for the new collapse-on-neutral-click behaviour |

## 3. Animation and state management

### The coalescing scheduler (the non-obvious part)

The morph runs inside `document.startViewTransition`, which snapshots the board, applies the mutation, and cross-fades while each card travels to its new box. Each card carries a stable `viewTransitionName` derived from its concept id, so the browser tracks *that* card across the reflow rather than fading the whole board.

The first implementation called `startViewTransition` per mutation and was **wrong** — a real bug, caught by e2e before commit. A single user gesture reaches the board through more than one dispatch layer: the document-capture outside-click listener fires first, then React's handler for the actual target (e.g. clicking a question phrase, or a preview row, which collapses *and* re-expands). Because `startViewTransition` defers its callback, the second call read pre-collapse state, its "already active" guard swallowed the re-activation, and commits landed out of order.

The fix: every board change **merges into one pending intent** (`boardPendingRef`), and exactly one commit applies it — inside a single View Transition when morphing is possible, instantly otherwise. All guards read the pending intent through `intentActiveId()`, which replicates the `concepts[0]` fallback so they agree with what the user actually sees, never render-scope state.

**Two race fixes came out of review, both reproduced before fixing:**

- *A deferred commit could outlive its own intent.* Clicking a stage pip ran: outside-click schedules a collapse (View Transition defers the commit) → React changes the stage → the phase-reset effect clears `boardCollapsed` → **the deferred commit lands last and re-collapses**. Because `SearchBuilderTab` stays mounted across stages, the board then stayed collapsed on return, with no working card and no focusable add box — breaking the H14 contract. Every reset path (phase, project, regenerate, unmount) now **cancels the pending intent**, which makes the late commit a no-op via the existing `if(!fin) return` guard. Pinned by a regression e2e that pips away and back.
- *A keyboard-synthesised click carried a stale pointer verdict.* `outsideDownRef` was set only by `pointerdown`, so activating a control with Enter reused whatever the last mouse gesture had decided — collapsing the board or not depending on unrelated history. The click handler now requires `e.detail !== 0` and consumes the flag, so the pairing can never outlive its gesture. Keyboard collapse remains Escape's job.

### Motion policy

CSS lives in the tab's existing `<style>` block (the house pattern — there are no `.css` files in `src/`; cf. the `pv-*` block in `SearchImportProgressModal`). No animation library was added: `framer-motion` is a dependency but is used only on marketing/auth pages, never in `src/features/*`, and pulling it into the workspace chunk for one morph would have been a pattern break and a bundle cost.

- Board morph: 220 ms, `--ease-out` (the workspace shell's easing custom property). Transform/opacity only — the properties the compositor handles.
- Hover on a compact card: accent ring + the theme elevation + `translateY(-1px)`, 180 ms.
- Chevron rotation: 180 ms. Working-surface entrance: a 200 ms fade-slide, which also gives a soft landing on engines without View Transitions.
- **`prefers-reduced-motion`** removes all of it — transitions, the body entrance, and the view-transition animations themselves — and the scheduler skips the transition entirely, committing instantly. Verified by a dedicated e2e test under `emulateMedia({ reducedMotion: 'reduce' })`.
- The morph is also skipped **during and immediately after a pointer drag**, where a reflow animation would fight the drag's own live geometry, and for data flows (merge/split/copy/create) whose `concepts` mutation commits in the surrounding batch — morphing those would snapshot a half-applied board.
- **The root is snapped, not cross-faded.** Only the cards carry transition names, so everything else landed in the default `root` group and ghosted the entire page under the board for the duration. `::view-transition-old(root)` is now hidden outright and old/new are retimed with their group (the UA default outlasted the movement).
- **Transition names are applied only while a morph is in flight.** A permanent `view-transition-name` makes every card wrapper a stacking context, which painted card-overflowing popovers (term editor, MeSH details) *under* the following cards. The name is flushed on synchronously before the old snapshot is taken and removed when the transition settles.

### Interaction rules

- **Expand**: click/Enter/Space on a compact card, its chevron, a strategy-preview row, the drift banner's "edit this concept", or "Find existing term". Only one card is ever expanded.
- **Switch**: clicking another card transfers the expansion in one commit — the old card collapses as the new one opens.
- **Collapse**: click outside, Escape, or the chevron on the open card. Clicking the *expanded* card is an intentional no-op (it stays open).
- **Outside-click** uses a gesture-scoped `pointerdown` + `click` capture pair: **both** the gesture start and the click target must be outside. A text-selection drag that starts inside a card and releases on the page therefore never collapses it, and a down-outside/up-inside gesture stays inert. Exempt surfaces are those whose clicks act *on* the concept workflow rather than leave it: the board, `[role="dialog"]`, the undo snackbar, and anything marked `data-sb-collapse-exempt` (question source card, stage toolbar, drift banner, inline hints, duplicate notice). Listeners are attached only on the terms phase and removed on cleanup.
- **Layered Escape**: Escape dismisses the innermost thing first — suggestion list, then a non-empty draft, then the term editor / MeSH popover / merge picker / split panel / delete confirm / the two text fields (rename, source phrase) — and only a "free" Escape collapses the card. Each layer calls `stopPropagation` **only when it actually consumed the key**, so no layer swallows an Escape it did not use.
- **Exemptions follow intent, not geography.** A surface is exempt when its controls act *on* the concepts: the question card, the PICO source tokens (same `togglePhrase` handler — without the exemption, removing a phrase-only concept from a PICO token collapsed the board while the identical question token did not), the strategy preview's AND/OR toggle and estimate retry, the stage toolbar, drift banner, inline hints and duplicate notice. Inert areas of those same panels still collapse, which is the documented behaviour.

## 4. Accessibility

- The chevron is a real `<button>` with `aria-expanded` and `aria-controls` → the disclosure region, labelled "Expand *X* for editing" / "Collapse *X*". It is a *view* control, so it is present for read-only viewers too.
- `aria-expanded="false"` tells the truth: the collapsed card's chip preview renders **outside** the controlled region, which is empty while collapsed. (Initially the region wrapped the preview too, which would have announced "collapsed" for content plainly still on screen.)
- The compact card stays a focusable tab stop with Enter/Space activation (98.md H14) and now carries a visually-hidden `aria-describedby` hint — "Press Enter to open this concept for editing" — because `role="region"` announces nothing about being operable. `role="button"` is **not** an option: the card contains nested interactive children, which that role forbids.
- **The card stays focusable in both states.** Gating `tabIndex` on `compact` un-focused the very element the user was standing on when it expanded, and the browser reset focus to `<body>` — after which Escape reached nothing and the card could not be collapsed from the keyboard at all. The expanded card keeps `tabIndex={-1}`: programmatically focusable (it is the refocus target) without adding a tab stop.
- **Focus is never stolen.** Escape-collapse moves focus to the now-compact card *only* when focus was inside the collapsing card **and the focused element did not survive it**. Controls that outlive the collapse — the chevron the user just pressed, the rename input — keep focus rather than being silently demoted to the card. Pointer-collapse never refocuses.
- The destructive delete-confirm now takes focus on open, consumes Escape to cancel itself (previously Escape there collapsed the whole card), and returns focus to "× Delete concept" when cancelled — each swap unmounts the focused button, so every leg needs an explicit landing place.
- Chevron hit target is 24×24 (WCAG 2.2 SC 2.5.8). On the expanded card it is the only pointer control that collapses, so it cannot lean on the card-sized target the compact state has.
- Collapsed cards remain informative (99.md §6): name, "Concept N" ordinal, term count with MeSH presence in the tooltip, status pill, suggestion badge, and a chip preview.
- axe scans of the board (including a dark-red duplicate chip) report no serious/critical violations.

## 5. Tests

**Unit — `tests/unit/searchBuilderUi.test.jsx` (+9, 113 total in file; 6083 suite-wide):** chevron `aria-expanded`/`aria-controls`/labels in both states; no chevron without toggle callbacks (legacy mount); the "N terms" badge and its absence when expanded/empty; hover/motion classes; chevron present read-only; the collapsed region is empty while the preview renders outside it; the operability hint and absence of `role="button"`; the 24×24 target.

**E2E — `e2e/search/searchWorkspace.spec.ts` (+2):**
- *expand/collapse journey*: switching between cards; outside click collapses to all-compact; collapsed cards keep term counts and a chevron reporting `aria-expanded=false`; chevron expands; clicks inside the working card never collapse it; a free Escape collapses and anchors focus on the compact card; Enter re-expands; a preview row expands its card; the chevron closes it again.
- *reduced motion*: the same expand/collapse round trip under `prefers-reduced-motion: reduce`.
- *pending-collapse cancellation*: pip away to Database Strategies and back, asserting a working card and a focusable add box are present — the regression guard for the deferred-commit race.
- Updated: the Ctrl+Z test now asserts the board collapses when the heading (neutral surface) is clicked, that global undo still works from the collapsed overview, and that the restored term is present once re-expanded.

**Manual/visual verification** at 1280 and 480 px, capturing resting / hovered / focused / expanded and confirming no horizontal overflow while expanded at 480 px. This caught a bug the automated tests could not: `--t-shadow` is a **complete** shadow value, not a colour, so `0 6px 16px var(--t-shadow)` was invalid at computed-value time and the browser silently dropped the entire hover `box-shadow` — the hover ring rendered nothing. Now `box-shadow: <ring>, var(--t-shadow)`, verified by computed style (hover ≠ resting).

**Adversarial review.** Four review lenses (state/races, accessibility, regressions, motion & code quality) each had their findings independently verified by a skeptic instructed to refute; 7 of 19 non-trivial claims were refuted and dropped. The 12 that survived are all fixed above — the two races, the `tabIndex` focus loss, the chevron/delete-confirm focus handling, the rename-input Escape, the PICO and strategy-preview exemptions, the root cross-fade, and the stacking-context regression. Two were caught only because the verifier built a working repro against real React and Chromium rather than reasoning about the event order.

## 6. Existing functionality

`npm run test:ci` — **6083 passed**. `npm run build` — clean. Playwright over `searchWorkspace.spec.ts` + `search.spec.ts` + `responsive/search-workspace.spec.ts` — **46/46 passed, zero retries**: phrase-click concept creation, chip drag onto a card, token-combine and grip-handle drags, group merge/split/delete with undo, drift keep/remove, Regenerate cancel/confirm/undo, global Ctrl+Z, duplicate journeys, MeSH popover, suggestions disclosure, beginner mode, read-only, mode switching, the two-writer and stale-write (409) reconciles, persistence/reload, both a11y scans and the responsive wrap contract.

A note on how that number was reached, because it matters for reading earlier runs: under **parallel workers** the shared dev database is heavily contended and times out widely. To separate signal from noise the changes were **stashed and the identical specs re-run on baseline** — baseline scored 24 passed / 10 failed against the modified code's 35 passed / 2 failed, i.e. the environment, not the diff. Running single-worker removes the contention and gives the clean 46/46 above. (The underlying cause is the accumulated "E2E Tmp" project scale documented in `docs/search-overhaul-96.md`/`97.md`.) One genuine failure *was* hiding in that noise — the deferred-commit race in §3 — and it was found by re-running a failing spec in isolation rather than by assuming flake.

Autosave and the byte-stability contract are unaffected: expansion state never enters the serialized signature or a PUT payload.

## 7. Visual states

- **Collapsed (all cards compact)** — a balanced row of equal cards: grip, "Concept N", name, suggestion badge, term count, status pill, chevron pointing down, and a chip preview. Cards wrap by viewport width and stack at narrow widths.
- **Hovered (compact)** — a 1 px accent ring plus the theme elevation and a 1 px lift; pointer cursor.
- **Focused (compact)** — a 2 px solid accent outline offset 2 px, from the shared focus-visible convention.
- **Expanded (working card)** — takes the full row with a 2 px accent border; chevron rotated 180°; source phrase, group actions, add box, full chip row with editors, suggestions disclosure and the Advanced compile preview fade-slide in. Sibling cards stay compact and readable beside/below it.

## 8. Remaining risks and recommended improvements

1. **View Transitions are Chromium-only today.** Firefox and Safari take the instant-commit path — correct, just without the morph; the CSS fade-slide entrance softens it. No behavioural difference, and the reduced-motion path exercises the same code.
2. **The view-transition rules are declared globally** (the tab's `<style>` is unscoped, matching the file's existing rules), including the `root` snap. Only this tab starts view transitions today, so there is nothing to collide with — but if another surface adopts them, these need scoping by transition name first, and the `root` rule in particular would suppress a cross-fade that another feature might want.
3. **Pre-existing, found while debugging the shadow bug (not fixed here):** several inline `boxShadow: "0 14px 40px var(--t-shadow)"` declarations elsewhere in the app (the merge dropdown, the add-term listbox, and others) have the same invalid-CSS shape and are silently rendering **no shadow**. Fixing them is a one-token change per site but would alter visuals in many unrelated places, so it belongs in its own reviewed pass.
4. **Expansion state is not restored across reloads** — deliberate (99.md: "treated as UI state unless there is a strong reason to persist it"). If usage shows people repeatedly reopening the same concept after a reload, per-project session storage would be the smallest fix.
5. The 98.md limitations remain open and untouched: `TermEditorPopover` is absolute-positioned rather than portaled, Beginner Mode persists per-browser, and within-group Boolean is fixed to OR.
