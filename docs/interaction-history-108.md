# Keyboard Interaction + Project-Wide Undo/Redo — 108.md

Implementation report for `.claude/Prompts/108.md`. Version **4.13.0**.
Builds on `docs/screening-extraction-107.md`. Round 2 (adversarial review + fixes) will be §12.

## 1. Why Ctrl/Cmd+I was triggering browser behaviour, and how it was fixed

**Root cause.** No PecanRev listener was swallowing the chord — every `stopPropagation()` in
`src/` is Escape-scoped. When the browser "won", it was the UA's own accelerator:

- **Firefox** binds Ctrl/⌘+I to **Page Info**, which opens a separate browser window — the
  reported symptom, and the prime suspect. Gecko dispatches the keydown to content first and
  honours cancellation. **Preventable — and now reliably prevented whenever PecanRev handles
  the press.**
- **Chrome**: Ctrl/⌘+I is unbound (nothing to suppress; a Chrome-only repro looks like a false
  negative). Ctrl/⌘+E is bound but cancellable.
- **Ctrl/Cmd+Shift+I** (DevTools) is **browser-reserved**: the keydown reaches the page but
  `preventDefault()` is ignored. The 107 matcher ignored Shift, so one press *both* added a
  keyword *and* opened DevTools. **Fixed: Shift chords are never claimed.** (Same class:
  Ctrl+Shift+E, Firefox Network Monitor.)
- **Edge / Safari**: chrome-level behaviours (Copilot sidebar, "Email This Page") are not
  observable from a page or from Playwright; ordinary accelerators are suppressed by the same
  `preventDefault()`, reserved ones are not suppressible by any page. Treated as hypotheses
  requiring manual verification — documented, not assumed.

**Code fixes** (`selectionShortcut.js` + `useAbstractSelectionShortcuts.js`):
`shiftKey` rejected; `e.defaultPrevented` / `e.repeat` / `e.isComposing` (incl. keyCode 229)
guarded via a pure `keyEventRejection(e)`; and **processability moved into the guard chain** —
a new `canHandle` predicate (wired to `canEditKeywords`) is evaluated *before* `handled:true`,
so a press PecanRev cannot process is never cancelled and the browser keeps its default
(108 §1 condition 5). Duplicate-term and opposite-list-conflict presses remain handled —
PecanRev responds with a note or the move dialog, which is processing. `preventDefault()`
stays synchronous, after all guards pass, only when handled.

**The honest scope**: the automated cross-engine matrix
(`e2e/screening/keywordShortcuts.spec.ts`, chromium/firefox/webkit) asserts the keyword was
added and `defaultPrevented === true` via a window-capture probe — i.e. "PecanRev cancelled
the event", never "the browser did nothing", which is unobservable. The Ctrl+Shift+I case is
pinned as *not* claimed with a positive control on the same selection.

## 2. The keyboard-shortcut routing architecture (108 §§23-24)

New pure core `src/research-engine/interaction/shortcutRouter.js` + one DOM adapter
`src/frontend/shortcuts/ShortcutProvider.jsx` (a single window-bubble keydown per project
shell). Tier model, documented in the router header:

1. **Modal** — unified signal `interaction/modalSignal.js`: screening `Modal` and every
   Stitch focus-trapped dialog stamp a modal attribute; `isAnyModalOpen()` feeds the router ctx.
2. **Focused editor / native behaviour** — the adapter skips `e.defaultPrevented` events
   (a nearer handler like the manuscript editor's italic wins), and bindings decline on
   `ctx.editableTarget` — the ONE canonical predicate `interaction/editableTarget.js`
   (tags + contenteditable + ARIA textbox/searchbox/combobox; `undoStack.js`'s
   `shouldHandleGlobalUndo` now re-exports from it, and the DOM reader also honours
   `getAttribute('role')` for engines without ARIA reflection).
3. **Component/selection** — the abstract Ctrl+I/E hook (registers first as a child effect;
   its preventDefault makes later handlers skip via the defaultPrevented rule).
4. **Engine** — the migrated Search-Builder undo binding and the manuscript
   Ctrl/Cmd+Enter placeholder-step binding (its missing-dep-array listener bug fixed by
   construction).
5. **Global** — the project-wide Undo/Redo chords.

Registration order breaks ties within a tier (child effects run first → nearest wins).
Left unrouted this round, by design: FocusMode's Ctrl/Cmd+Shift+F (already checks
`defaultPrevented`), the layered Escape-closers, and `Profile.jsx`'s capture-everything
rebinding UI (`ctx.suspended` exists for it; the Profile page mounts no router).
`SearchBuilderTab`'s document-bubble Ctrl+Z listener was **removed** (it ran before any
window-bubble listener and would have shadowed the router).

## 3. The Undo/Redo architecture (108 §§2-16)

**Pure model** `src/research-engine/interaction/historyStacks.js`: scope-keyed undo/redo
stacks, cap 20 per scope; entries are **semantic domain actions**
(`{ kind, scope, label, entityKey, undoOp, redoOp, meta }`) — never UI snapshots (§9/§10).
Standard stack rules incl. the §11 branch-clear (new action clears that scope's redo).
`takeUndo/takeRedo` move the entry into a per-scope in-flight `pending` slot and refuse
(`busy`) while occupied — per-scope serialization by construction. `redoOp: null` marks
one-way entries (dropped after undo instead of offering an impossible redo).
`coalesceOrRecord` merges top-of-stack entries (§13).

**Provider** `src/frontend/history/HistoryContext.jsx` (+ `ProjectInteractionProvider`
mounted in the Stitch workspace, standalone SiftProject, and the legacy Workspace with a
tab→scope adapter): `record / coalesce / undo / redo / canUndo / canRedo / registerExecutor`.
Executors dispatch through the SAME mutation paths as the forward actions (§8) and must
re-validate current state; `false/{ok:false}` ⇒ refusal (entry restored + "changed by a
collaborator" note), throw ⇒ persistence failure (entry restored). Feedback flows through a
queued `useUndoFeedback` provider that renders the 107 `KeywordSnackbar` unchanged
("<label> undone/redone", Undo-carrying notes always queue) (§17).

**Page-scoped history (§3)**: scope = the URL-derived stage
(`interaction/projectScopes.js`; all screening sub-tabs share `'screening'`). Ctrl+Z in
Screening undoes the last *Screening* action even if a later Extraction edit exists — per the
108 example. **Lifetime (§16)**: in-memory per session; navigation within the project keeps
each scope's stack; refresh/sign-out/project-switch clear it (project state itself always
persists); a blob autosave conflict (409) clears the blob-backed scopes
(the stack is only valid against the document it was recorded on — the searchBuilder rule,
generalized). The ProjectEvent audit ledger was evaluated and deliberately NOT used as the
history store (sanitised/bounded values, significance filtering, bulk collapsing, no coverage
of relational screening writes) — its entry schema informed ours instead.

**Native text editing (§7)**: the undo/redo bindings never fire on an editable target
(canonical predicate; the manuscript's contentEditable keeps native execCommand undo — its
own header documents that choice). With no history, the chord is NOT `preventDefault`ed
(§26 no-op). Autosave, debounce, cache refresh, and server reconciliation record nothing —
recording happens only at user-mutation call sites (§12).

## 4. Reversible actions this round (§§4-6)

| Scope | Actions | Notes |
|---|---|---|
| screening | include/exclude/maybe, decision change, clear-decision ('u'), keyword add (editor, Ctrl+I/E), keyword move, keyword delete (chip ×, context menu), suggestion accept/reject | decision entries carry the COMPLETE stage-scoped prior payload |
| extraction | typed field edits (coalesced — 42 keystrokes = 1 entry), click-to-pick/converter writes, all selects incl. the combined denominator patch, case-variable fields, classic-tab edits | undo restores value + FULL provenance entry + needsReview verbatim; a first click-pick undo deletes the provenance entry it created |
| analysis / forest / sensitivity / subgroup | τ² estimator, precision (single-project), proportion filters, proportion override record/clear | redo of an override restores the same consent record (original at/by); apply-to-all-projects excluded |
| search | the 17 existing searchBuilder kinds | **undo only** — delegated to the existing stack; redo unavailable (documented) |
| manuscript | section lock toggle, fact pin/revert | prose stays native; snapshots excluded |

Excluded by design (§6): project deletion, account/security changes, external communications,
server jobs (duplicate detection), promotion side effects (below), apply-to-all fan-outs.

## 5. Race-condition and collaboration handling (§§14-15)

- **Keyword ops**: server pre-image CAS + bounded retry (107) + client sequence guard; inverses
  are derived, never hand-rolled — `keywordInverseOps(stateBefore, op)` is total over all op
  types and fuzz-verified (23k cases, byte-identical round trips incl. origins, decisions,
  the seeded marker, and list position via the new `index` op flag). Redo replays the original
  forward op. Batch ops (`{ops:[...]}`, all-or-nothing, one CAS write) make compound inverses
  one round trip. The 107 "seeded residue on move-undo" limitation is now fixed.
- **Screening decisions** (the one surface with a genuinely reachable stale-response race):
  per-record POST serialization (`decChainRef`) + per-record response sequencing
  (`decSeqRef`); entries recorded at issue time so "mutation → Ctrl+Z before the first save
  returns" works; executors re-validate the live row (stage-scoped) and always send an
  explicit `stage` (the upsert otherwise resolves to `currentStage`, which after promotion is
  full_text — the stage trap). **Promotion is a one-way ratchet** (no demotion path exists
  server-side): a promoting decision's entry is disarmed by its precondition and the user is
  told the decision can no longer be undone.
- **Blob surfaces**: both autosave stacks are replace-not-queue with serialized sends, so an
  undo's write supersedes any pending save and an older PUT cannot resurrect the undone value;
  a 409 surfaces as a conflict that clears the blob scopes (never a silent pop).
- **Collaboration**: no whole-project snapshots anywhere — decisions are per-(record,
  reviewer, stage) rows, keyword ops are per-term server reducers, blob writes are
  single-key updates under CAS. A collaborator's newer change makes the entry's precondition
  fail → refusal with an explanatory note, never an overwrite.

## 6. Right-click keyword deletion (§§18-21)

`KeywordContextMenu.jsx` (modeled on the repo's `RowMenu`: role=menu/menuitem, roving
arrow-key focus, Escape closes + refocuses the trigger, outside-click and scroll/resize close)
positioned at the pointer by the pure `interaction/menuPosition.placeMenu` (both-axis clamp +
flip), stamping the screening modal attribute while open (suppresses Ctrl+I/E — deliberate).
Attached to BOTH keyword surfaces: the editor chips and the always-visible filter rows.
**Origin gating (§19, the documented decision)**: `manual` and `accepted` keywords are
deletable this way (accepted suggestions are user-controlled filters after acceptance);
`default` seed terms and non-editors get NO menu and no `preventDefault` — the browser's own
context menu survives, mirroring §1's own-it-or-leave-it rule. The menu is a single
"Delete keyword" danger item (the repo's inline-confirm convention; undo is the safety net).
Deletion records a history entry whose derived inverse restores the same list, position,
display text, origin, decisions and seeded state (§20) — Ctrl+Z restores, Ctrl+Shift+Z
deletes again, and the snackbar's Undo button shares the same history path. Chip ×/move
buttons were enlarged to ≥24px targets (the touch path); chips gained testids +
data-term/origin/list and keyboard access to the menu.

## 7. UI availability (§22, §25)

Undo/Redo buttons (`StitchIconButton` + tooltip with the shortcut hint) live in the per-stage
header action cluster, disabled from `canUndo/canRedo`; the header is hidden in Focus Mode
(keyboard still works — documented). Every action remains reachable through visible controls
(decision bar, chip buttons, suggestion buttons, menu = an *additional* path); menus carry
proper roles/labels; the app-wide focus-visible ring covers the new controls.

## 8. Files/modules (new)

`src/research-engine/interaction/`: `historyStacks.js`, `shortcutRouter.js`,
`editableTarget.js`, `menuPosition.js`, `projectScopes.js`, `undoChords.js`,
`modalSignal.js`, `extractionHistory.js`; `src/research-engine/manuscript/historyOps.js`;
`src/frontend/history/`: `HistoryContext.jsx`, `useUndoFeedback.jsx`,
`ProjectInteractionProvider.jsx`; `src/frontend/shortcuts/`: `ShortcutProvider.jsx`,
`domTarget.js`; `src/frontend/screening/lib/screeningHistory.js`;
`src/frontend/screening/components/KeywordContextMenu.jsx`;
`src/frontend/stitch/shell/StitchHistoryControls.jsx`. Modified: ScreeningTab,
ArticleWorkspace, PecanExtractionEngine, extractionTabs, analysisTabs, useManuscript,
manuscriptPanels, SearchBuilderTab, StitchProjectWorkspace, SiftProject, Workspace,
overlay.jsx, keywordModel.js, screeningController.js (keyword ops), selectionShortcut.js,
useAbstractSelectionShortcuts.js, undoStack.js (predicate re-export), icons.jsx.

## 9. Verification

| Command | Result |
|---|---|
| `npm run test:ci` | **453 files / 7612 tests — all passed** (7230 at v4.12.0; ~380 added) |
| `npm run lint` | clean |
| `npm run build` | ✓ |
| `npm run test:integration` (live server) | **96 files, 823 passed / 9 skipped** |
| e2e chromium (screening + extraction + search + manuscript) | **90 passed, 1 flaky (passed on retry), 2 skipped** |
| e2e firefox + webkit `@smoke` (incl. the Ctrl+I cross-engine matrix) | **120 passed, 1 flaky (passed on retry), 9 skipped** |
| esbuild parse-check, every edited `.jsx` | clean |

Key new test files: `tests/unit/interaction/*` (historyStacks 31, shortcutRouter 17,
menuPosition 13, historyProvider 18, useUndoFeedback 18, editableTarget 7, projectScopes 14,
undoChords 22, shellHistory 19, extractionHistory 59), `analysisHistoryEntries` 22,
`manuscript/historyOps` 17, `screeningDecisionHistory` 29, `keywordContextMenu` 20,
`keywordModel` 74 (was 38), `keywordOpsHandler` 23, `selectionShortcut` 35 (was 14),
`keywordUndoWiring` 16 (rewritten). New e2e: `keywordShortcuts.spec.ts` (6),
`keywordContextMenu.spec.ts` (8), `screeningUndoRedo.spec.ts` (7),
`extraction-undo.spec.ts` (4).

## 10. Invariants (do not regress)

1. **Never hand-roll a keyword inverse** — `keywordInverseOps(stateBefore, op)` with the
   state the op actually ran against (post-`materializeDefaults`); redo replays the forward op.
2. **Undo/redo bindings gate on `canUndo/canRedo` + non-editable target in `when()`** —
   an async handler would otherwise preventDefault a no-op chord (§7/§26).
3. **Shift chords are never claimed** by the selection shortcut; `preventDefault` only after
   the full guard chain (incl. `canHandle`) passes.
4. **Extraction undo never goes through `setFields`** (it downgrades provenance and forces
   needsReview) — always the writeStudy/applyExtractionWrite path with the full prior
   provenance entry.
5. **Decision undo/redo writes always carry an explicit `stage`** and the COMPLETE payload;
   entries for promoting decisions must stay disarmed (no demotion path exists).
6. **Executors never call the recording paths** (undo would record itself and clear redo).
7. **History entries are semantic ops, never snapshots**; autosave/reconciliation record
   nothing.
8. The searchBuilder scope delegates to its own stack (clear-on-remote preserved);
   its keydown listener must not be re-added outside the router.

## 11. Known limitations

1. **Search redo is unavailable** (the 17 undoStack kinds lack forward patches) — Ctrl+Shift+Z
   is a no-op in the search scope.
2. **Final Review (SecondReviewTab) has no Ctrl+I/E** — it renders N per-card abstracts and the
   hook takes one container ref; needs a `containerSelector` option on the hook (follow-up).
3. `revertFact`/`keepCurrentFact` have no UI caller yet — the manuscript fact-pin entries are
   reachable programmatically only; section-lock entries are live.
4. Modal-signal coverage: legacy `components/Modal.jsx`, RobWorkspace's OverrideModal,
   ExportDialog and the admin drawers don't stamp the attribute (Ctrl+Z not suppressed there).
5. An undo whose record fell out of the loaded screening window refuses (`record-missing`) —
   reachable under a non-`all` filter after a teammate's decision reload.
6. `dismissConflictOps` records two entries (two Ctrl+Z presses).
7. Undoing the first decision on a record also clears notes/rating saved in that same write
   (the faithful pre-action state — no row existed).
8. Focus Mode hides the header Undo/Redo buttons (keyboard unaffected).
9. Classic-select coalescing can merge a clear-then-pick into one entry (coarser step, never a
   wrong value); engine selects are discrete.
10. Manuscript persistence failures surface asynchronously; a manuscript undo relies on the
    blob-conflict scope-clear as its safety net.
11. History is session-memory: gone after refresh/sign-out/project switch (state persists).
12. Edge/Safari chrome-level shortcut behaviour requires manual verification (documented in §1).
