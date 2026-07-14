/**
 * suggestionReview.js — 85.md A1. Pure, network-free review model for the Search
 * Builder's vocabulary suggestions, plus the PERSISTED rejection memory that stops
 * a dismissed suggestion from reappearing on every visit.
 *
 * A "suggestion" is derived from the terms a concept already carries (no fabricated
 * vocabulary — the vocab records come from the NLM lookup that already ran):
 *   - kind 'mesh'     : a freetext term whose attached vocab record names a standard
 *                       subject heading the concept doesn't have yet (convertible to
 *                       a controlled term);
 *   - kind 'synonyms' : a controlled term whose vocab carries entry-term synonyms
 *                       not yet added to the concept.
 * One suggestion per source term; family variants of the same idea ("EUS" vs
 * "endoscopic ultrasound") collapse to ONE suggestion via termEquivalenceKey.
 *
 * REJECTION KEY (persisted in the module state's `rejectedSuggestions` string list,
 * omit-when-empty — see searchState.pickPersisted and the putSearch sanitizer):
 *   rej:<picoField-or-concept-id-or-normalized-label>:<termEquivalenceKey(sourceText)>
 * Keying on the SOURCE term's equivalence key (not the suggested heading) is what
 * keeps a whole family rejected: rejecting the heading offered for "EUS" also
 * covers the one offered for "endoscopic ultrasound".
 *
 * Deterministic + exported for unit tests. Nothing here calls the network.
 */
import { norm } from './conceptExtraction.js';
import { termEquivalenceKey } from './crossConcept.js';
import { liveTermsOf } from './termLiveness.js';

/** Persisted rejection key for a suggestion rooted at `termText` in `concept`.
 *  Scope = the concept's stable picoField when present (canonical groups), else the
 *  concept's persisted id: two MANUAL concepts can legitimately share a label
 *  (addConcept auto-names by count, renames are unvalidated), and a label scope
 *  would leak a rejection made in one into the other. Normalized label is only the
 *  last-resort fallback for id-less input. (Scope format changed from label→id
 *  pre-release, hours after the feature shipped — no persisted keys in the old
 *  manual-label format exist to migrate.) */
export function rejectionKey(concept, termText) {
  const scope = concept && concept.picoField
    ? String(concept.picoField).trim().toUpperCase()
    : ((concept && concept.id != null && String(concept.id).trim()) || norm(concept && concept.label));
  return `rej:${scope}:${termEquivalenceKey(termText)}`;
}

/** Coerce a rejected list/Set (or junk) into a Set of key strings. */
function toRejectedSet(rejected) {
  if (rejected instanceof Set) return rejected;
  if (Array.isArray(rejected)) return new Set(rejected.filter((s) => typeof s === 'string'));
  return new Set();
}

/** True when the concept already carries the heading as a live controlled term. */
function headingExists(concept, heading) {
  const h = norm(heading);
  if (!h) return true; // no usable heading → nothing to suggest
  return liveTermsOf(concept).some((t) => t.type === 'controlled'
    && (norm(t.text) === h || norm(t.vocab && t.vocab.mesh) === h));
}

/**
 * pendingSuggestions(concept, rejected) → ordered suggestion list:
 *   [{ key, text, kind:'mesh'|'synonyms', why, vocab?, sourceText, termId?, synonyms? }]
 *  - kind 'mesh'     → text = the suggested heading; vocab = the source record.
 *  - kind 'synonyms' → text = the source term; synonyms = the unadded entry terms.
 * Excludes rejected keys and suggestions whose target already exists (heading
 * already a controlled term / every entry term already present). One entry per
 * rejection key (family variants collapse). Pure.
 */
export function pendingSuggestions(concept, rejected) {
  const rej = toRejectedSet(rejected);
  const out = [];
  const seen = new Set(); // one suggestion per rejection key
  const allTexts = new Set(((concept && concept.terms) || [])
    .map((t) => norm(t && t.text)).filter(Boolean));

  for (const t of liveTermsOf(concept)) {
    if (!t.vocab || typeof t.vocab !== 'object') continue;
    const key = rejectionKey(concept, t.text);
    if (rej.has(key) || seen.has(key)) continue;

    if (t.type !== 'controlled') {
      // Convertible: a standard heading is known for this freetext term.
      const heading = String(t.vocab.mesh || '').trim();
      if (!heading || headingExists(concept, heading)) continue;
      seen.add(key);
      out.push({
        key, text: heading, kind: 'mesh',
        why: `Standard subject heading for "${t.text}"`,
        vocab: t.vocab, sourceText: t.text, termId: t.id,
      });
    } else {
      // Entry-term synonyms of a controlled term not yet added as freetext terms.
      const unadded = (Array.isArray(t.vocab.synonyms) ? t.vocab.synonyms : [])
        .filter((s) => typeof s === 'string' && s.trim() && !allTexts.has(norm(s)));
      if (!unadded.length) continue;
      seen.add(key);
      out.push({
        key, text: t.text, kind: 'synonyms',
        why: `Entry terms for "${t.text}"`,
        vocab: t.vocab, sourceText: t.text, termId: t.id, synonyms: unadded,
      });
    }
  }
  return out;
}

/**
 * suggestionCount(concepts, rejected) → { total, perConcept } where perConcept is
 * keyed by concept id (fallback `#<index>` for id-less concepts). Pure.
 */
export function suggestionCount(concepts, rejected) {
  const list = Array.isArray(concepts) ? concepts : [];
  const perConcept = {};
  let total = 0;
  list.forEach((c, i) => {
    const n = pendingSuggestions(c, rejected).length;
    perConcept[(c && c.id) || `#${i}`] = n;
    total += n;
  });
  return { total, perConcept };
}

/**
 * resetSuggestionMemory(state) — the "Restore all" contract: clearing suggestion
 * memory clears BOTH "user said no" lists together (hidden/deleted auto terms in
 * `ignored` AND rejected suggestions), so there is never a hidden, unrecoverable
 * rejection. Returns a new state object; other keys are untouched. Pure.
 */
export function resetSuggestionMemory(state) {
  return { ...(state && typeof state === 'object' ? state : {}), ignored: [], rejectedSuggestions: [] };
}
