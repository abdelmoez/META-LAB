# Structured Data Extraction (P5)

Feature flag: `extractionAssist` (default **OFF** — the classic extraction table is unchanged until an
admin enables it in Ops → Flags). Global policy: Ops → Extraction AI (`extractionAiSettings` SiteSetting).

## Architecture

| Layer | Location |
| --- | --- |
| Pure engine | `src/research-engine/extraction/` (model, conflicts, tableParse, heuristicExtract, validationMetrics, maHandoff) |
| Server | `server/routes/extraction.js` → `server/controllers/extractionController.js`, access in `server/extraction/access.js` |
| External LLM client | `server/services/extractionLlmClient.js` (`EXTRACTION_LLM_ENDPOINT/_API_KEY/_MODEL` env) |
| UI | `src/features/extraction/` (mounted as a toggle inside the classic Extraction tab) |
| Tables | ExtractionForm, ExtractionValue, ExtractionAssignment, ExtractionConsensus, AiExtractionSuggestion, ParsedTable |

Extraction is scoped to the META·LAB project (`:mlpid`); studies are the blob `Project.data.studies[]`
rows (joined by their in-document 8-char `id`, same convention as RoB).

## Data elements & templates

An **ExtractionForm** holds the project's data-element definitions (JSON, versioned). Element types:
dichotomous_outcome, continuous_outcome, categorical, baseline, study_design, intervention_detail,
comparator_detail, timepoint, adverse_event, text, numeric, date. Templates: generic, RCT intervention,
diagnostic accuracy, observational cohort, dichotomous 2×2, continuous outcome, NMA arm-level.
Value shapes: dichotomous `{events,total}`, continuous `{mean,sd,n[,median,iqrLo,iqrHi]}`, others
`{value[,unit]}`. Arm-scoped elements are keyed `elementId::armKey` (armKey `""` = study level).

## Dual extraction + adjudication

- Every extractor writes their **own** `ExtractionValue` rows (`@@unique(project,study,element,arm,user)`).
  Extractors never see each other's values; only adjudicators (owner/leader/`canManageExtraction`)
  get the side-by-side compare view.
- Conflict detection is pure (`conflicts.js`): normalized text compare, numeric relative tolerance,
  missing-vs-present and unit mismatches are conflicts.
- Adjudication writes **ExtractionConsensus** rows (accept A / accept B / agreement / custom value with
  note) — extractor rows are never overwritten. Full attribution (`resolvedBy`, timestamps, source).

## AI assist (never auto-commits)

`POST …/ai-suggest` produces an `AiExtractionSuggestion` row. Two providers:

- **heuristic** (default, self-hosted, deterministic): regex/pattern extraction from title/abstract/pasted
  text with sentence-level provenance and conservative confidence. No data leaves the server.
- **external**: server-proxied OpenAI-compatible endpoint (env-configured). Suggestions whose provenance
  excerpt does not literally occur in the supplied text are **dropped** (anti-hallucination grounding check).

Suggestions only become values when a human accepts/edits them (`origin: ai_accepted|ai_edited`,
`suggestionId` recorded). `requireHumanValidation` is a hard rule and is not configurable.

## Provenance

Every value stores a provenance JSON: `{type: sentence|paragraph|page|table|table_cell|figure|manual|ai,
excerpt, location, page, table, row, col}` plus origin + extractor + timestamps. Consensus rows carry the
chosen side's provenance.

## Meta-analysis handoff

`POST …/studies/:id/send-to-ma` maps consensus values → the blob study's raw fields (2×2 `a,b,c,d` or
continuous `meanExp…nCtrl`, as STRINGS) and computes `es/lo/hi` via the canonical `calcES`. It returns a
**409 `HAS_EFFECT_SIZE`** when the study already has an effect size (explicit overwrite confirmation
required — human edits are never silently replaced). Warnings surface missing denominators/SDs/zero cells.

## AI validation report (P5.9)

`GET …/validation-report` compares the latest AI suggestions per study against the human consensus (gold):
exact-match rate, within-tolerance rate, field precision/recall, missingness accuracy — computed by
`validationMetrics.js`. No accuracy claims are made until real consensus data exists.
