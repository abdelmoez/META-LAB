/**
 * nosThresholds.js — 101.md §22. How a NOS star profile may (and may not) be
 * turned into a quality label.
 *
 * THE SCIENTIFIC POINT, stated plainly because it is the whole reason this file
 * exists separately from nos.js:
 *
 *   The Newcastle–Ottawa Scale defines NO threshold. Both official OHRI documents
 *   (nosgen.pdf, nos_manual.pdf) were read end to end; neither contains a cut-off,
 *   band, or good/fair/poor mapping. The only scoring statements in the entire
 *   official corpus are the two "maximum one star per numbered item / maximum two
 *   stars for Comparability" notes.
 *
 *   In particular the familiar **0–3 poor / 4–6 moderate / 7–9 high** bands are
 *   NOT a NOS rule. They appear in no OHRI document. They are a convention that
 *   propagated through the secondary literature, and methodological reviews state
 *   directly that the NOS developers provide no cut-off. Presenting them as "the
 *   NOS threshold" is a misattribution — which is exactly what §22 forbids.
 *
 * So this module ships three modes and defaults to the honest one:
 *
 *   'none'   (DEFAULT) — report the star profile only. No verdict.
 *   'ahrq'   — the AHRQ Evidence-based Practice Center per-domain standard, a real
 *              published rule that is AHRQ's and is labelled as such.
 *   'custom' — thresholds the review team defines in its own protocol.
 *
 * Every non-'none' result carries `attribution` and `official:false` so no UI can
 * render a verdict without saying whose rule produced it.
 *
 * Pure — no DOM/React/network/Date.
 */

/** Interpretation modes a project can choose. */
export const THRESHOLD_MODES = Object.freeze(['none', 'ahrq', 'custom']);

export const DEFAULT_THRESHOLD_MODE = 'none';

/**
 * The AHRQ standard, verbatim from AHRQ Comparative Effectiveness Review No. 88
 * (Penson DF, Krishnaswami S, Jules A, et al. Evaluation and Treatment of
 * Cryptorchidism. AHRQ, December 2012), Appendix E p. E-18:
 *
 *   "Thresholds for converting the Newcastle-Ottawa scales to AHRQ standards
 *    (good, fair, and poor):
 *      Good quality: 3 or 4 stars in selection domain AND 1 or 2 stars in
 *        comparability domain AND 2 or 3 stars in outcome/exposure domain
 *      Fair quality: 2 stars in selection domain AND 1 or 2 stars in comparability
 *        domain AND 2 or 3 stars in outcome/exposure domain
 *      Poor quality: 0 or 1 star in selection domain OR 0 stars in comparability
 *        domain OR 0 or 1 stars in outcome/exposure domain"
 *
 * It is PER-DOMAIN, never a total — which is why it can disagree with total-score
 * banding: a study with 7/9 but zero comparability stars is Poor under AHRQ.
 */
export const AHRQ_STANDARD = Object.freeze({
  id: 'ahrq',
  label: 'AHRQ good / fair / poor',
  attribution: 'AHRQ Comparative Effectiveness Review No. 88 (Penson et al., 2012), Appendix E — an AHRQ standard, not part of the Newcastle–Ottawa Scale.',
  citation: 'https://www.ncbi.nlm.nih.gov/books/NBK115843/',
  official: false,
  levels: ['good', 'fair', 'poor'],
});

export const QUALITY_LABELS = Object.freeze({
  good: 'Good quality',
  fair: 'Fair quality',
  poor: 'Poor quality',
});

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Pull the three AHRQ domain inputs out of a scoreAssessment() result. The third
 * domain is 'outcome' on the cohort form and 'exposure' on the case-control form;
 * AHRQ writes "outcome/exposure domain" precisely to cover both.
 * Pure.
 */
function domainTriple(score) {
  const by = (score && score.byDomain) || {};
  return {
    selection: n(by.selection && by.selection.stars),
    comparability: n(by.comparability && by.comparability.stars),
    outcomeExposure: n((by.outcome && by.outcome.stars) != null && by.outcome
      ? by.outcome.stars
      : (by.exposure && by.exposure.stars)),
  };
}

/**
 * Apply the AHRQ rule. Evaluation order matters: Poor is tested FIRST because its
 * clause is a disjunction that overrides an otherwise-good profile.
 * @returns {{ level:'good'|'fair'|'poor', reasons:string[] }}
 * Pure.
 */
export function applyAhrq(score) {
  const d = domainTriple(score);
  const reasons = [
    `Selection ${d.selection}/4`,
    `Comparability ${d.comparability}/2`,
    `Outcome/Exposure ${d.outcomeExposure}/3`,
  ];
  if (d.selection <= 1 || d.comparability === 0 || d.outcomeExposure <= 1) {
    const why = [];
    if (d.selection <= 1) why.push('selection ≤ 1 star');
    if (d.comparability === 0) why.push('no comparability star');
    if (d.outcomeExposure <= 1) why.push('outcome/exposure ≤ 1 star');
    return { level: 'poor', reasons: [...reasons, `Poor: ${why.join('; ')}`] };
  }
  if (d.selection >= 3) return { level: 'good', reasons: [...reasons, 'Good: selection ≥ 3 with comparability ≥ 1 and outcome/exposure ≥ 2'] };
  return { level: 'fair', reasons: [...reasons, 'Fair: selection = 2 with comparability ≥ 1 and outcome/exposure ≥ 2'] };
}

/**
 * Apply project-defined TOTAL-score bands. Bands are [{ max, level, label }]
 * sorted ascending by `max`; the first band whose `max` >= total wins.
 * Pure.
 */
export function applyCustom(score, bands) {
  const total = n(score && score.total);
  const list = (Array.isArray(bands) ? bands : [])
    .filter((b) => b && Number.isFinite(Number(b.max)))
    .slice()
    .sort((a, b) => Number(a.max) - Number(b.max));
  for (const b of list) {
    if (total <= Number(b.max)) {
      return { level: String(b.level || b.label || ''), reasons: [`Total ${total}/${n(score && score.maxStars) || 9} falls in the project-defined band ≤ ${b.max}`] };
    }
  }
  return { level: '', reasons: [`Total ${total} is outside every project-defined band`] };
}

/**
 * interpretNos(score, config) — the ONE entry point a UI or the manuscript should
 * use. Never returns a verdict without saying whose rule produced it.
 *
 * @param {object} score  scoreAssessment() output
 * @param {object} [config]
 *   mode   'none' | 'ahrq' | 'custom'   (default 'none')
 *   bands  [{ max, level, label }]      required for 'custom'
 *   label  string                       display name for a custom scheme
 * @returns {{
 *   mode, level:string, label:string, reasons:string[],
 *   official:false, attribution:string, profile:string, total:number, maxStars:number,
 * }}
 * Pure.
 */
export function interpretNos(score, config = {}) {
  const mode = THRESHOLD_MODES.includes(config.mode) ? config.mode : DEFAULT_THRESHOLD_MODE;
  const base = {
    mode,
    level: '',
    label: '',
    reasons: [],
    // ALWAYS false. There is no official NOS interpretation rule; saying otherwise
    // would be the misattribution §22 exists to prevent.
    official: false,
    attribution: '',
    profile: (score && score.profile) || '',
    total: n(score && score.total),
    maxStars: n(score && score.maxStars) || 9,
  };

  if (mode === 'none') {
    return {
      ...base,
      attribution: 'The Newcastle–Ottawa Scale defines no quality threshold. Only the star profile is reported.',
      reasons: ['No interpretation threshold is applied — the NOS developers define none.'],
    };
  }

  if (mode === 'ahrq') {
    const r = applyAhrq(score);
    return {
      ...base,
      level: r.level,
      label: QUALITY_LABELS[r.level] || r.level,
      reasons: r.reasons,
      attribution: AHRQ_STANDARD.attribution,
    };
  }

  const r = applyCustom(score, config.bands);
  return {
    ...base,
    level: r.level,
    label: config.label ? `${r.level} (${config.label})` : r.level,
    reasons: r.reasons,
    attribution: 'Project-defined threshold. This is your review team\'s rule, not part of the Newcastle–Ottawa Scale.',
  };
}

/**
 * The warning a UI must show if a project ever configures the widely-copied
 * 0–3 / 4–6 / 7–9 bands, so nobody mistakes convention for instrument.
 * Pure.
 */
export const CONVENTIONAL_BANDS_NOTICE =
  'The 0–3 / 4–6 / 7–9 bands are a convention from the secondary literature, not a rule defined by the Newcastle–Ottawa Scale developers. Record them as a project-defined threshold and state them as such in your methods.';

/** The conventional bands, offered ONLY as an explicitly-labelled custom preset. */
export const CONVENTIONAL_BANDS = Object.freeze([
  { max: 3, level: 'poor', label: 'Poor' },
  { max: 6, level: 'moderate', label: 'Moderate' },
  { max: 9, level: 'high', label: 'High' },
]);

export default {
  THRESHOLD_MODES,
  DEFAULT_THRESHOLD_MODE,
  AHRQ_STANDARD,
  QUALITY_LABELS,
  applyAhrq,
  applyCustom,
  interpretNos,
  CONVENTIONAL_BANDS,
  CONVENTIONAL_BANDS_NOTICE,
};
