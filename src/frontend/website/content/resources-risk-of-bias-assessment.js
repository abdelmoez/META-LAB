/**
 * Content source for /resources/risk-of-bias-assessment.
 *
 * 113.md W1-B — appraisal guide. RoB 2 domains are from Sterne 2019 (BMJ
 * l4898); ROBINS-I from Sterne 2016 (BMJ i4919); NOS from the OHRI source
 * documents; GRADE from the GRADE series. The "PecanRev does not implement a
 * GRADE rating tool" statement is load-bearing honesty — do not soften it.
 */

export default `---
h1: Risk of bias assessment in systematic reviews
title: Risk of Bias Assessment: RoB 2, ROBINS-I and Newcastle-Ottawa
description: How to appraise included studies per outcome: the five RoB 2 domains, ROBINS-I for non-randomised designs, Newcastle-Ottawa scoring, and where GRADE fits.
slug: resources/risk-of-bias-assessment
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

Risk of bias assessment is a structured judgement about whether a study's result is likely to be distorted by how the study was designed, run, analysed or reported. It is made per study **and per outcome**, using an instrument matched to the study design, with a written rationale for each domain. It is not a quality score, not a judgement of reporting completeness, and not a proxy for journal prestige.

The per-outcome part is the one most often skipped. A trial can be at low risk of bias for mortality, which nobody can misclassify, and at high risk for a patient-reported symptom score assessed by an unblinded clinician. One judgement per study cannot express that.

## What are the five RoB 2 domains?

RoB 2 is the Cochrane tool for randomised trials. It assesses five domains through signalling questions answered Yes, Probably yes, Probably no, No, or No information, which feed an algorithm producing a domain judgement of low risk, some concerns, or high risk.

- **Bias arising from the randomisation process.** Was the allocation sequence random, was it concealed until assignment, and do baseline differences suggest a problem with randomisation? Concealment is the operative issue: a genuinely random sequence that the recruiting clinician can see is not protective.
- **Bias due to deviations from intended interventions.** This domain has two versions, and you must choose before you start. The **effect of assignment** version — the intention-to-treat question — asks what happens if you are assigned the intervention. The **effect of adhering** version asks what happens if you actually receive it as intended. They are different questions with different signalling questions and often different answers.
- **Bias due to missing outcome data.** Not "how much was missing" but "could the missingness depend on the true outcome". A high but demonstrably unrelated attrition rate can be low risk; a small differential attrition can be high risk.
- **Bias in measurement of the outcome.** Was the method appropriate, was it applied comparably across arms, was the assessor aware of the assignment, and if so could that awareness have influenced the measurement? Blinding matters far more for subjective outcomes than for hard ones.
- **Bias in selection of the reported result.** Was the analysis pre-specified, or was the reported result selected from multiple eligible measurements or analyses? This is where a protocol or registry entry becomes indispensable — without one, the honest answer is usually "some concerns" or "no information".

An overall judgement is derived from the domains: low risk only if every domain is low; some concerns if any domain raises concerns but none is high; high risk if any domain is high, or if multiple domains raise concerns in a way that substantially lowers confidence.

### Practical notes on applying RoB 2

Answer the signalling questions rather than jumping to the judgement — the algorithm exists to keep the judgement traceable. Record free-text support for every answer, quoting the paper where you can. Two assessors work independently and reconcile, and the reconciliation record is part of the review's audit trail.

Do not use the tool as a scale. RoB 2 has no numeric score by design, and inventing one by counting low-risk domains discards exactly the information the tool was built to preserve.

## When do you use ROBINS-I instead?

ROBINS-I assesses risk of bias in non-randomised studies of interventions, framed against a hypothetical target trial: how far is this study's estimate from what a well-conducted randomised trial of the same question would have found?

It has seven domains — confounding, selection of participants, classification of interventions, deviations from intended interventions, missing data, measurement of outcomes, and selection of the reported result — and five judgement levels: low, moderate, serious, critical, and no information.

Two things distinguish it in practice. First, "low risk" means comparable to a well-conducted randomised trial, which is a high bar that few observational studies clear. Second, the confounding domain requires you to pre-specify the confounders that matter for your question before you start assessing; without that list the domain cannot be answered consistently across studies.

## Which tool for observational and other designs?

- **Cohort and case-control studies**, where the question is aetiology or prognosis rather than an intervention effect: the Newcastle-Ottawa Scale is the most widely used instrument.
- **Diagnostic accuracy studies**: QUADAS-2, with four domains — patient selection, index test, reference standard, and flow and timing — each rated for risk of bias, and the first three also rated for applicability.
- **Case series**: the JBI critical appraisal tool for case series.
- **Systematic reviews you are including as evidence**: AMSTAR 2 or ROBIS, which appraise the conduct of a review rather than a primary study.

### How the Newcastle-Ottawa Scale works, and what to watch

The Newcastle-Ottawa Scale awards stars across three groups: selection of the study groups, comparability of the groups, and ascertainment of the exposure or outcome. There are separate forms for cohort and case-control designs, and a maximum of nine stars.

Two cautions are important enough to state plainly.

First, **the familiar 0-3 / 4-6 / 7-9 "poor, fair, good" bands are not part of the instrument.** No official Newcastle-Ottawa document defines them. They appear in the literature because reviews copy them from other reviews. If you use them, say where you got them; better, report the star profile per domain rather than a total.

Second, its reliability between assessors has been questioned empirically. Hartling and colleagues found low inter-rater reliability, and Stang's critical evaluation raised concerns about the scale's construction and its use in meta-analyses. This does not make it unusable — it makes detailed, pre-specified decision rules for each item essential, and it makes reporting the per-domain profile rather than a single total the more defensible choice.

## How do risk of bias and GRADE differ?

They answer different questions at different levels.

Risk of bias is about **one study**: is this particular result likely to be distorted? GRADE is about **the body of evidence for one outcome**: how much confidence should a reader place in the pooled estimate?

GRADE starts randomised evidence at high certainty and observational evidence at low, then rates down for five reasons — risk of bias across the contributing studies, inconsistency of results, indirectness, imprecision, and publication bias — and can rate up for a large effect, a dose-response gradient, or plausible residual confounding that would work against the observed effect. The outcome is a rating of high, moderate, low or very low certainty, reported per outcome, usually in a Summary of Findings table.

Your risk-of-bias assessments are one input into the GRADE risk-of-bias domain, weighted by how much each study contributes to the pooled estimate. A high-risk study contributing two percent of the weight is not a reason to rate the whole body of evidence down.

## How should risk of bias be used in the synthesis?

Plan the use in the protocol, not after seeing the results.

- **Report it, always.** A per-study, per-domain table or traffic-light figure, with the overall judgement.
- **Sensitivity analysis** restricted to studies at low risk of bias is the standard approach, and it is a sensitivity analysis: if it changes the conclusion, that is the finding, not a reason to switch primary analyses.
- **Subgroup analysis by risk of bias** is possible but usually underpowered and easy to over-read.
- **Do not weight studies by their risk-of-bias score.** Quality-effects weighting has been proposed repeatedly and is not recommended; weights should reflect precision, and bias is not the same as imprecision.
- **Do not exclude high-risk studies from the review.** Exclude them from a sensitivity analysis if you pre-specified it, but a review that silently drops inconvenient studies is not a systematic review.

## Common failure modes

- **One judgement per study** rather than per outcome.
- **Confusing reporting quality with risk of bias.** A short methods section is a reporting problem.
- **Turning a domain-based tool into a score.**
- **Using the unofficial Newcastle-Ottawa bands** as if they were part of the instrument.
- **Choosing the RoB 2 effect of interest after seeing the results.**
- **Answering the ROBINS-I confounding domain without a pre-specified confounder list.**
- **Assessing risk of bias and then never using it** anywhere in the synthesis or the conclusions.

## References

- Sterne JAC, Savovic J, Page MJ, et al. RoB 2: a revised tool for assessing risk of bias in randomised trials. *BMJ*. 2019;366:l4898. [doi:10.1136/bmj.l4898](https://doi.org/10.1136/bmj.l4898)
- Sterne JA, Hernan MA, Reeves BC, et al. ROBINS-I: a tool for assessing risk of bias in non-randomised studies of interventions. *BMJ*. 2016;355:i4919. [doi:10.1136/bmj.i4919](https://doi.org/10.1136/bmj.i4919)
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 8: Assessing risk of bias in a randomized trial. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Whiting PF, Rutjes AWS, Westwood ME, et al. QUADAS-2: a revised tool for the quality assessment of diagnostic accuracy studies. *Annals of Internal Medicine*. 2011;155(8):529-536. [doi:10.7326/0003-4819-155-8-201110180-00009](https://doi.org/10.7326/0003-4819-155-8-201110180-00009)
- Wells GA, Shea B, O'Connell D, et al. *The Newcastle-Ottawa Scale (NOS) for assessing the quality of nonrandomised studies in meta-analyses*. Ottawa Hospital Research Institute. [ohri.ca](https://www.ohri.ca/programs/clinical_epidemiology/oxford.asp)
- Stang A. Critical evaluation of the Newcastle-Ottawa scale for the assessment of the quality of nonrandomized studies in meta-analyses. *European Journal of Epidemiology*. 2010;25(9):603-605. [doi:10.1007/s10654-010-9491-2](https://doi.org/10.1007/s10654-010-9491-2)
- Hartling L, Milne A, Hamm MP, et al. Testing the Newcastle Ottawa Scale showed low reliability between individual reviewers. *Journal of Clinical Epidemiology*. 2013;66(9):982-993. [doi:10.1016/j.jclinepi.2013.03.003](https://doi.org/10.1016/j.jclinepi.2013.03.003)
- Guyatt GH, Oxman AD, Vist GE, et al. GRADE: an emerging consensus on rating quality of evidence and strength of recommendations. *BMJ*. 2008;336:924-926. [doi:10.1136/bmj.39489.470347.AD](https://doi.org/10.1136/bmj.39489.470347.AD)
- Guyatt GH, Oxman AD, Vist G, et al. GRADE guidelines: 4. Rating the quality of evidence - study limitations (risk of bias). *Journal of Clinical Epidemiology*. 2011;64(4):407-415. [doi:10.1016/j.jclinepi.2010.07.017](https://doi.org/10.1016/j.jclinepi.2010.07.017)

## Doing this in PecanRev

PecanRev's risk-of-bias workspace implements **RoB 2** for randomised trials and **ROBINS-I** for non-randomised studies of interventions, with the ROBINS-I instrument becoming selectable when guided appraisal is enabled for the project. Judgements are recorded per result rather than once per study, and a traffic-light figure is generated from the assessments.

Dual independent assessment is supported: two assessments share a project, study and instrument with different reviewers, plus a third consensus row, and neither reviewer's row is overwritten.

The **Newcastle-Ottawa Scale** is encoded verbatim from the source documents, for both the cohort and case-control forms. It ships with no default verdict banding: the 0-3 / 4-6 / 7-9 bands described above are an explicitly labelled opt-in, because no official Newcastle-Ottawa document defines them.

Two limits worth stating before you plan a review around the product. **QUADAS-2 is not implemented**, so a diagnostic accuracy review needs another instrument for appraisal. And **PecanRev does not implement a GRADE rating tool**: the generated Methods text includes a certainty-of-evidence statement, but the rating itself is yours to make and record elsewhere. The [manuscript editor](/features/manuscript) names the risk-of-bias instrument that actually has completed assessments, rather than the one that was configured.
`;
