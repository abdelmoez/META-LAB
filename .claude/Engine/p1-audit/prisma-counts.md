# P1 Audit — PRISMA 2020 Count Logic (the diagram, not the ORM)

Scope: where "records identified", "duplicates removed", "records screened" (and the rest of the
PRISMA 2020 flow) are **computed**, **stored**, and **rendered**. Documents the seam to auto-fill
**per-source identification counts** from a search run without double-counting on retry, and the
state of **PRISMA-S** support (none today).

> NOTE on the word "prisma": the codebase overloads it. `const prisma = new PrismaClient()` is the
> **ORM client** (ignore for this audit). The PRISMA **flow diagram** lives in `project.prisma`
> (a plain sub-object) and in `summary.prisma` (server response). This audit is about the latter.

---

## 0. TL;DR architecture — TWO parallel PRISMA worlds

There are two independent count pipelines with **different field names** and a translation layer
between them:

| | World A — canonical store / diagram | World B — screening-derived summary |
|---|---|---|
| Where | `project.prisma` blob (META·LAB workspace) | `GET /metalab/:mlpid/summary` → `summary.prisma` |
| Field names | `dbs, reg, other, dedupe, screened, excTA, excFull, reasons[], included, qual, quant` (all **strings**) | `identified, duplicatesRemoved, screened, excludedTitleAbstract, fullTextAssessed, fullTextExcluded, included` (all **numbers**) |
| Source of truth | manual entry OR pushed from World B | live `ScreenRecord` rows in the linked screening project |
| Renderer | `PRISMATab` (live boxes) + `buildPrismaSVG` (publication figure) | `MetaSiftPrismaSync` (read-only summary banner) |

World B is computed server-side from real screening data and **mapped into** World A's field names
by `MetaSiftPrismaSync.apply()` on the client. World A is what the diagram/SVG/methods text actually
read. There is a THIRD, **dead** computation: `computePrismaNumbers()` in the pure engine — exported,
unit-tested, but **not wired into any renderer or controller** (only its own test imports it).

---

## 1. COMPUTE — where counts are derived

### 1a. `computePrismaNumbers()` — pure engine, CURRENTLY DEAD CODE
`src/research-engine/screening/stats.js:32`
```js
export function computePrismaNumbers({ total, included, excluded, maybe, undecided, duplicates = 0 }) {
  return {
    identified:      total,
    deduplicated:    total - duplicates,
    screened:        included + excluded + maybe,
    excluded_title:  excluded,
    full_text:       included + maybe,
    included_final:  included,
  };
}
```
- Sibling `computeStats(total, decisions)` at `stats.js:12` returns
  `{ total, screened, included, excluded, maybe, undecided, progress }`.
- **Only** importer: `tests/screening/unit/stats.test.js:8`. No controller, no UI. Field names
  (`deduplicated`, `excluded_title`, `full_text`, `included_final`) match **neither** World A nor
  World B — it is an orphan. Treat as a reference spec, not a live path.

### 1b. Server summary — the REAL screening-derived computation (World B)
`server/controllers/screeningController.js:1760` `export async function getMetaLabSummary(req, res)`
(route: `GET /metalab/:mlpid/summary`, comment header at L1751). Counts (L1785–1792):
```js
const total              = records.length;
const duplicatesRemoved  = records.filter(r => r.isDuplicate).length;
const screened           = Math.max(0, total - duplicatesRemoved);
const fullTextAssessed   = records.filter(r => r.currentStage === 'full_text').length;
const excludedTitleAbstract = Math.max(0, screened - fullTextAssessed);
const fullTextExcluded   = records.filter(r => r.finalStatus === 'rejected').length;
const acceptedRecords    = records.filter(r => r.finalStatus === 'accepted');
const includedFinal      = acceptedRecords.length;
```
Emitted shape (L1819–1828):
```js
res.json({
  linked: true,
  screeningProjectId, title,
  prisma: { identified: total, duplicatesRemoved, screened, excludedTitleAbstract,
            fullTextAssessed, fullTextExcluded, included: includedFinal },
  screeningStarted, screeningComplete,
  screeningPending: { titleAbstractPending, unresolvedConflicts, unresolvedDuplicateGroups, secondReviewPending },
  acceptedStudies,   // studyFromRecord(r) for each finalStatus==='accepted' record
});
```
- `identified` = **all** `ScreenRecord` rows for the project (duplicates included, by design — PRISMA
  counts dups under "identified" then removes them).
- `duplicatesRemoved` reads the `isDuplicate` boolean flag, set by the dedup service, NOT recomputed here.
- This is the **canonical live counter**. No per-source breakdown is computed here today (see §5).

### 1c. Client-side derived arithmetic in the diagram (World A)
`src/frontend/workspace/tabs/screeningTabs.jsx:287-288` inside `PRISMATab`:
```js
const dbs=+prisma.dbs||0, reg=+prisma.reg||0, other=+prisma.other||0, total=dbs+reg+other;
const dedupe=+prisma.dedupe||0, screened=total-dedupe, excTA=+prisma.excTA||0,
      ftRet=screened-excTA, excFull=+prisma.excFull||0, included=ftRet-excFull;
```
- Note the **field-name asymmetry**: here `included` is a DERIVED value `ftRet-excFull`, but the
  IDENTIFICATION input block also exposes an `included` override input (label "Studies included
  (override)", L302). The stored `prisma.included` is both an input and shadowed by a local derived
  `included`. Watch this when wiring auto-fill.
- `buildPrismaSVG` repeats the **same arithmetic independently** —
  `src/frontend/workspace/charts/svgBuilders.js:76-77`:
  ```js
  const dbs=n("dbs"),reg=n("reg"),other=n("other"),total=dbs+reg+other;
  const dedupe=n("dedupe"),screened=total-dedupe,excTA=n("excTA"),ftRet=screened-excTA,
        excFull=n("excFull"),included=ftRet-excFull;
  ```
  Identification text at L98; duplicate side-box at L101. Any P1 change to the count model must
  update BOTH `PRISMATab` and `buildPrismaSVG` (duplicated logic, not shared).

### 1d. Legacy in-workspace manual screener (still in source, no longer rendered)
`screeningTabs.jsx:79` `syncToPrisma()` (inside `ScreeningModule`) writes World A fields from in-blob
`project.records[]` decisions:
```js
updateProject(activeId,p=>({...p,prisma:{...p.prisma,
  dbs:String(records.length), dedupe:String(dups),
  excTA:String(excluded), included:String(included),
}}));
```
Per the comment at L189-191 this manual module is prederved but **not rendered** — screening is owned
by the linked screening project. Do NOT build P1 on top of `project.records`; use `ScreenRecord`.

---

## 2. STORE — data shapes & persistence

### 2a. `project.prisma` sub-object (World A, canonical store)
Defaults: `src/research-engine/project-model/defaults.js:67-72`
```js
prisma: {
  dbs: "", reg: "", other: "", dedupe: "", screened: "",
  excTA: "", excFull: "",
  reasons: [{ id: uid(), r: "", n: "" }],
  included: "", qual: "", quant: "",
},
```
Documented in `src/research-engine/docs/data-model.md:52-67` ("prisma sub-object"). Field meanings:
`dbs`=records from databases, `reg`=registers, `other`=other sources, `dedupe`=duplicates removed,
`screened`, `excTA`=excluded title/abstract, `excFull`=excluded full-text, `reasons[]`=
`{id, r(reason), n(count)}`, `included`, `qual`, `quant`. **All values are strings** (free-text
number inputs). Persisted as part of the `Project.data` blob (the whole workspace project object),
NOT a dedicated table. Edited via `updNested("prisma", k, v)` (`PRISMATab.ch`, L283).

### 2b. `ScreenRecord` — the real per-record store (World B inputs)
`server/prisma/schema.prisma:484` (mirror: `server/prisma/postgres/schema.prisma:498`). Fields
relevant to PRISMA counting and to P1 provenance:
```
id, projectId
importBatchId  String?  → ScreenImportBatch     // PROVENANCE: which import produced this row
duplicateGroupId String? → ScreenDuplicateGroup
isPrimary      Boolean @default(false)
isDuplicate    Boolean @default(false)           // → duplicatesRemoved count
doi, pmid, title, authors, year, journal, abstract, keywords
sourceDb       String  @default("")              // PROVENANCE: per-source label ("PubMed", "Embase"…)
rawData        String  @default("{}")
currentStage   String  @default("title_abstract")// title_abstract | full_text → fullTextAssessed
finalStatus    String  @default("")              // "" | accepted | rejected → fullTextExcluded / includedFinal
handoffStatus / handoffStudyId / handoffAt …     // Data Extraction handoff (idempotent re-sync)
```

### 2c. `ScreenImportBatch` — import provenance + retry fingerprint
`server/prisma/schema.prisma:613-631`
```
id, projectId, filename, format, recordCount
fileHash       String?   // sha256 of line-ending-normalized content (prompt6 Task 19)
fileSize       Int?
importedById / importedByName / parser
@@index([projectId, fileHash])                   // ← KEY for retry-idempotency
```
Plus `ScreenImportJob` (`schema.prisma:640`, prompt50 WS2) — durable/retryable import job, "Idempotent
by (projectId, fileHash)" per its header comment. This is the existing retry-safety primitive.

---

## 3. RENDER — where counts are shown

- **Live flow boxes**: `PRISMATab` `src/frontend/workspace/tabs/screeningTabs.jsx:281-360`. Left column
  = editable IDENTIFICATION/SCREENING/INCLUDED number inputs (L300-302) bound to `prisma[k]`; right
  column = "LIVE FLOW DIAGRAM" `FlowBox`/`Arrow` built from the derived locals (L329-354). Includes
  per-reason exclusion list (L318-324, 346).
- **Publication SVG/PNG figure**: `PrismaFigureExport` `screeningTabs.jsx:363-402` → `buildPrismaSVG(prisma, opts)`
  at `src/frontend/workspace/charts/svgBuilders.js:73`. Exported via `openExportDialog` (`id:"prisma-figure"`,
  PNG/SVG). Also bundled into the journal ZIP — `Workspace.jsx:710-723` ("Preparing PRISMA diagram…",
  emits `figures/prisma-diagram.svg` + `.png`).
- **Read-only auto-fill banner**: `MetaSiftPrismaSync` `screeningTabs.jsx:192-279` — fetches the summary,
  shows `p.identified … p.duplicatesRemoved … p.screened …` (L275), and calls `apply()` to push into
  World A.
- **Methods prose**: `src/research-engine/docs/methodsText.js:83-90` reads `prisma.identified`,
  `prisma.deduped`, `prisma.included` (note: `deduped`, a THIRD name variant — currently always
  null/absent in the blob, so that clause never renders today).
- **Reporting checklist** (separate concern): `PRISMA_CL` constant
  `src/research-engine/project-model/monolithConstants.js:57` rendered by `ReportTab`
  (`src/frontend/workspace/tabs/reportTabs.jsx:40-52`). This is the 27-item **checklist**, not the
  flow counts.
- Stitch parallel design surface: `src/frontend/stitch/pages/StitchProjectOverview.jsx` (overview only;
  PRISMA tab falls back to legacy per the design-layer doc).

---

## 4. THE SYNC SEAM (World B → World A) — field-name translation
`MetaSiftPrismaSync.apply(summary)` `screeningTabs.jsx:195-226`:
```js
const p = summary.prisma;
const next = { ...cur,
  dbs:   String(p.identified),  reg:"0", other:"0",
  dedupe:String(p.duplicatesRemoved),
  excTA: String(p.excludedTitleAbstract),
  excFull:String(p.fullTextExcluded),
  included:String(p.included),
};
```
- Maps `identified → dbs` (lumps ALL identified into the "databases" bucket; `reg`/`other` forced to
  `"0"`). **This is exactly where per-source breakdown is lost today** — see §5.
- Idempotency guard: `samePrisma` compares the 7 fields; also pull-merges `acceptedStudies` into
  `proj.studies` deduped by `screeningRecordId|doi|pmid|normalized-title` (L211-219). Returns `proj`
  unchanged if nothing differs (no spurious writes / autosave churn).
- Triggered on mount (`load(true)`, L237) and "Sync now" button (L262, 270). Server fetch at L230:
  `GET /api/screening/metalab/${project.id}/summary`.

---

## 5. P1 SEAM — auto-fill PER-SOURCE identification counts without double-count on retry

**Goal**: a search run (P1 fetches N records from PubMed, M from Embase, …) should populate the
PRISMA "Identification" boxes per database, and a **retry** of the same source must not inflate counts.

### What already exists (REUSE)
1. **Per-source label is already stored**: `ScreenRecord.sourceDb` (`schema.prisma:502`), written by
   `dedupeAndInsertRecords` at `screeningImportService.js:140`
   (`sourceDb: String(r.sourceDb || r.source || format)…`). A `GROUP BY sourceDb` over non-duplicate
   records yields per-source identification counts directly.
2. **Import provenance**: `ScreenRecord.importBatchId` → `ScreenImportBatch` (filename/format/parser/
   `fileHash`/`recordCount`). One batch row per import.
3. **Retry idempotency primitive**: `@@index([projectId, fileHash])` on `ScreenImportBatch`
   (`schema.prisma:630`) + `ScreenImportJob` "idempotent by (projectId, fileHash)" (`schema.prisma:638`).
   A re-run with identical content is recognizable by `fileHash`.
4. **Record-level dedup already prevents double-count**: `dedupeAndInsertRecords`
   (`screeningImportService.js:69-105`) seeds `seenDois/seenPmids/seenTitles` from EXISTING project
   records (L78-89) and skips any incoming row whose doi/pmid/normTitle already exists (L97-100).
   So re-importing the same source does NOT create new `ScreenRecord` rows → `total`/`identified`
   stays correct on retry **at the record level**.

### What must be BUILT for P1
- **A per-source identification count surface.** Today `getMetaLabSummary` returns only a flat
  `identified` total; the sync collapses it to `dbs` and zeros `reg`/`other`. Build either:
  - (a) a `bySource` map in the summary response, e.g.
    `prisma.bySource = { PubMed: <count of non-duplicate records where sourceDb='PubMed'>, … }`
    computed from `records` already loaded at `screeningController.js:1780`; OR
  - (b) a dedicated search-run endpoint that aggregates `ScreenRecord` GROUP BY `sourceDb`.
- **A retry-safe identification ledger keyed by search run, not by file.** `fileHash` dedups identical
  *files*; a P1 *search run* against a live API returns different bytes each retry (timestamps, order),
  so `fileHash` alone will NOT recognize a retried run. P1 needs a stable **searchRunId / source+query
  fingerprint** so the "records identified from PubMed" number is set to the run's reported hit-count
  ONCE, idempotently — not incremented per retry. There is **no `searchRunId` column today**; the
  closest existing anchors are `importBatchId` + `sourceDb`. Recommended: add a nullable
  `searchRunId` (additive `prisma db push`-safe, matching the established additive-migration pattern)
  on `ScreenRecord` and/or a new `SearchRun` table, then have the summary count by `(searchRunId,
  sourceDb)` and dedup the *identified* figure to the run's authoritative API-reported total rather
  than the inserted-row count (raw API totals ≠ post-dedup inserted rows — PRISMA "identified" should
  reflect the API-reported number BEFORE in-tool dedup, which `total` currently does not capture for a
  retry that inserts 0 rows).
- **Extend the sync map** at `screeningTabs.jsx:200-206` to distribute `bySource` into `dbs`/`reg`/
  `other` (or a richer per-source structure) instead of dumping everything into `dbs` and zeroing the
  rest. The current hardcoded `reg:"0", other:"0"` is the explicit lossy step to replace.
- **Wire/replace `computePrismaNumbers()`** or retire it. If P1 wants a single shared counting function,
  this orphan in `stats.js` is the natural home — but its field names must be reconciled with World A
  (`dbs/dedupe/excTA/...`) and World B (`identified/duplicatesRemoved/...`); today it matches neither.

### Integration points (exact)
- Server compute/emit: `server/controllers/screeningController.js:1785-1828` (`getMetaLabSummary`).
- Insert/provenance: `server/services/screeningImportService.js:116-153` (batch + `sourceDb`).
- Dedup gate (retry safety): `server/services/screeningImportService.js:78-105`.
- Client translation (lossy): `src/frontend/workspace/tabs/screeningTabs.jsx:195-226`.
- Diagram + SVG arithmetic (must stay consistent): `screeningTabs.jsx:287-288` &
  `src/frontend/workspace/charts/svgBuilders.js:76-77`.
- Schema (additive): `server/prisma/schema.prisma:484` (ScreenRecord) & `:613` (ScreenImportBatch) +
  the postgres mirror `server/prisma/postgres/schema.prisma:498/627` — **both must be kept in sync**.

---

## 6. PRISMA-S support — NONE today (as expected)
- No PRISMA-S (search reporting) data model, endpoint, or UI exists. Only mentions:
  - `src/research-engine/searchBuilder/crossConcept.js:12` — a code comment referencing a
    "PRESS/PRISMA-S system" pointing at `docs/manager/search-builder-future-enhancements.md` (roadmap
    note, not an implementation).
- The search-strategy reporting fields that DO exist are PRISMA-2020 items, not PRISMA-S:
  `protocolTabs.jsx:468` "Date Last Searched (PRISMA item 7)" and `:481` "full search strategy".
  `project.search` blob (`defaults.js:58-66`: `dbs` map, `date`, `string`, `notes`) holds the strategy
  text but has no per-source result-count / dedup-method / filter fields that PRISMA-S requires.
- P1 implication: per-source hit counts, dedup method, and date-of-search fields needed for a PRISMA-S
  checklist are **greenfield**. The `sourceDb` + `ScreenImportBatch` provenance is the only existing
  scaffolding to build on.

---

## 7. Tests / docs anchors
- `tests/screening/unit/stats.test.js` — exercises `computeStats` + `computePrismaNumbers` (the dead path).
- `src/research-engine/screening/README.md:106-107` — documents both stats functions.
- `src/research-engine/docs/data-model.md:52-67` — the `prisma` sub-object field table.
- `server/docs/screening-api-contract.md` — screening API (Records/Duplicates/Stats sections).

## 8. Gotchas summary
1. THREE field-name vocabularies for the same flow (`dbs/dedupe/excTA…` vs `identified/duplicatesRemoved…`
   vs `deduplicated/excluded_title…`). Reconcile before adding fields.
2. `project.prisma` values are **strings**, not numbers; coerced with `+x||0` at render time.
3. Count arithmetic is **duplicated** in `PRISMATab` and `buildPrismaSVG` — change both.
4. The sync hard-zeros `reg`/`other` and lumps all into `dbs` — the explicit lossy spot for per-source.
5. `fileHash` retry-idempotency keys on *file bytes*; a live API search run won't reproduce bytes, so
   it is NOT sufficient to dedup a retried *search run* — needs a run-level key.
6. `identified` = raw `ScreenRecord` count (incl. duplicates), which on a 0-insert retry will not move
   even though the API "identified" total should be recorded — distinguish API-reported vs inserted.
7. Two schema files (sqlite `schema.prisma` + `postgres/schema.prisma`) must stay in lockstep.
8. `computePrismaNumbers()` is dead — don't assume it drives anything.
