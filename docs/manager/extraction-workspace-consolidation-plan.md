# Extraction workspace consolidation — plan (RoadMap/1.md)

PecanRev v3.67.0 → one protocol-scoped extraction workspace: inline PDF viewer (left) +
study form (right), four extraction methods (auto → pick-a-source → click/drag → manual),
all writing the same per-outcome data model. Deterministic first; the LLM path stays
optional, OFF by default, honestly labeled.

## 1. Current behavior (inspected)

### 1.1 Classic mode (always on)
`src/frontend/workspace/tabs/extractionTabs.jsx` (1060 lines) renders the Data Extraction
tab (`TABS` id `extraction`, rendered by both legacy `Workspace.jsx:1562` and Stitch
`StitchProjectWorkspace.jsx:263`). It edits `project.studies` (mkStudy rows,
`project-model/defaults.js:100`) via `updateProject(activeId, updater)` — blob autosave
(legacy `window.storage`, Stitch `PUT /api/projects/:id/autosave`, 800 ms debounce).
Cards + table views, filters/sorts (`extractionOrder.js`), ES calculator (`calcES`),
conversion panel (`CONVERSIONS`, audit trail), validation (`validateStudy`), duplicates,
poolability QC, CSV export. **No PDF viewer.**

### 1.2 Structured mode (flag `extractionAssist`, default OFF)
`src/features/extraction/ExtractionWorkspace.jsx` — Data-Element forms (server-side
Prisma: ExtractionForm/Value/Assignment/Consensus/AiExtractionSuggestion/ParsedTable),
blinded dual extraction, adjudication, heuristic/LLM suggestions
(`server/controllers/extractionController.js`), send-to-MA bridge
(`consensusToStudyPatch` → studies row, 409 guard on existing effect sizes). Reached via a
"Classic table | Structured extraction (beta)" toggle — a second, entirely separate UI.

### 1.3 PDF infrastructure (reused, not rebuilt)
- `src/frontend/components/AppPdfViewer.jsx` — universal pdf.js viewer (continuous scroll,
  fit-width, search over a real `pdfjsLib.TextLayer`). Props today:
  `{url, externalUrl, flush, previewHeight, withCredentials}`. No selection/overlay hooks.
- Per-study PDFs exist only through screening: `ScreenPdfAttachment` (upload or P9 OA
  auto-retrieve) served by `GET /api/screening/projects/:pid/records/:rid/pdf/:aid/download`.
  A study handed off from screening carries `screeningRecordId`/`screeningProjectId`
  (`screeningReviewController.js:63-64`); `screeningApi.metalabStudyRecord(mlpid, studyId)`
  resolves the record — the exact chain RoB already uses (`RobWorkspace.jsx:500`).
- `src/frontend/rob/robFullText.js` — client-side pdf.js text extraction pattern (80-page
  cap, never persisted).

### 1.4 Protocol outcome sources
- `project.prospero.fields.primary_outcomes` / `.secondary_outcomes` (PROSPERO tab,
  `PROSP_FIELDS`, persisted `protocolTabs.jsx:1338-1346`; the P46 Plan&Protocol module
  mirrors into the same `prospero.fields`).
- Fallback: `project.pico.O` (free-text outcomes).

## 2. LLM extractor — bugs found + root causes (all fixed in this work)

| # | Bug | Root cause | Fix |
|---|-----|-----------|-----|
| 1 | `callClaude()` fetches `https://api.anthropic.com/v1/messages` **directly from the browser with no `x-api-key` and no `anthropic-version` header** (`aiService.js:30-34`) | Monolith-era code assumed a sandbox that injected credentials. In this app the request always fails twice over: the strict CSP `connect-src 'self'` (prompt 51) blocks the cross-origin call, and the API would reject it (missing key/version headers, no CORS opt-in). | New same-origin server proxy `POST /api/ai-extract` (`server/routes/aiExtract.js`); key lives in `ANTHROPIC_API_KEY` env only, never reaches the client — same pattern as `extractionLlmClient.js`. Availability probed via `GET /api/ai-extract/status`. |
| 2 | Stale/invalid model list `["claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-3-5-sonnet-20241022"]` (`aiService.js:16`) | Hardcoded browser-side list drifted; `claude-sonnet-4-5-20250514` was never a valid ID. | Model chosen server-side (`AI_EXTRACT_MODEL` env, default `claude-sonnet-5`); single source of truth. |
| 3 | **HR scale bug (silent wrong numbers):** the prompt says "for time-to-event give es/lo/hi as the reported HR and its CI" (`extractionTabs.jsx:669`), and `applyExtracted` copies `es/lo/hi` verbatim — but the data model requires es/lo/hi on the **log** scale for OR/RR/HR (`defaults.js:95`). A raw HR 0.75 [0.60, 0.94] was stored as if it were lnHR and pooled wrong. | Prompt contract and field mapping disagreed with the analysis-scale convention. | New JSON contract returns ratio estimates in dedicated raw fields (`hr`,`hrLo`,`hrHi`); the mapper log-transforms via the existing `ratio_log` conversion and records a `conversions[]` audit entry. Raw ratios are never written into `es`. |
| 4 | Field-mapping coerces everything with `String(parsed[k])` (`extractionTabs.jsx:678`) — an object/array value becomes `"[object Object]"`; `esType` (incl. `DIAG`, which is not an `ES_TYPES` key), `adjusted`, `source` are copied unvalidated. | No whitelist/enum validation between the LLM contract and mkStudy. | Explicit field whitelist + enum validation (esType ∈ ES_TYPES, adjusted ∈ ADJUST_OPTIONS, source ∈ SOURCE_OPTIONS) + numeric coercion; invalid values dropped into `notes` instead of fields. |
| 5 | JSON parse: `safeParseJSON` grabs `indexOf('{')`…`lastIndexOf('}')` — a preamble containing `{` breaks it; brace-balancing on truncation can silently drop fields. | Heuristic extractor tolerant by design, but the *prompt* invited prose. | Server proxy requests JSON-only output and retries once on parse failure; client still `safeParseJSON`s defensively; extracted study is always `needsReview:true` (already the case). |
| 6 | 30 MB base64 PDF → ~40 MB JSON body would exceed server body limits and the API's 32 MB request cap. | Guard checked file size, not encoded/request size. | Proxy accepts ≤ 20 MB PDFs (413 otherwise); client guard aligned. |

`AI_FEATURES_ENABLED` stays `false` (it gates unrelated legacy AI surfaces). The
workspace's "AI boost" is a separate, explicit toggle that only appears when the server
reports the proxy is configured, and is OFF per session by default.

## 3. Target data shape (all four methods write it)

One record per **(study × target-outcome × timepoint × comparison)**:

- Records live in `project.studies` as today (analysis pools by outcome+timepoint —
  unchanged). New optional study fields (additive, blob-only, no schema change):
  - `scope`: `{ level: 'primary'|'secondary'|'other', outcomeId, canonical }` — which
    protocol outcome this record answers; `other` never reaches `studies`.
  - `provenance`: `{ method:'auto'|'table'|'figure'|'click'|'manual'|'ai', page, region:{x0,y0,x1,y1}|null, excerpt, at }` (region in intrinsic PDF page coords, scale 1).
- **Drafts** (auto-generate / pick-a-source output) → `project.extractionDrafts[]`
  (same record shape + `draft:true`). Rendered distinctly; a human Confirm moves one into
  `studies`; Dismiss deletes it. Drafts never overwrite an existing human-typed value.
- **Out-of-scope** ("Also reported — not in this review") → `project.extractionParked[]`.
  Parked records are never in `studies`, so Analysis cannot see them. Un-parking is an
  explicit action that requires assigning a protocol outcome (or acknowledging 'other').

Protocol scoping: `protocolOutcomes(project)` parses primary/secondary outcome lists from
`prospero.fields` (fallback `pico.O`), producing `{id, name, canonical, aliases}` entries
used by matching, the drafts panel and the record tag.

## 4. The four methods

1. **Auto-generate (deterministic, no model call)** — `autoExtract()` over the loaded
   PDF's per-page text (client pdf.js, robFullText pattern) + abstract:
   outcome mentions matched conservatively (normalized token match + curated synonym
   dictionary) → nearby stats harvested by `patternExtract` (n=, events/totals, mean±SD,
   95% CI, p-values, OR/RR/HR + CI, follow-up) and text-grid table detection
   (`pdfTextGrid`: cluster text items by y → columns by x-gap) → per-outcome draft records
   with page/region provenance and effect sizes computed only via the existing
   `calcES`/conversion machinery (each conversion logged in `conversions[]`).
   Confidence rules: single unambiguous source → draft with `needsReview:true`; multiple
   candidates → draft carries alternates and low confidence; nothing found → nothing
   emitted (never a guessed value).
2. **Pick-a-source (table OR figure)** — drag a rectangle on the PDF page:
   - *Table*: text items inside the region → grid (`pdfTextGrid`) → mapping panel
     (arm columns / value rows) → draft records. Deterministic.
   - *Figure*: the region opens the **plot digitizer** (canvas snapshot of the region):
     axis calibration (2 points per axis, linear or log), then per figure type:
     KM/survival (trace each arm + numbers-at-risk → Guyot 2012 IPD reconstruction →
     HR + 95% CI via Cox PH, log-rank cross-check), forest (point + whisker ends),
     bar/mean±error (bar top + cap, SD vs SE choice), box (quartiles → Wan 2014 mean/SD),
     scatter (points). All local/deterministic; every digitized value carries
     figure-region + point provenance and lands as an editable draft.
3. **Click / drag-and-drop** — an "Assign" mode arms the PDF text layer: click a numeric
   token (or select text) → it fills the currently focused form field (or a picker pops
   with the candidate fields), with provenance recorded. Drag-and-drop of a token onto a
   field does the same.
4. **Fully manual** — the classic study form (cards/table), untouched and always
   available; every field editable and auditable.

## 5. Layout (simple, progressive disclosure)

`ExtractionTab` becomes ONE workspace (`src/features/extraction/unified/`):

```
┌──────────────────────────────┬──────────────────────────────────────┐
│ PDF panel (collapsible,      │ Study rail: pick/add study            │
│ resizable split)             │ Method bar: [Auto] [Pick source]      │
│ AppPdfViewer (extended:      │             [Click-assign] [Manual]   │
│ overlay + text-click props)  │ Drafts to review (distinct styling)   │
│ source: screening PDF, OA    │ Study form = existing StudyCard body  │
│ find, or local session file  │ "Also reported (not in this review)"  │
└──────────────────────────────┴──────────────────────────────────────┘
```

- No PDF loaded → the right side fills the width; classic cards/table exactly as today
  (zero regression for existing users and e2e specs).
- The structured Data-Element system (dual-reviewer consensus) stays intact behind its
  flag, reachable from an "Advanced: dual-reviewer structured extraction" link — no longer
  a competing top-level mode.
- Deterministic features are labeled auto/suggested/computed; "AI" appears only on the
  optional external-model toggle.

## 6. New pure engine modules (`src/research-engine/extraction/`)

| Module | Exports | Notes |
|---|---|---|
| `protocolOutcomes.js` | `protocolOutcomes(project)` | prospero.fields → outcome list; pico.O fallback |
| `outcomeMatch.js` | `normalizeOutcome`, `matchOutcome(text, outcomes)` | dictionary + token overlap, conservative |
| `patternExtract.js` | `extractStats(text)` | typed matches with index/excerpt |
| `pdfTextGrid.js` | `itemsToRows(items)`, `detectGrid(rows)` | pdf.js text items → table grid + cell boxes |
| `autoExtract.js` | `autoExtract({pages, protocol, study})` | drafts + alsoReported + log |
| `records.js` | `mkExtractionRecord`, `recordToStudy`, `confirmDraft` | canonical record ⇄ mkStudy row |
| `digitizer/calibration.js` | `mkAxis`, `mapPoint` | linear/log axes, px→data |
| `digitizer/kmGuyot.js` | `reconstructIPD` (Guyot 2012), `coxHR`, `logRank` | KM → HR + 95% CI; refs: Guyot 2012 BMC Med Res Methodol 12:9; Tierney 2007 Trials 8:16 |
| `digitizer/figureExtract.js` | `forestFromClicks`, `barsFromClicks`, `boxFromClicks`, `scatterFromClicks` | box → Wan 2014 mean/SD |

AppPdfViewer gains **optional** props (`onDocLoaded`, `pageOverlay`, `onTextItemClick`,
`interactiveTextLayer`) — defaults preserve current behavior for RoB/screening.

## 7. Risks & mitigations

- **Regression risk in extractionTabs.jsx** — keep classic list/editor as the workspace's
  right side; e2e `extraction.spec.ts` flows (add study, 2×2 validation) unchanged.
- **PDF-less studies** — every method except manual degrades gracefully (Auto can run on
  abstract text; digitizer/pick-a-source require a PDF and say so).
- **Wrong-but-confident automation** — hard rules: drafts only, always `needsReview`,
  never overwrite non-empty human fields, conversions always logged, no value without a
  matched excerpt/region.
- **Structured-mode users** — no data migration; Prisma-backed workspace stays reachable.
- **Bundle size** — digitizer + workspace lazy-loaded like the current structured chunk.

## 8. Test plan

Unit (vitest, `tests/unit/extraction/`):
- `protocolOutcomes` parsing (numbered/semicolon/newline lists, pico fallback).
- `outcomeMatch` (synonyms, negative controls — must NOT match unrelated outcomes).
- `patternExtract` (each pattern; CI variants `1.2–3.4`, `1.2 to 3.4`, `(1.2, 3.4)`).
- `pdfTextGrid` (synthetic item layouts → expected grids).
- Digitizer math: calibration round-trips (linear + log); KM reconstruction on a synthetic
  exponential-survival example (known HR; Guyot output within tolerance; log-rank + Cox
  agree); forest/bar/box click math; Wan conversion parity with `CONVERSIONS`.
- `records` shape: record→study mapping, scope tags, draft confirm semantics (no
  overwrite of human values).
- LLM mapper: whitelist/enum validation, HR log-transform + conversion record.

Integration: drafts confirm → studies → `runMeta` pools by outcome+timepoint unchanged;
parked records never reach analysis. Existing suites must stay green.
