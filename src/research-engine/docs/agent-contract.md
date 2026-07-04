# Agent Contract — Research Engine Exports

This file lists every exported function and constant in the Research Engine
with its source file, signature, and a one-line description of its return value.
It is the authoritative import reference for the Backend Developer.

All exports are also available from the barrel:
  `src/research-engine/index.js`

---

## statistics/math-helpers.js

| Export | Signature | Returns |
|---|---|---|
| `Z975` | `const number` | Exact value 1.959963984540054 (qnorm(0.975)) |
| `normalCDF` | `(z: number) → number` | P(Z ≤ z) via Abramowitz & Stegun rational approx |
| `invNorm` | `(p: number) → number` | z such that Φ(z) = p (Acklam); NaN if p ≤ 0 or p ≥ 1 |
| `invNormAbs` | `(p: number) → number` | Absolute z for upper-tail probability (e.g. 0.975 → 1.96) |
| `lgamma` | `(z: number) → number` | ln Γ(z) via Lanczos approximation |
| `betacf` | `(x: number, a: number, b: number) → number` | Continued-fraction evaluation of the incomplete beta function |
| `ibeta` | `(x: number, a: number, b: number) → number` | Regularised incomplete beta I_x(a,b) ∈ [0,1] |
| `gammp` | `(a: number, x: number) → number` | Regularised lower incomplete gamma P(a,x) ∈ [0,1] |
| `chiSquareCDF` | `(x: number, df: number) → number` | P(χ²(df) ≤ x) |
| `tCDF` | `(t: number, df: number) → number` | P(T ≤ t) for Student-t with df degrees of freedom |
| `tCrit` | `(conf: number, df: number) → number` | t* such that P(-t* < T < t*) = conf; uses normal fallback if df is infinite |

---

## statistics/meta-analysis.js

| Export | Signature | Returns |
|---|---|---|
| `runMeta` | `(studies: Study[], method?: "fixed"\|"random", opts?: { tau2Method?: string }) → MetaResult\|null` | Full pooled meta-analysis result (see shape below); null if < 2 valid studies. `opts.tau2Method` selects the between-study variance estimator (default `"DL"` — existing results are byte-for-byte unchanged). |
| `estimateTau2` | `(y: number[], v: number[], opts?: { method?: string, maxIter?: number, tol?: number }) → { tau2, method, converged, iterations, fallback }` | RoadMap/2.md between-study variance (τ²) estimator. Methods: DL (default), REML, ML, PM, EB, SJ, HO, HS. Iterative estimators fall back to DL for k<3 / non-convergence (`fallback:"DL"`). Re-exported from `statistics/tau2.js`. |
| `TAU2_METHODS` | `string[]` | The eight supported τ² estimator keys (DL, REML, ML, PM, EB, SJ, HO, HS). |
| `TAU2_LABELS` | `Record<string,string>` | Human-readable label per τ² estimator (e.g. `DL` → "DerSimonian–Laird"). |
| `eggersTest` | `(studies: Study[]) → EggerResult\|null` | Canonical UNWEIGHTED OLS regression test for funnel asymmetry (Egger 1997 / metafor::regtest(model="lm")); null if k < 3 |
| `leaveOneOut` | `(studies: Study[], method?: string) → LOOEntry[]` | Array of per-study LOO results; empty if k < 3 |
| `trimFill` | `(studies: Study[], method?: string) → TrimFillResult\|null` | Trim-and-fill result with imputed studies and adjusted pooled estimate |
| `influenceDiagnostics` | `(studies: Study[], method?: string) → InfluenceEntry[]` | Per-study influence metrics (DFFIT, τ²-drop, I²-drop, influential flag) |
| `subgroupAnalysis` | `(studies: Study[], groupKey: string, method?: string) → SubgroupResult` | Per-group meta-analysis results plus Q-between test |

### MetaResult shape
```
{
  studies: Study[],        // each study extended with _es, _lo, _hi, _se, _w, _wFixed/Random(Pct)
  k: number,               // number of studies pooled
  Q: number,               // Cochran Q statistic
  Qpval: number,           // p-value for Q (chi-square, df = k-1)
  I2: number,              // I² (%)
  I2desc: string,          // "low" | "moderate" | "substantial" | "considerable"
  tau2: number,            // DerSimonian–Laird τ² (for the active model)
  tau: number,             // √τ² (for the active model)
  pES: number,             // pooled effect size
  pSE: number,             // pooled SE
  lo95: number,            // 95% CI lower
  hi95: number,            // 95% CI upper
  pval: number,            // overall p-value (z-test)
  z: number,               // z-statistic
  method: string,          // "fixed" | "random"
  W: number,               // total fixed-effects weight
  fixed: { es, se, lo, hi },   // fixed-effects results (always present)
  random: { es, se, lo, hi, tau2 }, // random-effects results (always present)
  hksj: HKSJResult | null, // HKSJ adjustment (null only if k < 2)
  predInt: PredIntResult | null  // prediction interval (null if k < 3)
}
```

---

## effect-sizes/calculators.js

| Export | Signature | Returns |
|---|---|---|
| `calcES` | `(type: string, params: object) → ESResult\|null` | `{ es, se, lo, hi, [display] }` on success, null on bad input |

**Supported types:** "SMD", "MD", "OR", "RR", "HR", "COR", "PROP", "DIAG"

| Type | Required params |
|---|---|
| SMD | `{ n1, n2, sd1, sd2, m1, m2 }` |
| MD  | `{ n1, n2, sd1, sd2, m1, m2 }` |
| OR  | `{ a, b, c, d }` (2×2 table) |
| RR  | `{ a, b, c, d }` |
| HR  | `{ hr, lo, hi }` (reported HR and CI) |
| COR | `{ r, n }` |
| PROP | `{ events, total }` |
| DIAG | `{ tp, fp, fn, tn }` |

---

## conversions/catalogue.js

| Export | Signature | Returns |
|---|---|---|
| `invNorm` | `(p: number) → number` | Re-export from math-helpers — inverse normal CDF |
| `CONVERSIONS` | `ConversionRecipe[]` | Array of 9 conversion recipe objects |

### ConversionRecipe shape
```
{
  id: string,
  group: string,
  label: string,
  inputs: [string, string][],   // [[fieldName, displayLabel], …]
  method: string,
  run: (params: object) → { ok: true, values: object, formula: string, detail: string }
                         | { ok: false, error: string }
}
```

### CONVERSIONS index
| id | Description |
|---|---|
| median_iqr | Median + IQR → Mean & SD (Wan 2014) |
| median_range | Median + Range → Mean & SD (Wan 2014 / Hozo 2005) |
| se_sd | SE → SD |
| ci_sd | 95% CI of a mean → SD |
| pval_se | P-value + effect → SE |
| pct_events | Percentage → Event count |
| events_pct | Event count → Percentage |
| ratio_log | OR/RR/HR → log scale + SE from CI |
| unit_scale | Linear unit conversion (multiply by factor) |

---

## validation/study-validator.js

| Export | Signature | Returns |
|---|---|---|
| `validateStudy` | `(s: Study) → ValidationItem[]` | Array of `{ sev: "error"\|"warn", field: string, msg: string }` |
| `analysisTypeWarnings` | `(studies: Study[]) → WarningItem[]` | Array of `{ sev, id, author, msg }` for studies where raw data mismatches esType |
| `checkPoolability` | `(studies: Study[]) → PoolabilityResult` | `{ ok, blockers[], warnings[], valid[], types?, designs?, composition? }` |
| `findDuplicates` | `(studies: Study[]) → { [id: string]: true }` | Map of study IDs flagged as duplicates |

### PoolabilityResult shape
```
{
  ok: boolean,
  blockers: string[],   // hard stops — pooling should not proceed
  warnings: string[],   // soft concerns — pooling may proceed with caution
  valid: Study[],       // studies with a usable ES + CI
  types?: string[],     // unique esType values found
  designs?: string[],   // unique design values found
  composition?: {
    total: number,
    nonPrimary: number,
    converted: number,
    primary: number,
    natures: string[],
    adj: string[]
  }
}
```

---

## import-export/parsers.js

| Export | Signature | Returns |
|---|---|---|
| `normTitle` | `(t: string) → string` | Lower-case, non-alphanumeric-collapsed title for dedup keying |
| `mkRecord` | `(r: object) → CiteRecord` | Canonical citation record with fresh uid and empty screening fields |
| `parseRIS` | `(text: string) → CiteRecord[]` | Array of records parsed from RIS format |
| `parseNBIB` | `(text: string) → CiteRecord[]` | Array of records parsed from PubMed NBIB / MEDLINE format |
| `parseBibTeX` | `(text: string) → CiteRecord[]` | Array of records parsed from BibTeX format |
| `parseEndNoteXML` | `(text: string) → CiteRecord[]` | Array of records parsed from EndNote XML; requires DOM |
| `parseCSV` | `(text: string, delim?: string) → CiteRecord[]` | Delimited table (comma/tab/semicolon auto-detected); header maps to known fields; attaches `url`/`keywords` when present (roadmap 1.4) |
| `parseTXT` | `(text: string) → CiteRecord[]` | Delimited-table TXT if a header is recognised, else one record per line (title) (roadmap 1.4) |
| `parseCIW` | `(text: string) → CiteRecord[]` | Web of Science / Clarivate tagged export; PT…ER blocks, AF-preferred authors, keyword collection (roadmap 1.4) |
| `detectAndParse` | `(text: string, filename?: string) → { records: CiteRecord[], format: string }` | Auto-detect format and parse; `format` is "RIS"\|"BibTeX"\|"PubMed nbib"\|"EndNote XML"\|"CIW (Web of Science)"\|"CSV"\|"TXT"\|"MEDLINE"\|"unknown" |
| `dedupeRecords` | `(existing: CiteRecord[], incoming: CiteRecord[]) → { merged: CiteRecord[], dupCount: number, added: number }` | Merge incoming into existing, tagging duplicates by DOI, PMID, or normalised title+year |

---

## screening/pdfMatching.js (roadmap 1.4)

| Export | Signature | Returns |
|---|---|---|
| `extractIdentifiersFromFilename` | `(filename: string) → { doi, pmid, year, titleHint }` | Pull DOI/PMID/year/title hints from a PDF filename (incl. "/"→"_" DOI recovery) |
| `normalizeDoi` | `(doi: string) → string` | Lower-case, strip URL prefix + trailing punctuation |
| `findDoiInText` | `(text: string) → string` | Best-effort DOI from decoded PDF text (XMP/Info-dict/uncompressed); '' if none. `matchPdfToRecords` reads `pdf.pdfText` |
| `classifyMatch` | `(confidence: number) → "auto"\|"review"\|"unmatched"` | Band a confidence (≥0.90 auto, ≥0.70 review) |
| `matchPdfToRecords` | `(pdf, records) → Array<{recordId, confidence, matchedBy, disposition}>` | Ranked candidate matches (DOI/PMID/title[+year]) |
| `bestPdfMatch` | `(pdf, records) → {recordId, confidence, matchedBy, disposition, candidates}\|null` | Top match (demotes near-tie title matches to review); null below the review floor |
| `AUTO_ATTACH_THRESHOLD` / `REVIEW_THRESHOLD` | `number` | 0.90 / 0.70 |

Network OA resolution + attachment live in the BACKEND (`server/services/oaPdfResolver.js`,
`server/controllers/screeningOaController.js`) — never in the engine.

## screening/agreement.js (roadmap 1.3)

| Export | Signature | Returns |
|---|---|---|
| `cohenKappa` | `(r1: any[], r2: any[]) → KappaResult\|null` | Cohen's κ for two raters with normal-approx CI; null if length mismatch / no paired items |
| `fleissKappa` | `(matrix: number[][]) → FleissResult\|null` | Fleiss' κ for m raters (constant count) with asymptotic SE under H0; null if non-constant rater count |
| `toFleissMatrix` | `(perSubject: any[][], categories?: string[]) → { matrix: number[][], categories: string[] }` | Build a Fleiss count matrix from per-subject rater labels |
| `interpretKappa` | `(k: number) → string` | Landis & Koch band: "poor"\|"slight"\|"fair"\|"moderate"\|"substantial"\|"almost perfect" |

`KappaResult` = `{ kappa, po, pe, se, lo, hi, n, categories, raters, interpretation }`.
`FleissResult` = `{ kappa, Pbar, Pe, se, lo, hi, N, raters, categories, pj, interpretation }`.

## screening/sampling.js (roadmap 1.3)

| Export | Signature | Returns |
|---|---|---|
| `mulberry32` | `(seed: number) → () => number` | Deterministic 32-bit PRNG yielding values in [0,1) |
| `seededPermutation` | `(len: number, seed: number) → number[]` | Reproducible Fisher–Yates permutation of [0..len) |
| `seededSample` | `(items: any[], n: number, seed: number) → { sample, indices, seed, n, total }\|null` | Reproducible random subset of size n (clamped) from a stored seed |

---

## project-model/defaults.js

| Export | Signature | Returns |
|---|---|---|
| `uid` | `() → string` | Random 8-character alphanumeric ID |
| `now` | `() → string` | Current time as ISO-8601 string |
| `fmtDate` | `(iso: string) → string` | "Mon DD, YYYY" formatted date, or "—" for falsy input |
| `mkProject` | `(name: string) → Project` | New project object with all fields at default empty state |
| `mkStudy` | `() → Study` | New study object with all fields at default empty state |

---

## project-model/constants.js

| Export | Type | Description |
|---|---|---|
| `SOURCE_OPTIONS` | `[string, string][]` | Option pairs [value, label] for data source selector |
| `DATA_NATURE` | `[string, string, boolean][]` | Option tuples [value, label, isNonPrimary] |
| `ADJUST_OPTIONS` | `[string, string][]` | Option pairs for adjustment status selector |
| `EXTRACT_FLAGS` | `[string, string][]` | Option pairs for reliability flags multi-select |
| `DATA_NATURE_LABEL` | `Record<string, string>` | Map from DATA_NATURE value → label |
| `ADJUST_LABEL` | `Record<string, string>` | Map from ADJUST_OPTIONS value → label |
| `FLAG_LABEL` | `Record<string, string>` | Map from EXTRACT_FLAGS value → label |
| `SOURCE_LABEL` | `Record<string, string>` | Map from SOURCE_OPTIONS value → label |
| `isNonPrimary` | `(s: Study) → boolean` | True if study is flagged, non-primary, converted, or from an indirect source |
| `ES_TYPES` | `Record<string, ESTypeMeta>` | Metadata for SMD, MD, OR, RR, HR, COR, PROP — includes `log`, `nullVal`, `scale`, `family` |
| `ROB2` | `{ id: string, label: string }[]` | Cochrane RoB 2 domain definitions (5 domains) |
| `NOS` | `{ id: string, g: string, label: string }[]` | Newcastle–Ottawa Scale domain definitions (9 domains) |

## RoB engine — Risk of Bias (`src/research-engine/rob/`, rob.md)

Pure RoB 2 engine (effect-of-assignment / ITT variant). Validated against the
official Cochrane RoB 2 tables — see `rob-validation.md`. Re-exported from the
top barrel with a `rob`/`ROB_*` prefix (the full instrument is `ROB2_INSTRUMENT`
there, to avoid colliding with the legacy `ROB2` domain-list constant).

| Export (from `rob/index.js`) | Signature | Returns |
|---|---|---|
| `ROB2` | frozen object | RoB 2 instrument DATA (domains, signalling questions, options, guidance, declarative branching) — JSON-serialisable |
| `judgeDomain(domainId, answers)` | `(string, {qid:resp}) → {judgment, reasons[]}` | algorithm-proposed domain judgement + why-trace |
| `judgeOverall(domainJudgments)` | `({domainId:'low'|'some'|'high'}|[]) → {judgment, reasons[], multiSomeConcernsFlag}` | overall roll-up (Table 1) |
| `getInstrument(id='RoB2')` | `(string) → Instrument` | frozen instrument |
| `isReachable(question, answers)` | `→ boolean` | declarative branch evaluation |
| `nextQuestions(instrument, domainId, answers)` | `→ Question[]` | currently-reachable questions |
| `proposeDomain` / `proposeAllDomains` | see engine.js | `{domainId,judgment,reasons}` / map |
| `proposeOverall(instrument, domainJudgments)` | `→ {judgment, reasons, multiSomeConcernsFlag}` | overall |
| `completeness(instrument, {answersByDomain})` | `→ {perDomain, overall}` | answered/required/missing |
| `summaryMatrix(assessments[], instrument)` | `→ {instrumentId, domains[], rows[]}` | traffic-light feed |
| `RESPONSES` / `JUDGMENTS` (+ `*_LABELS`) | arrays / maps | `Y/PY/PN/N/NI/NA`, `low/some/high` |

`synthesisHooks.js` (stubs): `annotateForestRows(effectRows, robByStudy)`,
`gradeRiskOfBiasInput(assessments)` — extension points for forest annotation / GRADE.
