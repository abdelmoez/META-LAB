# Data Model Reference

This document describes all fields in the project and study data model
used by METAÂ·LAB.

---

## Project Object (`mkProject(name)`)

Top-level container for a systematic review.

| Field | Type | Description |
|---|---|---|
| `id` | string | Random 8-char uid |
| `name` | string | Project display name |
| `created` | string | ISO timestamp |
| `modified` | string | ISO timestamp (updated on save) |
| `pico` | object | PICO question fields (see below) |
| `search` | object | Database search configuration |
| `prisma` | object | PRISMA flow counts and exclusion reasons |
| `records` | Array | Imported citation records for screening |
| `studies` | Array | Extracted study data for meta-analysis |
| `robMethod` | string | Active RoB instrument: "RoB2" or "NOS" |
| `reportChecked` | object | Map of PRISMA checklist item IDs to booleans |

### pico sub-object

| Field | Description |
|---|---|
| `question` | Free-text research question |
| `P` | Population |
| `I` | Intervention / Exposure |
| `C` | Comparator / Control |
| `O` | Outcome |
| `studyDesign` | Primary design target (e.g. "RCT") |
| `timeframe` | Follow-up / time horizon |
| `prosperoId` | PROSPERO registration number |
| `keywords` | MeSH / search keywords |
| `incl` | Inclusion criteria |
| `excl` | Exclusion criteria |
| `notes` | Free-text notes |

### search sub-object

| Field | Description |
|---|---|
| `dbs` | Object map of database name â†’ boolean (selected?) |
| `date` | Date range of the search |
| `string` | Raw search string |
| `notes` | Free-text notes |

### prisma sub-object

| Field | Description |
|---|---|
| `dbs` | Records identified from databases |
| `reg` | Records from trial registers |
| `other` | Records from other sources |
| `dedupe` | Records removed as duplicates |
| `screened` | Records screened (title/abstract) |
| `excTA` | Records excluded at title/abstract |
| `excFull` | Records excluded at full-text |
| `reasons` | Array of `{ id, r (reason text), n (count) }` |
| `included` | Studies included in the review |
| `qual` | Studies in qualitative synthesis |
| `quant` | Studies in quantitative synthesis (meta-analysis) |

---

## Study Object (`mkStudy()`)

Each study in `project.studies` has the following fields.

### Identity and citation

| Field | Description |
|---|---|
| `id` | Random 8-char uid |
| `author` | First author (or study label) |
| `year` | Publication year (string) |
| `country` | Country of study |
| `design` | Study design: "RCT", "cohort", "case-control", "cross-sectional", etc. |
| `n` | Total sample size |
| `outcome` | Outcome name (free text) |
| `title` | Full paper title |
| `authors` | All authors (semicolon-separated) |
| `journal` | Journal name |
| `doi` | Digital Object Identifier (without URL prefix) |
| `pmid` | PubMed ID |
| `abstract` | Abstract text |

### Descriptive metadata

| Field | Description |
|---|---|
| `dataSource` | Origin of data (e.g. "registry", "claims database") |
| `enrollPeriod` | Enrolment / recruitment period |
| `populationDef` | Population definition |
| `interventionDef` | Intervention definition |
| `comparatorDef` | Comparator definition |
| `primaryOutcome` | Primary outcome from the paper |
| `secondaryOutcomes` | Secondary outcomes listed |
| `funding` | Funding source |

### Effect-size configuration

| Field | Type | Description |
|---|---|---|
| `esType` | string | Effect measure: "SMD" \| "MD" \| "OR" \| "RR" \| "HR" \| "COR" \| "PROP" \| "" |
| `timepoint` | string | Follow-up window (e.g. "12 weeks") â€” used to distinguish repeated measures |
| `followup` | string | Total follow-up duration |
| `adjusted` | string | Adjustment status: "unadjusted" \| "adjusted" \| "multivariable" \| "propensity" \| "iptw" |
| `dataNature` | string | Role of the estimate: "primary" \| "secondary" \| "subgroup" \| "posthoc" \| "sensitivity" |
| `flags` | Array\<string\> | Reliability flags â€” see EXTRACT_FLAGS |

### Raw continuous data

| Field | Description |
|---|---|
| `nExp` | Experimental group n |
| `nCtrl` | Control group n |
| `meanExp` | Experimental group mean |
| `sdExp` | Experimental group SD |
| `meanCtrl` | Control group mean |
| `sdCtrl` | Control group SD |

### Raw dichotomous data (2Ã—2 table)

| Field | Description |
|---|---|
| `a` | Events in experimental group |
| `b` | Non-events in experimental group |
| `c` | Events in control group |
| `d` | Non-events in control group |

Convention: a+b = experimental group total; c+d = control group total.

### Raw single-arm proportion

| Field | Description |
|---|---|
| `events` | Number of events |
| `total` | Group total |

### Raw diagnostic accuracy (2Ã—2 diagnostic table)

| Field | Description |
|---|---|
| `tp` | True positives |
| `fp` | False positives |
| `fn` | False negatives |
| `tn` | True negatives |

### Final effect size and CI

Entered on the **analysis scale** â€” log scale for OR/RR/HR, Fisher z for COR,
logit for PROP, raw units for MD, standardised units for SMD.

| Field | Description |
|---|---|
| `es` | Effect size on analysis scale |
| `lo` | 95% CI lower bound |
| `hi` | 95% CI upper bound |

### Provenance and audit trail

| Field | Type | Description |
|---|---|---|
| `source` | string | Physical location: "text" \| "table" \| "figure" \| "supplement" \| "calculated" \| "converted" \| "author" \| "unclear" |
| `converted` | boolean | True if any value was derived by a conversion |
| `conversions` | Array | Audit trail entries: `{ id, target, type, method, reason, original, result, at }` |
| `needsReview` | boolean | Requires second-reviewer confirmation |
| `extractedBy` | string | Reviewer initials |
| `extractedAt` | string | ISO timestamp of extraction |
| `rob` | object | Risk-of-bias assessments keyed by domain ID |
| `notes` | string | Free-text notes |

---

## Citation Record Object (`mkRecord(r)`)

Used in `project.records` for the screening stage (before data extraction).

| Field | Description |
|---|---|
| `id` | Random 8-char uid |
| `title` | Article title |
| `authors` | Authors (semicolon-separated) |
| `year` | Publication year |
| `journal` | Journal name |
| `doi` | DOI (URL prefix stripped) |
| `pmid` | PubMed ID |
| `abstract` | Abstract text |
| `source` | Import format: "RIS" \| "BibTeX" \| "PubMed" \| "EndNote" |
| `decision` | Screening decision: "" \| "include" \| "exclude" \| "maybe" |
| `reviewer2` | Second reviewer's decision |
| `notes` | Free-text notes |
| `dupOf` | ID of the earlier record this duplicates (null if unique) |

---

## Option Arrays

### SOURCE_OPTIONS
| Value | Label |
|---|---|
| (empty) | â€” where from? â€” |
| text | Reported in text |
| table | From a table |
| figure | Figure / Kaplanâ€“Meier curve |
| supplement | Supplementary material |
| calculated | Calculated from reported data |
| converted | Converted from another format |
| author | Obtained from authors |
| unclear | Unclear / needs verification |

### DATA_NATURE
| Value | Label | isNonPrimary |
|---|---|---|
| primary | Primary outcome (directly reported) | false |
| secondary | Secondary outcome | true |
| subgroup | Subgroup analysis | true |
| posthoc | Post-hoc analysis | true |
| sensitivity | Sensitivity analysis | true |

### ADJUST_OPTIONS
| Value | Label |
|---|---|
| unadjusted | Unadjusted |
| adjusted | Adjusted (covariates) |
| multivariable | Multivariable-adjusted |
| propensity | Propensity-matched |
| iptw | IPTW-adjusted |

### EXTRACT_FLAGS
| Value | Label |
|---|---|
| calc | Requires calculation |
| conv | Requires conversion |
| figure | Estimated from figure |
| notprimary | Not primary data |
| highrisk | High risk of extraction error |
| noconfirm | Do not pool unless confirmed |

---

## Effect-Measure Types (`ES_TYPES`)

| Key | Label | Family | Log scale | Null value | Internal scale |
|---|---|---|---|---|---|
| SMD | SMD (standardized mean diff) | continuous | No | 0 | SMD |
| MD | Mean Difference (raw units) | continuous-raw | No | 0 | MD |
| OR | Odds Ratio (log scale) | ratio | Yes | 0 | lnOR |
| RR | Risk Ratio (log scale) | ratio | Yes | 0 | lnRR |
| HR | Hazard Ratio (log scale) | ratio | Yes | 0 | lnHR |
| COR | Correlation (Fisher z) | correlation | No | 0 | z |
| PROP | Single-arm proportion (logit) | proportion | No | null | logit |

**PROP nullVal is null** because there is no universal "no effect" value for
a single-arm proportion â€” it depends on the clinical context.

---

## Risk-of-Bias Instruments

### ROB2 (Cochrane RoB 2 for randomised trials)
| Domain ID | Label |
|---|---|
| D1 | Randomisation process |
| D2 | Deviations from intended interventions |
| D3 | Missing outcome data |
| D4 | Measurement of the outcome |
| D5 | Selection of the reported result |

### NOS (Newcastleâ€“Ottawa Scale for observational studies)
| Domain ID | Group | Label |
|---|---|---|
| SC1 | Selection | Representativeness of exposed cohort |
| SC2 | Selection | Selection of non-exposed cohort |
| SC3 | Selection | Ascertainment of exposure |
| SC4 | Selection | Absence of outcome at start |
| CO1 | Comparability | Comparability (most important factor) |
| CO2 | Comparability | Comparability (additional factor) |
| OC1 | Outcome | Assessment of outcome |
| OC2 | Outcome | Adequate follow-up length |
| OC3 | Outcome | Adequate follow-up rate |

---

## isNonPrimary(s) Logic

A study is classified as non-primary if **any** of the following is true:

1. `dataNature` is set and is not "primary"
2. `flags` includes any of: "notprimary", "figure", "conv", "calc", "noconfirm", "highrisk"
3. `source` is one of: "figure", "converted", "calculated", "author", "unclear"
4. `converted === true`

Non-primary status affects poolability warnings when â‰¥ 50% of included
studies are non-primary.
