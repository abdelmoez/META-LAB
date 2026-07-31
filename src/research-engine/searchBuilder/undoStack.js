/**
 * undoStack.js — 85.md A1 (+ 96.md D13). A pure LIFO stack (cap 20) of INVERSE
 * PATCHES over the Search Builder's { concepts, ignored } state, so destructive
 * actions (remove a term/concept, disable, bulk-accept suggestions, and the 96.md
 * group operations: reorder / merge / split) are recoverable.
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

/** recordDisable(stack, { concept, term }) → stack. Undo re-ENABLES the term by
 *  DELETING the `disabled` key — the EXACT inverse patch, byte-identical to the
 *  pre-disable state. Unlike setTermDisabled's enable path it does NOT stamp the
 *  `kept` sync marker: undo reverts the action (no signature drift), while the
 *  deliberate Enable toggle must survive future PICO syncs. */
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
 * 96.md D13 — recordReorderConcept(stack, { conceptId, fromIndex, toIndex, label? })
 * After a group was moved (searchState.reorderConcept), record the move. Undo puts
 * the concept back at `fromIndex` (clamped; a vanished concept degrades to no-op).
 */
export function recordReorderConcept(stack, { conceptId, fromIndex, toIndex, label } = {}) {
  if (!conceptId || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) {
    return asStack(stack);
  }
  return pushEntry(stack, {
    kind: 'reorderConcept',
    conceptId,
    fromIndex,
    toIndex,
    label: String(label || ''),
  });
}

/**
 * 96.md §3B (QA M3) — recordReorderTerm(stack, { conceptId, termId, fromIndex,
 * toIndex, text? }). After a term was moved within its group
 * (searchState.reorderTerm), record the move. Undo puts the term back at
 * `fromIndex` (clamped; a vanished concept/term degrades to a no-op) — the exact
 * inverse of the move, so undo restores a byte-identical term order.
 */
export function recordReorderTerm(stack, { conceptId, termId, fromIndex, toIndex, text } = {}) {
  if (!conceptId || !termId || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) {
    return asStack(stack);
  }
  return pushEntry(stack, {
    kind: 'reorderTerm',
    conceptId,
    termId,
    fromIndex,
    toIndex,
    text: String(text || ''),
  });
}

/**
 * 96.md D13 — recordMergeConcepts(stack, undoInfo) where undoInfo comes straight
 * from searchState.mergeConcepts: { fromConcept, fromIndex, intoId, movedTermIds }.
 * Undo removes exactly the moved terms (by id) from the target group and re-inserts
 * the ORIGINAL source concept object at its original index.
 */
export function recordMergeConcepts(stack, { fromConcept, fromIndex, intoId, movedTermIds } = {}) {
  if (!fromConcept || !intoId) return asStack(stack);
  return pushEntry(stack, {
    kind: 'mergeConcepts',
    fromConcept,
    fromIndex: Number.isInteger(fromIndex) && fromIndex >= 0 ? fromIndex : 0,
    intoId,
    movedTermIds: asList(movedTermIds).filter(Boolean),
  });
}

/**
 * 96.md D13 — recordSplitConcept(stack, { fromConceptId, newConceptId, termIds,
 * label? }). After searchState.splitConcept moved `termIds` into the new group
 * (whose id the caller just assigned), record the split. Undo moves those terms
 * back into the source group (appended; a term re-added manually is not duplicated)
 * and removes the new group when nothing else was added to it meanwhile.
 */
export function recordSplitConcept(stack, { fromConceptId, newConceptId, termIds, label } = {}) {
  const ids = asList(termIds).filter(Boolean);
  if (!fromConceptId || !newConceptId || !ids.length) return asStack(stack);
  return pushEntry(stack, {
    kind: 'splitConcept',
    fromConceptId,
    newConceptId,
    termIds: ids,
    label: String(label || ''),
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
    // Exact inverse of "add disabled:true": delete the key, nothing else (see
    // recordDisable — no `kept` stamp here, or disable→undo would drift the
    // persisted signature).
    const next = concepts.map((c) => {
      if (!c || c.id !== entry.conceptId) return c;
      return {
        ...c,
        terms: asList(c.terms).map((t) => {
          if (!t || t.id !== entry.termId || !('disabled' in t)) return t;
          const { disabled: _off, ...restT } = t;
          return restT;
        }),
      };
    });
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored },
      description: `Re-enabled "${entry.text}"`,
    };
  }

  if (entry.kind === 'reorderConcept') {
    // Inverse of a move: pull the concept from wherever it now sits and re-insert
    // it at the ORIGINAL index (clamped). A concept deleted meanwhile degrades to
    // a no-op rather than throwing.
    const cur = concepts.findIndex((c) => c && c.id === entry.conceptId);
    if (cur === -1) return { stack: rest, state, description: '' };
    const next = concepts.slice();
    const [moved] = next.splice(cur, 1);
    const at = Math.min(Math.max(entry.fromIndex, 0), next.length);
    next.splice(at, 0, moved);
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored },
      description: `Moved "${entry.label || String(moved && moved.label || '')}" back`,
    };
  }

  if (entry.kind === 'reorderTerm') {
    // Inverse of a within-group term move: pull the term from wherever it now sits
    // in that concept and re-insert it at the ORIGINAL index (clamped). A concept
    // or term deleted meanwhile degrades to a no-op rather than throwing.
    const next = concepts.map((c) => {
      if (!c || c.id !== entry.conceptId) return c;
      const terms = asList(c.terms);
      const cur = terms.findIndex((t) => t && t.id === entry.termId);
      if (cur === -1) return c;
      const rearranged = terms.slice();
      const [moved] = rearranged.splice(cur, 1);
      const at = Math.min(Math.max(entry.fromIndex, 0), rearranged.length);
      rearranged.splice(at, 0, moved);
      return { ...c, terms: rearranged };
    });
    const touched = next.some((c, i) => c !== concepts[i]);
    return {
      stack: rest,
      state: touched ? { ...state, concepts: next, ignored } : state,
      description: touched ? `Moved "${entry.text}" back` : '',
    };
  }

  if (entry.kind === 'mergeConcepts') {
    // Inverse of a merge: strip exactly the moved terms (by id) from the target,
    // then re-insert the ORIGINAL source concept at its original index (skipped
    // when a concept with that id somehow already exists — no duplicates).
    const drop = new Set(entry.movedTermIds || []);
    let next = concepts.map((c) => (c && c.id === entry.intoId
      ? { ...c, terms: asList(c.terms).filter((t) => !(t && drop.has(t.id))) }
      : c));
    if (!next.some((c) => c && entry.fromConcept && c.id === entry.fromConcept.id)) {
      const at = Math.min(Math.max(entry.fromIndex, 0), next.length);
      next = [...next.slice(0, at), entry.fromConcept, ...next.slice(at)];
    }
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored },
      description: `Restored concept "${String(entry.fromConcept && entry.fromConcept.label || '')}"`,
    };
  }

  if (entry.kind === 'splitConcept') {
    // Inverse of a split: move the split-off terms back into the source group
    // (appended; texts already present are not duplicated), then remove the new
    // group when it holds nothing else — terms a collaborator/user added to the
    // new group after the split are preserved (the group stays with them).
    const wanted = new Set(entry.termIds || []);
    const fresh = concepts.find((c) => c && c.id === entry.newConceptId);
    const src = concepts.find((c) => c && c.id === entry.fromConceptId);
    if (!fresh || !src) return { stack: rest, state, description: '' };
    const back = asList(fresh.terms).filter((t) => t && wanted.has(t.id));
    const remain = asList(fresh.terms).filter((t) => !(t && wanted.has(t.id)));
    const have = new Set(asList(src.terms).map((t) => norm(t && t.text)).filter(Boolean));
    const appended = back.filter((t) => !have.has(norm(t && t.text)));
    let next = concepts.map((c) => {
      if (!c) return c;
      if (c.id === entry.fromConceptId) return { ...c, terms: [...asList(c.terms), ...appended] };
      if (c.id === entry.newConceptId) return { ...c, terms: remain };
      return c;
    });
    if (!remain.length) next = next.filter((c) => !(c && c.id === entry.newConceptId));
    return {
      stack: rest,
      state: { ...state, concepts: next, ignored },
      description: `Undid split "${entry.label || String(fresh.label || '')}"`,
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
