/**
 * Content source for /features/network-meta-analysis — 113 W1-A.
 *
 * Claims verified against src/research-engine/statistics/nma/{index,frequentist,
 * contrasts,inconsistency,contribution,geometry}.js, server/controllers/
 * nmaController.js, src/frontend/workspace/tabs/nmaTab.jsx,
 * src/shared/opsSettingsCatalog.js, src/research-engine/engine-registry/
 * engines.js, src/research-engine/manuscript/exportValidation.js and
 * docs/manager/nma-p2.md. Deliberately conservative: the "does not do" list is
 * that doc's own deferred-work list, and the validation section repeats its
 * caveat that the external netmeta oracle was not run.
 */

export default `---
h1: Network meta-analysis, frequentist and fully declared
title: Network Meta-Analysis Software for Systematic Reviews | PecanRev
description: A frequentist network meta-analysis engine with league tables, P-score ranking, node-splitting, design-by-treatment inconsistency and a contribution matrix.
slug: features/network-meta-analysis
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

PecanRev includes a frequentist network meta-analysis engine that compares three or more treatments by combining direct and indirect evidence. It produces a league table, P-score rankings, network geometry, node-split and global inconsistency assessment, and a contribution matrix showing how much each direct comparison contributes to each network estimate. It is a deterministic engine with a declared model and a published list of what it does not do — including no Bayesian mode, because a resampled frequentist estimate dressed up as a posterior would be a lie.

## What is network meta-analysis?

Network meta-analysis pools evidence across a connected set of treatments so that treatments never compared head to head can still be compared, through their shared comparators. If trials compare A with B and B with C, the network yields an estimate for A versus C that borrows strength from both. It is the right tool when a clinical question is "which of these several options", and the wrong tool when the trials are too clinically different for indirect comparison to be credible — a judgement no software can make for you.

## What does the engine compute?

Every run returns one result object containing:

- **Counts** — studies, treatments, direct comparisons, participants, how many studies are multi-arm, and whether a continuity correction was applied.
- **Heterogeneity** — a single shared between-study variance across the network, with tau, Cochran's Q, degrees of freedom, its p-value and I-squared.
- **A league table** of every ordered treatment pair.
- **Rankings** as P-scores.
- **Network geometry** — nodes, edges and connected components, drawn as an SVG plot with an accessible table beside it.
- **A forest plot** of every treatment against the reference treatment.
- **Inconsistency** — node-splits per comparison plus a global design-by-treatment decomposition.
- **A contribution matrix** derived from the hat matrix.
- **Warnings** — transparency signals in the spirit of CINeMA's domains.
- **Provenance** — engine version, effect measure, model, reference treatment, estimator, and an order-independent hash of the data and configuration.

### Which effect measures are supported?

Odds ratio, risk ratio, risk difference, mean difference, and a generic contrast measure for pre-computed effects such as a log hazard ratio supplied with its standard error. Odds ratios and risk ratios are carried on the log scale internally. Where a continuity correction is needed it is applied inside the transformation, recorded in the result, and never written back over your raw counts.

Standardised mean difference is not derived natively from arm-level data; if you need it, compute the standardised effect and its standard error and supply them through the generic contrast path.

### Fixed-effect and random-effects, both

Both a common-effect and a random-effects fit are computed on every run and both are returned; the random-effects model is the primary by default. Between-study variance uses the multivariate DerSimonian-Laird estimator. That is worth stating plainly, because the pairwise engine in the same product supports eight tau-squared estimators and the network engine supports one.

Multi-arm studies are handled with the exact shared-baseline covariance rather than being split into independent pairwise contrasts, which would double-count the shared arm.

## How is ranking reported?

As P-scores, the frequentist analogue of SUCRA described by Rucker and Schwarzer. The interface says what a P-score is and, more importantly, what it is not: it is not the probability that a treatment is best, and it is not a clinical recommendation. Rankings reflect relative evidence and its uncertainty, and a treatment can top a ranking on the strength of a single small trial.

SUCRA itself is not implemented, and neither are rankograms. They belong to the Bayesian pathway, which is not shipped.

## How is inconsistency assessed?

Two ways, both reported.

**Node-splitting** compares the direct estimate for a comparison with the indirect estimate obtained by refitting the network without the studies that make that comparison directly, and tests the difference. The method is exact for two-arm studies and deliberately conservative for multi-arm ones, because excluding a study removes its other contrasts too. A split is computed only where both direct evidence and an estimable indirect path exist; otherwise it is reported as not estimable rather than fabricated.

**Global inconsistency** decomposes Q into within-design and between-design components, the design-by-treatment approach. When the network has no independent closed loops there are no inconsistency degrees of freedom, and the engine says exactly that instead of returning a meaningless p-value. When the test is available and non-significant, the accompanying note says that this does not prove consistency — power is often low in sparse networks.

## What happens to a disconnected network?

Only the largest connected component is analysed, and the treatments left out are named in the result with a warning. Silently analysing a fragment as though it were the whole network is the failure mode this avoids.

## Is a run reproducible?

Yes, by construction. The engine is pure — no randomness, no sampling, no wall-clock reads — so the same dataset and configuration always produce the same numbers. Each result carries an order-independent hash of the data and the configuration alongside the engine version, so a result can be tied to the exact inputs that produced it.

Requests are bounded at two thousand studies and two hundred treatments, and the analysis runs server-side rather than in your browser.

## How has it been validated?

Honestly, and with a stated limit. A two-treatment network reduces exactly to PecanRev's pairwise meta-analysis engine — same pooled effect, standard error, Q, tau-squared and I-squared — and that pairwise engine is validated against R. On top of that the test suite pins multi-arm covariance correctness, coherence (the A-to-C estimate equals A-to-B plus B-to-C), reciprocity, invariance to the choice of reference treatment, invariance to relabelling, P-score validity, node-splitting detecting a deliberately inconsistent loop, correct loop degrees of freedom in the global decomposition, contribution rows summing to one, and determinism.

What we will not claim: R was not available in the build environment, so the external netmeta numerical oracle was not run. The validation above is equivalence against the R-validated pairwise engine plus hand-derived checks, and that is how it should be described.

## Exports

The league table and the rankings export as CSV, the full result exports as JSON, and the engine generates a methods paragraph naming the model, the heterogeneity estimate, the ranking statistic, the inconsistency assessments, the engine version and the data hash — ending with the reminder that rankings reflect evidence and uncertainty rather than clinical recommendations.

## What this does not do

- **Bayesian network meta-analysis is not available.** No MCMC, no credible intervals, no convergence diagnostics — and no frequentist estimates resampled to look Bayesian.
- **SUCRA and rankograms are not implemented.** Ranking is by P-score.
- **Transitivity is not assessed.** Judging whether indirect comparison is credible remains yours; the engine will happily analyse a network that should not have been built.
- **Comparison-adjusted funnel plots are not implemented**, and loop-specific inconsistency is not reported as a separate output beyond node-splitting and the design-by-treatment decomposition.
- **Standardised mean difference is not derived from arm-level data**, and multi-arm studies cannot be supplied as generic contrasts with their own covariance.
- **Network and ranking plots are not included in the Word export.** Export them from the analysis workspace and place them yourself.
- **Results are not persisted.** The engine is stateless: the input dataset is saved with the project, the result is not, so network estimates do not currently flow into the manuscript's live fact tokens the way pairwise estimates do. Re-run before you report.
- **It is a beta engine**, marked as such in the product's own engine registry.

## Availability

Network meta-analysis is off by default. A site administrator enables it from the operations console, and access is additionally gated by the workspace's entitlements. When it is off, the routes are not merely hidden — they do not respond.

## Where this sits in the workflow

Arm-level data comes from [data extraction](/features/data-extraction), which ships a reusable extraction template for exactly this shape. Pairwise pooling, heterogeneity, publication-bias and sensitivity analysis live in [meta-analysis](/features/meta-analysis). If you are still deciding whether your question needs a network at all, start with [how to run a meta-analysis](/resources/how-to-run-a-meta-analysis).
`;
