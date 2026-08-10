/**
 * Content source for /resources/how-to-run-a-meta-analysis.
 * 111.md §9 — cornerstone page. References verified real.
 */

export default `---
h1: How to run a meta-analysis
title: How to Run a Meta-Analysis: Models, Heterogeneity and Interpretation
description: A practical guide to choosing an effect measure, picking a fixed-effect or random-effects model, reading I-squared honestly, and knowing when not to pool.
slug: resources/how-to-run-a-meta-analysis
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

A meta-analysis combines the results of several studies into a single estimate with a confidence interval. It is a statistical procedure, and like any statistical procedure it answers exactly the question you asked it, whether or not that was the question you meant. Most of the skill lies in the decisions made before any pooling happens.

## First decide whether to pool at all

The question is not "are these studies statistically compatible" but "would a single number describing all of them mean anything". Pooling is appropriate when the studies address the same question in populations, interventions, comparators and outcomes that are similar enough for an average effect to be interpretable.

Reasons not to pool:

- The populations differ in ways that plausibly change the effect, not just its precision.
- The interventions differ in dose, delivery or duration enough that they are different interventions.
- The outcome is measured at incomparable timepoints or with instruments that do not map onto each other.
- There are two or three studies, all small, all at high risk of bias. Pooling does not repair them; it produces a spuriously precise summary of unreliable data.

Structured narrative synthesis is a legitimate result. The SWiM guideline exists to make it reportable.

## Choose the effect measure

For **binary outcomes**: risk ratio, odds ratio, or risk difference. Risk ratios are easier for clinicians to interpret; odds ratios are what case-control designs and logistic models give you. Risk differences are absolute and therefore more useful for decision-making, but they transport poorly across populations with different baseline risks.

For **continuous outcomes**: the mean difference when all studies use the same instrument and units, and the standardised mean difference when they do not. SMD has a real cost — it is expressed in standard-deviation units, which most readers cannot interpret clinically, and it is sensitive to the variability of the sample rather than only the size of the effect.

For **time-to-event outcomes**: the hazard ratio, pooled on the log scale.

For **single-arm proportions**: pooled on a transformed scale, because untransformed proportions near 0 or 1 have variance that behaves badly.

Whatever you choose, pool on the scale where the estimator is approximately normal — log scale for ratios — and back-transform for presentation only.

## Fixed effect or random effects?

This is a question about what you are estimating, not about the value of I-squared.

A **fixed-effect** model assumes there is one true effect and that the studies differ only by sampling error. It estimates that single effect. It is defensible when the studies are near-replications — the same protocol in similar populations.

A **random-effects** model assumes the true effect varies across studies and that the studies sample from a distribution of effects. It estimates the mean of that distribution and its between-study variance, tau-squared. For most clinical evidence syntheses, this is the more plausible assumption, and it is the usual default.

Two things follow that are often misunderstood:

- **Choosing the model based on a heterogeneity test is not a valid strategy.** The test has low power with few studies, so "Q was not significant, therefore fixed effect" mostly means "we had five studies".
- **Random effects is not the conservative choice in all circumstances.** It widens the interval, but it also weights small studies relatively more heavily than fixed effect does. If small studies are biased — which is the usual pattern of small-study effects — random effects can move the point estimate in the direction of the bias.

### Estimating tau-squared

DerSimonian-Laird is the historical default and is still the most widely reported. It is known to underestimate between-study variance when the number of studies is small, which makes the confidence interval too narrow. Restricted maximum likelihood and the Paule-Mandel estimator generally perform better in that setting, and several others exist.

Whichever you use, name it in the methods. "A random-effects meta-analysis was performed" does not specify an analysis.

### Hartung-Knapp-Sidik-Jonkman

The HKSJ adjustment replaces the normal-based confidence interval with a t-based one that accounts for the uncertainty in the estimate of tau-squared. With a small number of studies it typically produces a wider, better-calibrated interval, and it is increasingly recommended as the default for random-effects meta-analysis.

It will sometimes turn a significant result non-significant. That is the method working, not a problem with the method — but it does mean the choice must be pre-specified rather than made after seeing both answers.

## Read heterogeneity properly

**Cochran's Q** tests the null hypothesis that all studies share one true effect. It has low power when there are few studies and excessive power when there are many, so its p-value should not drive decisions on its own.

**I-squared** is the percentage of total variability that is due to between-study heterogeneity rather than sampling error. It is a **proportion, not an amount**. This is the most consequential misunderstanding in applied meta-analysis: a set of very precise studies with clinically trivial differences can produce an I-squared above 90%, and a set of small imprecise studies with wildly different effects can produce a low one. I-squared also rises with study precision even when the underlying spread of effects is unchanged.

The rough bands often quoted — 25% low, 50% moderate, 75% high — come with an explicit caution in their source that they are not fixed thresholds.

**Tau and tau-squared** describe the actual spread of true effects, on the scale of the outcome. Tau is more interpretable than I-squared for the question a clinician usually has, which is "how much do effects differ".

**The prediction interval** is the most useful single summary of heterogeneity and the most under-reported. It gives the range in which the true effect of a future study is expected to lie. A meta-analysis whose confidence interval excludes the null but whose prediction interval comfortably includes it is telling you something important, and the confidence interval alone will not tell you.

Report a prediction interval whenever there are enough studies to estimate one — conventionally at least three, and preferably more.

## Investigate heterogeneity, do not just measure it

- **Subgroup analysis** compares pooled effects across pre-specified groups with a test for interaction between them. Post-hoc subgroups are hypothesis-generating and must be labelled as such. Subgroup analyses with a handful of studies per group are usually uninformative.
- **Meta-regression** relates the effect size to study-level covariates. It requires a reasonable number of studies — roughly ten per covariate is the usual rule of thumb — and it is vulnerable to ecological bias: a study-level association is not evidence about individual patients.
- **Sensitivity analysis** tests whether the conclusion depends on a debatable decision — excluding high-risk-of-bias studies, changing the tau-squared estimator, or leave-one-out. Leave-one-out is also a useful influence diagnostic: if removing one study changes the conclusion, say so.

## Small-study effects and publication bias

A funnel plot displays effect size against precision. Asymmetry is *consistent with* publication bias, and also with poor methodological quality in small studies, true heterogeneity related to study size, and chance. Reading asymmetry as proof of publication bias is a standard over-interpretation.

**Egger's test** tests funnel-plot asymmetry formally. It has low power and should not be used with fewer than about ten studies.

**Trim-and-fill** imputes hypothetical missing studies and recomputes the estimate. It is best treated as a sensitivity analysis — "if studies were missing in this pattern, the estimate would be this" — and not as a bias-corrected result.

None of these methods detects publication bias. They detect asymmetry.

## Reporting

At minimum, report the effect measure and the model, the tau-squared estimator, whether HKSJ was used, the number of studies and participants, the pooled estimate with its confidence interval, tau-squared, I-squared and Q, a prediction interval where estimable, the forest plot, the heterogeneity investigations you pre-specified, the small-study-effect assessment, and the certainty of the evidence, usually via GRADE.

Deviations from the protocol get reported as deviations.

## References

- Borenstein M, Hedges LV, Higgins JPT, Rothstein HR. *Introduction to Meta-Analysis*, 2nd edition. Wiley; 2021.
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5, chapter 10 (Analysing data and undertaking meta-analyses). Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- DerSimonian R, Laird N. Meta-analysis in clinical trials. *Controlled Clinical Trials*. 1986;7(3):177-188. [doi:10.1016/0197-2456(86)90046-2](https://doi.org/10.1016/0197-2456%2886%2990046-2)
- Higgins JPT, Thompson SG. Quantifying heterogeneity in a meta-analysis. *Statistics in Medicine*. 2002;21(11):1539-1558. [doi:10.1002/sim.1186](https://doi.org/10.1002/sim.1186)
- Higgins JPT, Thompson SG, Spiegelhalter DJ. A re-evaluation of random-effects meta-analysis. *Journal of the Royal Statistical Society Series A*. 2009;172(1):137-159. [doi:10.1111/j.1467-985X.2008.00552.x](https://doi.org/10.1111/j.1467-985X.2008.00552.x)
- IntHout J, Ioannidis JPA, Borm GF. The Hartung-Knapp-Sidik-Jonkman method for random effects meta-analysis is straightforward and considerably outperforms the standard DerSimonian-Laird method. *BMC Medical Research Methodology*. 2014;14:25. [doi:10.1186/1471-2288-14-25](https://doi.org/10.1186/1471-2288-14-25)
- IntHout J, Ioannidis JPA, Rovers MM, Goeman JJ. Plea for routinely presenting prediction intervals in meta-analysis. *BMJ Open*. 2016;6:e010247. [doi:10.1136/bmjopen-2015-010247](https://doi.org/10.1136/bmjopen-2015-010247)
- Egger M, Davey Smith G, Schneider M, Minder C. Bias in meta-analysis detected by a simple, graphical test. *BMJ*. 1997;315(7109):629-634. [doi:10.1136/bmj.315.7109.629](https://doi.org/10.1136/bmj.315.7109.629)
- Duval S, Tweedie R. Trim and fill: a simple funnel-plot-based method of testing and adjusting for publication bias in meta-analysis. *Biometrics*. 2000;56(2):455-463. [doi:10.1111/j.0006-341x.2000.00455.x](https://doi.org/10.1111/j.0006-341x.2000.00455.x)
- Campbell M, McKenzie JE, Sowden A, et al. Synthesis without meta-analysis (SWiM) in systematic reviews: reporting guideline. *BMJ*. 2020;368:l6890. [doi:10.1136/bmj.l6890](https://doi.org/10.1136/bmj.l6890)

## In PecanRev

The [meta-analysis engine](/features/meta-analysis) computes both models for every analysis, offers eight tau-squared estimators with HKSJ intervals, reports Q, tau-squared, I-squared and a prediction interval, and warns when the HKSJ adjustment changes significance. It also publishes what it does not implement, so you can choose your tooling before designing the analysis.
`;
