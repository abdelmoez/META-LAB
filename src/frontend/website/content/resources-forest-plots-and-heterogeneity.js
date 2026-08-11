/**
 * Content source for /resources/forest-plots-and-heterogeneity.
 *
 * 113.md W1-B — READING guide. /resources/how-to-run-a-meta-analysis owns the
 * "how do I run one" intent (model choice, workflow); this page owns "how do I
 * read the plot and the heterogeneity statistics". Cross-link rather than
 * restate. Statistical claims trace to Higgins 2003, Borenstein 2017,
 * IntHout 2016, Riley 2011, Veroniki 2016.
 */

export default `---
h1: How to read a forest plot
title: Forest Plots and Heterogeneity: How to Read a Meta-Analysis
description: How to read every element of a forest plot, what I-squared, tau-squared and Q measure, and why the fixed-effect and random-effects diamonds differ.
slug: resources/forest-plots-and-heterogeneity
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

A forest plot shows one horizontal line per study — the point estimate as a marker, the confidence interval as the line, the study's weight as the marker's area — against a vertical line of no effect, with a diamond at the bottom whose centre is the pooled estimate and whose width is its confidence interval. Reading one well means reading it in a specific order: the scale, the spread of the studies, the heterogeneity statistics, and only then the diamond.

This guide is about interpretation. For choosing a model and running the analysis, see [how to run a meta-analysis](/resources/how-to-run-a-meta-analysis).

## What is each element of a forest plot?

- **The study label column**, usually first author and year, occasionally with the site or subgroup.
- **The raw data columns** — events and totals, or means, standard deviations and sample sizes, per arm. These are worth reading. They tell you the size of each study and let you sanity-check an estimate that looks implausible.
- **The point estimate marker.** Its position is the study's effect estimate; its **area is proportional to the study's weight**, not to its sample size. Weight is driven by precision, so a large study with a noisy outcome can carry less weight than a smaller one with a precise measurement.
- **The horizontal line** is the confidence interval, conventionally 95%. An arrowhead means the interval extends beyond the plotted range.
- **The vertical line of no effect** sits at 1 for ratio measures and 0 for differences.
- **The diamond** is the pooled estimate: centre at the point estimate, horizontal extremities at the confidence limits. The diamond's height carries no information.
- **A dashed line or a second, wider bar** through the diamond is usually the prediction interval, which is a different quantity and is discussed below.
- **The heterogeneity line** beneath the plot, typically reporting Q with its degrees of freedom and p-value, I-squared, and tau-squared.

### Reading the scale correctly

Ratio measures — odds ratios, risk ratios, hazard ratios — are plotted on a **logarithmic scale**, so that a halving and a doubling are equidistant from the line of no effect. If a ratio plot's axis is linear, the visual impression of the effects is distorted and the plot is wrong.

Check which side favours which arm. The label under the axis is not decorative: for a harmful outcome a ratio below 1 favours the intervention, and for a beneficial outcome it favours the control. Plots have been misread this way in print.

## What order should you read it in?

1. **The axis and its direction.** Everything else depends on it.
2. **The scatter of the study estimates.** Do the confidence intervals overlap substantially? Are studies on both sides of the line of no effect?
3. **The heterogeneity statistics.** These tell you whether a single pooled number is a sensible summary.
4. **The diamond.** Last, and interpreted in the light of step 3.
5. **The weights.** If one study holds most of the weight, the meta-analysis is largely that study with decoration.

Reading the diamond first is the most common error in interpreting a forest plot, because a diamond that excludes the line of no effect looks conclusive regardless of what produced it.

## What do Q, I-squared and tau-squared actually measure?

They are three different things, and only one of them is on the scale of the effect.

**Cochran's Q** is a test statistic: the weighted sum of squared deviations of the study estimates from the pooled estimate. Under the null hypothesis that all studies share one true effect, it follows a chi-square distribution with k minus 1 degrees of freedom. It is a hypothesis test, with the usual consequences — low power when there are few studies, and near-certain significance when there are many. A non-significant Q is not evidence of homogeneity.

**I-squared** is the percentage of the total variability in the estimates that is due to between-study differences rather than to within-study sampling error. It is a **proportion**, not an amount. This is the single most misunderstood statistic in meta-analysis, and the consequence is concrete: if the included studies are very large, their sampling error is tiny, so even a clinically trivial amount of real variation makes I-squared large. Conversely, a set of small studies with genuinely different true effects can produce a modest I-squared.

Borenstein and colleagues state this directly — I-squared is not an absolute measure of heterogeneity — and Rucker and colleagues showed how undue reliance on it misleads. The commonly quoted 25 / 50 / 75 per cent bands come from the original paper as a tentative descriptive aid and were never intended as decision thresholds.

**Tau-squared** is the estimated variance of the true effects across studies, on the scale of the effect measure. Tau, its square root, is the estimated standard deviation of the true effects and is the number that tells you how much the effect actually varies. If your effect measure is a log odds ratio, a tau of 0.1 and a tau of 0.6 describe very different worlds, and I-squared may be identical in both.

Report all three. Tau-squared depends on which estimator was used — DerSimonian-Laird, REML, Paule-Mandel and others give different answers, particularly with few studies — so name the estimator, as Veroniki and colleagues recommend.

## Why do the fixed-effect and random-effects diamonds differ?

Because they estimate different things.

A **fixed-effect** model assumes every study estimates one common true effect and that the only reason estimates differ is sampling error. Weights are the inverse of the within-study variance, so large precise studies dominate. What is being estimated is that single common effect.

A **random-effects** model assumes the true effect varies across studies and that the included studies are a sample from a distribution of true effects. Weights are the inverse of within-study variance plus tau-squared, which pulls the weights toward equality — small studies gain influence, large studies lose it. What is being estimated is the **mean** of the distribution of true effects.

Three practical consequences follow:

- When heterogeneity is zero, tau-squared is zero and the two models give identical results.
- As heterogeneity grows, the random-effects interval widens and small studies gain weight. If the small studies differ systematically from the large ones — which is exactly what publication bias produces — the random-effects estimate moves toward them.
- The choice is a question about what you are estimating, decided in the protocol. It is not a diagnostic to be chosen after inspecting I-squared, and it is certainly not "use random effects if the heterogeneity test is significant".

A useful discipline is to compute both and look at both. If they agree, the model choice was not load-bearing. If they disagree substantially, that disagreement is a finding about the evidence and belongs in the results.

## What is a prediction interval and why does it matter?

The confidence interval around the diamond describes uncertainty about the **mean** true effect. It says nothing about how much the effect varies between settings.

A **prediction interval** describes the range in which the true effect in a new, comparable study is expected to fall. It incorporates tau-squared, so it is always wider than the confidence interval and can be dramatically wider when heterogeneity is substantial. Riley, Higgins and Deeks argue that it is usually the more clinically relevant interval, and IntHout and colleagues make the case for presenting it routinely.

It is common and instructive to see a random-effects meta-analysis whose confidence interval excludes no effect while its prediction interval comfortably includes it. That combination means: on average the intervention works, and we cannot be confident it will work in your setting. Reporting only the confidence interval hides the second half.

Prediction intervals need enough studies to estimate tau-squared with any stability. Below about three studies they are not estimable, and with fewer than five they should be treated as indicative.

## How do you investigate heterogeneity?

Heterogeneity is information about the evidence, not a nuisance to be minimised.

- **Pre-specify the investigations.** Subgroup analyses and meta-regression decided after seeing the plot are hypothesis-generating at best.
- **Subgroup analysis** splits studies by a study-level characteristic and tests whether the subgroups differ. Interpret the between-subgroup test, not the presence or absence of significance within each subgroup separately — that comparison is a well-known fallacy.
- **Meta-regression** relates the effect to a continuous or categorical study-level covariate. It needs roughly ten studies per covariate to be worth fitting, and its results are observational associations across studies, subject to aggregation bias: a relationship at study level need not hold at patient level.
- **Sensitivity analyses** — leave-one-out, restricting to low risk of bias, alternative tau-squared estimators — test whether the conclusion depends on a single choice.
- **Influence diagnostics** identify studies whose removal changes the estimate or the heterogeneity substantially. An influential study is a prompt to check the extraction, not a licence to delete it.

Sometimes the correct response to heterogeneity is not to pool. If the studies are answering meaningfully different questions, a structured narrative synthesis following SWiM is more informative than an average of incommensurable numbers.

## Common failure modes

- **Reading the diamond first.**
- **Treating I-squared as an amount of heterogeneity** rather than a proportion of variability.
- **Using the 25 / 50 / 75 bands as decision rules.**
- **Choosing the model from the heterogeneity test result.**
- **Reporting the confidence interval and omitting the prediction interval** when tau-squared is substantial.
- **A ratio measure on a linear axis.**
- **Not noticing that one study holds 70 per cent of the weight.**
- **Post-hoc subgroups presented as if pre-specified.**

## References

- Higgins JPT, Thompson SG, Deeks JJ, Altman DG. Measuring inconsistency in meta-analyses. *BMJ*. 2003;327:557-560. [doi:10.1136/bmj.327.7414.557](https://doi.org/10.1136/bmj.327.7414.557)
- Higgins JPT, Thompson SG. Quantifying heterogeneity in a meta-analysis. *Statistics in Medicine*. 2002;21(11):1539-1558. [doi:10.1002/sim.1186](https://doi.org/10.1002/sim.1186)
- Borenstein M, Higgins JPT, Hedges LV, Rothstein HR. Basics of meta-analysis: I-squared is not an absolute measure of heterogeneity. *Research Synthesis Methods*. 2017;8(1):5-18. [doi:10.1002/jrsm.1230](https://doi.org/10.1002/jrsm.1230)
- Rucker G, Schwarzer G, Carpenter JR, Schumacher M. Undue reliance on I-squared in assessing heterogeneity may mislead. *BMC Medical Research Methodology*. 2008;8:79. [doi:10.1186/1471-2288-8-79](https://doi.org/10.1186/1471-2288-8-79)
- Riley RD, Higgins JPT, Deeks JJ. Interpretation of random effects meta-analyses. *BMJ*. 2011;342:d549. [doi:10.1136/bmj.d549](https://doi.org/10.1136/bmj.d549)
- IntHout J, Ioannidis JPA, Rovers MM, Goeman JJ. Plea for routinely presenting prediction intervals in meta-analysis. *BMJ Open*. 2016;6:e010247. [doi:10.1136/bmjopen-2015-010247](https://doi.org/10.1136/bmjopen-2015-010247)
- DerSimonian R, Laird N. Meta-analysis in clinical trials. *Controlled Clinical Trials*. 1986;7(3):177-188. [doi:10.1016/0197-2456(86)90046-2](https://doi.org/10.1016/0197-2456(86)90046-2)
- Veroniki AA, Jackson D, Viechtbauer W, et al. Methods to estimate the between-study variance and its uncertainty in meta-analysis. *Research Synthesis Methods*. 2016;7(1):55-79. [doi:10.1002/jrsm.1164](https://doi.org/10.1002/jrsm.1164)
- Lewis S, Clarke M. Forest plots: trying to see the wood and the trees. *BMJ*. 2001;322:1479-1480. [doi:10.1136/bmj.322.7300.1479](https://doi.org/10.1136/bmj.322.7300.1479)
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 10: Analysing data and undertaking meta-analyses. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)

## Doing this in PecanRev

[PecanRev's analysis engine](/features/meta-analysis) computes **both** a fixed-effect and a random-effects estimate for every analysis and shows both, because presenting one silently is how a heterogeneous body of evidence gets reported as homogeneous. Forest plots and funnel plots are generated as SVG from the analysis data.

Every result reports Cochran's Q with its degrees of freedom and chi-square p-value, tau-squared and tau, and I-squared with a descriptive band. A prediction interval is computed when there are at least three studies and is reported as unavailable below that rather than estimated from too little information. Eight tau-squared estimators are available, including DerSimonian-Laird, REML and Paule-Mandel; iterative estimators fall back to DerSimonian-Laird when they cannot converge, and the fallback is reported rather than hidden.

For investigating heterogeneity there is subgroup analysis with a Q-between test, meta-regression with method-of-moments and REML estimators, leave-one-out sensitivity analysis, and influence diagnostics reporting DFFIT and the change in tau-squared and I-squared when each study is removed. Pooled estimates and heterogeneity statistics reach the write-up as live tokens in the [manuscript editor](/features/manuscript), so the results text cannot drift from the plot.
`;
