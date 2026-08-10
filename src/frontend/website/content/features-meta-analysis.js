/**
 * Content source for /features/meta-analysis.
 * 111.md §8 "Never advertise unsupported analyses" — the "What PecanRev does
 * not do" section is load-bearing. Sourced from src/research-engine/statistics/*
 * and src/research-engine/docs/methods-content.js.
 */

export default `---
h1: Meta-analysis, run on the data you extracted
title: Meta-Analysis Software for Systematic Reviews | PecanRev
description: Pool effect sizes with fixed and random-effects models, eight tau-squared estimators, HKSJ intervals, subgroup analysis, meta-regression and network meta-analysis.
slug: features/meta-analysis
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

The analysis engine runs on the data you extracted, in the same project, with the same audit trail. There is no export to a statistics package and no re-keying of numbers. This page lists what the engine computes — and, just as importantly, what it does not, because a review team needs to know before they design the analysis, not after.

## Effect measures

PecanRev computes and pools eight effect measure types: standardised mean difference, mean difference, odds ratio, risk ratio, hazard ratio, correlation, proportion, and a diagnostic odds ratio from a two-by-two table. A catalogue of effect-size conversion recipes handles the common cases where studies report an outcome in a form other than the one you are pooling.

## Pooling models

Both a fixed-effect (inverse-variance) and a random-effects estimate are computed for every analysis, and both are shown. Presenting one model silently is how a heterogeneous body of evidence gets reported as if it were homogeneous.

### Eight tau-squared estimators

Between-study variance can be estimated with DerSimonian-Laird (the default), restricted maximum likelihood, maximum likelihood, Paule-Mandel, empirical Bayes, Sidik-Jonkman, Hunter-Schmidt, or Hedges-Olkin. Iterative estimators fall back to DerSimonian-Laird when there are fewer than three studies or when the iteration does not converge, and the fallback is reported rather than hidden.

### Hartung-Knapp-Sidik-Jonkman

An HKSJ-adjusted, t-based confidence interval is produced alongside every random-effects result whenever there are at least two studies. Because HKSJ can widen an interval enough to change the qualitative conclusion, the interface raises an explicit warning when the adjustment flips statistical significance. That warning is the point of the method.

## Heterogeneity

Every result reports Cochran's Q with its chi-square p-value and degrees of freedom, tau-squared and tau, and I-squared with a descriptive band — low, moderate, substantial or considerable. A prediction interval is computed when there are at least three studies; below that it is reported as unavailable rather than estimated from too little information.

## Plots

Forest plots and funnel plots are generated as SVG from the analysis data, with an Egger regression overlay available on the funnel plot.

## Publication bias and small-study effects

- **Egger's regression test** — the canonical unweighted ordinary-least-squares form, matching the standard reference implementation. Returned as unavailable below three studies.
- **Trim-and-fill** — returns the imputed studies and the adjusted pooled estimate.

## Subgroups, moderators and sensitivity

- **Subgroup analysis** with a Q-between test, groupable by extraction fields including the denominator population and action-status fields used in proportion reviews.
- **Meta-regression** with two estimators, method of moments and REML, supporting both continuous and categorical moderators.
- **Leave-one-out** sensitivity analysis, available from three studies upward.
- **Influence diagnostics** reporting DFFIT, the drop in tau-squared and the drop in I-squared when each study is removed, with an influential-study flag.

## Proportion and single-arm meta-analysis

Single-arm proportion meta-analysis is supported using a logit transform. Estimates whose denominators or action statuses are incompatible are blocked from being pooled together until the conflict is resolved, with a documented override that has to be signed for explicitly. Pooling "proportion of patients tested" with "proportion of patients with a management change" produces a number that means nothing, so the engine refuses by default.

## Network meta-analysis

The network meta-analysis engine is frequentist, with fixed-effect and random-effects (DerSimonian-Laird) options. It provides network geometry, inconsistency assessment, and a contribution matrix showing how much each direct comparison contributes to each network estimate.

Treatment ranking uses the **P-score** of Rucker and Schwarzer, the frequentist analogue of SUCRA. We call it a P-score because that is what it is.

## What PecanRev does not do

Publishing this list is deliberate. A review team should choose its tooling knowing the boundaries.

- **Begg's rank correlation test is not implemented.** Only Egger's test and trim-and-fill are available for small-study effects.
- **SUCRA is not implemented.** Network rankings are P-scores, which are closely related but not the same statistic and should not be reported under the other name.
- **Bivariate and HSROC models for diagnostic test accuracy are not implemented.** The diagnostic effect type computes a diagnostic odds ratio from a two-by-two table, which collapses sensitivity and specificity into a single number and hides the threshold. If your review's primary question is diagnostic accuracy, use a package that fits the bivariate model.
- **Bayesian network meta-analysis is not available.** The NMA engine is frequentist only.
- **Freeman-Tukey double-arcsine transformation and GLMM pooling of proportions are not implemented.** Proportion pooling is logit-transform only.
- **Network and ranking plots are not included in the Word export** and have to be exported separately.

## Analysis and the write-up stay connected

Pooled estimates, heterogeneity statistics and study counts reach the write-up as live fact tokens in the [manuscript editor](/features/manuscript), so Results and Abstract cannot disagree with each other.

One current limitation to plan around: the manuscript pipeline does not apply analysis-tab filters, so a filtered analysis view and the generated draft can report different study counts. Check the count in the draft against the analysis you intend to report.

New to pooling? Start with our guide on [how to run a meta-analysis](/resources/how-to-run-a-meta-analysis), or see where the input data comes from in [data extraction](/features/data-extraction).
`;
