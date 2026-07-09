# 77.md — Extraction UX, unified PDF, dedup→manuscript, crash containment

Scope: the Pecan Extraction Engine (flag `extractionEngine`), shared PDF resolution,
the Manuscript Editor's PRISMA/dedup source, and app-wide crash containment. All changes
are additive and flag-safe (the engine stays default-OFF; the classic tab is untouched).

## 1. Architecture & root causes discovered

- **Two extraction surfaces.** Flag ON → `PecanExtractionEngine` → `ArticleWorkspace`
  (the surface 77.md targets); flag OFF → the classic `ClassicExtractionTab` /
  `AssistedExtractionPanel`. The classic tab already carried a Converter (`ConversionPanel`)
  and the "Also reported" parked list; the new engine had four modes (Table/Click/Figure/
  Manual) and no Converter.
- **Click-to-pick replace (obj 2)** was blocked by design: `ArticleWorkspace.assignFromClick`
  ran an overwrite guard that turned `valuePrecedence.decideWrite('propose-replace')` into a
  hard stop and hardcoded `existingOrigin:'user-typed'`, so a second click over ANY value
  (even one a previous click placed) refused and asked the user to clear the field first.
- **Effect-measure regression (obj 7)** was a field-mapping mismatch, NOT a remount/stale
  closure: the click target was a static dropdown stuck on `smart`, and smart-mode routed a
  bare number into `es` (ln) for a ratio measure — so RR/OR's expected 2×2 boxes (`a,b,c,d`)
  never filled, and after `es` was set the guard blocked every further click. DIAG had no
  click targets at all.
- **PDF (obj 5).** There is ONE canonical store — the screening `ScreenPdfAttachment`
  (`server/storage/screening-pdfs/<screenProjectId>/<uuid>.pdf`), reached by every engine
  through `usePdfSource` → the study↔screening-record link. RoB and Screening already read
  it. The only gap: Extraction's "Upload a PDF" created a session-local object URL that was
  never persisted and invisible elsewhere.
- **Crash (obj 9).** Two likely root causes: (a) unhandled dynamic-import (stale
  content-hashed chunk) failures after a deploy — every lazy engine shares one route
  boundary and there was no retry; (b) unguarded `const {studies}=project` in the analysis
  tabs throwing on a project whose blob has no `studies`. No client observability existed.

## 2. What changed

| Obj | Change | Files |
|-----|--------|-------|
| 2 | Click-to-pick REPLACES immediately; the replaced value is kept in a bounded per-field provenance `history[]` (never a silent loss). Removed the hard-stop guard; unified all value writes through one `writeValues()` path. | `ArticleWorkspace.jsx`, `articleProvenance.js` |
| 3 | Only two modes: **Pick from PDF** + **Manual Entry**. Table/figure recognition removed from the UI (pure engines retained in-repo, unsurfaced). | `ArticleWorkspace.jsx` |
| 4 | Restored the Converter as an inline, theme-aware, a11y panel reusing the pure `conversions/catalogue.js`; it occupies the old "Also reported" slot. | `ConverterPanel.jsx` (new), `DraftReviewList.jsx` (`showParked` prop) |
| 7 | The pick target is now **measure-driven** and clicking a form field makes it active; captures **auto-advance** through the measure's required fields (fill 4 boxes in 4 clicks). Any populated value is always shown (no invisible `es`). | `articleStatus.js` (`assignableFieldsFor`/`usesEffectSlot`/`nextAssignableField`), `ArticleWorkspace.jsx` |
| 8 | Discoverable pick UX: labelled "Pick from PDF" tab, dismissible first-use coach mark, a visible active-field outline + "◎ Now click the value for X", `aria-live` status. | `ArticleWorkspace.jsx` |
| 5 | Extraction upload now **persists** to the canonical screening attachment store when the study is screening-linked (survives refresh, shows in RoB/Screening); honest session-local fallback + messaging otherwise. | `usePdfSource.js` |
| 6 | Viewer already handles Firefox `caretPositionFromPoint` + WebKit `caretRangeFromPoint`, guards `ResizeObserver`; added a cross-browser @smoke e2e for the new surface. No Chrome-only APIs introduced. | `pecan-engine.spec.ts` |
| 1 | Canonical dedup metadata (tri-state `performed`, `method`, `lastRunAt`) added to `getMetaLabSummary`; threaded through `mapScreeningSummary`; `computePrismaCounts` reports **not-performed** (null + warning) instead of a false "0". | `screeningController.js`, `manuscriptData.js`, `prismaCounts.js` |
| 9 | Reusable `ScopedErrorBoundary` (correlation id, targeted retry, auto-reset on stage change) wraps each lazy tab body; global `error`/`unhandledrejection`/`vite:preloadError` handlers with a guarded once-only reload for stale chunks; guarded `project.studies` in analysis tabs. No stack traces shown. | `ScopedErrorBoundary.jsx` + `errorReporting.js` (new), `StitchProjectWorkspace.jsx`, `main.jsx`, `analysisTabs.jsx` |

## 3. Click-to-pick state model

`activeField` (Smart | a value field) is the sole pick target. On article open it resets to
the measure default (Smart for es/lo/hi measures, else the first required field); on measure
change it clamps to a field the new measure uses. Focusing a form field sets it active. A
capture writes through `writeValues()` (immediate replace + provenance history + audit),
then auto-advances to the next empty required field. Smart captures (value+CI, events+total)
write atomically and do not auto-advance. Ratio es/lo/hi stay ln-scale on every path.

## 4. Unified PDF model

The screening `ScreenPdfAttachment` is the single canonical project-study document (keyed by
`ScreenProject`+`ScreenRecord`, checksum-deduped on the OA path). Screening writes it;
RoB/Extraction read it through `usePdfSource`'s study→record resolution. This round makes
Extraction also **write** to it (persisted upload), so a PDF added in Extraction appears in
RoB and Screening and survives refresh/relogin — without introducing a competing document
table (which would create a second source of truth). Manual, never-screened studies keep a
session-local copy with explicit "not saved" messaging.

## 5. Crash protections

- `ScopedErrorBoundary` isolates each engine; a chart/converter/PDF crash recovers to a card
  while the rail and navigation stay live, with a support correlation id.
- Global handlers reload **once** (30s-guarded, no loop) on a stale-chunk import failure and
  emit privacy-safe structured events (route/engine/browser/release/correlationId only —
  never manuscript content, health data, PDF bytes, or tokens).
- "Switch to classic UI" is unchanged: already admin-only and functional; kept as-is.

## 6. Tests

- Unit (new): `assignFields.test.js`, `provenanceHistory.test.js`, `prismaDedup.test.js`,
  plus `ArticleWorkspace` SSR smoke in `engineSmoke.test.jsx` (asserts two modes, Converter
  present, "Also reported" absent, active-field UI). Full unit suite green (4271+).
- E2E: added a cross-browser `@smoke` test (Chromium/Firefox/WebKit) for the new surface
  contract in `e2e/extraction/pecan-engine.spec.ts`.
- Build green.

## 7. Limitations — addressed in a follow-up round

The round-1 limitations were addressed (see §10); what remains is genuinely out of scope:

- Existing screening PDFs are NOT retro-migrated into the study-document store — they don't
  need to be; a screening-linked study already resolves its `ScreenPdfAttachment` and that
  stays canonical. The study document is the store for studies that have no screening record.
- A many-documents-per-study model isn't introduced (one canonical PDF per study, matching
  every existing consumer's assumption).

## 8. Deploy / rollback

- No schema migration (dedup metadata is derived at read-time from existing columns; provenance
  history rides in the additive `study.extractionMeta` blob). Standard build + deploy.
- Rollback: set `extractionEngine` OFF (engine changes vanish; classic tab unaffected). The
  server `dedup` field and `ScopedErrorBoundary` are additive and inert if unused.

## 9. Adversarial review round (12 confirmed fixes)

A 6-dimension find→verify review found 12 real, verified issues in the round-1 code; all fixed:

1. **PDF persist is now opt-in** (`setLocalFile(file,{persist:true})`) — the engine's
   empty-state upload (no existing PDF) persists; the classic panel's "replace" stays
   session-local, so it can never silently overwrite a stored screening PDF.
2. **Upload-failure race** — the async catch path now bails on a mid-upload article switch,
   so a failed persist can't show the wrong study's PDF.
3. **Transient `listPdf` failure** is distinguished from "no PDF" and warns the user before an
   upload could replace an unlisted attachment.
4. **Single-field pick** now guards p-values/percentages (was fabricatable into a count).
5. **Smart bare-number** is refused for non-effect-slot measures instead of misfiling into `es`.
6. **Converter `es` target** is guarded to ratio measures only (ln-scale can't corrupt a
   non-ratio effect size).
7. **Converter stale result** — editing an input clears the cached Compute result so Apply
   never writes a value/formula that no longer matches the inputs.
8. **writeValues** skips identical re-writes (no autosave churn) and preserves the full
   10-entry replace history.
9. **Manual value edits** now re-attribute provenance to `manual` and drop the stale
   page/bbox, so jump-to-source and replace-history stay honest.
10. **Parked drafts** — the "Not in this review" action is hidden in the engine (where the
    parked list is replaced by the Converter), so a draft can't become unreachable.
11. **Dedup `lastRunAt`** is null when dedup wasn't performed (only accounting-bearing batches
    count as a run).
12. **Auto-synced manual dedupe `0`** no longer masks a live "not-performed" signal (only a
    deliberate override or a non-zero manual value stands).

Refuted (no change needed): object-URL leak on overlapping uploads (already guarded), a 30s
chunk-reload "storm" (sessionStorage survives the reload), CSS-preload regex gap (broadened
anyway as a cheap robustness win). Full unit suite green (4273), build green.

## 10. Limitations follow-up round (manual-study PDFs · per-source PRISMA · cross-browser)

Addressed the three documented limitations:

**Persistent, cross-engine PDFs for manual (non-screening) studies (§5 gap, zero migration).**
A study that was never screened had no `ScreenRecord` to hang a `ScreenPdfAttachment` on, so
its uploaded PDF could only be session-local. New **blob-anchored study-document store**:
bytes on disk (`server/storage/study-docs/<projectId>/<uuid>.pdf`), the authoritative pointer
(`study.document = {storedName, fileHash, fileName, fileSize, mimeType, uploadedBy, uploadedAt}`)
rides in the project blob — so there is **no schema migration** and **one canonical PDF
location per study** (screening attachment when screening-linked, else this document — never
both, no competing source of truth). New `server/studyDocs/studyDocStorage.js` +
`server/controllers/studyDocController.js` + routes `POST/GET/GET download/DELETE
/api/projects/:id/studies/:studyId/document`. Access = the extraction access resolver
(owner/member, canView to read, canEdit to write); PDFs streamed through the authenticated
Range-aware route (never public); magic-byte + 25 MB validated; sha256 content-dedupe within a
project; `storedName` strictly validated (`isSafeStoredName`) at every filesystem use to block
a crafted-blob path traversal. The server writes `study.document` durably AND returns it so the
client stamps its in-memory blob (autosave can't clobber the pointer). `usePdfSource` gained
study-document resolution + `setLocalFile(file,{persist:true})` persistence for manual studies;
the extraction article list shows availability for them; **Risk of Bias** renders the document
too (`RobPdfPanel` fallback). Verified end-to-end against a live server (upload · checksum ·
metadata · download · cross-user 404 · delete).

**Per-source PRISMA split (databases vs registers vs other).** New pure
`research-engine/screening/sourceClassify.js` (`classifySource`/`splitBySource`) buckets
`ScreenRecord.sourceDb`; `getMetaLabSummary` emits `sources:{databases,registers,other,exact}`;
`mapScreeningSummary` feeds dbs/reg/other into the manuscript **only when `exact`** (no
import-time duplicates, so the split equals `identified` and can't corrupt the total);
`computePrismaCounts.pick` is now variadic so dbs prefers the explicit split and falls back to
identified, and reg/other read the canonical split (previously always manual/missing).

**Cross-browser coverage.** The study-document round-trip is covered by a deterministic
integration test (`tests/integration/api-study-doc.test.js`); the extraction UX contract
(two modes, Converter, measure-driven active field, RR→MD field switch, Manual Entry) is a
cross-browser `@smoke` e2e that runs on Chromium/Firefox/WebKit (pdf.js canvas rendering stays
out of the browser assertions — too fragile in CI, per the existing files-pdf convention).

Tests added: `sourceClassify`, `studyDocStorage`, extended `prismaDedup` (source split), the
study-doc integration test, extended extraction e2e. Full unit suite green; build green.
