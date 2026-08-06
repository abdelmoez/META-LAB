/**
 * vocabulary/index.js — 100.md §4. Public API of the cross-database vocabulary
 * translation layer.
 *
 *   toCanonicalConcept(term)              term  → canonical semantic concept
 *   translateConcept(concept, system)     concept → native heading | free-text plan
 *   planControlledTerm(term, cap)         the one call a database adapter makes
 *
 * See canonical.js for the model and mappings.js for the registry (and for how to add
 * a new vocabulary crosswalk without touching any renderer).
 */
export {
  toCanonicalConcept, naturalOrderLabel, freeTextFormsFor,
} from './canonical.js';
export {
  translateConcept, registerVocabularyMapping, lookupVocabularyMapping,
  listVocabularyMappings, CONFIDENCE, FALLBACK_REASON,
} from './mappings.js';

import { toCanonicalConcept } from './canonical.js';
import { translateConcept, FALLBACK_REASON } from './mappings.js';

/**
 * planControlledTerm(term, cap) — the single entry point compilers/shared.js uses.
 * `cap` is the target database's capability record (compilers/capabilities.js): its
 * `vocabSystem`, `controlledVocab` and `explosion` flags decide what is reachable.
 *
 * Returns the translation decision enriched with the canonical concept and the
 * capability facts a renderer needs, so no renderer has to look at `term.vocab` again:
 *
 *   { concept, status:'native',   system, heading, explode, confidence, authority }
 *   { concept, status:'freetext', system, forms, reason, confidence:'none' }
 */
export function planControlledTerm(term, cap) {
  const concept = toCanonicalConcept(term);
  const capability = cap && typeof cap === 'object' ? cap : {};
  const declaredSystem = String(capability.vocabSystem || 'none').toLowerCase();
  // `controlledVocab: false` means "Pecan cannot target this database's thesaurus with
  // a heading it can verify" — which is NOT the same as "this database has no
  // thesaurus". Embase/CINAHL/PsycInfo are indexed with a real (proprietary)
  // vocabulary we have no crosswalk to; Scopus/WoS/IEEE have none at all. The
  // distinction drives two very different user-facing explanations, so resolve it here
  // rather than making every renderer re-derive it.
  const reachable = !!capability.controlledVocab;
  const decision = translateConcept(concept, reachable ? declaredSystem : 'none');

  if (decision.status !== 'native') {
    return {
      ...decision,
      concept,
      /** The database's own thesaurus (or 'none') — what the explanation names. */
      databaseSystem: declaredSystem,
      reason: reachable
        ? decision.reason
        : (declaredSystem && declaredSystem !== 'none'
          ? FALLBACK_REASON.NO_EQUIVALENT
          : FALLBACK_REASON.NO_VOCABULARY),
    };
  }
  // The capability table has the last word on explosion. A database can index the
  // vocabulary yet expose NO explosion control (PMC always explodes `[MeSH Terms]`;
  // Europe PMC's `MESH:` matches the heading exactly) — `explosionDefault` says which
  // way it falls so we can report the mismatch in the right direction instead of
  // asserting a generic "narrower topics were dropped".
  const controllable = capability.explosion !== false;
  const dbDefaultExplodes = controllable ? null : capability.explosionDefault === 'explode';
  const effectiveExplode = controllable ? decision.explode : !!dbDefaultExplodes;
  return {
    ...decision,
    concept,
    databaseSystem: declaredSystem,
    explode: effectiveExplode,
    explosionUnsupported: !controllable && !!concept.explode !== !!dbDefaultExplodes,
    /** 'lost' → narrower topics dropped; 'forced' → narrower topics included anyway. */
    explosionMismatch: !controllable && !!concept.explode !== !!dbDefaultExplodes
      ? (concept.explode ? 'lost' : 'forced') : null,
  };
}
