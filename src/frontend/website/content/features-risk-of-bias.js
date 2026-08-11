/**
 * Content source for /features/risk-of-bias — 113 W1-A.
 *
 * Claims verified against src/research-engine/rob/{tools,engine,agreement,
 * appraisal,usage,gradeSync}.js, src/research-engine/rob/instruments/{rob2,
 * robinsI,nos,nosThresholds}.js, src/research-engine/docs/rob-validation.md,
 * server/controllers/{robController,robAdminController}.js,
 * src/frontend/rob/*, src/shared/opsSettingsCatalog.js and
 * docs/manager/{ops-risk-of-bias-engine,rob-to-grade-integration}.md.
 *
 * The "what this does not do" section is load-bearing: the dual-reviewer flow
 * is API-and-data-model only today, several Ops toggles are persisted but not
 * enforced, and RoB does not yet reach the forest plot. Saying so is the point.
 */

export default `---
h1: Risk of bias assessment with the algorithm in plain sight
title: Risk of Bias Software: RoB 2, ROBINS-I and Newcastle-Ottawa | PecanRev
description: Assess risk of bias with RoB 2, ROBINS-I and the Newcastle-Ottawa Scale: signalling questions, computed domain judgements you can override, and honest star scoring.
slug: features/risk-of-bias
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

PecanRev implements four risk-of-bias instruments as real, encoded tools rather than as blank grids you type judgements into: Cochrane's RoB 2 for randomised trials, ROBINS-I for non-randomised studies of interventions, and both official Newcastle-Ottawa forms — cohort and case-control. You answer the instrument's own signalling questions, the engine applies the published algorithm and shows you its reasoning, and you can override any judgement provided you say why.

## Which tools are implemented?

- **RoB 2** — Cochrane risk of bias 2 for randomised trials. Five domains, twenty-two signalling questions, the 2019-08-22 version, effect of assignment to intervention.
- **ROBINS-I** — non-randomised studies of interventions, the 2016 tool of Sterne and colleagues. Seven domains, thirty-four signalling questions. Selectable only when the guided-appraisal flag is enabled as well as the workspace itself; see Availability below.
- **Newcastle-Ottawa Scale (cohort)** — three categories, eight items, nine stars maximum.
- **Newcastle-Ottawa Scale (case-control)** — three categories, eight items, nine stars maximum.

QUADAS-2 and user-defined custom templates are declared in the tool catalogue as planned and are not selectable. That is deliberate: a half-built diagnostic-accuracy instrument is worse than none, because it looks finished.

## How does RoB 2 work here?

You answer the tool's own signalling questions with its own response options — Yes, Probably yes, Probably no, No, No information — and questions that the instrument branches away from are hidden rather than left to confuse you. Each domain then receives one of the three published judgements: low risk of bias, some concerns, or high risk of bias.

Crucially, the domain judgement is **computed from your answers by the published decision table**, not typed in. The overall judgement follows the tool's own rule: high if any domain is high, otherwise some concerns if any domain raises them, otherwise low. When two or more domains sit at "some concerns", the engine raises a non-blocking flag noting that the tool permits a reviewer to consider the overall judgement high — a prompt to think, never an automatic downgrade.

### The algorithm proposes; you decide

Every computed judgement arrives with a plain-language trace of the rule that produced it, so you can see why the algorithm landed where it did. If you disagree, you override it — and an override **requires a written justification**. Both the proposed and the final judgement are stored, along with the fact that an override happened and its reason, and every create, answer, override, finalise and reopen is written to an audit log.

That pairing is the whole design. An algorithm without an override is a machine making scientific judgements. An override without a recorded proposal and reason is an unauditable opinion. Storing both is what makes the assessment reviewable later.

### Validated against the published decision tables

The RoB 2 encoding is documented in a validation file that transcribes the official domain and overall decision tables and records the verification pass against them — including six encoding errors that adversarial verification found and fixed before release. The test suite pins all fourteen official rows of the randomisation-domain table and every branch of the remaining four domains.

## ROBINS-I

ROBINS-I uses its own five levels — low, moderate, serious, critical, and no information — across seven domains from confounding through to selection of the reported result. The overall judgement is the worst domain, as the tool specifies.

One implementation detail matters for statistics rather than for judgements: "no information" is not the most severe level, so the engine keeps a separate severity ordering for ordinal calculations such as weighted kappa. Treating "we do not know" as worse than "critical" would quietly distort agreement statistics.

## The Newcastle-Ottawa Scale, and the threshold problem

Both official OHRI forms are encoded verbatim, including the instrument's own protocol blanks in the comparability item, where you name the factor being controlled for. Stars are counted by the scale's own rules: one star at most for a single-choice item, and the comparability item is genuinely additive — two stars are available for two independently controlled factors. The result is reported as a profile, for example four of four, two of two, three of three, with the total.

Now the honest part. **The Newcastle-Ottawa Scale defines no quality threshold.** The familiar bands that classify a study as poor, fair or good at three, six and nine stars are not part of the instrument — they come from elsewhere, and papers frequently cite them as though OHRI published them.

PecanRev handles that as follows. The default threshold mode is none: you get the star profile and nothing else. If your protocol calls for a categorical rating you can opt in to the AHRQ standard, quoted verbatim from the comparative effectiveness review it comes from and applied per domain as that source specifies, or to your own project-defined bands. Every rating produced this way is labelled as unofficial and carries its attribution. The conventional bands ship only as an explicitly labelled preset with a notice explaining what they are. No quality label is ever stored on the assessment — only stars are persisted, and any verdict is derived at read time from the mode you chose.

Newcastle-Ottawa results are also presented differently from the judgement instruments: a star-profile table, never a traffic-light plot, because colouring a star count as if it were a risk-of-bias judgement would misrepresent both.

## Guided appraisal is a cue matcher, not a language model

An optional guided appraisal reads the study text and pre-fills signalling answers. It is a deterministic cue-phrase matcher — no model call, no learning, no generated prose — and it behaves accordingly:

- Each suggestion carries a verbatim quotation from the text, located by character offset, plus a confidence and a rationale.
- Where no cue matches, it answers "no information" at very low confidence rather than guessing.
- Suggestions are written only to answer rows marked as suggested, never to a final judgement, and any question a human has already answered is skipped.
- Coverage is partial and we will say how partial: cues exist for twelve of RoB 2's twenty-two questions and twenty-six of ROBINS-I's thirty-four. Everything else defaults to "no information" for you to answer.
- It is refused outright for the Newcastle-Ottawa Scale, whose items have to be assessed by a reviewer against the study text.
- It warns when the text it was given is thin or when no full text was available.

Where an assessor overrode a guided suggestion, PecanRev can compute agreement between the two — weighted kappa with a confidence interval, per domain, restricted to a single instrument so three-level and five-level scales are never pooled, and counting only genuine overrides rather than answers that were auto-copied at finalisation and would inflate the statistic.

## Two assessors and a consensus record

The data model supports two independent assessors and a third, separate consensus record for the same study and instrument. Neither assessor's row is ever overwritten — not by the other assessor and not by the consensus — so the disagreement rate remains measurable after the fact. A comparison endpoint reports per-question agreement and the specific disagreements, and it counts a disagreement only where at least two assessors actually answered: a question one reviewer has not reached yet is incomplete, not a conflict. Creating a consensus record requires two genuinely independent assessments to exist first.

Be aware of the current boundary: **this flow is available through the API and the data model, and does not yet have a workspace interface**. See the limitations below.

## Outputs

- **Traffic-light plot** for the judgement instruments, with colour-blind-safe colours and redundant symbols so the plot survives greyscale printing, exportable as SVG or PNG.
- **Star-profile table** with summary and per-item CSV for the Newcastle-Ottawa forms.
- **Per-assessment export** as CSV, JSON, or robvis-ready format using the exact category strings robvis expects. The robvis export is refused for Newcastle-Ottawa, with an explanation, rather than emitting a traffic light for a star scale.
- **Manuscript integration**: a risk-of-bias summary table, an optional traffic-light figure that becomes available only once structured assessments exist, and a Methods sentence that names only the instruments actually used, counting distinct studies rather than assessment rows.
- **GRADE**: where the certainty engine is enabled, finalised assessments feed a suggested risk-of-bias rating, and the suggestion goes stale with an explicit re-sync prompt when assessments change. It is a suggestion, and it is recorded as one.

## What this does not do

- **No QUADAS-2, no custom templates**, and no AMSTAR, JBI, ROBIS, PROBAST, ROBINS-E or the original Cochrane RoB 1.
- **RoB 2 covers the effect of assignment to intervention in parallel-group trials only.** The per-protocol variant and the cluster and crossover forms are not implemented.
- **There is no cross-sectional Newcastle-Ottawa form**, because OHRI publishes exactly two. Third-party adaptations exist; we do not ship one under the NOS name.
- **The dual-assessor and consensus workflow has no interface yet.** It is implemented and tested at the API and data-model level; the workspace does not surface it.
- **There is no assessor blinding**, and no enforced minimum number of assessors. Several workflow policies are configurable in the operations console and stored, but are not yet enforced by the engine — do not rely on them as controls.
- **Risk of bias does not reach the analysis.** Forest plots are not annotated by judgement, and there is no subgroup or sensitivity analysis by risk of bias. The integration points exist as stubs and are not wired.
- **The PRISMA checklist's risk-of-bias item does not detect engine assessments yet** — its automatic signal still reads the older per-study field, so the item may show as not reported even when every study is assessed.
- **The GRADE suggestion is project-level and count-based**, not weighted by study size or split per outcome.
- **The guided appraisal covers only part of each instrument** (see above) and is not available for Newcastle-Ottawa.

## Availability

The risk-of-bias workspace is behind a feature flag that is **off by default** and described in the product's own settings catalogue as beta, off until validated. A site administrator enables it; guided appraisal is a second flag that requires the first. When the workspace is off, its routes do not respond at all.

One consequence of that two-flag arrangement is worth stating rather than leaving to be discovered: **ROBINS-I becomes selectable only when the second flag, guided appraisal, is on.** With the workspace flag alone you get RoB 2 and both Newcastle-Ottawa forms; an attempt to create a ROBINS-I assessment is refused with that reason. If your review appraises non-randomised studies of interventions, both flags need to be enabled.

## Where this sits in the workflow

The studies you assess come from [data extraction](/features/data-extraction); assessments reach the write-up through the [manuscript editor](/features/manuscript) as a summary table, an optional figure and a Methods sentence naming the instruments used. For the method itself rather than the tooling, see [what is a systematic review?](/resources/what-is-a-systematic-review).
`;
