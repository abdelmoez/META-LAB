/**
 * undoStack.js — 85.md A1. A pure LIFO stack (cap 20) of INVERSE PATCHES over the
 * Search Builder's { concepts, ignored } state, so destructive actions (remove a
 * term/concept, disable, bulk-accept suggestions) are recoverable.
 *
 * WHY INVERSE PATCHES AND NOT SNAPSHOTS: removing a pico_auto term ALSO appends an
 * `ignored` entry (so the PICO re-sync won't resurrect it). An undo that restored
 * only the term would leave contradictory state — the next re-sync would see the
 * text in `ignored` and silently drop the "restored" term again. Every entry
 * therefore records the ignored entries its action added, and undoLast removes
 * them together with restoring the content (critique #7).
 *
 * COLLABORATION RULE: the stack is only valid against the document it was recorded
 * on. The UI MUST call clear() whenever a remote document is adopted (applyRemote)
 * or a version is restored — undoing across someone else's update would resurrect
 * stale state and clobber their work via the last-write-wins PUT.
 *
 * All functions are pure: they return new stacks/state and never mutate inputs.
 * Ids stay untouched (undo re-inserts the ORIGINAL term/concept objects).
 */
import { norm } from './conceptExtraction.js';
import { setTermDisabled } from './searchState.js';

export const UNDO_STACK_CAP = 20;

const asStack = (stack) => (Array.isArray(stack) ? stack : []);
const asList = (v) => (Array.isArray(v) ? v : []);

/** Push an entry, trimming the OLDEST entries beyond the cap. */
function pushEntry(stack, entry) {
  const next = [...asStack(stack), entry];
  return next.length > UNDO_STACK_CAP ? next.slice(next.length - UNDO_STACK_CAP) : next;
}

/** Normalized texts of the ignored entries an action added (accepts one entry,
 *  an array of entries, plain strings, or nothing). */
function ignoredTextsOf(addedLike) {
  const arr = Array.isArray(addedLike) ? addedLike : (addedLike ? [addedLike] : []);
  return arr
    .map((e) => (typeof e === 'string' ? e : (e && typeof e === 'object' ? e.text : '')))
    .map((t) => String(t || '').trim())
    .filter(Boolean);
}

/**
 * recordRemoveTerm(stack, { concept, term, index?, ignoredEntryAdded? }) → stack
 * Call BEFORE (or with the pre-removal concept of) removing `term` from `concept`.
 * `index` = the term's position (derived from concept.terms when omitted);
 * `ignoredEntryAdded` = the `ignored` entry the removal appended (pico_auto terms
 * only; omit/null when the entry already existed or the term was user-added).
 */
export function recordRemoveTerm(stack, { concept, term, index, ignoredEntryAdded } = {}) {
  if (!concept || !term) return asStack(stack);
  const terms = asList(concept.terms);
  const at = Number.isInteger(index) ? index : terms.findIndex((t) => t && term && t.id === term.id);
  return pushEntry(stack, {
    kind: 'removeTerm',
    conceptId: concept.id,
    term,
    index: at >= 0 ? at : terms.length,
    ignoredTexts: ignoredTextsOf(ignoredEntryAdded),
  });
}

/**
 * recordRemoveConcept(stack, { concept, index, ignoredEntriesAdded? }) → stack
 * `index` = the concept's position in the concepts array (it is restored there);
 * `ignoredEntriesAdded` = the ignored entries the removal appended for its
 * pico_auto terms (only the ones actually ADDED, not pre-existing ones).
 */
export function recordRemoveConcept(stack, { concept, index, ignoredEntriesAdded } = {}) {
  if (!concept) return asStack(stack);
  return pushEntry(stack, {
    kind: 'removeConcept',
    concept,
    index: Number.isInteger(index) && index >= 0 ? index : 0,
    ignoredTexts: ignoredTextsOf(ignoredEntriesAdded),
  });
}

/** recordDisable(stack, { concept, term }) → stack. Undo re-ENABLES the term
 *  (deletes the `disabled` key via setTermDisabled — never writes disabled:false). */
export function recordDisable(stack, { concept, term } = {}) {
  if (!concept || !term) return asStack(stack);
  return pushEntry(stack, {
    kind: 'disable',
    conceptId: concept.id,
    termId: term.id,
    text: String(term.text || ''),
  });
}

/**
 * recordBulkAccept(stack, { concept, termIds, label? }) → stack
 * After a bulk "accept suggestions" added terms to `concept`, record the ids of
 * the terms it CREATED. Undo removes exactly those terms (by id).
 */
export function recordBulkAccept(stack, { concept, termIds, label } = {}) {
  const ids = asList(termIds).filter(Boolean);
  if (!concept || !ids.length) return asStack(stack);
  return pushEntry(stack, {
    kind: 'bulkAccept',
    conceptId: concept.id,
    termIds: ids,
    label: String(label || ''),
  });
}

/** Remove every ignored entry whose normalized text is in `texts`. */
function dropIgnored(ignored, texts) {
  if (!texts.length) return asList(ignored);
  const drop = new Set(texts.map(norm));
  return asList(ignored).filter((e) => !drop.has(norm(e && typeof e === 'object' ? e.text : e)));
}

/**
 * undoLast(stack, state) → { stack, state, description } | null
 * Pops the most recent entry and applies its inverse to state = { concepts,
 * ignored }. Returns null when the stack is empty. Guarantees:
 *  - restoring a term/concept ALSO removes the ignored entries its removal added
 *    (no contradictory state — see file header);
 *  - a removed concept returns to its ORIGINAL index (clamped);
 *  - undo after the same text was re-added manually inserts NO duplicate (the
 *    ignored cleanup still runs);
 *  - a vanished target (concept deleted by a collaborator mid-flight) degrades to
 *    a no-op on that part rather than throwing.
 */
export function undoLast(stack, state) {
  const st = asStack(stack);
  if (!st.length) return null;
  const entry = st[st.length - 1];
  const rest = st.slice(0, -1);
  const concepts = asList(state && state.concepts);
  const ignored = asList(state && state.ignored);

  if (entry.kind === 'removeTerm') {
    const next = concepts.map((c) => {
      if (!c || c.id !== entry.conceptId) return c;
      const terms = asList(c.terms);
      const n = norm(entry.term && entry.term.text);
      if (n && terms.some((t) => norm(t && t.text) === n)) return c; // re-added manually → no duplicate
      const at = Math.min(Math.max(entry.index, 0), terms.length);
      return { ...c, terms: [...terms.slice(0, at), entry.term, ...terms.slice(at)] };
    });
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored: dropIgnored(ignored, entry.ignoredTexts) },
      description: `Restored "${String(entry.term && entry.term.text || '')}"`,
    };
  }

  if (entry.kind === 'removeConcept') {
    let next = concepts;
    if (!concepts.some((c) => c && entry.concept && c.id === entry.concept.id)) {
      const at = Math.min(Math.max(entry.index, 0), concepts.length);
      next = [...concepts.slice(0, at), entry.concept, ...concepts.slice(at)];
    }
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored: dropIgnored(ignored, entry.ignoredTexts) },
      description: `Restored concept "${String(entry.concept && entry.concept.label || '')}"`,
    };
  }

  if (entry.kind === 'disable') {
    return {
      stack: rest,
      state: { ...state, concepts: setTermDisabled(concepts, entry.conceptId, entry.termId, false), ignored },
      description: `Re-enabled "${entry.text}"`,
    };
  }

  if (entry.kind === 'bulkAccept') {
    const drop = new Set(entry.termIds);
    const next = concepts.map((c) => (c && c.id === entry.conceptId
      ? { ...c, terms: asList(c.terms).filter((t) => !(t && drop.has(t.id))) }
      : c));
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored },
      description: `Removed ${entry.termIds.length} accepted term${entry.termIds.length === 1 ? '' : 's'}`,
    };
  }

  // Unknown entry kind (forward compat): drop it without touching state.
  return { stack: rest, state, description: '' };
}

/** Empty the stack. The UI MUST call this on applyRemote / version restore. */
export function clear(_stack) {
  return [];
}
