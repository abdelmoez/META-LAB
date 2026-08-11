/**
 * Content source for /resources/network-meta-analysis-explained.
 *
 * 113.md W1-B — NMA guide. Sources: Salanti 2008 (geometry), Bucher 1997
 * (indirect comparison), Higgins 2012 / White 2012 (inconsistency), Dias 2010
 * (node-splitting), Rucker & Schwarzer 2015 (P-score), Salanti 2011 (SUCRA),
 * Hutton 2015 (PRISMA-NMA), Nikolakopoulou 2020 (CINeMA).
 *
 * The product section must repeat the shipped limits: frequentist only, no
 * Bayesian NMA, P-score not SUCRA, network plots excluded from Word export.
 */

export default `---
h1: Network meta-analysis explained
title: Network Meta-Analysis Explained: Geometry and Indirect Evidence
description: What a network meta-analysis estimates, how indirect evidence is formed, why transitivity matters, how consistency is tested and how to read rankings.
slug: resources/network-meta-analysis-explained
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

A network meta-analysis compares three or more treatments simultaneously by combining direct evidence, where two treatments were compared head to head in a trial, with indirect evidence formed through a common comparator. It produces an estimate for every pair of treatments in the network — including pairs that no trial has ever compared — along with a ranking. It rests on one assumption that cannot be tested statistically and one that partly can, and understanding those two assumptions is most of understanding the method.

If you are new to pooling, start with [how to run a meta-analysis](/resources/how-to-run-a-meta-analysis) and [forest plots and heterogeneity](/resources/forest-plots-and-heterogeneity); the concepts below build on both.

## How is indirect evidence formed?

Suppose trials compared A with B, and other trials compared A with C, but nothing compared B with C directly. The indirect estimate of B versus C is the difference between the two direct estimates, anchored on the common comparator A. This is the Bucher method, and its variance is the sum of the variances of the two contributing estimates — so an indirect estimate is always less precise than either of the direct estimates it is built from.

A network meta-analysis generalises this. Every treatment is a node, every set of trials comparing two treatments is an edge, and the model estimates all pairwise contrasts at once while respecting the correlation structure induced by multi-arm trials and by shared comparators. Where both direct and indirect evidence exist for a comparison, the model combines them into a **mixed** estimate, weighted by precision.

The important consequence: an estimate for a comparison nobody ever ran is not invented. It is an inference, and its credibility depends entirely on whether the trials that anchor it were comparable.

## What does network geometry tell you?

The network plot draws the nodes and edges, conventionally with node size proportional to the number of participants receiving that treatment and edge thickness proportional to the number of trials making that comparison. Salanti and colleagues introduced the study of this geometry as a diagnostic in its own right, and reading it before reading any estimate is good practice.

- **Star-shaped networks**, where everything connects only through a single common comparator such as placebo, contain no direct evidence for any active-versus-active comparison. Every such estimate is purely indirect and untestable for consistency.
- **Well-connected networks** with many closed loops support consistency checking and produce more precise mixed estimates.
- **Sparse edges** matter: an edge carrying one small trial can dominate a chain of inference reaching several comparisons.
- **Disconnected components** cannot be compared at all. Two subnetworks with no shared comparator produce no estimate between them, and any software that appears to give one is doing something you should investigate.
- **Asymmetric geometry** — some comparisons studied heavily, others avoided — can itself indicate a preference for certain comparisons, which is a form of reporting bias at the network level.

## What is transitivity, and why can it not be tested?

Transitivity is the assumption that the trials contributing to different comparisons are similar enough in every respect that could modify the treatment effect, so that a participant in an A-versus-B trial could in principle have been randomised in an A-versus-C trial instead.

Concretely: if the A-versus-B trials enrolled patients with mild disease and short follow-up while the A-versus-C trials enrolled severe disease with long follow-up, the indirect B-versus-C estimate is confounded by disease severity and follow-up. Jansen and Naci put it directly — the validity of a network meta-analysis depends on the distribution of effect modifiers across comparisons.

Transitivity is a **conceptual** assumption about the trials, evaluated by tabulating the potential effect modifiers you identified in the protocol and inspecting how they are distributed across the edges of the network. There is no statistical test for it. Consistency checking, described next, tests a statistical consequence of transitivity, and only in the closed loops where direct and indirect evidence both exist.

The practical implication: identify the plausible effect modifiers in your protocol, before you build the network, and report their distribution across comparisons as a table of study characteristics. A network meta-analysis that never discusses transitivity has skipped its main assumption.

## How is consistency assessed?

Consistency means that direct and indirect evidence for the same comparison agree. Inconsistency is the statistical footprint of a transitivity violation.

- **Global tests.** The design-by-treatment interaction model, developed by Higgins and colleagues and implemented by White and colleagues, provides a single test of inconsistency across the whole network. A significant result says something is wrong somewhere; it does not localise it.
- **Local tests.** Node-splitting, from Dias and colleagues, separates the direct and indirect evidence for one comparison and tests whether they agree. The loop-specific approach does the same for each closed loop. These do localise the problem, at the cost of multiple testing.
- **Side-by-side presentation.** Reporting the direct, indirect and network estimate for each comparison is often more informative than any test, especially in a small network where all the tests are underpowered.

Two cautions. Inconsistency tests have low power in typical networks, so a non-significant result is weak reassurance. And a network with no closed loops — the star shape — admits no consistency assessment at all; the assumption is simply untested.

## How should rankings be read?

A network meta-analysis can order treatments by their estimated effect, and this is the output most likely to be over-interpreted.

**SUCRA**, the surface under the cumulative ranking curve, summarises a treatment's ranking distribution as a single number between 0 and 1 in a Bayesian framework. The **P-score** of Rucker and Schwarzer is the frequentist analogue and is interpreted the same way; the two are closely related but are not the same statistic and should not be reported under each other's name.

What a ranking does not tell you:

- **Whether the differences are meaningful.** A treatment can rank first with a P-score of 0.9 while its confidence interval against the second-placed treatment comfortably includes no difference.
- **How much evidence supports it.** A treatment studied in one small trial can rank highly, because the ranking metric uses the point estimate and its uncertainty but does not require the evidence to be substantial.
- **Anything about certainty.** Rankings are computed from the model whether or not the model's assumptions hold.

Report rankings alongside the effect estimates with their intervals, and never as a standalone league table. The estimate is the result; the ranking is a summary of it.

## How much does each study contribute?

A contribution matrix shows how much each direct comparison contributes to each network estimate. It is worth reporting for the same reason study weights are worth reading on a forest plot: it reveals when a headline network estimate is really driven by one or two trials several steps away in the network.

Rucker's graph-theoretical formulation of network meta-analysis, which treats the network as an electrical network, provides the framework in which these contributions are defined for the frequentist model.

## How is a network meta-analysis reported?

**PRISMA-NMA**, the PRISMA extension by Hutton and colleagues, is the reporting standard. Beyond the standard PRISMA items it requires the network geometry to be presented and described, the assumption of transitivity to be discussed explicitly, the methods for assessing inconsistency to be stated, and rankings to be presented with an explanation of what they do and do not mean.

For certainty of evidence, the GRADE working group's approach to network meta-analysis rates each comparison, taking into account the certainty of the direct and indirect contributions and any incoherence between them. **CINeMA** is a structured framework and tool implementing this, covering within-study bias, reporting bias, indirectness, imprecision, heterogeneity and incoherence.

## Common failure modes

- **Building a network without a protocol-stage list of effect modifiers**, which makes transitivity undiscussable.
- **Treating a non-significant global inconsistency test as proof of consistency** in an underpowered network.
- **Reporting a league table of rankings** without the estimates and intervals.
- **Ignoring multi-arm trials' correlation structure**, which understates uncertainty.
- **Lumping heterogeneous treatments into one node** — different doses, or different drugs in a class — to make the network connect.
- **Presenting an estimate between two disconnected subnetworks.**
- **Naming a P-score as SUCRA**, or the reverse.

## References

- Hutton B, Salanti G, Caldwell DM, et al. The PRISMA extension statement for reporting of systematic reviews incorporating network meta-analyses of health care interventions: checklist and explanations. *Annals of Internal Medicine*. 2015;162(11):777-784. [doi:10.7326/M14-2385](https://doi.org/10.7326/M14-2385)
- Salanti G, Kavvoura FK, Ioannidis JPA. Exploring the geometry of treatment networks. *Annals of Internal Medicine*. 2008;148(7):544-553. [doi:10.7326/0003-4819-148-7-200804010-00011](https://doi.org/10.7326/0003-4819-148-7-200804010-00011)
- Bucher HC, Guyatt GH, Griffith LE, Walter SD. The results of direct and indirect treatment comparisons in meta-analysis of randomized controlled trials. *Journal of Clinical Epidemiology*. 1997;50(6):683-691. [doi:10.1016/S0895-4356(97)00049-8](https://doi.org/10.1016/S0895-4356(97)00049-8)
- Higgins JPT, Jackson D, Barrett JK, Lu G, Ades AE, White IR. Consistency and inconsistency in network meta-analysis: concepts and models for multi-arm studies. *Research Synthesis Methods*. 2012;3(2):98-110. [doi:10.1002/jrsm.1044](https://doi.org/10.1002/jrsm.1044)
- White IR, Barrett JK, Jackson D, Higgins JPT. Consistency and inconsistency in network meta-analysis: model estimation using multivariate meta-regression. *Research Synthesis Methods*. 2012;3(2):111-125. [doi:10.1002/jrsm.1045](https://doi.org/10.1002/jrsm.1045)
- Dias S, Welton NJ, Caldwell DM, Ades AE. Checking consistency in mixed treatment comparison meta-analysis. *Statistics in Medicine*. 2010;29(7-8):932-944. [doi:10.1002/sim.3767](https://doi.org/10.1002/sim.3767)
- Rucker G. Network meta-analysis, electrical networks and graph theory. *Research Synthesis Methods*. 2012;3(4):312-324. [doi:10.1002/jrsm.1058](https://doi.org/10.1002/jrsm.1058)
- Rucker G, Schwarzer G. Ranking treatments in frequentist network meta-analysis works without resampling methods. *BMC Medical Research Methodology*. 2015;15:58. [doi:10.1186/s12874-015-0060-8](https://doi.org/10.1186/s12874-015-0060-8)
- Salanti G, Ades AE, Ioannidis JPA. Graphical methods and numerical summaries for presenting results from multiple-treatment meta-analysis: an overview and tutorial. *Journal of Clinical Epidemiology*. 2011;64(2):163-171. [doi:10.1016/j.jclinepi.2010.03.016](https://doi.org/10.1016/j.jclinepi.2010.03.016)
- Jansen JP, Naci H. Is network meta-analysis as valid as standard pairwise meta-analysis? It all depends on the distribution of effect modifiers. *BMC Medicine*. 2013;11:159. [doi:10.1186/1741-7015-11-159](https://doi.org/10.1186/1741-7015-11-159)
- Nikolakopoulou A, Higgins JPT, Papakonstantinou T, et al. CINeMA: an approach for assessing confidence in the results of a network meta-analysis. *PLoS Medicine*. 2020;17(4):e1003082. [doi:10.1371/journal.pmed.1003082](https://doi.org/10.1371/journal.pmed.1003082)
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 11: Undertaking network meta-analyses. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)

## Doing this in PecanRev

[PecanRev's network meta-analysis engine](/features/meta-analysis) is **frequentist**, with fixed-effect and random-effects (DerSimonian-Laird) options. It provides network geometry, inconsistency assessment, and a contribution matrix showing how much each direct comparison contributes to each network estimate.

Treatment ranking uses the **P-score** of Rucker and Schwarzer. PecanRev calls it a P-score because that is what it is: SUCRA is not implemented, and reporting a P-score under the other name would misstate the statistic.

Two limits to plan around. **Bayesian network meta-analysis is not available** — if your analysis plan requires a Bayesian model with informative priors, this engine is not the right tool. And **network and ranking plots are not included in the Word export**; they have to be exported separately.

Arm-level data is what a network model needs, and the [data extraction](/features/data-extraction) form supports arm-scoped elements with a reusable template for arm-level network meta-analysis data.
`;
