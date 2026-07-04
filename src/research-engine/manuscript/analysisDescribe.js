/**
 * manuscript/analysisDescribe.js — 73.md Part 8. The ONE shared, pure description
 * of the synthesis model the analysis is actually configured to run, so the
 * manuscript abstract, Methods, Results, the readiness/repro snapshot and the
 * journal-package methods text can never disagree about the model / τ² estimator.
 * (Previously 'DerSimonian–Laird' was hardcoded in three places and silently
 * ignored project.analysisSettings.tau2Method.)
 *
 * BYTE-COMPAT CONTRACT: with the defaults ({model:'random', tau2Method:'DL'})
 * every rendered phrase is EXACTLY the string the generators emitted before this
 * module existed, so regenerating an old draft with no new opts is a no-op.
 * Pure — no DOM/React/network.
 */

import { TAU2_METHODS, TAU2_LABELS } from '../statistics/tau2.js';

/** Lower-case inline phrases for τ² estimators (used mid-sentence). */
export const TAU2_PHRASES = {
  DL: 'DerSimonian–Laird',
  REML: 'restricted maximum likelihood',
  ML: 'maximum likelihood',
  PM: 'Paule–Mandel',
  EB: 'empirical Bayes',
  SJ: 'Sidik–Jonkman',
  HO: 'Hedges–Olkin',
  HS: 'Hunter–Schmidt',
};

/**
 * Resolve the {model, tau2Method} the manuscript should describe.
 * Precedence: opts.analysis ({model, tau2Method} threaded by the caller/UI)
 *   → legacy opts.model + the project's own analysisSettings.tau2Method
 *   → defaults ('random', 'DL').
 * Reading project.analysisSettings keeps the manuscript grounded in what the
 * Analysis tab actually runs even before the caller threads opts.analysis.
 * Unknown estimators clamp to DL (mirrors runMeta's own clamping). Pure.
 */
export function resolveAnalysis(project, opts = {}) {
  const a = (opts && opts.analysis) || {};
  const rawModel = a.model || (opts && opts.model) || 'random';
  const model = rawModel === 'fixed' ? 'fixed' : 'random';
  const projTau2 = project && project.analysisSettings && project.analysisSettings.tau2Method;
  const raw = a.tau2Method || projTau2 || 'DL';
  const tau2Method = TAU2_METHODS.includes(raw) ? raw : 'DL';
  return { model, tau2Method };
}

function heterogeneityMethodLabel(tau2Method) {
  // DL keeps the historical readiness string byte-for-byte (ASCII hyphen included).
  if (tau2Method === 'DL') return 'DerSimonian-Laird (I², τ², Cochran Q)';
  return `${TAU2_LABELS[tau2Method]} (I², τ², Cochran Q)`;
}

/**
 * describeSynthesisModel({model, tau2Method}) → a phrase pack every consumer
 * renders from (never compose these strings anywhere else):
 *   model                'fixed' | 'random' (clamped)
 *   tau2Method           'DL' | 'REML' | … (clamped to TAU2_METHODS)
 *   estimatorLabel       'Restricted maximum likelihood (REML)' (TAU2_LABELS)
 *   estimatorPhrase      'restricted maximum likelihood' (inline, lower case)
 *   short                inline fragment for "a … model": 'fixed-effect' |
 *                        'random-effects (DerSimonian–Laird)' |
 *                        'random-effects (restricted maximum likelihood τ² estimator)'
 *   label                'random-effects model (restricted maximum likelihood τ² estimator)'
 *   methodsPhrase        "were pooled using …": 'an inverse-variance common (fixed)
 *                        effect model' | 'a DerSimonian–Laird random-effects model' |
 *                        'a random-effects model with the … τ² estimator'
 *   heterogeneityMethod  readiness/repro snapshot string (DL keeps legacy text)
 * Pure.
 */
export function describeSynthesisModel(analysis = {}) {
  const model = (analysis && analysis.model) === 'fixed' ? 'fixed' : 'random';
  const raw = analysis && analysis.tau2Method;
  const tau2Method = TAU2_METHODS.includes(raw) ? raw : 'DL';
  const phrase = TAU2_PHRASES[tau2Method];
  if (model === 'fixed') {
    return {
      model,
      tau2Method,
      estimatorLabel: TAU2_LABELS[tau2Method],
      estimatorPhrase: phrase,
      short: 'fixed-effect',
      label: 'fixed-effect model (inverse variance)',
      methodsPhrase: 'an inverse-variance common (fixed) effect model',
      heterogeneityMethod: heterogeneityMethodLabel(tau2Method),
    };
  }
  return {
    model,
    tau2Method,
    estimatorLabel: TAU2_LABELS[tau2Method],
    estimatorPhrase: phrase,
    short: tau2Method === 'DL'
      ? 'random-effects (DerSimonian–Laird)'
      : `random-effects (${phrase} τ² estimator)`,
    label: `random-effects model (${phrase} τ² estimator)`,
    methodsPhrase: tau2Method === 'DL'
      ? 'a DerSimonian–Laird random-effects model'
      : `a random-effects model with the ${phrase} τ² estimator`,
    heterogeneityMethod: heterogeneityMethodLabel(tau2Method),
  };
}

export default { TAU2_PHRASES, resolveAnalysis, describeSynthesisModel };
