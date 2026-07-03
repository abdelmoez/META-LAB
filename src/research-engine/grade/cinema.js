/**
 * cinema.js — P12. CINeMA ↔ engine-agnostic domain mapping (types + mapping only).
 *
 * CINeMA (Confidence In Network Meta-Analysis; Nikolakopoulou A et al. PLoS Med.
 * 2020;17:e1003082) rates the confidence in each network estimate across six
 * domains. This module maps those domains — and the NMA engine's own transparency
 * warnings (research-engine/statistics/nma/index.js, warnings[].kind) — onto the
 * same engine-agnostic domain keys used by gradeModel.js, so a network estimate can
 * later feed the SAME certainty model as a pairwise outcome.
 *
 * SCOPE: mapping + types ONLY. This does NOT implement the CINeMA rating algorithm
 * (percentage-contribution weighting, transitivity checks, etc.) — it is the
 * adapter layer that lets NMA signals reuse the pairwise GRADE machinery.
 *
 * Pure: no Prisma / Express / React / Date.now() / randomness.
 */

/**
 * The six CINeMA domains, each mapped to an engine-agnostic domain key.
 *   - `engineDomain` reuses the pairwise GRADE domains where they coincide
 *     (within-study bias → rob, reporting bias → publicationBias, heterogeneity →
 *     inconsistency). Incoherence is NMA-specific and has its own key 'incoherence'
 *     (the direct-vs-indirect disagreement that has no pairwise analogue).
 */
export const CINEMA_DOMAINS = [
  { key: 'within_study_bias', cinema: 'Within-study bias', engineDomain: 'rob',             note: 'Risk of bias in the studies contributing to the estimate.' },
  { key: 'reporting_bias',    cinema: 'Reporting bias',    engineDomain: 'publicationBias', note: 'Selective outcome / publication reporting across the network.' },
  { key: 'indirectness',      cinema: 'Indirectness',      engineDomain: 'indirectness',    note: 'Relevance of contributing evidence to the question (incl. transitivity).' },
  { key: 'imprecision',       cinema: 'Imprecision',       engineDomain: 'imprecision',     note: 'Width of the confidence/credible interval around the network estimate.' },
  { key: 'heterogeneity',     cinema: 'Heterogeneity',     engineDomain: 'inconsistency',   note: 'Variability of effects within comparisons.' },
  { key: 'incoherence',       cinema: 'Incoherence',       engineDomain: 'incoherence',     note: 'Disagreement between direct and indirect evidence (NMA-specific).' },
];

/** Lookup a CINeMA domain by its own key or the engine domain key. */
export function cinemaDomain(key) {
  return CINEMA_DOMAINS.find((d) => d.key === key || d.engineDomain === key) || null;
}

/**
 * The NMA engine emits warnings[].kind ∈ {incoherence, heterogeneity, indirectness,
 * imprecision, info}. This table also covers the two CINeMA domains the frequentist
 * engine does not currently surface as warning kinds (within-study bias, reporting
 * bias) so callers can route them uniformly if/when they are emitted.
 */
const NMA_WARNING_TO_DOMAIN = {
  incoherence: 'incoherence',
  heterogeneity: 'inconsistency',
  indirectness: 'indirectness',
  imprecision: 'imprecision',
  reporting: 'publicationBias',
  bias: 'rob',
  info: null, // informational only — not a certainty domain
};

/**
 * mapNmaWarningToDomain(kind) → engine domain key | null
 * Maps an NMA warning kind to the engine-agnostic domain it informs. Returns null
 * for informational warnings and unrecognised kinds.
 */
export function mapNmaWarningToDomain(kind) {
  if (kind == null) return null;
  return Object.prototype.hasOwnProperty.call(NMA_WARNING_TO_DOMAIN, kind)
    ? NMA_WARNING_TO_DOMAIN[kind]
    : null;
}

export const GRADE_CINEMA_VERSION = 'v1';
