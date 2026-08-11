/**
 * Content source for /resources/publication-bias.
 *
 * 113.md W1-B — small-study effects guide. Sources: Egger 1997, Begg 1994,
 * Duval & Tweedie 2000, Sterne 2011 (BMJ d4002), Peters 2006, Page 2021 (RSM).
 * The product section must repeat the shipped limitation that Begg's test is
 * NOT implemented in PecanRev.
 */

export default `---
h1: Publication bias and small-study effects
title: Publication Bias: Funnel Plots, Egger's Test and Trim-and-Fill
description: What publication bias is, how to read a funnel plot, when Egger's and Begg's tests are informative, and what trim-and-fill can and cannot correct.
slug: resources/publication-bias
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Publication bias is the distortion that arises when whether a study is published, and how prominently, depends on what it found. Studies with statistically significant or striking results are more likely to be published, published faster, and published in journals a reviewer will find, so a meta-analysis of the published literature systematically overestimates the effect. It is one member of a family of reporting biases that also includes selective outcome reporting, time-lag bias, language bias and duplicate publication.

The honest framing is that you cannot measure publication bias from the studies you found. Every available method infers something about the studies you did not find, from the pattern of the ones you did — and every method rests on assumptions that are frequently violated.

## What is the difference between publication bias and small-study effects?

A funnel plot and its tests detect **small-study effects**: the tendency for smaller studies to show larger effects than larger ones. Publication bias is one explanation for that pattern. It is not the only one.

Alternatives that produce identical funnel asymmetry:

- **Genuine clinical heterogeneity.** Small early trials often recruit higher-risk patients, deliver the intervention more intensively, or use shorter follow-up — all of which can genuinely produce larger effects.
- **Poorer methodological quality in small studies.** Inadequate allocation concealment and unblinded outcome assessment both inflate effects, and both are more common in small trials.
- **Chance**, particularly with few studies.
- **The choice of effect measure.** Some measures produce artefactual funnel asymmetry through a mathematical association between the estimate and its standard error — the odds ratio is the classic case for rare events.

Sterne and colleagues make this point central in their guidance: funnel asymmetry should prompt an investigation of possible causes, not an announcement of publication bias.

## How do you read a funnel plot?

A funnel plot scatters each study's effect estimate on the horizontal axis against a measure of its precision on the vertical axis, conventionally the standard error inverted so that the most precise studies sit at the top. Under no bias and no heterogeneity, the scatter is a symmetrical inverted funnel: precise studies cluster tightly near the pooled effect, imprecise studies spread out below.

Practical points that change what you see:

- **Plot the standard error on the vertical axis**, not the sample size or its inverse — Sterne and Egger compared the options and recommended the standard error, because the pseudo-confidence-interval contours are then straight lines.
- **Ratio measures go on a log scale** horizontally, for the same reason as in a forest plot.
- **Contour-enhanced funnel plots** shade the regions of statistical significance. If the studies missing from the sparse side of the funnel would have fallen in the non-significant region, publication bias is a plausible explanation; if the gap is in an already-significant region, it is not, and heterogeneity becomes the likelier account. This single addition does more interpretive work than any of the statistical tests.
- **Do not draw a funnel plot with fewer than about ten studies.** Below that the eye reliably invents asymmetry that is not there, and the tests have no power.

Funnel plot interpretation is subjective, and studies of reader agreement have found it poor. Treat it as a prompt for investigation rather than as evidence.

## When are Egger's and Begg's tests informative?

**Egger's regression test** regresses the effect estimate divided by its standard error on the inverse of the standard error — equivalently, it tests whether the intercept of a regression of the standardised effect on precision differs from zero. A non-zero intercept indicates asymmetry. It is the more powerful of the two classic tests and the most widely reported.

**Begg's rank correlation test** correlates the standardised effect estimates with their variances. It makes fewer distributional assumptions and has consistently lower power, which is why it has largely fallen out of routine use.

The conditions under which either is worth running:

- **At least ten studies.** Below that, power is so low that a non-significant result carries no information at all. Reporting "no evidence of publication bias (Egger p = 0.4)" from six studies is a statement about the test's power, not about the literature.
- **Substantial variation in study size.** If every study is roughly the same size there is no precision gradient to detect.
- **Low to moderate heterogeneity.** Heterogeneity inflates the false-positive rate of asymmetry tests.
- **A suitable effect measure.** For dichotomous outcomes with rare events, the standard Egger test is anti-conservative. Peters and colleagues proposed a modified test using the inverse of the total sample size, and Harbord's modified test addresses the same problem; both are preferable to the standard test in that setting.

A significant test means asymmetry, not bias. A non-significant test with ten studies means very little.

## What can trim-and-fill actually fix?

Trim-and-fill, from Duval and Tweedie, works in two stages. It trims the asymmetric outlying studies from the side of the funnel where studies appear to be over-represented, estimates the pooled effect from the remaining symmetric core, then fills the plot by imputing mirror-image counterparts for the trimmed studies and recomputes the estimate including them.

What it is good for: a **sensitivity analysis**. If the adjusted estimate is close to the original, the conclusion is robust to one plausible model of publication bias. That is a genuinely useful thing to report.

What it is not: a correction. Four limitations matter.

- **It assumes the asymmetry is caused by suppression** of studies at one extreme. If the asymmetry comes from heterogeneity, trim-and-fill imputes studies that never existed and adjusts toward a value with no interpretation. Terrin and colleagues showed it performs poorly under heterogeneity.
- **The imputed studies are fabrications.** They are a mathematical device, and they should never be plotted without being visually distinguished from real data.
- **It can adjust in the wrong direction** when the true model is not suppression.
- **It has no power advantage** over the tests: with few studies it usually imputes nothing, which is not reassurance.

Report the adjusted estimate as a sensitivity analysis alongside the unadjusted one, and never as the primary result.

Other approaches exist — selection models that explicitly parameterise the probability of publication as a function of the p-value, and limit meta-analysis, which extrapolates to the estimate a study of infinite size would have produced. They rest on their own assumptions, and none of them recovers data that was never published.

## What actually reduces reporting bias?

The methods above are diagnostics applied after the fact. The things that reduce the underlying problem happen during the review:

- **Search trial registries.** ClinicalTrials.gov and the WHO ICTRP reveal completed studies that were never published, and registered protocols reveal outcomes that were measured and not reported.
- **Search grey literature** — theses, conference abstracts, agency reports.
- **Do not restrict by language** without a justification.
- **Compare each publication against its registration** for outcome switching. Selective outcome reporting within a published study is invisible to every funnel-plot method, and it is at least as common as non-publication.
- **Contact authors** for unreported outcomes.

## How should publication bias be reported?

PRISMA 2020 asks you to describe the methods used to assess the risk of bias due to missing results, and to report the assessment. Concretely:

- State in the protocol what you will do and at what threshold — "a contour-enhanced funnel plot and Egger's test if at least ten studies contribute" is a complete pre-specification.
- If you have fewer than ten studies, say that assessment was not possible. Do not run the test and report the p-value anyway.
- Present the funnel plot, contour-enhanced where possible.
- Report the test used, its statistic and its p-value, and state explicitly that asymmetry has several possible causes.
- Report trim-and-fill, if used, as a sensitivity analysis with both estimates.
- Feed the conclusion into the GRADE publication-bias domain for that outcome.

## Common failure modes

- **Running a funnel plot on six studies** and drawing a conclusion either way.
- **Equating asymmetry with publication bias** and never considering heterogeneity or study quality.
- **Reporting the trim-and-fill estimate as the result.**
- **A plain funnel plot where a contour-enhanced one would have settled the question.**
- **Sample size on the vertical axis**, which distorts the contours.
- **Using the standard Egger test with rare binary events** where a modified test is indicated.
- **Assessing publication bias while never searching a trial registry**, which addresses the actual cause.

## References

- Egger M, Davey Smith G, Schneider M, Minder C. Bias in meta-analysis detected by a simple, graphical test. *BMJ*. 1997;315:629-634. [doi:10.1136/bmj.315.7109.629](https://doi.org/10.1136/bmj.315.7109.629)
- Begg CB, Mazumdar M. Operating characteristics of a rank correlation test for publication bias. *Biometrics*. 1994;50(4):1088-1101. [doi:10.2307/2533446](https://doi.org/10.2307/2533446)
- Duval S, Tweedie R. Trim and fill: a simple funnel-plot-based method of testing and adjusting for publication bias in meta-analysis. *Biometrics*. 2000;56(2):455-463. [doi:10.1111/j.0006-341X.2000.00455.x](https://doi.org/10.1111/j.0006-341X.2000.00455.x)
- Sterne JAC, Sutton AJ, Ioannidis JPA, et al. Recommendations for examining and interpreting funnel plot asymmetry in meta-analyses of randomised controlled trials. *BMJ*. 2011;343:d4002. [doi:10.1136/bmj.d4002](https://doi.org/10.1136/bmj.d4002)
- Sterne JAC, Egger M. Funnel plots for detecting bias in meta-analysis: guidelines on choice of axis. *Journal of Clinical Epidemiology*. 2001;54(10):1046-1055. [doi:10.1016/S0895-4356(01)00377-8](https://doi.org/10.1016/S0895-4356(01)00377-8)
- Peters JL, Sutton AJ, Jones DR, Abrams KR, Rushton L. Comparison of two methods to detect publication bias in meta-analysis. *JAMA*. 2006;295(6):676-680. [doi:10.1001/jama.295.6.676](https://doi.org/10.1001/jama.295.6.676)
- Terrin N, Schmid CH, Lau J, Olkin I. Adjusting for publication bias in the presence of heterogeneity. *Statistics in Medicine*. 2003;22(13):2113-2126. [doi:10.1002/sim.1461](https://doi.org/10.1002/sim.1461)
- Page MJ, Sterne JAC, Higgins JPT, Egger M. Investigating and dealing with publication bias and other reporting biases in meta-analyses of health research: a review. *Research Synthesis Methods*. 2021;12(2):248-259. [doi:10.1002/jrsm.1468](https://doi.org/10.1002/jrsm.1468)
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 13: Assessing risk of bias due to missing results in a synthesis. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)

## Doing this in PecanRev

[PecanRev's analysis engine](/features/meta-analysis) generates funnel plots as SVG with an optional Egger regression overlay, and implements **Egger's test** in the canonical unweighted ordinary-least-squares form, returned as unavailable below three studies. **Trim-and-fill** is implemented and returns both the imputed studies and the adjusted pooled estimate, so it can be reported as the sensitivity analysis it is.

Two limits are worth knowing before you plan the analysis. **Begg's rank correlation test is not implemented** — Egger's test and trim-and-fill are the available small-study-effect methods. Neither is the modified Peters or Harbord test for rare binary events, so a review with rare events should compute that test elsewhere.

Upstream, the [search engine](/features/search-engine) compiles queries for ClinicalTrials.gov and the WHO ICTRP alongside the bibliographic databases, and can run ClinicalTrials.gov automatically — registry searching being the part of reporting-bias assessment that addresses the cause rather than the symptom. For interpreting the plots themselves, see [forest plots and heterogeneity](/resources/forest-plots-and-heterogeneity).
`;
