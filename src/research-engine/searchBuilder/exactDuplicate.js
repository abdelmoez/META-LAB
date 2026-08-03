/**
 * exactDuplicate.js — 97.md Phase 12. The CONSERVATIVE exact-duplicate normalizer
 * and the chip-integrated duplicate engine, ADDED ALONGSIDE (never replacing) the
 * family-based `termEquivalenceKey` in crossConcept.js.
 *
 * WHY TWO KEYS (plan §13, invariant 7): persisted `rejectionKey` strings and
 * `dismissedWarnings` ids embed the family-based `termEquivalenceKey` — changing it
 * would orphan every historical dismissal. So the family key survives untouched and
 * is DEMOTED to the soft, non-blocking "Possible variant" signal, while this module
 * supplies the strict key that drives the dark-red "Exact duplicate across AND
 * groups" chip treatment.
 *
 * exactDuplicateKey normalizes ONLY:
 *   - leading/trailing whitespace,
 *   - repeated internal whitespace,
 *   - case,
 *   - SURROUNDING quotation marks (straight or curly, single or double) — never
 *     quotes inside the term,
 *   - trailing database field tags ("[tiab]", "[Mesh]", "[Mesh:NoExp]", …).
 * Everything else (hyphens, internal punctuation, extra words) keeps terms
 * DISTINCT: `EUS` ≡ `eus` ≡ `"EUS"` ≡ `“EUS”`, but `EUS` ≠ `endoscopic
 * ultrasound` ≠ `EUS-guided biliary drainage` and `tumour` ≠ `tumor` (97's
 * verbatim not-exact list).
 *
 * INTENTIONAL-DUPLICATE OVERRIDE (plan §13): "Keep both intentionally" persists as
 * a TERM-LEVEL `dupOverride: { key, groups: [sorted concept ids] }` riding inside
 * `concepts` (no new putSearch key — concepts are stored as sent). The warning is
 * suppressed only while the term's CURRENT exactDuplicateKey and the sorted set of
 * groups holding that key still match the stored override — any text edit, move,
 * or third copy changes that configuration and the warning re-evaluates
 * automatically. Stale overrides ride along harmlessly (byte-stable) until the
 * user re-decides.
 *
 * All functions are pure, deterministic, network-free, and liveness-aware
 * (disabled terms are invisible to duplicate detection, mirroring crossConcept).
 */
import { detectCrossConceptDuplicates, termEquivalenceKey } from './crossConcept.js';
import { liveTermsOf } from './termLiveness.js';

/* One trailing bracketed database field tag: [tiab], [Mesh], [Mesh:NoExp],
   [MeSH Terms], [Title/Abstract], [mh ^…], … — conservative: letters first,
   short, bracketed, at the very end only. */
const FIELD_TAG_RE = /\s*\[[A-Za-z][A-Za-z0-9 :/^,._-]{0,29}\]$/;

/* ONE symmetric pair of surrounding quotes (straight/curly, single/double). */
const QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"]];

/**
 * The conservative shared normalizer for EXACT duplicate detection (97 Phase 12).
 * Returns '' for blank/junk input. Pure.
 */
export function exactDuplicateKey(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  let prev;
  do {
    prev = s;
    // strip trailing field tags for comparison ("heart failure"[tiab] ≡ "heart failure")
    s = s.replace(FIELD_TAG_RE, '').trim();
    // strip ONE pair of SURROUNDING quotes ("EUS" ≡ EUS, “EUS” ≡ EUS); quotes
    // inside the term are meaningful and stay.
    for (const [open, close] of QUOTE_PAIRS) {
      if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
        s = s.slice(1, -1).trim();
        break;
      }
    }
  } while (s && s !== prev);
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/* ── 97 QA M18 — the duplicate model is TERM-TYPE-AWARE ──────────────────────
   "Heart Failure"[MeSH] OR "heart failure"[tiab] inside one OR group is the
   STANDARD controlled-vocabulary + free-text pattern (Phase 13 encourages it),
   so a controlled term and a free-text term must never classify as EXACT
   duplicates of each other. Controlled terms key on their DESCRIPTOR
   (vocab.mesh, falling back to text) with a `mesh:` prefix; free-text terms
   keep the bare conservative key ('eus'), so pre-existing freetext dupOverride
   keys and dismissal ids are unchanged. */

/** 'controlled' | 'freetext' — the duplicate-model class of a term. Pure. */
export function termTypeClass(term) {
  return term && term.type === 'controlled' ? 'controlled' : 'freetext';
}

/**
 * The type-aware duplicate key of an EXISTING term: free-text terms → the bare
 * conservative key; controlled terms → `mesh:` + the key of their descriptor
 * (vocab.mesh || text), so two controlled copies of one heading collide even
 * when their typed texts differ. Returns '' for junk. Pure.
 */
export function termDuplicateKey(term) {
  if (!term) return '';
  if (term.type === 'controlled') {
    const mesh = term.vocab && typeof term.vocab === 'object' ? term.vocab.mesh : '';
    const base = exactDuplicateKey(mesh || term.text);
    return base ? `mesh:${base}` : '';
  }
  return exactDuplicateKey(term.text);
}

/**
 * The duplicate key a CANDIDATE insertion would occupy. `candidate` is either a
 * term-like object ({ type, vocab }) or a type-class string; absent → freetext
 * (every typed/pasted/entry-term add is freetext). Pure.
 */
export function candidateDuplicateKey(text, candidate) {
  const type = typeof candidate === 'string' ? candidate : (candidate && candidate.type);
  if (type === 'controlled') {
    const mesh = candidate && typeof candidate === 'object' && candidate.vocab && typeof candidate.vocab === 'object'
      ? candidate.vocab.mesh : '';
    const base = exactDuplicateKey(mesh || text);
    return base ? `mesh:${base}` : '';
  }
  return exactDuplicateKey(text);
}

/** Sorted, deduped concept ids whose LIVE terms carry the type-aware `key`. Pure. */
export function groupsHoldingKey(concepts, key) {
  if (!key) return [];
  const ids = new Set();
  for (const c of (Array.isArray(concepts) ? concepts : [])) {
    if (!c) continue;
    if (liveTermsOf(c).some((t) => termDuplicateKey(t) === key)) ids.add(c.id);
  }
  return [...ids].sort();
}

/** The FIRST live term in `concept` matching the candidate's TYPE-AWARE exact key
 *  (excluding `excludeTermId`), or null — the "Find existing term" /
 *  blocked-insert target. `candidate` (optional) = the term being added/moved
 *  (or its type class); absent → freetext. A free-text candidate never collides
 *  with a controlled copy of the same label (QA M18). */
export function findExactDuplicateInConcept(concept, text, excludeTermId, candidate) {
  const key = candidateDuplicateKey(text, candidate);
  if (!key) return null;
  return liveTermsOf(concept).find((t) => t.id !== excludeTermId && termDuplicateKey(t) === key) || null;
}

const sortedEqual = (a, b) => {
  const x = Array.isArray(a) ? [...a].sort() : [];
  const y = Array.isArray(b) ? [...b].sort() : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * True when EVERY occurrence of `key` (across `conceptIds`) carries a still-valid
 * `dupOverride` for exactly this configuration: same key AND the same sorted set
 * of groups. Any edit/move/extra copy breaks the match → warning re-fires. Pure.
 */
export function dupOverrideActive(concepts, key, conceptIds) {
  if (!key) return false;
  const groups = Array.isArray(conceptIds) && conceptIds.length
    ? [...conceptIds].sort()
    : groupsHoldingKey(concepts, key);
  if (groups.length < 2) return false;
  for (const c of (Array.isArray(concepts) ? concepts : [])) {
    if (!c || !groups.includes(c.id)) continue;
    for (const t of liveTermsOf(c)) {
      if (termDuplicateKey(t) !== key) continue;
      const o = t.dupOverride;
      if (!o || typeof o !== 'object' || o.key !== key || !sortedEqual(o.groups, groups)) return false;
    }
  }
  return true;
}

/**
 * Cross-AND-group EXACT duplicates. Each entry:
 *   { id:'exactdup:<key>', key, label, conceptIds:[sorted], suppressed,
 *     occurrences:[{ conceptId, conceptLabel, termId, termText }] }
 * A key counts at most once per concept (same-group copies are the separate
 * within-group case). `suppressed` = an active "Keep both intentionally" override
 * (see dupOverrideActive); `opts.dismissed` (warning-id list) additionally
 * suppresses by id. Entries are returned even when suppressed IF
 * `opts.includeSuppressed` — the UI needs them for the chip menu. Pure.
 */
export function detectExactCrossGroupDuplicates(concepts, opts = {}) {
  const list = Array.isArray(concepts) ? concepts : [];
  const dismissed = new Set(opts.dismissed || []);
  const byKey = new Map();
  for (const c of list) {
    if (!c) continue;
    const seen = new Set();
    for (const t of liveTermsOf(c)) {
      const key = termDuplicateKey(t); // QA M18 — type-aware: MeSH vs free-text same-label is NOT exact
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ conceptId: c.id, conceptLabel: c.label, termId: t.id, termText: t.text });
    }
  }
  const out = [];
  for (const [key, occ] of byKey) {
    if (occ.length < 2) continue;
    const conceptIds = occ.map((o) => o.conceptId).sort();
    const suppressed = dupOverrideActive(list, key, conceptIds) || dismissed.has(`exactdup:${key}`);
    if (suppressed && !opts.includeSuppressed) continue;
    out.push({ id: `exactdup:${key}`, key, label: occ[0].termText, conceptIds, suppressed, occurrences: occ });
  }
  return out;
}

/**
 * The full chip-signal classification (plan §13):
 *   { exact: [...detectExactCrossGroupDuplicates entries...],
 *     variants: [{ id:'multi:<equivKey>', equivKey, label, occurrences }] }
 * `variants` = family-equivalent cross-group duplicates ("EUS" vs "endoscopic
 * ultrasound") that are NOT all the same exact key — the DEMOTED, non-blocking
 * "Possible variant" signal. Existing persisted `multi:<equivKey>` dismissals keep
 * suppressing exactly this softer signal (invariant 7 — ids unchanged). Pure.
 */
export function classifyCrossGroupDuplicates(concepts, opts = {}) {
  const dismissed = new Set(opts.dismissed || []);
  const exact = detectExactCrossGroupDuplicates(concepts, opts);
  const variants = [];
  const familyEntries = detectCrossConceptDuplicates(concepts);
  for (const d of familyEntries) {
    // Occurrences that all share ONE exact key are the exact path's job; a family
    // entry is a "possible variant" only when at least two DISTINCT exact keys
    // meet. QA M18 — the keys are TYPE-AWARE (recomputed from the live terms:
    // family occurrences carry no termId), so a MeSH + free-text pair of the same
    // label demotes to this soft signal instead of the dark-red exact class.
    const keys = new Set();
    for (const c of (Array.isArray(concepts) ? concepts : [])) {
      if (!c) continue;
      for (const t of liveTermsOf(c)) {
        if (termEquivalenceKey(t.text) === d.equivKey) keys.add(termDuplicateKey(t));
      }
    }
    if (keys.size < 2) continue;
    const id = `multi:${d.equivKey}`;
    if (dismissed.has(id)) continue;
    variants.push({ id, equivKey: d.equivKey, label: d.label, occurrences: d.occurrences });
  }
  return { exact, variants };
}

/**
 * "Keep both intentionally" — stamp `dupOverride: { key, groups }` on EVERY live
 * term whose exact key is `key` (each copy carries the decision, so it survives
 * whichever copy a later edit touches). Returns { concepts, changed } where
 * `changed` = [{ conceptId, termId, prev }] (prev = the term's previous
 * dupOverride value or undefined) — exactly what undoStack.recordDupOverride
 * needs. Returns the SAME array (changed: []) when nothing matches or every copy
 * already carries this exact configuration. Pure.
 */
export function applyDupOverride(concepts, key) {
  const list = Array.isArray(concepts) ? concepts : [];
  const groups = groupsHoldingKey(list, key);
  if (groups.length < 2) return { concepts: list, changed: [] };
  const changed = [];
  const next = list.map((c) => {
    if (!c || !groups.includes(c.id)) return c;
    let touched = false;
    const terms = (c.terms || []).map((t) => {
      if (!t || t.disabled === true || termDuplicateKey(t) !== key) return t;
      const o = t.dupOverride;
      if (o && typeof o === 'object' && o.key === key && sortedEqual(o.groups, groups)) return t; // already current
      changed.push({ conceptId: c.id, termId: t.id, prev: t.dupOverride });
      touched = true;
      return { ...t, dupOverride: { key, groups } };
    });
    return touched ? { ...c, terms } : c;
  });
  return changed.length ? { concepts: next, changed } : { concepts: list, changed: [] };
}

/**
 * Remove the intentional-duplicate decision for `key`: every term whose
 * dupOverride.key === key loses the field entirely (omit-when-absent hygiene —
 * old saves stay byte-identical). Same return contract as applyDupOverride. Pure.
 */
export function clearDupOverride(concepts, key) {
  const list = Array.isArray(concepts) ? concepts : [];
  if (!key) return { concepts: list, changed: [] };
  const changed = [];
  const next = list.map((c) => {
    if (!c) return c;
    let touched = false;
    const terms = (c.terms || []).map((t) => {
      if (!t || !t.dupOverride || typeof t.dupOverride !== 'object' || t.dupOverride.key !== key) return t;
      changed.push({ conceptId: c.id, termId: t.id, prev: t.dupOverride });
      touched = true;
      const { dupOverride: _gone, ...rest } = t;
      return rest;
    });
    return touched ? { ...c, terms } : c;
  });
  return changed.length ? { concepts: next, changed } : { concepts: list, changed: [] };
}
