# Outcomes organised by outcome name (prompt32 Task 9)

## Current state (investigated)
Each meta-analysis "study" row carries a free-text `outcome` (the outcome NAME), a `timepoint`, an `esType` (effect measure), and a separate `dataNature` ("primary" | "secondary" | "subgroup" | "posthoc" | "sensitivity") which is methodological ROLE metadata. **Analysis and Forest already group/select by outcome NAME** via the key `${outcome}|||${timepoint}` (`AnalysisTab` + `ForestTab` `outcomePairs`). `dataNature` (primary/secondary) is only used for composition/poolability warnings and a per-row chip — it is **not** a grouping axis.

## Issue
The task premise ("outcomes are grouped by primary/secondary") did not match the code — grouping was already by name. The real, useful gaps were: (a) Data Extraction had no way to organise the list by outcome name; (b) two outcomes sharing the same name but a different effect measure could read as one entry in the selector.

## Decision
Keep grouping by outcome name (already correct). De-emphasise primary/secondary (kept as metadata only). Add an explicit "Outcome (A–Z)" grouping to Data Extraction, and disambiguate selector/summary labels by appending the measure only when the same name appears more than once (a label-only change — pooling keys are unchanged, so existing single-measure projects behave identically and need no migration).

## Implementation
- `src/frontend/pages/extractionOrder.js` — new `outcome_az` sort ("Outcome (A–Z)") that orders the extraction list by outcome NAME then timepoint then original order.
- `meta-lab-3-patched.jsx` `AnalysisTab` + `ForestTab` `outcomePairs` — each pair now carries `esType` and a derived `label`: `"<name>"` + `" @ <timepoint>"` + (only when the name is duplicated) `" · <MEASURE>"`. The outcome selector, the single-outcome confirmation, and the all-outcomes Summary-of-Findings table render `p.label` (falling back to the bare name). The grouping/pooling key (`outcome|||timepoint`) is unchanged.

## Test results
- No pooling behaviour change for existing projects (key unchanged) — the `projectStore` round-trip invariant is unaffected (no new persisted fields).
- Build green.

## Risks / limitations
- Two copies of the project model (`src/research-engine/project-model/defaults.js` and the monolith) — no model fields were added here, so they stay in sync.
- A fuller "canonical outcome registry" (rename/merge, outcome-level isPrimary, measure in the pooling key) is a larger, optional follow-up; this change delivers the user-facing "by outcome name" organisation safely without a migration. See **Recommended next steps** in the final report.
