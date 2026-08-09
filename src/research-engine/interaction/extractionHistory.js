/**
 * interaction/extractionHistory.js — 108.md §5, §8, §12-15. The PURE half of
 * extraction Undo/Redo: the entry builders, the coalescing predicate, the
 * precondition check, and the write appliers both extraction surfaces share.
 *
 * WHY A SEPARATE MODULE. `ArticleWorkspace.jsx` (1,000 lines) and the classic
 * `extractionTabs.jsx` (1,300 lines) are stateful React components and the repo has
 * no jsdom, so nothing inside them can be exercised by a unit test. Everything that
 * decides WHAT an undo does lives here instead, where it is testable against real
 * `studies[]` fixtures; the components keep only the wiring (see the source-pin
 * tests in tests/unit/interaction/extractionHistory.test.js).
 *
 * ── THE PROVENANCE PITFALL (108.md §8, the sharpest correctness question) ─────
 * An extraction field carries per-value provenance under
 * `study.extractionMeta.provenance[field]` — method / page / bbox / fileKey /
 * excerpt / history — which is what "⌖ source" (jump-to-source) reads. The forward
 * MANUAL write path (`ArticleWorkspace.setFields`) deliberately DOWNGRADES that
 * entry to `{ method:'manual', page:null, bbox:null }` and forces
 * `needsReview:true`, because a hand-typed value invalidates the click coordinates
 * of the value it replaced.
 *
 * An undo routed back through `setFields` would therefore destroy the very thing it
 * is supposed to restore: undoing back to a PDF-clicked value would leave it
 * attributed to 'manual' with no page/bbox, and jump-to-source would answer "No
 * saved source for this value yet." So the entries built here snapshot the WHOLE
 * prior provenance entry (and `needsReview`) and the executor applies them through
 * `applyExtractionWrite` — the same one-functional-update path
 * `PecanExtractionEngine.writeStudy` uses for a forward click-to-pick — never
 * through `setFields`.
 *
 * `null` in a provenance map means REMOVE: when the forward action CREATED a
 * provenance entry for a field that had none (a first click-to-pick), a faithful
 * undo has to delete it again, not leave a fabricated 'manual' stub behind.
 *
 * ── TRANSACTION BOUNDARIES (108.md §12-13) ───────────────────────────────────
 * Extraction inputs are per-keystroke controlled inputs with no blur handler; the
 * only boundary below them is the 800 ms autosave debounce, which lives in the
 * storage layer and is shared by the whole blob. So the boundary is introduced HERE,
 * in the history layer, exactly as 108.md §13 asks: consecutive keystrokes in one
 * (study, field) COALESCE into a single entry that keeps the FIRST prev and the LAST
 * next. Autosave, debounce commits and server responses record nothing at all —
 * recording happens only at the mutation call sites (§12).
 *
 * ── RACES (108.md §14) ───────────────────────────────────────────────────────
 * Both blob autosave stacks are REPLACE-not-queue and serialize their sends
 * (`serverStorage.set` overwrites `pendingValue` and restarts the timer;
 * `useStitchProjectDoc.scheduleSave` clears the previous timer; both PUT the WHOLE
 * blob through a `_baseRev` compare-and-set). An undo's `updateProject` therefore
 * SUPERSEDES a pending post-change save, and an older in-flight PUT cannot resurrect
 * the undone value because the next PUT carries the whole post-undo blob. Nothing
 * here needs to flush or cancel anything; the executor's job is only the
 * precondition check below.
 *
 * PURE — no React, no IO, no Date/Math.random. Ids and timestamps are supplied by
 * the caller (the repo's idFn rule: StrictMode double-invokes state updaters).
 */

import { propagateArticleFields } from '../extraction/caseSeries.js';
import { attachProvenanceMany, readProvenance } from '../extraction/engine/articleProvenance.js';

/** The history entry `kind` every extraction field mutation records under. */
export const EXTRACTION_HISTORY_KIND = 'extraction.field';

/**
 * The entry label. 108.md §17 names the feedback line verbatim — "Extraction change
 * undone" — and HistoryContext.historyNote composes it as `${label} ${verb}`, so the
 * label IS this string. The human field name rides in `meta.fieldLabel` (resolved
 * from ArticleWorkspace's FIELD_LABELS, case variables included) for the Undo/Redo
 * control's tooltip, which is where naming the field actually helps.
 */
export const EXTRACTION_ENTRY_LABEL = 'Extraction change';

/**
 * Idle window for coalescing (108.md §13). Consecutive keystrokes in one field merge
 * into one entry; a pause longer than this starts a new one, which is the same
 * "sensible transaction boundary" every code editor uses. Rolling: the merged entry
 * carries the newest timestamp.
 */
export const EXTRACTION_COALESCE_WINDOW_MS = 4000;

/** Which extraction surface an op must be applied through. */
export const EXTRACTION_SURFACE = Object.freeze({ ENGINE: 'engine', CLASSIC: 'classic' });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * normalizeFieldValue — the comparison form of a studies[] cell.
 *
 * Row values are strings by convention but a few are booleans (`needsReview`),
 * numbers (imported rows) or arrays (`flags`, `conversions`). A MISSING key and `''`
 * are the same semantic state (the 107.md §8C legacy contract), so both normalize to
 * `''` — a precondition must not refuse an undo merely because the forward write
 * created the key.
 */
export function normalizeFieldValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** True when two row cells hold the same value (see normalizeFieldValue). */
export function sameFieldValue(a, b) {
  return normalizeFieldValue(a) === normalizeFieldValue(b);
}

/**
 * matchesExpected(row, expect) → boolean — 108.md §14/§15, the executor precondition.
 *
 * Before applying an inverse the executor re-reads the row from the FRESHEST project
 * and requires every expected field to still hold the value this entry produced. If a
 * collaborator (or the AI extractor, or a second tab) moved it, the undo is refused
 * and the entry goes back on its stack — an undo must reverse the user's own action,
 * never silently overwrite somebody else's newer one.
 */
export function matchesExpected(row, expect) {
  if (!isObj(expect)) return true;
  if (!isObj(row)) return false;
  for (const [f, v] of Object.entries(expect)) {
    if (!sameFieldValue(row[f], v)) return false;
  }
  return true;
}

/** Values a keystroke can produce. A boolean/array/object write is never typing. */
function isTextLike(v) {
  return v === null || v === undefined || typeof v === 'string' || typeof v === 'number';
}

/**
 * isTypingContinuation(prev, next) → boolean
 *
 * The shape test that separates TYPING from a discrete choice when the call site
 * cannot say so itself (the classic tab writes selects and text inputs through the
 * same single-key `updStudy`). Typing appends characters and backspacing removes
 * them, so one value is a prefix of the other; picking 'Cohort' after 'RCT' is not.
 *
 * KNOWN EDGE (documented, harmless): every string has `''` as a prefix, so clearing a
 * select and immediately choosing a new option can still merge into one entry. The
 * result is a single undo that lands on the value before the clear — a coarser undo
 * step, never a wrong value. The engine surface does not rely on this heuristic at
 * all: its selects pass `discrete: true` explicitly.
 */
export function isTypingContinuation(prev, next) {
  if (!isTextLike(prev) || !isTextLike(next)) return false;
  const a = prev == null ? '' : String(prev);
  const b = next == null ? '' : String(next);
  if (a === b) return false;
  return b.startsWith(a) || a.startsWith(b);
}

/**
 * entityKeyFor(studyId, fields) — the coalescing identity: one chain per (study,
 * field-set). A different field, a different row, or a different patch SHAPE (the
 * combined denominator patch vs a plain one) produces a different key and therefore
 * breaks the chain, which is what 108.md §13 means by a natural boundary.
 */
export function entityKeyFor(studyId, fields) {
  const list = Array.isArray(fields) ? fields.filter(Boolean).map(String) : [];
  return `${String(studyId == null ? '' : studyId)}|${[...list].sort().join(',')}`;
}

/**
 * buildExtractionEntry(spec) → entry | null
 *
 * ONE logical entry per user intent (108.md §12). Returns null — record nothing —
 * when the write changes no primary value, which is what keeps a re-render, a
 * re-pick of an identical value, or an autosave echo out of the history.
 *
 * @param {object}   spec
 * @param {object}   spec.study            the row BEFORE the write (the prev snapshot)
 * @param {object}   spec.patch            the EXACT patch about to be written
 * @param {string[]} [spec.primaryFields]  the fields the user changed; these carry the
 *   precondition. Defaults to the patch keys minus the bookkeeping `needsReview`.
 * @param {Object<string,object>} [spec.provenanceNext] provenance entries the forward
 *   write attaches. The prev snapshot is taken for exactly these fields (`null` where
 *   the field had none, so the undo removes rather than fabricates).
 * @param {string}   [spec.surface]        'engine' | 'classic' — which executor path
 * @param {string}   [spec.fieldLabel]     human name for the UI (FIELD_LABELS)
 * @param {boolean}  [spec.discrete]       a one-shot action (select, click-to-pick,
 *   converter, checkbox) that must NEVER merge with a neighbouring edit
 * @param {number}   [spec.at]             timestamp; the provider stamps one when omitted
 * @returns {object|null} an entry for useProjectHistory().record / .coalesce
 */
export function buildExtractionEntry({
  study, patch, primaryFields, provenanceNext,
  surface = EXTRACTION_SURFACE.ENGINE, fieldLabel = '', discrete = false, at,
} = {}) {
  const row = isObj(study) ? study : null;
  const next = isObj(patch) ? patch : null;
  if (!row || !row.id || !next) return null;

  const keys = Object.keys(next);
  if (!keys.length) return null;

  const declared = Array.isArray(primaryFields) ? primaryFields.filter(Boolean) : null;
  const primary = (declared && declared.length ? declared : keys.filter((k) => k !== 'needsReview'))
    .filter((f) => keys.includes(f));
  if (!primary.length) return null;

  // 108.md §12 — a write that changes nothing is not a user action.
  if (primary.every((f) => sameFieldValue(row[f], next[f]))) return null;

  const prevFields = {};
  for (const k of keys) prevFields[k] = row[k];

  const provNext = isObj(provenanceNext) ? provenanceNext : {};
  const provPrev = {};
  for (const f of Object.keys(provNext)) {
    // `null` ⇒ the field had no provenance before, so the undo must DELETE the entry
    // the forward write created (never leave a fabricated 'manual' stub).
    provPrev[f] = readProvenance(row, f) || null;
  }

  const undoExpect = {};
  const redoExpect = {};
  for (const f of primary) {
    undoExpect[f] = next[f];   // undo runs only while the row still holds what we wrote
    redoExpect[f] = row[f];    // redo runs only while the row still holds what undo restored
  }

  const base = { surface: String(surface || EXTRACTION_SURFACE.ENGINE), studyId: String(row.id) };
  return {
    kind: EXTRACTION_HISTORY_KIND,
    label: EXTRACTION_ENTRY_LABEL,
    entityKey: entityKeyFor(row.id, primary),
    ...(at === undefined ? {} : { at }),
    meta: {
      studyId: String(row.id),
      field: primary[0],
      fields: primary,
      fieldLabel: fieldLabel || primary[0],
      surface: base.surface,
      discrete: !!discrete,
    },
    undoOp: { ...base, fields: prevFields, provenance: provPrev, expect: undoExpect },
    redoOp: { ...base, fields: next, provenance: provNext, expect: redoExpect },
  };
}

/**
 * canMergeExtractionEdit(top, next, opts) → boolean — the `canMerge` matcher for
 * historyStacks.coalesceOrRecord (108.md §13).
 *
 * Typing 42 characters into "Denominator description" must cost ONE Ctrl+Z, so a new
 * keystroke merges into the scope's top entry when all of these hold:
 *   • both are extraction entries in the same scope and surface;
 *   • same (study, field) — a different field or row breaks the chain naturally,
 *     because the top of the stack no longer matches;
 *   • neither is `discrete` (a select / click-to-pick / converter apply is its own
 *     entry, always);
 *   • exactly one field is involved (the combined denominator patch never merges);
 *   • the chain is UNBROKEN: this edit's prev is the previous edit's next. Anything
 *     that wrote the field in between (a collaborator's reload, a click-to-pick)
 *     leaves a gap and starts a new entry;
 *   • the values look like typing (prefix relationship — see isTypingContinuation);
 *   • the keystrokes are within the idle window.
 *
 * coalesceOrRecord keeps the TOP entry's undoOp (the first prev — where Ctrl+Z must
 * land) and the NEW entry's redoOp (the last next), which is exactly the semantics
 * this predicate is designed for. The PRECONDITIONS inside those ops point the other
 * way and are crossed over by `mergeExtractionOps` below, which every coalescing call
 * site must pass as coalesceOrRecord's `mergeOps` argument.
 */
export function canMergeExtractionEdit(top, next, opts = {}) {
  if (!isObj(top) || !isObj(next)) return false;
  if (top.kind !== EXTRACTION_HISTORY_KIND || next.kind !== EXTRACTION_HISTORY_KIND) return false;
  if (String(top.scope || '') !== String(next.scope || '')) return false;
  if (!top.entityKey || top.entityKey !== next.entityKey) return false;

  const tm = isObj(top.meta) ? top.meta : {};
  const nm = isObj(next.meta) ? next.meta : {};
  if (tm.discrete || nm.discrete) return false;
  if (String(tm.surface || '') !== String(nm.surface || '')) return false;

  const fields = Array.isArray(nm.fields) ? nm.fields : [];
  if (fields.length !== 1) return false;
  const f = fields[0];

  const topNext = isObj(top.redoOp) && isObj(top.redoOp.fields) ? top.redoOp.fields[f] : undefined;
  const nextPrev = isObj(next.undoOp) && isObj(next.undoOp.fields) ? next.undoOp.fields[f] : undefined;
  const nextNext = isObj(next.redoOp) && isObj(next.redoOp.fields) ? next.redoOp.fields[f] : undefined;
  if (!sameFieldValue(topNext, nextPrev)) return false;
  if (!isTypingContinuation(topNext, nextNext)) return false;

  const win = Number.isFinite(opts && opts.windowMs) ? opts.windowMs : EXTRACTION_COALESCE_WINDOW_MS;
  const ta = Number(top.at);
  const na = Number(next.at);
  if (Number.isFinite(ta) && Number.isFinite(na) && na - ta > win) return false;
  return true;
}

/**
 * mergeExtractionOps(top, next) → { undoOp, redoOp } — the `mergeOps` hook for
 * historyStacks.coalesceOrRecord (108 review, [critical] "a coalesced typed edit can
 * never be undone").
 *
 * coalesceOrRecord's DEFAULT merge keeps the top entry's whole `undoOp` and the new
 * entry's whole `redoOp`. That is right for the PAYLOADS — undo must land on the FIRST
 * prev, redo on the LAST next — and wrong for the PRECONDITIONS that ride inside the
 * same ops, because they point the other way:
 *
 *   undoOp.expect = "the row still holds what we wrote"  → the LAST keystroke's value
 *   redoOp.expect = "the row still holds what undo restored" → the FIRST keystroke's prev
 *
 * Keeping the defaults there pins `undoOp.expect` to the value after the FIRST
 * keystroke, so `matchesExpected` (which both executors gate on) is false for every
 * multi-keystroke edit and the entry can never run. The two halves are therefore
 * CROSSED here: each op keeps its own payload and adopts the other end's expectation.
 *
 * Defensive by contract: an unusable half is returned as `undefined`, which makes
 * coalesceOrRecord fall back to its default for that half rather than lose the entry.
 */
export function mergeExtractionOps(top, next) {
  const t = isObj(top) ? top : {};
  const n = isObj(next) ? next : {};
  const topUndo = isObj(t.undoOp) ? t.undoOp : null;
  const topRedo = isObj(t.redoOp) ? t.redoOp : null;
  const nextUndo = isObj(n.undoOp) ? n.undoOp : null;
  const nextRedo = isObj(n.redoOp) ? n.redoOp : null;
  // `expect` is only carried when the other end actually has one — a missing
  // expectation must not silently DISABLE the precondition (matchesExpected treats an
  // absent expect as "always applicable").
  const withExpect = (op, from) => (op && from && isObj(from.expect) ? { ...op, expect: from.expect } : (op || undefined));
  return {
    undoOp: withExpect(topUndo, nextUndo),    // oldest payload, newest precondition
    redoOp: withExpect(nextRedo, topRedo),    // newest payload, oldest precondition
  };
}

/**
 * The refusal an executor reports when the target article has been completed or
 * locked. 108 review, [major] "extraction undo writes to completed/locked articles":
 * every forward write in ArticleWorkspace is gated on `editable = !readOnly &&
 * !completed`, so the inverse must be gated the same way or an undo silently edits an
 * article the UI has closed for editing (and the server's completion validation has
 * already signed off on).
 */
export const EXTRACTION_LOCKED_REFUSAL = 'This article is completed/locked — reopen it to undo.';

/**
 * isExtractionRowLocked(study) → boolean
 *
 * The completed-or-locked half of `articleStatusOf` (extraction/engine/articleStatus.js
 * — `meta.locked` → 'locked', `meta.completedAt` → 'complete', both ahead of every
 * value-derived status), restated here as a dependency-free predicate so the classic
 * surface can share it without pulling the validator in. The equivalence with
 * `articleStatusOf` is pinned by a test, so the two cannot drift.
 */
export function isExtractionRowLocked(study) {
  const meta = isObj(study) && isObj(study.extractionMeta) ? study.extractionMeta : null;
  if (!meta) return false;
  return !!meta.locked || !!meta.completedAt;
}

/**
 * splitProvenanceEntries(byField) → { attach, remove }
 * `null` means "this field had no provenance before — delete the entry"; everything
 * else is an entry to write. `undefined` is skipped (nothing was recorded for it).
 */
export function splitProvenanceEntries(byField) {
  const attach = {};
  const remove = [];
  if (!isObj(byField)) return { attach, remove };
  for (const [f, entry] of Object.entries(byField)) {
    if (!f) continue;
    if (entry === null) { remove.push(f); continue; }
    if (entry === undefined) continue;
    attach[f] = entry;
  }
  return { attach, remove };
}

/**
 * removeProvenanceFields(study, fields) → study
 * The missing half of articleProvenance's attach* helpers. Pure and byte-stable: the
 * SAME object comes back when none of the fields carried provenance, and an emptied
 * map is dropped entirely rather than left as `provenance: {}`.
 */
export function removeProvenanceFields(study, fields) {
  const list = Array.isArray(fields) ? fields.filter(Boolean) : [];
  if (!isObj(study) || !list.length) return study;
  const meta = study.extractionMeta;
  const map = isObj(meta) ? meta.provenance : null;
  if (!isObj(map)) return study;
  const present = list.filter((f) => Object.prototype.hasOwnProperty.call(map, f));
  if (!present.length) return study;
  const nextMap = { ...map };
  for (const f of present) delete nextMap[f];
  if (Object.keys(nextMap).length) {
    return { ...study, extractionMeta: { ...meta, provenance: nextMap } };
  }
  const nextMeta = { ...meta };
  delete nextMeta.provenance;
  return { ...study, extractionMeta: nextMeta };
}

/**
 * applyExtractionWrite(studies, id, patch, provenanceByField, { at }) → studies
 *
 * THE engine write. Values + provenance land in ONE functional update (83.md §5), so
 * an autosave flush can never persist a value without the provenance that justifies
 * it, and article-level keys still fan out to sibling cases (106.md) exactly as they
 * do for a forward edit — an undo must use the same write path as the action it
 * reverses (108.md §8).
 *
 * `provenanceByField` accepts `null` per field to REMOVE that field's provenance,
 * which is what makes a faithful inverse of a first click-to-pick possible.
 */
export function applyExtractionWrite(studies, id, patch, provenanceByField, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const at = opts && opts.at ? { at: opts.at } : {};
  const spread = propagateArticleFields(list, id, patch || {}, at).studies;
  const { attach, remove } = splitProvenanceEntries(provenanceByField);
  if (!Object.keys(attach).length && !remove.length) return spread;
  return spread.map((s) => {
    if (!s || s.id !== id) return s;
    const attached = Object.keys(attach).length ? attachProvenanceMany(s, attach) : s;
    return remove.length ? removeProvenanceFields(attached, remove) : attached;
  });
}

/**
 * applyRowPatch(studies, id, patch, { at }) → studies
 * The CLASSIC tab's write: a flat field patch with an `updatedAt` stamp, no
 * provenance and no case fan-out (that surface never wrote either). Extracted here so
 * the classic undo executor and the classic forward write are provably one path.
 */
export function applyRowPatch(studies, id, patch, opts = {}) {
  const list = Array.isArray(studies) ? studies : [];
  const at = opts && opts.at ? opts.at : null;
  return list.map((s) => (s && s.id === id
    ? { ...s, ...(isObj(patch) ? patch : {}), ...(at ? { updatedAt: at } : {}) }
    : s));
}

/**
 * findStudyRow(studies, id) — the freshest row an executor should validate against.
 * 108.md §15: never validate from the closure the entry was recorded in.
 */
export function findStudyRow(studies, id) {
  const list = Array.isArray(studies) ? studies : [];
  return list.find((s) => s && s.id === id) || null;
}
