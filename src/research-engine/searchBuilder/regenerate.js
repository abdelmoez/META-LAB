/**
 * regenerate.js — 97.md Phase 4 (plan §9, Decision R1). The EXPLICIT Regenerate
 * engine: rebuild neutral-label concept groups from the research-question text.
 *
 * Decision R1 (documented variation): 97's wording says "question and PICO", but
 * 96 removed the protocol PICO fields from the builder entirely and Phase 8
 * forbids resurrecting the P/I/C/O organization — so regeneration reads ONLY the
 * research-question text (which is where PICO thinking lives post-96), and the
 * groups it emits are labeled `Concept 1..N` (98.md §8), NEVER picoField-labeled.
 * `syncSearchBuilderFromPico` stays untouched (legacy tests only).
 *
 * The flow around this engine (client-side, plan §9): confirm dialog → snapshot
 * FIRST via POST /api/search-builder/:pid/versions ("Before regeneration"; abort
 * on failure) → replace concepts + stamp questionSnapshot + meta → immediate
 * saveNow carrying `auditAction:'regenerated'` (→ SEARCH_REGENERATED audit row) →
 * whole-state `regenerate` undo entry. This module supplies the pure state
 * transition; timestamps and user identity are INPUTS (module contract: no
 * Date.now, no randomness, no id assignment — the caller stamps ids).
 */
import { splitSegments, stripJunk, extractConcepts, norm } from './conceptExtraction.js';
import { buildGeneratedMeta } from './searchState.js';

/** `source` marker for regenerated groups/terms. Deliberately NOT 'pico_auto':
 *  the legacy exemptions (drift skip, empty-group QC skip, ignored bookkeeping)
 *  key off 'pico_auto' and must not apply to freshly regenerated groups. */
export const REGENERATED_SOURCE = 'generated';

/**
 * Rebuild id-less concept groups from the research question. Each connector-split
 * segment of the question becomes one OR group: label `Concept N`,
 * `sourcePhrase` = the cleaned segment (it appears verbatim in the question, so
 * drift detection anchors correctly), `source:'generated'`, terms = the extraction
 * engine's family ladder / synonyms / abbreviation expansion for that segment
 * (deduped across groups by primary term). NO picoField anywhere. Returns [] for a
 * blank question. Pure + deterministic.
 */
export function regenerateConceptsFromQuestion(question) {
  const out = [];
  const seenPrimary = new Set();
  for (const seg of splitSegments(question)) {
    const cleaned = stripJunk(seg);
    if (!cleaned) continue;
    for (const c of extractConcepts(cleaned, '')) {
      const primary = norm(c.terms[0] && c.terms[0].text);
      if (!primary || seenPrimary.has(primary)) continue;
      seenPrimary.add(primary);
      out.push({
        label: '', // numbered below once the final group count is known
        sourcePhrase: cleaned,
        source: REGENERATED_SOURCE,
        op: 'AND',
        terms: c.terms.map((t) => {
          const fresh = { text: t.text, normalizedLabel: norm(t.text), type: 'freetext', field: 'tiab', source: REGENERATED_SOURCE };
          if (t.synonym) fresh.synonym = true;
          return fresh;
        }),
      });
    }
  }
  return out.map((c, i) => ({ ...c, label: `Concept ${i + 1}` })); // 98.md §8 — the ONE user-facing noun
}

/**
 * The UI-facing wrapper (SearchBuilderTab codes against this exact name/shape):
 * regenerateFromQuestion(question) → { concepts } — neutral "Concept N"
 * labels, no picoField anywhere; the caller stamps ids and meta. Pure.
 */
export function regenerateFromQuestion(question) {
  return { concepts: regenerateConceptsFromQuestion(question) };
}

/**
 * The complete regenerated workspace slice in one call:
 *   { concepts, questionSnapshot, meta }
 * - concepts: regenerateConceptsFromQuestion(question) — id-less (caller assigns);
 * - questionSnapshot: the question trimmed + capped at 2000 (the seed/sanitizer
 *   normalization, so the drift banner arms against exactly what was built);
 * - meta: { generatedAt:at, generatedBy:{id,name}, sourceQuestion } via
 *   buildGeneratedMeta — manuallyModified* deliberately RESET (a fresh generation
 *   has no manual edits; "modified since generation" is derived from
 *   manuallyModifiedAt's presence, never stored).
 * `at` = caller-supplied ISO timestamp; `user` = { id, name }. Pure.
 */
export function buildRegenerateState({ question, user, at } = {}) {
  const questionSnapshot = String(question || '').slice(0, 2000).trim();
  return {
    concepts: regenerateConceptsFromQuestion(question),
    questionSnapshot,
    meta: buildGeneratedMeta({ user, at, sourceQuestion: questionSnapshot }),
  };
}

/** 97's exact confirmation copy (plan §9) — exported so the UI and its SSR
 *  contract tests share one source of truth. */
export const REGENERATE_CONFIRM_COPY = {
  title: 'Regenerate search strategy?',
  body: 'This will rebuild the automatically generated keywords and concept groups from the current research question. Your current manual organization may change.',
  cancel: 'Cancel',
  confirm: 'Regenerate',
};

/** Post-action snackbar copy (97 Phase 4: "Search strategy regenerated. Undo"). */
export const REGENERATE_DONE_MESSAGE = 'Search strategy regenerated.';

/** The auto-created pre-regeneration snapshot's name (rides the versions panel). */
export const PRE_REGENERATE_SNAPSHOT_NAME = 'Before regeneration';
