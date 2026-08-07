/**
 * vocabulary/mappings.js — 100.md §§3-4. The CROSS-DATABASE VOCABULARY MAPPING
 * registry: given a canonical concept (canonical.js) and the vocabulary a target
 * database indexes, decide whether a database-native subject heading can be produced
 * — and, when it cannot, say so instead of inventing one.
 *
 * ── The rule we implement (100.md §3, "Important fallback behavior") ──────────────
 * A mapping is emitted ONLY when there is a real, checkable basis for it. Otherwise
 * the concept is searched as properly-formatted free text. We never fabricate a
 * subject heading, and we never present a guess as if it were indexed vocabulary.
 *
 * ── What that means for the current catalogue ─────────────────────────────────────
 * MeSH is published by the NLM and is free. The databases below INDEX MeSH itself, so
 * the mapping is an IDENTITY — not a guess:
 *     PubMed/MEDLINE · PubMed Central · Cochrane CENTRAL · Europe PMC
 *
 * Emtree (Elsevier/Embase), CINAHL Headings (EBSCO) and the APA Thesaurus of
 * Psychological Index Terms (APA) are PROPRIETARY. No authoritative, redistributable
 * MeSH crosswalk exists for any of them — the UMLS Metathesaurus, the only general
 * crosswalk NLM publishes, does not carry them. Every "mapping" the old compilers
 * emitted for those three was the MeSH string pasted into the target's heading syntax
 * (Embase additionally used a lowercase/de-inversion heuristic). Those are exactly the
 * "fake database syntax" 100.md §3 forbids and 100.md §20 means by "do not invent
 * mappings", so they now resolve to `none` and fall back to free text. Advanced users
 * who own the real heading can still paste it through the per-database manual override
 * that already exists on every Database Strategies panel.
 *
 * ── Adding a vocabulary later ─────────────────────────────────────────────────────
 * This file is the ONLY place that has to change. Ship a dataset (or a client) and:
 *
 *     registerVocabularyMapping({
 *       from: 'mesh', to: 'emtree', confidence: 'verified',
 *       authority: 'Emtree ↔ MeSH crosswalk, <source + release>',
 *       translate(concept) {
 *         const hit = CROSSWALK[concept.sourceId];
 *         return hit ? { heading: hit.label, id: hit.id } : null;   // null ⇒ free text
 *       },
 *     });
 *
 * A `translate` returning null for a concept it does not know is REQUIRED: partial
 * coverage must degrade to free text per-concept, never to a guessed heading.
 *
 * PURE + deterministic (no app / DOM / I/O / network).
 */

const S = (v) => String(v == null ? '' : v);

const key = (from, to) => `${S(from).toLowerCase()}␟${S(to).toLowerCase()}`;

/** confidence ladder — only these two are ever emitted as a native heading. */
export const CONFIDENCE = Object.freeze({
  /** The target database indexes the SOURCE thesaurus itself. Not a translation. */
  EXACT: 'exact',
  /** A real, cited crosswalk resolved this concept. */
  VERIFIED: 'verified',
  /** No basis for a heading → free-text fallback. */
  NONE: 'none',
});

const MAPPINGS = new Map();

/**
 * registerVocabularyMapping({ from, to, confidence, authority, translate }) — declare
 * how concepts from one vocabulary become headings in another.
 *   translate(concept) → { heading, id?, explodable? } | null   (null ⇒ no equivalent)
 * Re-registering the same (from,to) pair replaces it (test seams / host overrides).
 */
export function registerVocabularyMapping(mapping) {
  if (!mapping || !mapping.from || !mapping.to || typeof mapping.translate !== 'function') return;
  const confidence = mapping.confidence === CONFIDENCE.EXACT || mapping.confidence === CONFIDENCE.VERIFIED
    ? mapping.confidence : CONFIDENCE.VERIFIED;
  MAPPINGS.set(key(mapping.from, mapping.to), {
    from: S(mapping.from).toLowerCase(),
    to: S(mapping.to).toLowerCase(),
    confidence,
    authority: S(mapping.authority) || 'unspecified source',
    translate: mapping.translate,
  });
}

/** The registered mapping for a (from,to) pair, or null. */
export function lookupVocabularyMapping(from, to) {
  return MAPPINGS.get(key(from, to)) || null;
}

/** Every registered mapping (diagnostics / tests / docs). */
export function listVocabularyMappings() {
  return [...MAPPINGS.values()].map(({ from, to, confidence, authority }) => ({ from, to, confidence, authority }));
}

/** Drop a registered mapping (test isolation / host override rollback). */
export function removeVocabularyMapping(from, to) {
  return MAPPINGS.delete(key(from, to));
}
/** Restore the shipped registry — no crosswalks, only the built-in identity rule. */
export function resetVocabularyMappings() {
  MAPPINGS.clear();
}

/* ── the identity rule ─────────────────────────────────────────────────────────────
 * When a concept's OWN vocabulary is the one the target database indexes, there is
 * nothing to translate — the descriptor IS the heading. PubMed, PMC, Cochrane CENTRAL
 * and Europe PMC all index MEDLINE's MeSH, so a MeSH concept resolves natively there.
 *
 * This is a RULE rather than a registered mesh→mesh entry precisely so the model stays
 * uncoupled from MeSH (100.md §4: "MeSH is only one vocabulary system"): a term sourced
 * from Emtree resolves natively against an Emtree-indexed database on the same line,
 * with no new registration. It also keeps `listVocabularyMappings()` an honest answer to
 * "which cross-vocabulary crosswalks do we ship?" — today, none. */
function identityMapping(system) {
  return {
    from: system, to: system, confidence: CONFIDENCE.EXACT,
    authority: 'this database indexes that vocabulary directly — no translation needed',
    translate: (concept) => {
      const heading = S(concept && concept.preferredLabel).trim();
      return heading ? { heading, id: S(concept && concept.sourceId), explodable: true } : null;
    },
  };
}

/**
 * translateConcept(concept, targetSystem) — the decision, as data.
 *
 * Returns either
 *   { status:'native',   system, heading, id, confidence, authority, explode }
 * or
 *   { status:'freetext', system, forms, confidence:'none', reason }
 *
 * `reason` is a machine code (see FALLBACK_REASON); the user-facing sentence is
 * composed by the compiler, which knows the database's label and grammar.
 */
export const FALLBACK_REASON = Object.freeze({
  /** The database indexes no controlled vocabulary at all. */
  NO_VOCABULARY: 'no-vocabulary',
  /** The database has a thesaurus, but no verified crosswalk reaches it. */
  NO_EQUIVALENT: 'no-equivalent',
  /** A crosswalk exists but does not cover THIS concept. */
  NOT_IN_CROSSWALK: 'not-in-crosswalk',
  /** The term carries no usable heading (nothing to translate). */
  NO_SOURCE_HEADING: 'no-source-heading',
});

export function translateConcept(concept, targetSystem) {
  const c = concept && typeof concept === 'object' ? concept : null;
  const target = S(targetSystem).trim().toLowerCase() || 'none';
  const forms = (c && Array.isArray(c.freeTextForms) ? c.freeTextForms : []).filter(Boolean);
  const fallback = (reason) => ({ status: 'freetext', system: target, forms, confidence: CONFIDENCE.NONE, reason });

  if (!c || !S(c.preferredLabel).trim()) return fallback(FALLBACK_REASON.NO_SOURCE_HEADING);
  if (!target || target === 'none') return fallback(FALLBACK_REASON.NO_VOCABULARY);

  const source = S(c.sourceSystem).trim().toLowerCase();
  const mapping = source === target ? identityMapping(target) : lookupVocabularyMapping(source, target);
  if (!mapping) return fallback(FALLBACK_REASON.NO_EQUIVALENT);

  let hit = null;
  try { hit = mapping.translate(c); } catch { hit = null; }
  const heading = hit && S(hit.heading).trim();
  if (!heading) return fallback(FALLBACK_REASON.NOT_IN_CROSSWALK);

  return {
    status: 'native',
    system: target,
    heading,
    id: S(hit.id),
    confidence: mapping.confidence,
    authority: mapping.authority,
    // Explosion is only offered when both the mapping and the user ask for it; the
    // per-database capability table has the final say (some databases cannot explode).
    explode: !!c.explode && hit.explodable !== false,
  };
}

export default translateConcept;
