# META·LAB Research Engine

Pure-JavaScript ES-module library extracted from `meta-lab-3-patched.jsx`.
Contains all statistical, validation, conversion, and data-model logic with
**no React or JSX dependencies**.

---

## Module map

```
src/research-engine/
  index.js                    Central re-export barrel — import from here
  statistics/
    math-helpers.js           Low-level math: normalCDF, invNorm, tCDF, chiSquareCDF, etc.
    meta-analysis.js          runMeta, eggersTest, leaveOneOut, trimFill,
                              influenceDiagnostics, subgroupAnalysis
  effect-sizes/
    calculators.js            calcES — unified calculator for SMD/MD/OR/RR/HR/COR/PROP/DIAG
  conversions/
    catalogue.js              CONVERSIONS array (9 recipes) + re-exported invNorm
  validation/
    study-validator.js        validateStudy, analysisTypeWarnings, checkPoolability,
                              findDuplicates
  import-export/
    parsers.js                parseRIS, parseBibTeX, parseEndNoteXML, parseNBIB,
                              detectAndParse, mkRecord, normTitle, dedupeRecords
  project-model/
    defaults.js               uid, now, fmtDate, mkProject, mkStudy
    constants.js              SOURCE_OPTIONS, DATA_NATURE, ADJUST_OPTIONS, EXTRACT_FLAGS,
                              ES_TYPES, ROB2, NOS, label maps, isNonPrimary
  docs/
    statistical-validation.md Explains every statistical test and validation rule
    data-model.md             Explains all project/study fields
    agent-contract.md         Full export list with signatures (for the Backend Developer)
```

---

## Quick start

```js
import {
  runMeta,
  calcES,
  validateStudy,
  checkPoolability,
  CONVERSIONS,
  detectAndParse,
  mkProject,
  mkStudy,
} from './research-engine/index.js';

// 1. Build a project
const project = mkProject("My Review");

// 2. Add studies
const s = mkStudy();
s.author = "Smith"; s.year = "2022";
s.esType = "OR";
s.es = "-0.693"; s.lo = "-1.386"; s.hi = "0.000";  // log-OR

// 3. Validate before pooling
const issues = validateStudy(s);        // per-study checks
const gate   = checkPoolability([s]);   // project-level gate

// 4. Pool
const result = runMeta([s, ...otherStudies], "random");

// 5. Sensitivity
const loo    = leaveOneOut([s, ...otherStudies], "random");
const egger  = eggersTest([s, ...otherStudies]);

// 6. Effect-size from raw data
const es = calcES("OR", { a:10, b:90, c:5, d:95 });
// → { es: 0.6931, se: 0.4851, lo: -0.2577, hi: 1.6439, display: "OR=2.000 [0.775, 5.166]" }

// 7. Data conversion
const median2sd = CONVERSIONS.find(c => c.id === "median_iqr");
const out = median2sd.run({ q1:10, med:15, q3:20, n:50 });
// → { ok:true, values:{ mean:15.0000, sd:3.7153 }, formula:"…", detail:"…" }

// 8. Import references
const { records, format } = detectAndParse(fileText, "export.ris");
```

---

## How the backend uses it

The research engine is imported by the backend API layer (planned).  The
backend calls functions directly — no React context, no hooks.

Key integration points:

| Concern | Function(s) |
|---|---|
| Pool studies | `runMeta(studies, method)` |
| Validate before pooling | `checkPoolability(studies)` |
| Per-study QC | `validateStudy(s)` |
| Cross-study QC | `analysisTypeWarnings(studies)` |
| Effect-size from raw data | `calcES(type, params)` |
| Unit conversions | `CONVERSIONS[n].run(params)` |
| Sensitivity | `leaveOneOut`, `trimFill`, `influenceDiagnostics` |
| Subgroups | `subgroupAnalysis(studies, groupKey, method)` |
| Publication bias | `eggersTest(studies)` |
| Import references | `detectAndParse(text, filename)` |
| Deduplication | `dedupeRecords(existing, incoming)` |
| Create project | `mkProject(name)` |
| Create study | `mkStudy()` |

---

## Design decisions

1. **No dependencies** — all modules are pure ES2020 JS. No npm packages required.
2. **Formulas copied exactly** — every numeric constant and algorithm is a
   verbatim copy from the original JSX file. Do not optimise or refactor them.
3. **invNorm lives in math-helpers** and is re-exported from `conversions/catalogue.js`
   for convenience; there is only one implementation.
4. **`checkPoolability` imports `ADJUST_LABEL`, `DATA_NATURE_LABEL`, and
   `isNonPrimary`** from `project-model/constants.js` — no duplication.
5. **`parsers.js` imports `uid`** from `project-model/defaults.js` so record
   IDs are generated with the same algorithm as study IDs.
