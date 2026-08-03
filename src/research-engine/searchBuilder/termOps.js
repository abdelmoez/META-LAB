/**
 * termOps.js — 97.md Phases 6/9/11/12 (plan §12). Pure term-level operations for
 * the Boolean workspace: cross-group MOVE, explicit COPY, token/term COMBINE into a
 * phrase, and phrase SPLIT. Extracted out of the React component (house style) so
 * the interaction core is unit-testable and the UI stays a thin consumer.
 *
 * THE moveTerm BUG THIS MODULE FIXES (plan §5/§12): the old SearchBuilderTab
 * moveTerm (a) recorded no undo entry, (b) rewrote `source:'user_added'` (a
 * vestigial anti-resync guard — no resync exists post-96), and (c) on a duplicate
 * collision at the target it removed the term from the source WITHOUT adding it to
 * the target — silent term loss. moveTermToConcept blocks the duplicate case
 * instead ({ blocked:'duplicate' } → "This exact term is already in this group —
 * Find existing term"), moves the ORIGINAL term object (id, type, vocab, source,
 * components, dupOverride all survive by reference), and returns the exact undo
 * info recordMoveTerm needs.
 *
 * SIGNATURES are the plan §12 positional forms the UI codes against
 * (SearchBuilderTab.jsx header):
 *   moveTermToConcept(concepts, termId, fromId, toId, index?)
 *   copyTerm(concepts, termId, fromId, toId)
 *   combineTokens(concepts, conceptId, termIds)
 *   splitPhrase(concepts, conceptId, termId, parts?)
 *
 * ID ASSIGNMENT (documented deviation from the searchState "caller assigns ids"
 * contract): copy/combine/split CREATE terms, and their consumers need the new
 * ids in the same tick (undo entries, focus). These functions therefore stamp
 * DETERMINISTIC collision-free ids (`t97-<n>`, scanned against every term id in
 * the document) — still pure: same input ⇒ same output, no randomness.
 */
import { norm } from './conceptExtraction.js';
import { splitConcept } from './searchState.js';
import { exactDuplicateKey, findExactDuplicateInConcept } from './exactDuplicate.js';

const asList = (v) => (Array.isArray(v) ? v : []);

/** Deterministic fresh term ids: t97-1, t97-2, … skipping every id already used
 *  anywhere in the document. Pure (no randomness). */
function freshTermIds(concepts, count) {
  const taken = new Set();
  for (const c of asList(concepts)) {
    for (const t of asList(c && c.terms)) if (t && t.id != null) taken.add(String(t.id));
  }
  const out = [];
  let n = 1;
  while (out.length < count) {
    const id = `t97-${n}`;
    n += 1;
    if (!taken.has(id)) { taken.add(id); out.push(id); }
  }
  return out;
}

/**
 * Move one term between concept groups, preserving EVERYTHING about it.
 * @returns
 *   null                                          — unknown ids / same group;
 *   { blocked:'duplicate', existingTermId,
 *     existingConceptId, text }                   — target already holds this exact
 *                                                   term (97: prevented, never a
 *                                                   silent deletion);
 *   { concepts, term, fromIndex, toIndex, undo }  — success. `term` is the SAME
 *                                                   object that moved; `undo` is
 *                                                   ready for recordMoveTerm.
 * `index` = target position (clamped; omitted → append). Pure.
 */
export function moveTermToConcept(concepts, termId, fromId, toId, index) {
  const list = asList(concepts);
  if (!termId || !fromId || !toId || fromId === toId) return null;
  const from = list.find((c) => c && c.id === fromId);
  const to = list.find((c) => c && c.id === toId);
  if (!from || !to) return null;
  const fromIndex = asList(from.terms).findIndex((t) => t && t.id === termId);
  if (fromIndex === -1) return null;
  const term = from.terms[fromIndex];

  // QA M18 — the collision check is type-aware (the moving term is the candidate):
  // a free-text term moves happily into a group holding the same-label MeSH term.
  const existing = findExactDuplicateInConcept(to, term.text, termId, term);
  if (existing) {
    return { blocked: 'duplicate', existingTermId: existing.id, existingConceptId: to.id, text: String(term.text || '') };
  }

  const targetTerms = asList(to.terms);
  const at = Number.isInteger(index) ? Math.min(Math.max(index, 0), targetTerms.length) : targetTerms.length;
  const next = list.map((c) => {
    if (!c) return c;
    if (c.id === fromId) return { ...c, terms: asList(c.terms).filter((t) => !(t && t.id === termId)) };
    if (c.id === toId) return { ...c, terms: [...targetTerms.slice(0, at), term, ...targetTerms.slice(at)] };
    return c;
  });
  return {
    concepts: next,
    term,
    fromIndex,
    toIndex: at,
    undo: { fromConceptId: fromId, toConceptId: toId, termId, fromIndex, toIndex: at, text: String(term.text || '') },
  };
}

/**
 * Move one term into a brand-NEW group (97 Phase 10 "move terms into a newly
 * created group"). Reuses searchState.splitConcept — the new id-less group is
 * inserted right after the source with the term inside it; label falls back to the
 * term's own text. Returns { concepts, newIndex, termId, fromConceptId } (the
 * caller stamps the new group's id, then records recordSplitConcept — the split
 * inverse IS the move-to-new-group inverse) or null. Pure.
 */
export function moveTermToNewConcept(concepts, { termId, fromId, label } = {}) {
  const list = asList(concepts);
  const from = list.find((c) => c && c.id === fromId);
  const term = from && asList(from.terms).find((t) => t && t.id === termId);
  if (!term) return null;
  const out = splitConcept(list, fromId, [termId], String(label || term.text || '').trim());
  if (!out) return null;
  return { concepts: out.concepts, newIndex: out.newIndex, termId, fromConceptId: fromId };
}

/**
 * EXPLICIT duplicate-term copy (97 Phase 9/11 — default dragging MOVES; cloning
 * only through this deliberate action). The copy is a NEW term (deterministic
 * fresh id, `source:'copied'`); type/field/vocab/components survive, `dupOverride`
 * does NOT (a copy creates a new duplicate configuration that must warn afresh).
 * @returns null | { blocked:'duplicate', existingTermId, existingConceptId, text }
 *   | { concepts, newTermId, copiedIndex, toConceptId } — feed newTermId to
 *   recordCopyTerm (or recordBulkAccept). Pure.
 */
export function copyTerm(concepts, termId, fromId, toId) {
  const list = asList(concepts);
  if (!termId || !fromId || !toId || fromId === toId) return null;
  const from = list.find((c) => c && c.id === fromId);
  const to = list.find((c) => c && c.id === toId);
  if (!from || !to) return null;
  const term = asList(from.terms).find((t) => t && t.id === termId);
  if (!term) return null;

  const existing = findExactDuplicateInConcept(to, term.text, undefined, term); // type-aware (QA M18)
  if (existing) {
    return { blocked: 'duplicate', existingTermId: existing.id, existingConceptId: to.id, text: String(term.text || '') };
  }

  const { id: _id, dupOverride: _o, ...rest } = term;
  const [newTermId] = freshTermIds(list, 1);
  const copy = { ...rest, id: newTermId, source: 'copied' };
  const next = list.map((c) => (c && c.id === toId ? { ...c, terms: [...asList(c.terms), copy] } : c));
  return { concepts: next, newTermId, copiedIndex: asList(to.terms).length, toConceptId: toId };
}

/**
 * Combine token/term texts into ONE phrase (97 Phase 6 rules): semantic order
 * preserved (caller passes parts in order), each part whitespace-normalized,
 * hyphens/punctuation untouched, and `components` recorded so the phrase can be
 * split later ("sodium-glucose" + "cotransporter" + "2" →
 * "sodium-glucose cotransporter 2"). Returns { text, components:[{text},…] } or
 * null when fewer than 2 usable parts. Pure.
 */
export function combinePhrase(parts) {
  const texts = asList(parts)
    .map((p) => String((p && typeof p === 'object' ? p.text : p) || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (texts.length < 2) return null;
  return { text: texts.join(' '), components: texts.map((text) => ({ text })) };
}

/**
 * Combine 2+ terms of ONE group into a single phrase term. The new term
 * (deterministic fresh id, freetext/tiab, `source:'user_added'`, `phrase:true`,
 * `components` = the source texts) replaces the sources at the FIRST source's
 * position. Controlled-vocabulary identity does NOT survive a combine — the
 * result is deliberately a free-text term (97 Phase 6 "clearly convert"); the
 * undo entry restores the original term objects (vocab intact).
 * @returns null | { concepts, term, insertIndex,
 *                   undo:{ conceptId, newTermId, removed:[{term,index}],
 *                          insertIndex, text } }
 * `undo` feeds recordCombineTokens directly. Order = current display order of the
 * selected terms (semantic order preserved). Pure.
 */
export function combineTokens(concepts, conceptId, termIds) {
  const list = asList(concepts);
  const ci = list.findIndex((c) => c && c.id === conceptId);
  if (ci === -1) return null;
  const wanted = new Set(asList(termIds).filter(Boolean));
  if (wanted.size < 2) return null;
  const terms = asList(list[ci].terms);
  const removed = [];
  terms.forEach((t, index) => { if (t && wanted.has(t.id)) removed.push({ term: t, index }); });
  if (removed.length < 2) return null;

  const combined = combinePhrase(removed.map((r) => r.term.text));
  if (!combined) return null;
  // 97 QA M19 — same-group duplicate PREVENTION on the combine entry path too:
  // when the combined phrase's exact key already lives on a SURVIVING term of the
  // group, block instead of committing a same-OR-group exact duplicate (mirrors
  // moveTermToConcept's { blocked } contract; the combined result is free-text).
  const survivors = { ...list[ci], terms: terms.filter((t) => !(t && wanted.has(t.id))) };
  const existing = findExactDuplicateInConcept(survivors, combined.text);
  if (existing) {
    return { blocked: 'duplicate', existingTermId: existing.id, existingConceptId: list[ci].id, text: combined.text };
  }
  const insertIndex = removed[0].index;
  const [newTermId] = freshTermIds(list, 1);
  const fresh = {
    id: newTermId,
    text: combined.text,
    normalizedLabel: norm(combined.text),
    type: 'freetext',
    field: 'tiab',
    source: 'user_added',
    phrase: true,
    components: combined.components,
  };
  const staying = terms.filter((t) => !(t && wanted.has(t.id)));
  const at = Math.min(insertIndex, staying.length);
  const nextTerms = [...staying.slice(0, at), fresh, ...staying.slice(at)];
  const next = list.map((c, i) => (i === ci ? { ...c, terms: nextTerms } : c));
  return {
    concepts: next,
    term: fresh,
    insertIndex: at,
    undo: { conceptId, newTermId, removed, insertIndex: at, text: combined.text },
  };
}

/**
 * The parts a phrase term would split into: its recorded `components` (≥2 usable
 * texts) or null — null tells the UI to open the SAFE manual-split dialog instead
 * of guessing destructively (97 Phase 6: edited phrases are never auto-split).
 * Pure.
 */
export function splitPartsOf(term) {
  const texts = asList(term && term.components)
    .map((c) => String((c && typeof c === 'object' ? c.text : c) || '').trim())
    .filter(Boolean);
  return texts.length >= 2 ? texts : null;
}

/**
 * 97 QA M14 — do the term's recorded `components` still describe its CURRENT
 * text? True only when the normalized text equals the normalized join of the
 * components. An EDITED combined phrase ("… 2" → "… 2 inhibitors") no longer
 * matches, so the recorded-components split must NOT be offered (it would
 * silently discard the edit) — the safe manual-split dialog applies instead.
 * Pure.
 */
export function componentsMatchText(term) {
  const parts = splitPartsOf(term);
  if (!parts) return false;
  return norm(parts.join(' ')) === norm(term && term.text);
}

/**
 * Split one phrase term back into component terms. `parts` (from the manual-split
 * dialog) overrides the term's recorded `components`; with neither ≥2 usable
 * texts → null. The new terms (deterministic fresh ids, freetext/tiab,
 * `source:'user_added'`, phrase:true when multi-word) replace the phrase at its
 * position, in order; a part whose text already lives in the group (same
 * normalized text) is skipped rather than duplicated.
 * @returns null | { concepts, terms, insertIndex,
 *                   undo:{ conceptId, term, index, newTermIds } }
 * `terms` = the created term objects; `undo` feeds recordSplitPhrase directly.
 * Pure.
 */
export function splitPhrase(concepts, conceptId, termId, parts) {
  const list = asList(concepts);
  const ci = list.findIndex((c) => c && c.id === conceptId);
  if (ci === -1) return null;
  const terms = asList(list[ci].terms);
  const index = terms.findIndex((t) => t && t.id === termId);
  if (index === -1) return null;
  const term = terms[index];

  const explicit = asList(parts).map((p) => String((p && typeof p === 'object' ? p.text : p) || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // QA M14 — recorded components apply ONLY while they still match the term's
  // current text; an edited phrase must go through an explicit `parts` list
  // (the manual-split dialog), never a stale-component guess that drops the edit.
  const texts = explicit.length >= 2 ? explicit : (componentsMatchText(term) ? splitPartsOf(term) : null);
  if (!texts) return null;

  const have = new Set(terms.filter((t) => t && t.id !== termId).map((t) => norm(t.text)).filter(Boolean));
  const keptTexts = [];
  for (const text of texts) {
    const n = norm(text);
    if (!n || have.has(n)) continue; // already in the group — never a redundant copy
    have.add(n);
    keptTexts.push(text);
  }
  if (!keptTexts.length) return null;

  const ids = freshTermIds(list, keptTexts.length);
  const created = keptTexts.map((text, i) => {
    const fresh = { id: ids[i], text, normalizedLabel: norm(text), type: 'freetext', field: 'tiab', source: 'user_added' };
    if (text.includes(' ')) fresh.phrase = true;
    return fresh;
  });

  const nextTerms = [...terms.slice(0, index), ...created, ...terms.slice(index + 1)];
  const next = list.map((c, i) => (i === ci ? { ...c, terms: nextTerms } : c));
  return {
    concepts: next,
    terms: created,
    insertIndex: index,
    undo: { conceptId, term, index, newTermIds: ids },
  };
}

/** Convenience re-export so UI code needing the strict key imports ONE module. */
export { exactDuplicateKey };
