# One-click journal-submission export ZIP (prompt42 Task 8)

A single click produces a journal-ready package as one ZIP: PRISMA diagram, one forest plot per
outcome, an auto-drafted Methods section, the study table, the full report, and provenance files.

## Where to find it

Universal project header (every non-Overview tab), next to Report/Export — the **layers** icon, tooltip
*"Journal submission package (ZIP): PRISMA, forest plots, methods text & study table"*. It opens the
shared `ExportDialog` (figure size preset + decimal precision), then assembles + downloads the ZIP.

ZIP name: `<project-title>-journal-submission-YYYY-MM-DD.zip` (sanitized).

## Contents

```
figures/prisma-diagram.svg + .png
figures/forest-plot-<outcome>.svg + .png      (one pair per outcome/comparison)
methods-text.md                                (auto-drafted Methods, review before use)
study-table.csv                                (included-studies characteristics, UTF-8 BOM)
report.html                                    (full self-contained report)
README.md                                      (contents + generation info + notes)
manifest.json                                  (projectId, title, generatedAt/By, appVersion, files, warnings)
warnings.txt                                   (anything missing / skipped)
```

Figures use the dialog's size preset (default journal single-column @300dpi) and respect the chosen
decimal precision. PNGs are rasterized from the builders' hex-colour SVGs via `exportCore.rasterizeSvg`.

## Architecture (reuse, never duplicate)

- **Client-side assembly** — the figures are live SVGs rendered in the browser, so the ZIP is built
  client-side from the EXISTING pure builders: `buildPrismaSVG`, `buildPubForestSVG` (per outcome via
  the new pure `getOutcomePairs`/`filterStudiesForOutcome`), `runMeta`, the study-table CSV
  (`buildStudyTableCSV`), the Methods generator (`buildMethodsMarkdown`), and `buildReportHTML`.
- **Zero-dependency ZIP** — `exportCore.zipFiles()` is a small STORE (no-compression) ZIP writer with a
  proper CRC-32 + central directory + EOCD. The repo deliberately avoids adding libraries (the PDF
  viewer and world map are hand-rolled), so no `jszip` / lockfile churn / bundle bloat.
- **Server authorizes + audits** — `POST /api/export/journal-submission/:id`
  (`authorizeJournalSubmission`) enforces the export permission (owner/leader or member with
  `canExport`, else 403; outsiders 404), enforces the `exportTools` feature flag, records the
  `USAGE.EXPORT` audit event (`source: metalab-journal-submission`), and returns the canonical
  appVersion + server timestamp + title for the manifest. The client calls it first; on 403/404 it
  aborts with a clear message.

## Resilience & UX

- **Progress** — the dialog shows live step text (Authorizing… → Preparing PRISMA diagram… → forest
  plots… → methods text… → study table… → report… → Creating ZIP…) via a new optional progress channel
  passed to `item.run(choice, onProgress)` (backward-compatible; older run functions ignore it).
- **Partial is fine** — a missing/failed component (no PRISMA, no outcomes, no studies, PNG raster
  failure) becomes a line in `warnings.txt` / README, never a hard failure. The SVG is always included
  even if its PNG can't be rasterized.
- **Permissions** — enforced server-side (above); the trigger is part of the standard export cluster.

## Files

- `src/frontend/components/exportCore.js` — `crc32`, `zipFiles`, `safeFilePart` (+ existing
  `rasterizeSvg`/`downloadBlob`).
- `src/research-engine/import-export/journalSubmission.js` — `getOutcomePairs`,
  `filterStudiesForOutcome`, `buildStudyTableCSV`, `buildReadmeMarkdown`, `buildManifest`,
  `buildWarningsText`, `safeName` (all pure).
- `src/research-engine/docs/methodsText.js` — `buildMethodsMarkdown(ctx)` (pure; no fabricated data —
  marks gaps with placeholders).
- `meta-lab-3-patched.jsx` — `buildJournalSubmissionZip(choice, onProgress)` orchestrator +
  `openJournalSubmissionExport` trigger + header button.
- `src/frontend/components/ExportDialog.jsx` — `zip` format shows the size selector; progress channel.
- `server/controllers/importExportController.js` + `server/routes/importExport.js` — authorize/audit endpoint.

## Known limitations

- DOCX/XLSX are not produced (the app ships no docx/xlsx lib) — Methods is `.md`, the study table is
  `.csv` (the prompt's documented fallbacks). The report is self-contained HTML (print to PDF).
- The per-study **Risk of bias** column is auto-populated (best-effort) from `/api/rob` — the worst
  outcome-level judgement per study; it is blank when RoB is unavailable (not the owner / engine flag
  off / no assessments).
- STORE (no compression) ZIP — slightly larger files, but universally openable and dependency-free.
