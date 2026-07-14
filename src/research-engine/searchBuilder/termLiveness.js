/**
 * termLiveness.js — 85.md A1. THE single term-liveness rule for the whole search
 * stack. A term contributes to the executed/compiled/documented search iff it has
 * non-blank text AND is not disabled (`disabled: true` = keep-but-off, the
 * disable-without-delete flag; the key is omitted entirely when a term is enabled,
 * so old saves stay byte-identical — see searchState.setTermDisabled).
 *
 * Every consumer of a strategy's terms MUST use this rule (directly or via a
 * mirrored inline check where an import is impractical, e.g.
 * server/pecanSearch/query/ast.js). Divergence here is a reproducibility bug: the
 * preview would count one query while the automated run executes another.
 *
 * Adopters: compilers/normalize.js (all 16 DB compilers + PubMed count + previews),
 * crossConcept.js (quality checks + duplicate detection), searchState.conceptStatus,
 * methodsText.js (Methods paragraph), strategyGenerator.js (Strategy Studio
 * paste-ready strings), strategyCritic.js (critique + revised strategies),
 * recallEstimate.js (concept-coverage reasons + improvement suggestions),
 * versionDiff.js (version compare — disabled ≡ absent, matching the projection),
 * server/pecanSearch/query/ast.js (automated runs / preview counts / renderPlain —
 * inline mirror), server/searchEngine/searchVersionService.canonicalStrategyProjection
 * (version identity hash), server/searchEngine/strategyStudioService.loadStoredStrategy
 * (strips disabled terms before the studio engine ever sees them), and
 * pecanSearchApi.loadCanonicalQuery (client belt-and-braces).
 *
 * Pure, dependency-free, deterministic.
 */

/** True when a term is live: non-blank text and not disabled. */
export function isLiveTerm(t) {
  return !!(t && String(t.text || '').trim() && t.disabled !== true);
}

/** The live terms of one concept (never null; tolerates junk). */
export function liveTermsOf(concept) {
  return ((concept && concept.terms) || []).filter(isLiveTerm);
}

/**
 * stripDisabledTerms(concepts) — concepts with every `disabled: true` term removed.
 * Concepts whose terms all end up removed (or were empty) are KEPT — empty concepts
 * carry the inter-concept `op` chain, and dropping them here would diverge from the
 * UI/compiler op-chaining contract (compilers/normalize.js keeps empty concepts for
 * exactly this reason). Blank-text terms are NOT touched (downstream liveness
 * filters handle those). Returns the input array unchanged when nothing is
 * disabled, so referential no-op callers stay cheap.
 */
export function stripDisabledTerms(concepts) {
  const list = Array.isArray(concepts) ? concepts : [];
  let changed = false;
  const out = list.map((c) => {
    const terms = (c && Array.isArray(c.terms)) ? c.terms : null;
    if (!terms || !terms.some((t) => t && t.disabled === true)) return c;
    changed = true;
    return { ...c, terms: terms.filter((t) => !(t && t.disabled === true)) };
  });
  return changed ? out : list;
}
