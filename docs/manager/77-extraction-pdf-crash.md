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

## 7. Remaining limitations (honest)

- A brand-new `Document` table + backfill migration was deliberately NOT built: the existing
  screening-attachment store already IS the canonical shared document store, and a parallel
  table would create the competing source of truth the brief warns against. Persisting
  extraction uploads to that canonical store is the correct, lower-risk consolidation.
- Persisted extraction upload requires the study to be screening-linked; a truly manual study
  has no server record to attach to (session-local, clearly messaged).
- Full Firefox/WebKit coverage is `@smoke`-tagged (project convention), not the whole suite.
- Per-source PRISMA split (databases vs registers vs other) is not yet aggregated from
  `ScreenRecord.sourceDb`; `identified`/dedup metadata are canonical and honest.

## 8. Deploy / rollback

- No schema migration (dedup metadata is derived at read-time from existing columns; provenance
  history rides in the additive `study.extractionMeta` blob). Standard build + deploy.
- Rollback: set `extractionEngine` OFF (engine changes vanish; classic tab unaffected). The
  server `dedup` field and `ScopedErrorBoundary` are additive and inert if unused.
