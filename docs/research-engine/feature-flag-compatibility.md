# Research Engine — Feature Flag Compatibility

**Date:** 2026-06-07
**Scope:** `src/research-engine/` vs planned admin feature flags in `GET /api/settings/public`
**Cross-reference:** `docs/research-engine/data-model-compatibility.md`

---

## 1. Feature Flag → Research Engine Function Mapping

### `advancedMetaAnalysis`

Gates the sensitivity, publication-bias, and subgroup computation layer.

| Function | File | API endpoint |
|---|---|---|
| `eggersTest` | `statistics/meta-analysis.js` | `POST /api/meta/egger` |
| `leaveOneOut` | `statistics/meta-analysis.js` | `POST /api/meta/sensitivity` |
| `influenceDiagnostics` | `statistics/meta-analysis.js` | `POST /api/meta/sensitivity` |
| `trimFill` | `statistics/meta-analysis.js` | `POST /api/meta/trimfill` |
| `subgroupAnalysis` | `statistics/meta-analysis.js` | `POST /api/meta/subgroup` |

`runMeta` (fixed/random pooling, HKSJ, prediction interval, Q/I²) is **not** part of this flag — see section 3.

---

### `exportTools`

Gates reference import (upload/parse/dedupe) and project JSON download.

| Function | File | API endpoint |
|---|---|---|
| `detectAndParse` | `import-export/parsers.js` | `POST /api/import/references` |
| `dedupeRecords` | `import-export/parsers.js` | `POST /api/import/references` |
| `parseRIS` | `import-export/parsers.js` | (called internally by detectAndParse) |
| `parseNBIB` | `import-export/parsers.js` | (called internally by detectAndParse) |
| `parseBibTeX` | `import-export/parsers.js` | (called internally by detectAndParse) |
| `parseEndNoteXML` | `import-export/parsers.js` | (called internally by detectAndParse) |
| `mkRecord` / `normTitle` | `import-export/parsers.js` | (called internally by parsers) |
| `exportProject` (server) | `server/controllers/importExportController.js` | `GET /api/export/project/:id` |

Note: `parseEndNoteXML` uses `DOMParser` and requires a browser DOM environment. It is already restricted to browser contexts; no server-side risk.

---

### `autosave`

No research engine functions are involved. Autosave is handled entirely by the `window.storage` bridge (`src/frontend/storage/serverStorage.js`), which calls `PUT /api/projects/:id/autosave`. The research engine's data model (`mkProject`, `mkStudy`) is agnostic to persistence timing — it only defines shapes.

The `autosave` flag should gate whether `window.storage.set` fires on change events in the frontend. The research engine produces no side-effects and does not call `window.storage` directly.

---

### `contactForm`, `projectDuplication`

No research engine functions are involved. These flags control UI-only or server-only features outside `src/research-engine/`.

---

## 2. Core Required Functions (must remain enabled)

The following functions underpin the 14-step workflow and must always be available regardless of feature flags. Disabling them would break basic project creation, study entry, or the primary pooled estimate.

| Function | Module | Why required |
|---|---|---|
| `mkProject` | `project-model/defaults.js` | Creates every new project; called by `projectsController.js` |
| `mkStudy` / `uid` | `project-model/defaults.js` | Creates every new study; called by `studiesController.js` and `recordsController.js` |
| `runMeta` | `statistics/meta-analysis.js` | Core pooled estimate — `POST /api/meta/run` |
| `calcES` | `effect-sizes/calculators.js` | Effect-size calculation from raw data |
| `validateStudy` | `validation/study-validator.js` | Per-study QC via `POST /api/validation/check` |
| `checkPoolability` | `validation/study-validator.js` | Project-level gate via `POST /api/validation/check` |
| `analysisTypeWarnings` | `validation/study-validator.js` | Cross-study QC via `POST /api/validation/check` |
| `CONVERSIONS` | `conversions/catalogue.js` | Unit/format conversions during data extraction |
| All constants / label maps | `project-model/constants.js` | Required by `checkPoolability` and `validateStudy` |
| Math helpers | `statistics/math-helpers.js` | Depended on by `runMeta`, `calcES`, `eggersTest` |

---

## 3. Safe-to-Disable vs Core Required

```
CORE (never disable)                         SAFE TO DISABLE (flag-gated)
─────────────────────────────────────────    ──────────────────────────────────────────
runMeta          → POST /api/meta/run        eggersTest       → advancedMetaAnalysis
mkProject        → projects CRUD            leaveOneOut      → advancedMetaAnalysis
mkStudy / uid    → studies/records CRUD     influenceDiag    → advancedMetaAnalysis
validateStudy    → POST /api/validation     trimFill         → advancedMetaAnalysis
checkPoolability → POST /api/validation     subgroupAnalysis → advancedMetaAnalysis
analysisTypeWarnings → /api/validation      detectAndParse   → exportTools
calcES           → effect-size calc         dedupeRecords    → exportTools
CONVERSIONS      → conversion panel         parseRIS/NBIB/BibTeX/XML → exportTools
constants        → labels + predicates      exportProject    → exportTools
math-helpers     → internal dependency      window.storage.set timer → autosave
```

---

## 4. Warnings

### 4.1 `advancedMetaAnalysis: false`

- `POST /api/meta/sensitivity`, `POST /api/meta/subgroup`, `POST /api/meta/egger`, and `POST /api/meta/trimfill` should return **HTTP 403** when the flag is off — not 404. A 404 would mislead the frontend into thinking the route does not exist, causing incorrect error messages.
- `runMeta` itself is **not** gated. The primary pooled estimate (fixed/random, HKSJ, prediction interval, Q/I²/τ²) is always computed. These fields are part of the `runMeta` return object, not separate endpoints.
- `findDuplicates` (`validation/study-validator.js`) is exported but currently called client-side or inline. It is not gated by any flag and should remain available.

### 4.2 `exportTools: false`

- Disabling `exportTools` must gate both directions: import (`POST /api/import/references`) and export (`GET /api/export/project/:id`).
- The `dedupeRecords` logic is only reachable through `importReferences`. No data-integrity consequence of disabling it — existing `project.records` arrays are unaffected.
- `parseEndNoteXML` uses `DOMParser`. If the flag ever controls server-side behaviour, this function must not be called in a Node.js process without a DOM shim (e.g. `jsdom`).

### 4.3 `autosave: false`

- The research engine has **no coupling to autosave**. The `window.storage` bridge is entirely frontend-side. Disabling autosave only means `window.storage.set` should be debounced or gated in the frontend; it has no effect on any function in `src/research-engine/`.
- `mkProject` and `mkStudy` write `created` / `modified` timestamps into the project blob. When autosave is disabled, these values will be stale (they record when the object was created in memory, not when it was last persisted). This is noted in `data-model-compatibility.md` §3.2 — the DB's `updatedAt` column is the authoritative post-save timestamp.

---

## 5. Data Model Round-Trip Compatibility

All research engine functions produce plain JSON-serialisable values (strings, numbers, booleans, plain objects, arrays — no `Date` objects, no functions, no `undefined`). Flag-gated endpoints operate on the same `mkStudy` / `mkProject` shapes regardless of whether they are enabled or disabled. No flag changes the data model schema.

For full round-trip analysis of `mkProject` / `mkStudy` through the `window.storage` bridge and Prisma, see **`docs/research-engine/data-model-compatibility.md`**.

Key interaction: if `autosave: false`, the `modified` field inside the project blob will lag behind actual user edits. The server's `updatedAt` column will be accurate only as of the last manual save. No research engine function reads `modified` or `updatedAt` — they are display-only fields.

---

## 6. Admin Console Descriptions (for UI)

Recommended display strings for the admin panel:

| Flag key | Display name | Description |
|---|---|---|
| `advancedMetaAnalysis` | Advanced Meta-Analysis | Enables sensitivity analysis (leave-one-out, influence diagnostics), publication-bias tests (Egger's test, trim-and-fill), and subgroup analysis. Core pooling is always available. |
| `exportTools` | Export & Import Tools | Enables project JSON download and reference import (RIS, BibTeX, PubMed NBIB, EndNote XML). |
| `autosave` | Autosave | Automatically persists unsaved changes to the server. When disabled, users must save manually. No effect on statistical computations. |
| `contactForm` | Contact Form | Shows the public contact form on the landing page. |
| `projectDuplication` | Project Duplication | Allows users to duplicate existing projects from the dashboard. |
