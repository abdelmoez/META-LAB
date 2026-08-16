/**
 * projectScopes.js — 108.md §3 "Undo/Redo should be contextual to the current
 * page". The pure mapping from a project WORKFLOW STAGE to the history SCOPE key
 * that `historyStacks.js` keys its per-page undo/redo stacks on.
 *
 * WHY A MODULE AND NOT A LINE OF JSX. Three different shells decide "which page am
 * I on" three different ways and all three must land on the SAME key, or a user who
 * screens in the Stitch shell and then opens the legacy monolith gets two disjoint
 * histories for one page:
 *   - the Stitch workspace reads `?tab=` (navConfig.activeProjectStage);
 *   - the legacy monolith keeps the stage in React state (`Workspace.jsx` `tab`);
 *   - the standalone /sift-beta screening route has no stage at all — it IS
 *     screening, so it passes SCOPE_SCREENING directly.
 * Stage ids and scope keys are deliberately the SAME strings (workspace/
 * projectHelpers.js TABS ids), so this module is mostly a validating identity — but
 * it is the one place the aliasing (`discovery` → `search`) and the unknown-stage
 * fallback live.
 *
 * SUB-PAGES SHARE THEIR STAGE'S SCOPE. `?screen=` (screening sub-tab) and `?stage=`
 * (the 8-step search workflow) do NOT split the stack. Moving between Title &
 * Abstract and Conflicts is navigation inside one engine, and 108.md §16 requires
 * that "switching between pages and returning should allow the page-specific Undo
 * stack to continue where sensible".
 *
 * Pure: no DOM, no React, no imports.
 */

/** Every stage id that owns a history stack. Mirrors workspace/projectHelpers TABS. */
export const HISTORY_SCOPES = Object.freeze([
  'overview', 'control', 'pico', 'prospero', 'search', 'living', 'citation',
  'screening', 'prisma', 'extraction', 'rob', 'analysis', 'forest', 'sensitivity',
  'subgroup', 'nma', 'grade', 'manuscript', 'report', 'methods', 'history',
  // 119.md §8 — the Logbook. A READ-ONLY stage: it owns a scope so nothing it does
  // can ever share (or clear) another page's undo stack, but the stack stays empty
  // because an append-only audit trail has no undoable action to record.
  'logbook',
  // 116.md §86 — the ONE scope that is not a workflow stage. The PDF viewer is
  // mounted INSIDE other stages (screening, RoB, extraction), and 116.md §86 is
  // explicit that "annotation undo must not unexpectedly undo an unrelated
  // Screening decision". Giving annotations their own scope makes that structural
  // rather than a matter of luck: the global Ctrl+Z chord reads the STAGE's scope
  // and can never reach these entries, while the viewer registers a TIER.COMPONENT
  // binding (which beats TIER.GLOBAL) that targets this scope only while the PDF
  // pane holds focus. `historyScopeForStage` never returns it — no URL stage maps
  // here, by design.
  'pdf',
]);

const SCOPE_SET = new Set(HISTORY_SCOPES);

/** The scope an unrecognised stage falls back to (matches the workspace router). */
export const DEFAULT_SCOPE = 'overview';

/** The standalone /sift-beta route's scope — it has no `?tab=` to read. */
export const SCOPE_SCREENING = 'screening';

/** The Search Builder's scope; its undo delegates to searchBuilder/undoStack.js. */
export const SCOPE_SEARCH = 'search';

/**
 * 116.md §86 — the PDF annotation scope. Surface-scoped, not stage-scoped: the same
 * viewer appears on Title & Abstract, Full-text review, Conflicts, RoB and
 * Extraction, and its undo stack must follow the DOCUMENT, not the page it happens
 * to be embedded in.
 */
export const SCOPE_PDF = 'pdf';

/**
 * historyScopeForStage(stage) → scope key
 *
 * `discovery` normalizes to `search` exactly as navConfig.activeProjectStage does
 * (prompt60 folded the two stages into one); anything unknown falls back to the
 * overview scope, which is where StitchProjectWorkspace also sends it.
 */
export function historyScopeForStage(stage) {
  const s = typeof stage === 'string' ? stage.trim() : '';
  if (!s) return DEFAULT_SCOPE;
  if (s === 'discovery') return SCOPE_SEARCH;
  return SCOPE_SET.has(s) ? s : DEFAULT_SCOPE;
}

/**
 * legacyTabScope(tab) — the legacy monolith adapter. `Workspace.jsx` keeps the
 * stage in React state rather than the URL, but its ids are the same TABS ids, so
 * this is historyScopeForStage under a name that says where it is used.
 */
export function legacyTabScope(tab) {
  return historyScopeForStage(tab);
}

/**
 * BLOB_SCOPES — the scopes whose mutations land in the `Project.data` JSON blob and
 * are therefore invalidated together by ONE autosave 409.
 *
 * The blob is saved whole under an `autosaveRev` compare-and-set (server/store.js).
 * When that CAS refuses a write, both shells respond by DISCARDING the pending save
 * and reloading the server's copy (Workspace.jsx `resolveSaveConflict`,
 * useStitchProjectDoc's 409 branch). Every history entry recorded against the local
 * blob now describes a state that no longer exists, so those scopes must be cleared
 * — see 108.md §15 and the dossier's "A 409 SILENTLY DISCARDS AN UNDO" pitfall.
 *
 * NOT blob-backed, and therefore deliberately absent:
 *   - `screening` — relational rows (ScreenDecision / keyword ops with their own
 *     server-side pre-image CAS); a blob conflict says nothing about them;
 *   - `prisma` — 116.md §10: the entries this scope records are PRISMA-inspector
 *     record edits, which are RELATIONAL ScreenRecord mutations through the
 *     screening PATCH endpoint. A blob CAS refusal says nothing about them (the
 *     page's legacy manual-number fields do write the blob, but they record no
 *     history entries), so clearing this scope on a 409 would only destroy valid
 *     relational undo state;
 *   - `search` — its own SearchDocument row + revision envelope, and its stack has
 *     its own clear-on-remote-adoption rule inside SearchBuilderTab;
 *   - `pdf` — 116.md §88/§111: annotations are RELATIONAL PdfAnnotation rows with
 *     their own per-row `revision` CAS and their own endpoints. A blob 409 says
 *     nothing about them, and clearing the scope would destroy valid undo state
 *     for highlights that persisted perfectly well (the same reasoning that keeps
 *     `screening` and `prisma` out);
 *   - `living` / `citation` / `methods` / `history` / `logbook` / `overview` — no
 *     blob writes that this round records (the Logbook has no write path at all).
 */
export const BLOB_SCOPES = Object.freeze(new Set([
  'control', 'pico', 'prospero', 'extraction', 'rob',
  'analysis', 'forest', 'sensitivity', 'subgroup', 'nma',
  'grade', 'manuscript', 'report',
]));

/** Predicate form — the argument `HistoryContext.clearScopes` expects. */
export function isBlobScope(scope) {
  return BLOB_SCOPES.has(String(scope == null ? '' : scope));
}

export default {
  HISTORY_SCOPES, DEFAULT_SCOPE, SCOPE_SCREENING, SCOPE_SEARCH, SCOPE_PDF,
  historyScopeForStage, legacyTabScope, BLOB_SCOPES, isBlobScope,
};
