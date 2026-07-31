/**
 * crossConcept.js — SB4 Parts 4, 8, 9. Pure, network-free concept-hygiene helpers:
 *
 *  - termEquivalenceKey — collapse a term to its concept family (so "EUS" ≡
 *    "endoscopic ultrasound", "T2DM" ≡ "type 2 diabetes mellitus") for duplicate
 *    detection across AND-ed concepts.
 *  - detectCrossConceptDuplicates — find the same/equivalent term living in more than
 *    one concept (which over-narrows an AND-ed search).
 *  - searchQualityCheck — a small "Search Quality Check" foundation: empty concept
 *    group in the AND chain, term-in-multiple-concepts, no controlled vocabulary for
 *    a concept, likely-missing acronym expansion, literal Boolean operator inside a
 *    term, within-concept duplicate. (NOT a full PRESS/PRISMA-S system — see
 *    docs/manager/search-builder-future-enhancements.md.)
 *    96.md re-keyed the formerly PICO-specific checks generically: empty-group is
 *    `empty:<conceptId>` (was empty:P/empty:I), no-vocab is `novocab:<conceptId>`
 *    (was novocab:P/I/O); the narrow:C / narrow:O / outcomes-optional PICO pedagogy
 *    is deleted. Old dismissed ids persist harmlessly as orphans in
 *    `dismissedWarnings` (the dismissal filter simply never matches them again).
 *  - sensitivitySignal — bucket a hit count into Very broad … Very narrow.
 *
 * Deterministic + exported for unit tests. No fabricated numbers; nothing here calls
 * the network.
 */
import { matchFamily, norm } from './conceptExtraction.js';
import { liveTermsOf } from './termLiveness.js';

/** Live terms of a concept — the shared rule (non-blank AND not disabled), so the
 *  quality checks and duplicate detection ignore terms the user switched off
 *  (85.md A1; see termLiveness.js). */
function liveTerms(concept) {
  return liveTermsOf(concept);
}

/**
 * Equivalence key for a term: its concept-family id when the term maps to a family
 * ("EUS"/"endoscopic ultrasound" → "fam:eus"), else the normalized text. So variants
 * and acronyms of the same idea compare equal. Pure.
 */
export function termEquivalenceKey(text) {
  const n = norm(text);
  if (!n) return '';
  const fam = matchFamily(n);
  return fam ? `fam:${fam.id}` : n;
}

/**
 * Find terms (by equivalence key) that appear in more than one concept. Each entry:
 *   { key, equivKey, label, conceptIds:[...], occurrences:[{conceptId, conceptLabel,
 *     termText, picoField}] }
 * A key is counted at most once per concept. Pure.
 */
export function detectCrossConceptDuplicates(concepts) {
  const list = Array.isArray(concepts) ? concepts : [];
  const byKey = new Map();
  list.forEach((c) => {
    const seen = new Set();
    liveTerms(c).forEach((t) => {
      const key = termEquivalenceKey(t.text);
      if (!key || seen.has(key)) return; // count each equivalence key once per concept
      seen.add(key);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ conceptId: c.id, conceptLabel: c.label, termText: t.text, picoField: c.picoField || null });
    });
  });
  const dups = [];
  for (const [key, occ] of byKey) {
    if (occ.length < 2) continue;
    dups.push({ key: `dup:${key}`, equivKey: key, label: occ[0].termText, conceptIds: occ.map((o) => o.conceptId), occurrences: occ });
  }
  return dups;
}

function conceptHasText(concept, text) {
  const n = norm(text);
  return liveTerms(concept).some((t) => norm(t.text) === n);
}

/**
 * The Search Quality Check (foundation). Returns an array of warnings:
 *   { id, severity:'info'|'warning'|'critical', concept, conceptId?, message, action }
 * `opts.dismissed` (array of ids) filters out warnings the user has dismissed. Pure.
 */
export function searchQualityCheck(concepts, opts = {}) {
  const list = Array.isArray(concepts) ? concepts : [];
  const dismissed = new Set(opts.dismissed || []);
  const warnings = [];
  const push = (w) => { if (!dismissed.has(w.id)) warnings.push(w); };

  // 1. (96.md re-key) A concept group with ZERO live terms silently drops out of the
  //    AND chain — the compiled search no longer requires that idea at all, which is
  //    exactly the "empty groups highlighted" hazard the spec names. Warn per group,
  //    keyed by the concept's stable id (`empty:<conceptId>`) so dismissals survive
  //    renames. Only meaningful when 2+ groups exist (a single empty group is the
  //    ordinary just-started state — the stage status already reads 'empty').
  //    Note-carrying groups (the legacy Time-Frame group renders its restriction as
  //    a `note`, never as terms) are deliberately exempt — they are "ready" without
  //    terms (see searchState.conceptStatus).
  if (list.length >= 2) {
    for (const c of list) {
      if (!c || (c.note && String(c.note).trim())) continue;
      // 96.md compat (QA L23) — legacy PICO scaffold groups (picoField / pico_auto)
      // were auto-created five-at-a-time by the retired sync; an intentionally-empty
      // Comparator/Outcomes group is historical state, not a user mistake, so it
      // must not wake migrated projects up with warnings (mirrors conceptDrift's
      // legacy exemption). ONLY zero-TERM groups are exempt: a legacy group whose
      // terms the user switched off is a live user action (it silently drops out
      // of the AND chain) and still warns via the liveness check below.
      if ((c.picoField || c.source === 'pico_auto') && (c.terms || []).length === 0) continue;
      if (liveTerms(c).length === 0) {
        const label = c.label || 'This concept';
        push({ id: `empty:${c.id}`, severity: 'warning', conceptId: c.id, concept: label, message: `${label} has no search terms, so it is not part of the search yet.`, action: `Add at least one term to ${label}, or remove the group if it isn't needed.` });
      }
    }
  }

  // 2. Same/equivalent term in more than one AND-ed concept.
  for (const d of detectCrossConceptDuplicates(list)) {
    const labels = d.occurrences.map((o) => o.conceptLabel).join(' and ');
    push({ id: `multi:${d.equivKey}`, severity: 'warning', concept: labels, message: `"${d.label}" appears in more than one concept (${labels}). Since concepts are joined with AND, repeating it may make the search too narrow.`, action: 'Move it to the single best concept, or keep it if intentional.' });
  }

  // 3. (96.md re-key) No controlled vocabulary for a concept that has terms — keyed
  //    generically by concept id (`novocab:<conceptId>`, was novocab:P/I/O).
  for (const c of list) {
    if (!c) continue;
    const terms = liveTerms(c);
    if (terms.length && !terms.some((t) => t.type === 'controlled' || t.vocab)) {
      const label = c.label || 'this concept';
      push({ id: `novocab:${c.id}`, severity: 'info', conceptId: c.id, concept: label, message: `No controlled-vocabulary (MeSH) term found for ${label} yet.`, action: 'Consider adding a MeSH or Emtree term if available.' });
    }
  }

  // 4. Likely missing acronym expansion (a family acronym without its expanded term).
  for (const c of list) {
    for (const t of liveTerms(c)) {
      const txt = String(t.text).trim();
      if (!/^[A-Za-z0-9-]{2,8}$/.test(txt) || !/[A-Z]/.test(txt)) continue; // acronym-ish only
      const fam = matchFamily(norm(txt));
      if (!fam) continue;
      const expansion = (fam.terms || []).find((x) => norm(x) !== norm(txt) && norm(x).includes(' '));
      if (expansion && !conceptHasText(c, expansion)) {
        push({ id: `acronym:${c.id}:${norm(txt)}`, severity: 'info', conceptId: c.id, concept: c.label, message: `"${txt}" is an acronym — add its expanded term "${expansion}" so the search catches both.`, action: `Add "${expansion}" to ${c.label}.` });
      }
    }
  }

  // 5. (85.md A1) A term whose TEXT contains a standalone UPPERCASE Boolean operator
  //    is searched as those literal words — "stroke OR TIA" matches the exact phrase,
  //    not either term. Word-boundary + case-sensitive (a real phrase like "signs and
  //    symptoms" uses lowercase) and requires other words around the operator, so the
  //    hint is high-precision. Mirrors ast.js findLiteralBooleanTerms for AND/OR.
  for (const c of list) {
    for (const t of liveTerms(c)) {
      const txt = String(t.text).trim();
      const m = /(?:^|\s)(AND|OR)(?:\s|$)/.exec(txt);
      if (m && txt.split(/\s+/).length > 1) {
        push({ id: `boolop:${c.id}:${norm(txt)}`, severity: 'warning', conceptId: c.id, concept: c.label, message: `"${txt}" contains "${m[1]}" — operators inside a term are searched as literal words, not as Boolean logic.`, action: `Split it into separate terms in ${c.label} (synonyms within a concept are combined with OR automatically).` });
      }
    }
  }

  // 6. (85.md A1) The same/equivalent term twice WITHIN one concept (the cross-concept
  //    pass counts each equivalence key once per concept, so this is a separate check).
  for (const c of list) {
    const seen = new Map(); // equivKey -> first term text
    for (const t of liveTerms(c)) {
      const key = termEquivalenceKey(t.text);
      if (!key) continue;
      if (seen.has(key)) {
        push({ id: `dupin:${c.id}:${key}`, severity: 'warning', conceptId: c.id, concept: c.label, message: `"${t.text}" duplicates "${seen.get(key)}" within ${c.label}. Duplicate synonyms don't broaden the search — they just add noise.`, action: `Remove one of the duplicates from ${c.label}.` });
      } else {
        seen.set(key, t.text);
      }
    }
  }

  // (96.md — the former check 7, narrow:C / narrow:O comparator/outcome pedagogy,
  //  was PICO-specific and is deleted. Persisted dismissals of those ids remain
  //  harmless orphans.)

  // Stable order: critical → warning → info.
  const rank = { critical: 0, warning: 1, info: 2 };
  return warnings.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

/**
 * Bucket a (PubMed) hit count into a sensitivity signal, or null when unknown.
 * Heuristic thresholds (documented); no fabricated numbers when count is null. Pure.
 */
export function sensitivitySignal(hitCount) {
  if (hitCount == null || !Number.isFinite(hitCount)) return null;
  if (hitCount > 50000) return { key: 'very-broad', label: 'Very broad' };
  if (hitCount > 10000) return { key: 'broad', label: 'Broad' };
  if (hitCount >= 200) return { key: 'balanced', label: 'Balanced' };
  if (hitCount >= 30) return { key: 'narrow', label: 'Narrow' };
  return { key: 'very-narrow', label: 'Very narrow' };
}
