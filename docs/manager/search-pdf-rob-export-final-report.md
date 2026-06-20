# prompt42 — Final report: Search Builder intelligence, continuous PDF viewer + live search, no-scroll RoB, one-click journal export

**Version:** v3.25.0 · **Scope:** 8 tasks across 4 subsystems. This is the manager-facing summary;
each subsystem has its own detailed doc (linked below).

- [search-builder-live-hits-and-mesh.md](search-builder-live-hits-and-mesh.md) — Tasks 1-3
- [pdf-viewer-continuous-search.md](pdf-viewer-continuous-search.md) — Tasks 4 & 6
- [pdf-viewer-initial-scale-fuzziness-fix.md](pdf-viewer-initial-scale-fuzziness-fix.md) — Task 5
- [rob-no-page-scroll-assessment.md](rob-no-page-scroll-assessment.md) — Task 7
- [journal-submission-export-zip.md](journal-submission-export-zip.md) — Task 8

## 1-4. Search Builder (Tasks 1-3)

- **Auto-updating hits** — a `strategyHash` keys the live PubMed strategy; any relevant change marks the
  count **stale** then a debounced refresh runs **updating → updated/failed** with a visible status,
  last-updated time, and a non-blocking error. Race-guarded + cached; never freezes the UI.
- **Restore deleted PICO terms** — deletes record `{text, field, label}` provenance; a "Hidden PICO
  terms" panel restores one term / all from a field / all (Reset). Back-compatible with legacy
  `string[]` `ignored` rows. Restoring updates the strategy and refreshes hits.
- **MeSH suggestions** — as-you-type dropdown (instant local seed + debounced live backend), keyboard
  accessible, MeSH/keyword/synonym badges, dedupe. **T2DM → "Diabetes Mellitus, Type 2"** out of the box.

## 5-6. PDF continuous scroll (Task 4)

Continuous, **virtualized** vertical scroll (IntersectionObserver renders visible pages ±1); page
indicator follows the most-visible page; prev/next scroll between pages; zoom + rotation preserved;
fit-width default; search works across the whole document.

## 6. PDF initial scale / fuzziness root cause + fix (Task 5)

Root cause was **timing + CSS upscaling**: the first canvas painted at a stale/too-small width and was
then stretched by `maxWidth:100%`. Fixed with a skeleton-until-real-width, correct HiDPI per-page render
(backing store = `viewport × dpr`, CSS = `viewport`, DPR capped at 2), removal of CSS stretch, and a
coalesced ResizeObserver re-fit (sharp after RoB resize / menu collapse / window resize).

## 7. PDF live search (Task 6) + match-case / whole-word

Live (debounced) search with **real pdf.js text-layer highlighting**, `n / total` count, up/down
(Enter / Shift+Enter) navigation that scrolls to the selected match (distinct colour), **Match case**
and **Whole words** toggles, **Escape**/close clears highlights. The same pure matcher drives the
cross-page scan and the DOM highlight, so counts and highlights always agree.

## 9. RoB no-page-scroll layout fix (Task 7)

The leak was in the embedding shell, not the workspace. The monolith now treats the open RoB workspace
like Screening (`overflow:hidden` + `padding:0`, gated strictly on the per-study workspace being open),
with a bounded-height flex chain and an accurate re-measuring fill-height hook. The standalone
`/rob/:id` route got the same treatment. Internal scroll (PDF panel + assessment panel) + sticky footer;
narrow/stacked layout intentionally still page-scrolls.

## 10-12. Journal-submission ZIP (Task 8)

One click (header **layers** icon → ExportDialog) produces
`<project>-journal-submission-YYYY-MM-DD.zip` containing: `figures/prisma-diagram.{svg,png}`,
`figures/forest-plot-<outcome>.{svg,png}` (one per outcome), `methods-text.md`, `study-table.csv`,
`report.html`, `README.md`, `manifest.json`, `warnings.txt`. Live step progress in the dialog. Missing
pieces become **warnings**, never a hard failure. A **zero-dependency** STORE ZIP writer keeps the
minimal-deps footprint. The server endpoint **enforces the export permission + records the audit event**
and supplies the manifest's appVersion/timestamp; figures are client-rendered then zipped client-side.

## 13. Backend changes

- `server/searchEngine/nlmClient.js` — `meshSuggest(term)` (esearch retmax≈6 → esummary → mapped; cached,
  throttled, graceful).
- `server/searchEngine/searchEngineController.js` — `postMeshSuggest` (flag-gated) + `ignored` sanitizer
  back-compat (string[] | object[]).
- `server/routes/searchEngine.js` — `POST /mesh-suggest`.
- `server/controllers/importExportController.js` — `authorizeJournalSubmission` (permission + exportTools
  flag + `USAGE.EXPORT` audit + appVersion/timestamp).
- `server/routes/importExport.js` — `POST /export/journal-submission/:id`.

## 14. Frontend changes

`src/frontend/components/AppPdfViewer.jsx` (rewrite), `pdfSearch.js` (+matchers), `exportCore.js`
(+zipFiles/crc32/safeFilePart), `ExportDialog.jsx` (zip sizing + progress channel),
`src/features/searchBuilder/{SearchBuilderTab,searchBuilderApi,index}.js(x)`,
`src/research-engine/searchBuilder/meshSuggest.js` (new),
`src/research-engine/import-export/journalSubmission.js` (new),
`src/research-engine/docs/methodsText.js` (new), `src/frontend/rob/{RobWorkspace,RobPage}.jsx`,
`meta-lab-3-patched.jsx` (RoB no-scroll wiring + journal-ZIP orchestrator/trigger/header button).

## 15. Database / migration changes

**None.** No schema change. `ignored` persists in the existing `WorkflowModuleState` (moduleKey
`search`); hit state is runtime-only; the export endpoint reuses existing access/usage tables.

## 16. Tests added

`tests/unit/pdfSearch.test.js` (+findMatchesInText/escapeRegExp/countMatchesInItems),
`tests/unit/journalSubmission.test.js` (crc32 known values, ZIP structure, outcome enumeration, study
table, README/manifest/warnings, methods text), `tests/unit/searchBuilderHits.test.js`,
`tests/unit/meshSuggest.test.js`, and extensions to `searchEngine.test.js` / `conceptExtraction.test.js`.

## 17-18. Manual QA + build/test results

- Unit: **1318 unit + 164 screening = 1482 tests green** (`vitest`, PowerShell forks pool).
- Build: `npm run build` green (548 modules, exit 0; pre-existing benign chunk-size + AnalysisTab JSX
  esbuild warnings only).
- Adversarial multi-agent review (5 areas → per-finding verification): see "Review outcome" below.

## 19-21. Version / commit / push

- Version bumped **3.24.0 → 3.25.0** (minor; major behavioural additions, no breaking change).
- Commit / push: see git log.

## 22. Known limitations

- Hit counts are live for **PubMed only** (other databases have no contract count source yet).
- Cross-text-item PDF search matches aren't highlighted (rare); rotation-0 highlighting is pixel-exact.
- Journal package ships **Methods as `.md`** and the **study table as `.csv`** (no docx/xlsx lib by
  design); the report is self-contained HTML (print to PDF). RoB-per-study column is included but only
  filled when a mapping is supplied. STORE (uncompressed) ZIP → slightly larger but universally openable.
- Per-study RoB summary in the study table is not auto-joined from `/api/rob` yet.

## 23. Claude's additional engineering recommendations

- **Search Builder:** persist a small `lastHitCount`+timestamp per strategy hash so a returning user sees
  the last known count instantly (still re-validated); add an Embase/Cochrane count provider when a
  contract exists; surface a "stale >24h" badge.
- **PDF viewer:** add a thumbnails rail + keyboard "/" to focus search; cache rendered canvases in an
  LRU keyed by (page,scale,rotation) to avoid re-render on scroll-back; consider an off-main-thread
  text-index for very large PDFs.
- **RoB:** extract the no-page-scroll shell pattern (Screening + RoB) into one reusable `FullBleedRoute`
  wrapper so future focus-mode tabs inherit it without per-tab wiring.
- **Journal export:** an "export readiness checklist" (PRISMA complete? ≥1 outcome? GRADE done?) shown
  before generation; pluggable journal templates (target-journal cover letter + title page); optional
  DEFLATE in the ZIP writer if package sizes grow; join RoB summaries into the study table.
