/**
 * crossConcept.js — SB4 Parts 4, 8, 9. Pure, network-free concept-hygiene helpers:
 *
 *  - termEquivalenceKey — collapse a term to its concept family (so "EUS" ≡
 *    "endoscopic ultrasound", "T2DM" ≡ "type 2 diabetes mellitus") for duplicate
 *    detection across AND-ed concepts.
 *  - detectCrossConceptDuplicates — find the same/equivalent term living in more than
 *    one concept (which over-narrows an AND-ed search).
 *  - searchQualityCheck — a small "Search Quality Check" foundation: empty major
 *    concept, term-in-multiple-concepts, no controlled vocabulary for a major concept,
 *    likely-missing acronym expansion, comparator/outcome over-narrowing. (NOT a full
 *    PRESS/PRISMA-S system — see docs/manager/search-builder-future-enhancements.md.)
 *  - sensitivitySignal — bucket a hit count into Very broad … Very narrow.
 *
 * Deterministic + exported for unit tests. No fabricated numbers; nothing here calls
 * the network.
 */
import { matchFamily, norm } from './conceptExtraction.js';

/** Live (non-empty) terms of a concept. */
function liveTerms(concept) {
  return ((concept && concept.terms) || []).filter((t) => String(t.text || '').trim());
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

const MAJOR_CONCEPTS = [['P', 'Population'], ['I', 'Intervention / Exposure'], ['O', 'Outcomes']];

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

  // 1. Population / Intervention with no terms is a real problem (warning). Outcomes
  //    empty is NORMAL — many SR searches deliberately omit outcomes to stay sensitive
  //    — so it gets a calm, informational note instead of a warning (SB5 Part 7).
  for (const [key, label] of [['P', 'Population'], ['I', 'Intervention / Exposure']]) {
    const c = list.find((x) => x.picoField === key);
    if (c && liveTerms(c).length === 0) {
      push({ id: `empty:${key}`, severity: 'warning', conceptId: c.id, concept: label, message: `${label} has no search terms.`, action: `Add at least one term for ${label} in Select Keywords.` });
    }
  }
  const outEmpty = list.find((x) => x.picoField === 'O');
  if (outEmpty && liveTerms(outEmpty).length === 0) {
    push({ id: 'outcomes-optional', severity: 'info', conceptId: outEmpty.id, concept: 'Outcomes', message: 'No outcome terms — that’s usually fine. Outcomes are optional in many systematic-review searches; adding them makes the search more specific but can reduce sensitivity (you can apply outcomes at screening instead).', action: 'Leave empty for a sensitive search, or add outcome terms if you want a narrower, more targeted search.' });
  }

  // 2. Same/equivalent term in more than one AND-ed concept.
  for (const d of detectCrossConceptDuplicates(list)) {
    const labels = d.occurrences.map((o) => o.conceptLabel).join(' and ');
    push({ id: `multi:${d.equivKey}`, severity: 'warning', concept: labels, message: `"${d.label}" appears in more than one concept (${labels}). Since concepts are joined with AND, repeating it may make the search too narrow.`, action: 'Move it to the single best concept, or keep it if intentional.' });
  }

  // 3. No controlled vocabulary for a major concept that has terms.
  for (const [key, label] of MAJOR_CONCEPTS) {
    const c = list.find((x) => x.picoField === key);
    if (!c) continue;
    const terms = liveTerms(c);
    if (terms.length && !terms.some((t) => t.type === 'controlled' || t.vocab)) {
      push({ id: `novocab:${key}`, severity: 'info', conceptId: c.id, concept: label, message: `No controlled-vocabulary (MeSH) term found for ${label} yet.`, action: 'Consider adding a MeSH or Emtree term if available.' });
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

  // 5. Comparator / Outcomes AND-ed in can over-narrow.
  const comp = list.find((x) => x.picoField === 'C');
  if (comp && liveTerms(comp).length) {
    push({ id: 'narrow:C', severity: 'info', conceptId: comp.id, concept: 'Comparator / Control', message: 'Comparator terms are AND-ed into the search and can make it too narrow.', action: 'Many reviews leave the comparator out of the search and apply it at screening.' });
  }
  const outc = list.find((x) => x.picoField === 'O');
  if (outc && liveTerms(outc).length) {
    push({ id: 'narrow:O', severity: 'info', conceptId: outc.id, concept: 'Outcomes', message: 'Outcome terms are AND-ed in and can make the search too narrow (outcomes are often not in titles/abstracts).', action: 'Consider broadening or removing outcome terms; apply outcomes at screening.' });
  }

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
