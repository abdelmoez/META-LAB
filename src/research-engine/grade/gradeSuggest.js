/**
 * gradeSuggest.js — P12. Evidence-linked GRADE domain SUGGESTIONS.
 *
 * Consolidates the domain heuristics that previously lived inline in the monolith
 * (gradeSuggestions in src/frontend/workspace/projectHelpers.js) into one pure,
 * testable module. Every output is explicitly a SUGGESTION (source:'auto') for the
 * reviewer to accept or override — never a final certainty judgment, and never
 * described to the user as "AI". Risk of bias is delegated to the existing
 * RoB→GRADE mapper (summariseRobForGrade) so the auto-suggestion stays consistent
 * with the Risk of Bias tab.
 *
 * (RoadMap/2.md recs) The line of no effect is measure-specific: 0 on the analysis
 * scale for log/additive measures, but 0.5 for an AUC / C-statistic (no
 * discrimination). It is read from ES_TYPES.nullVal so imprecision is judged
 * against the correct null.
 *
 * Thresholds are standard, published GRADE operationalisations — documented per
 * domain below; nothing is invented.
 *
 * Pure: no Prisma / Express / React / Date.now() / randomness.
 */
import { ES_TYPES } from '../project-model/monolithConstants.js';

/** Deterministic p-value formatter for reason text (no rounding of the decision). */
function fmtP(p) {
  if (p == null || isNaN(p)) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

/**
 * Risk of bias — reuse the RoB→GRADE summary (summariseRobForGrade output).
 * The mapping (mostly-low → not serious; any high / some-concerns majority →
 * serious; high in ≥ half → very serious) lives in rob/gradeSync.js and is not
 * duplicated here. When no assessment is finalised the suggestion is null.
 */
export function suggestRob(robSummary) {
  if (!robSummary || robSummary.suggestedRating == null) {
    return {
      suggest: null,
      reason: (robSummary && robSummary.reason) ||
        'No finalised risk-of-bias assessments yet — complete the Risk of Bias tab and GRADE can suggest this domain automatically.',
      source: 'auto',
      domain: 'rob',
      signature: robSummary && robSummary.signature,
    };
  }
  return {
    suggest: robSummary.suggestedRating,
    reason: robSummary.reason,
    source: 'auto',
    domain: 'rob',
    signature: robSummary.signature,
  };
}

/**
 * Inconsistency — from between-study heterogeneity (I²) and the Q-test.
 * GRADE guidance (Guyatt GH et al. GRADE guidelines: 7. Rating the quality of
 * evidence—inconsistency. J Clin Epidemiol. 2011;64:1294-302) judges inconsistency
 * from the spread of point estimates, CI overlap, I² and the heterogeneity p-value.
 * We use the same I² bands the meta-analysis engine reports (I2desc): I² ≥ 75%
 * (considerable) → very serious; I² ≥ 50% (substantial) → serious; otherwise not
 * serious. A single study (no meta result) cannot show inconsistency → null.
 */
export function suggestInconsistency(meta) {
  if (!meta) {
    return { suggest: null, source: 'auto', domain: 'inconsistency',
      reason: 'Inconsistency needs at least two pooled studies. With 0–1 studies heterogeneity cannot be assessed.' };
  }
  const I2 = Number(meta.I2);
  if (I2 >= 75) {
    return { suggest: 'very_serious', source: 'auto', domain: 'inconsistency',
      reason: `I² = ${Math.round(I2)}% (considerable heterogeneity) — results are highly inconsistent across studies.` };
  }
  if (I2 >= 50) {
    const q = meta.Qpval;
    const qtxt = q == null ? '' : ` with Q-test p ${q < 0.05 ? '< 0.05' : '= ' + q.toFixed(2)}`;
    return { suggest: 'serious', source: 'auto', domain: 'inconsistency',
      reason: `I² = ${Math.round(I2)}% (substantial heterogeneity)${qtxt}.` };
  }
  return { suggest: 'not_serious', source: 'auto', domain: 'inconsistency',
    reason: `I² = ${Math.round(I2)}% (${meta.I2desc || 'low-to-moderate'} heterogeneity) indicates reasonably consistent results.` };
}

/**
 * Indirectness — always a reviewer judgment (suggest:null). Indirectness reflects
 * how well the studies' population/intervention/comparator/outcome match the review
 * question, plus indirect comparisons — none of which can be read off the numbers.
 * (Guyatt GH et al. GRADE guidelines: 8. Rating the quality of evidence—
 * indirectness. J Clin Epidemiol. 2011;64:1303-10.) We surface PICO-anchored
 * guidance text but never a rating.
 */
export function suggestIndirectness(pico) {
  const p = pico || {};
  const bits = [];
  if (p.P) bits.push(`population (“${String(p.P).slice(0, 60)}”)`);
  if (p.I) bits.push('intervention/exposure');
  if (p.C) bits.push('comparator');
  if (p.O) bits.push('outcome');
  const anchor = bits.length
    ? `Check that each study's ${bits.join(', ')} directly matches your question`
    : 'Check that the studies\' population, intervention, comparator and outcome directly match your question';
  return {
    suggest: null,
    source: 'auto',
    domain: 'indirectness',
    reason: `${anchor}. Downgrade for indirect populations, interventions, comparators, surrogate outcomes, or indirect (across-study) comparisons — a judgment only the reviewer can make.`,
  };
}

/**
 * Imprecision — from the width/position of the CI and the amount of information.
 * GRADE guidance (Guyatt GH et al. GRADE guidelines: 6. Rating the quality of
 * evidence—imprecision. J Clin Epidemiol. 2011;64:1283-93) downgrades when the CI
 * is wide enough to include appreciably different decisions — operationalised here
 * as the 95% CI crossing the line of no effect — and/or when the total information
 * falls short of the Optimal Information Size (OIS).
 *
 * On the analysis scale runMeta returns, the null is 0 for every measure except a
 * single-arm proportion (PROP, logit scale — no null), so "CI crosses null" is
 * simply lo95 < 0 < hi95. The number of studies (k < 5) is used as a transparent
 * PROXY for below-OIS information size: full OIS needs event counts / a target
 * effect and MID, which are not available at this layer — the reason says so.
 */
export function suggestImprecision(meta, esType) {
  if (!meta) {
    return { suggest: null, source: 'auto', domain: 'imprecision',
      reason: 'Imprecision needs a pooled estimate (at least two studies with effect sizes and CIs).' };
  }
  const k = Number(meta.k);
  const isProp = String(esType || '').toUpperCase() === 'PROP';
  // Measure-specific line of no effect (0 for log/additive on the analysis scale;
  // 0.5 for AUC). Unknown/blank measures keep the historical null of 0.
  const meas = ES_TYPES[String(esType || '').toUpperCase()] || {};
  const nv = (meas.nullVal != null) ? meas.nullVal : 0;
  const crosses = !isProp && Number(meta.lo95) < nv && Number(meta.hi95) > nv;
  const fewStudies = k < 5;
  const oisNote = ' Formal imprecision also depends on the Optimal Information Size (total events/sample vs a target effect and minimally important difference) — confirm the information size before finalising.';

  if (crosses && fewStudies) {
    return { suggest: 'very_serious', source: 'auto', domain: 'imprecision',
      reason: `Few studies (k = ${k}) and the 95% CI crosses the line of no effect — the pooled estimate is very imprecise.${oisNote}` };
  }
  if (crosses) {
    return { suggest: 'serious', source: 'auto', domain: 'imprecision',
      reason: `The 95% CI crosses the line of no effect, so the result is consistent with both benefit and harm.${oisNote}` };
  }
  if (fewStudies) {
    return { suggest: 'serious', source: 'auto', domain: 'imprecision',
      reason: `Only ${k} stud${k === 1 ? 'y' : 'ies'} pooled — the information size is likely below the Optimal Information Size, so precision is limited.${oisNote}` };
  }
  return { suggest: 'not_serious', source: 'auto', domain: 'imprecision',
    reason: `The 95% CI ${isProp ? 'is reasonably narrow' : 'excludes the line of no effect'} and ${k} studies were pooled.${oisNote}` };
}

/**
 * Publication bias — from small-study effects (Egger's test) and the number of
 * studies. GRADE guidance (Guyatt GH et al. GRADE guidelines: 5. Rating the quality
 * of evidence—publication bias. J Clin Epidemiol. 2011;64:1277-82) rates down when
 * publication bias is *strongly suspected* — e.g. an asymmetric funnel / significant
 * small-study effect, a body of small industry-funded trials, or known unpublished
 * studies. A significant Egger's test (p < 0.05, needs k ≥ 3) → serious.
 *
 * Deliberately, having fewer than 10 studies is NOT auto-downgraded: with < 10
 * studies funnel/Egger tests are unreliable (Cochrane Handbook §13.3.5.1), so
 * publication bias cannot be *assessed* — but GRADE cautions against downgrading on
 * study count alone. We surface that as a not-serious suggestion with a reason
 * asking the reviewer to judge it qualitatively. (This is a documented refinement of
 * the legacy heuristic, which downgraded to serious purely for k < 10.)
 */
export function suggestPublicationBias(meta, egger) {
  if (!meta) {
    return { suggest: null, source: 'auto', domain: 'publicationBias',
      reason: 'Publication bias needs a pooled estimate (at least two studies).' };
  }
  const k = Number(meta.k);
  if (egger && egger.pval != null && egger.pval < 0.05) {
    return { suggest: 'serious', source: 'auto', domain: 'publicationBias',
      reason: `Egger's test is significant (p = ${fmtP(egger.pval)}), indicating funnel-plot asymmetry / small-study effects — publication bias is suspected.` };
  }
  if (k < 10) {
    return { suggest: 'not_serious', source: 'auto', domain: 'publicationBias',
      reason: `With only ${k} stud${k === 1 ? 'y' : 'ies'} (< 10), funnel-plot and Egger's tests are unreliable, so publication bias cannot be formally assessed. Not downgraded on study count alone (per GRADE guidance) — judge qualitatively (predominance of small studies, industry funding, unregistered or unpublished trials).` };
  }
  return { suggest: 'not_serious', source: 'auto', domain: 'publicationBias',
    reason: `No strong signal of small-study effects (${k} studies${egger && egger.pval != null ? `, Egger's p = ${fmtP(egger.pval)}` : ''}).` };
}

/**
 * suggestDomains({ robSummary, meta, pico, design, egger, esType }) → per-domain
 * suggestions for the five down-rating domains.
 *
 * @param {object}  robSummary  output of summariseRobForGrade(assessments).
 * @param {object}  meta        output of runMeta(studies) (or null).
 * @param {object}  pico        PICO object ({P,I,C,O,studyDesign}) for indirectness text.
 * @param {string}  design      optional design descriptor (unused for suggestions;
 *                              start level is derived separately via startLevelForDesign).
 * @param {object}  egger       optional eggersTest(studies) output; also read from meta.egger.
 * @param {string}  esType      optional effect-measure code; also read from meta.esType.
 * @returns {{ rob, inconsistency, indirectness, imprecision, publicationBias }}
 *   Each value is { suggest, reason, source, domain }. indirectness.suggest is
 *   always null (reviewer-only).
 */
export function suggestDomains({ robSummary, meta, pico, design, egger, esType } = {}) {
  const eg = egger || (meta && meta.egger) || null;
  const et = esType || (meta && meta.esType) || (pico && pico.esType) || '';
  return {
    rob: suggestRob(robSummary),
    inconsistency: suggestInconsistency(meta),
    indirectness: suggestIndirectness(pico),
    imprecision: suggestImprecision(meta, et),
    publicationBias: suggestPublicationBias(meta, eg),
  };
}

export const GRADE_SUGGEST_VERSION = 'v1';
