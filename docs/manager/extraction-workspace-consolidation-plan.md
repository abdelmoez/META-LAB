# Extraction Workspace Consolidation & Correction Plan (e1.md)

**Status:** planning → implementing
**Baseline:** v3.69.1 (`b2247d8`). Correction/fix pass on the EXISTING four-method assisted-extraction workspace — not a rebuild.
**Supersedes:** the original RoadMap/1.md build plan (v3.68.0), preserved in git history.
**North stars:** (1) precision/accuracy first — the automated pass must be trustworthy and never emit a confident wrong value; (2) one simple, easy-to-navigate UI — PDF left, form right, one method switch.
**Honesty rule:** only the optional live-model path may be labeled "AI". The deterministic extractor, OCR, table parse, digitizer math, stats and report text are "auto / assisted / computed / suggested / text recognition".

This plan is derived from an 8-subsystem deep audit. File:line references below are the audited current state.

---

## 1. Current behaviour (as audited)

### 1.1 Tab wiring — the consolidation spine
- `ExtractionTab({project, updateProject, activeId})` — `src/frontend/workspace/tabs/extractionTabs.jsx:560`. Mounted twice: Stitch shell (`StitchProjectWorkspace.jsx:264`) and legacy `Workspace.jsx:1562`. Both pass the whole project blob + `updateProject`.
- **Three stacked layers inside one tab:**
  1. **Classic / Structured toggle** (`:804-820`, gated on flag `extractionAssist`). `extractionMode==='structured'` early-returns to the lazy 66.md `ExtractionWorkspace` (a *second, rival* server-backed elements/consensus/adjudication system — the only dual-review path).
  2. **`showAssisted` toggle button** (`:931`, default false, **not** flag-gated) mounts the RoadMap/1 `AssistedExtractionPanel` *inline above* the classic study cards (`:940-956`).
  3. The panel itself (4-method split screen).
- Reaching the four methods today = open tab → click "🔬 Assisted workspace" → pick a study → pick a method. It is a mode-within-a-mode, not the main surface.
- **Data owned by the classic path (must be preserved byte-compatibly):** `project.studies[]`, `project.extractionDrafts[]`, `project.extractionParked[]`, `project.extractionSort`; the `AddStudyModal / ESCalcInline / ConversionPanel / StudyCard` exports (also imported by `Workspace.jsx`); `buildExtractionCSV` (fixed 49-column order, UTF-8 BOM).
- **Layout:** right column is a plain flex child (`AssistedExtractionPanel.jsx:241-266`), `flexWrap:'wrap'`, `minHeight:420` — **no** `position:sticky`, **no** independent scroll; `DraftReviewList` renders *outside/below* the panel, so confirming a draft scrolls away from the PDF.
- **Done→continue:** none anywhere.
- **e2e coupling:** `e2e/extraction/extraction.spec.ts` drives the classic manual path (Add Study → Manual → New Study card → 2×2 OR calculator error strings → Remove Study) — must stay reachable. `e2e/extraction/structured-living.spec.ts` asserts the Classic/Structured toggle buttons — will break by design when the toggle is retired → rewrite in the same change.

### 1.2 The optional LLM path — verification + remaining bugs
The prior recs-round fixes are **confirmed present**: server-proxied `POST /api/ai-extract` (`aiExtractController.js`), flag `aiExtraction` default **false** with **404 existence-hiding**, off-by-default per-session UI toggle honestly labeled, 20 MB decoded cap, `mapExtractedToStudyPatch` whitelists every field to `Object.keys(mkStudy())` + enum-validates, forces `needsReview=true`, raw ratio measures kept raw then log-transformed via a logged `conversions[]` recipe, `deps.fetch` injection for offline CI. When both flags are off, zero bytes leave the server (CSP `connect-src 'self'`).

**Remaining bugs (root causes):**
- **B1 (medium) — conversions[] dropped from the AI draft.** `runAi()` does `const { patch, warnings } = await aiExtract(...)` then reads `patch.conversions` (never exists — server returns `conversions` as a *sibling* of `patch`). Result: AI ratio drafts show log-scale `es/lo/hi` with an **empty** audit trail. Root cause: `AssistedExtractionPanel.jsx:168,176` vs server `aiExtractClient.js:355` / `aiExtractController.js:89-90`. Fix: destructure and pass `conversions`.
- **B2 (medium) — truncated-JSON 502 on longer PDFs.** `DEFAULT_MODEL='claude-sonnet-5'`, `MAX_TOKENS=2500`, request omits `thinking`. On Sonnet 5, omitting `thinking` runs *adaptive thinking* by default; thinking spend can push the JSON past the 2500 cap → truncation → `null` parse → wasted retry → honest 502. Code never inspects `stop_reason`. Root cause: `aiExtractClient.js:59-60,160-181`. Fix: send `thinking:{type:'disabled'}` (deterministic-format task) **and** raise `MAX_TOKENS` to ~6000; branch on `stop_reason==='max_tokens'` for a precise error.
- **B3 (low) — legacy direct-browser client still ships.** `src/frontend/services/aiService.js` (`AI_FEATURES_ENABLED=false`) still contains the header-less `api.anthropic.com` fetch + stale/malformed model IDs (`claude-sonnet-4-5-20250514`, retired `claude-3-5-sonnet-20241022`) — the very bugs the proxy replaced — imported by 4 workspace modules. Retire or route through the proxy.
- **B4 (low) — honesty on the P5 surface.** `AiAssistPanel` + `extractionAssist` brand the deterministic `provider:'heuristic'` path as "AI assist". Rename UI copy to "Assisted suggestions (deterministic)"; say "AI" only when `provider==='external'`.
- **B5 (low) — focus not protocol-wired.** Server supports a `focus` steering field; `runAi` hardcodes `focus:''`, and the AI draft never sets `comparison`. Wire an outcome/timepoint picker.

### 1.3 The four methods — state today
- **Method 1 Auto-generate (`autoExtract.js`) — under-delivers + silently loses data.** Engine runs and is precision-minded on clean prose, BUT: unmatched-outcome `meanSd`/`eventsTotal` are **silently dropped** (only `ratioCI` is parked — `:104`); no `detectedOutcomes` list when PICO is empty/unmatched (**e1 forbids silent fail**); reads prose sentences only, never the table grid (real effect+CI live in tables); no OCR; passes the **whole sentence** to `matchOutcome` (designed for a label) → mis-attribution risk; 2×2/continuous drafts carry **no** `es/lo/hi` (no auto-compute); `scope.canonical` string coerced to boolean (`records.js:159`).
- **Method 2a Pick-a-source table (`TableRegionMapper` + `pdfTextGrid`) — cannot map common tables.** Direct-effect tables (OR/RR/HR + 95% CI + P, no events/total) are **structurally unmappable** (no roles/measures/`{es,lo,hi}` path); columns mis-split ("Age, years" fragments; phantom columns from `minRows=2` + tight `gapThreshold`); `0.99–1.03` splits into separate cells (no CI pattern in `NUMERIC_CELL_PATTERNS`, `parseNumCell` rejects it); merged/multi-line headers (`detectHeaderRow` returns only 0/-1) + footnote rows pollute; applied draft is **not protocol-scoped**.
- **Method 2b Pick-a-source figure (`PlotDigitizer` + engine).** **Engine math is sound and correctly cited** (Guyot 2012 pseudo-IPD, Tierney 2007 Peto, Breslow Cox, Wan 2014, two-point linear/log calibration) — do NOT rewrite it. UX is the problem: exposes **raw pixel coordinates** (`:635-637`), shows all axis slots at once with jargon, **no worked example**, no auto-read of axis tick labels, no KM axis defaults, numbers-at-risk is free-text, no live reconstructed-curve overlay, arm direction can silently invert HR. Panel-side `figureResultToRecords` has a real bug: `Math.log` with **no positivity guard** → `NaN`/`-Infinity` written to `es/lo/hi`; forest `measure` defaults to `'HR'` on *both* ternary branches.
- **Method 3 Click-assign — BROKEN.** `AppPdfViewer.onTextClickCapture` captures the **whole pdf.js text run**; the panel takes `firstNumber(str)` → clicking `0.89` in "HR 1.05 (95% CI 0.89–1.24)" assigns **1.05**. pdf.js also splits one number across items (`12.`+`3`) with no stitching; `firstNumber` can't read ranges/`%`/`±`/`n/N`. Dead on scanned pages (no text layer, no OCR); silent no-op on a miss; **no provenance**; direct `onPatchStudy` bypasses the record model and can **overwrite a human value**.
- **Method 4 Manual — works** (classic `StudyCard`). Keep as the "form right" pane.

### 1.4 PDF sourcing + OCR
- `usePdfSource(study, projectId)` resolves via the screening attachment pipeline (screening ids → `metalabStudyRecord` → `listPdf`) or a **session-only object-URL upload** (shown only in the empty state). Effect deps are **study-identity primitives only** (a fixed v3.69.1 bug — depending on the whole `study` reloads the PDF on every field edit). **Missing:** the third mode (auto-retrieve via `oaPdfResolver`), persisted uploads, a source switcher.
- `oaPdfResolver` (Unpaywall→OpenAlex→CrossRef) is **DOI-only** (no PMID→DOI), flag `autoPdfRetrieval` default OFF, rate-limited, wired **only** to `screeningOaController` (bulk).
- **No OCR anywhere.** Tesseract.js is not a dependency. Under the prod CSP (`script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`) OCR worker + wasm core + `eng.traineddata` **must be self-hosted** to stay truly local.
- `AppPdfViewer` exposes the pdf.js `PDFDocumentProxy` via `onDocLoaded(doc)`; interaction props (`{mode:'click'|'region', ...}`, `pageOverlay`) all default null so RoB/screening callers stay byte-identical.

### 1.5 Data model (must not regress)
Record shape (`mkExtractionRecord`, `records.js:138`): `{id, draft, author, year, outcome, timepoint, comparison, esType, scope:{level,outcomeId,canonical}, values:{16 string fields, es/lo/hi already on analysis scale}, provenance:{method,page,region,excerpt,at}, confidence, alternates[], conversions[], needsReview, notes}`. Pure/deterministic (no `Date.now`; `idFn` injectable). Confirm APPENDS one study row per record inheriting `CITATION_FIELDS` from `citationBaseId` (the v3.69.1 fix — never merge into `baseStudyId`). Protection rule: a non-empty base field is **never** overwritten. Analysis pools `project.studies` by exact `${outcome}|||${timepoint}` with `τ²` from `project.analysisSettings.tau2Method`; drafts/parked never reach Analysis. The P5 `model.js`/`conflicts.js` element system is the **only** dual-review path — preserve it.

---

## 2. Target design

**One workspace = extraction.** Retire the Classic/Structured toggle and the `showAssisted` button. `ExtractionTab` renders the split screen as its body: **PDF left, form/method panel right**, with a compact record/table view reachable via a "Records" step. The old classic study cards become the **Manual** method (the "form right" pane) and the "View table / Records" destination — all their data handlers stay identical. The P5 `ExtractionWorkspace` moves behind an explicit admin/flag route (kept, not deleted) so its server data and dual-review path survive.

**Layout:** 2-column CSS grid; the right method/form column is `position:sticky` with its own `overflow-y:auto` and `max-height:calc(100vh - offset)`; the PDF column scrolls independently. The draft-confirm list lives **inside** the sticky right column so confirm/park happens next to the PDF.

**Protocol scoping (all four methods):** every method produces records tagged `scope.level` primary/secondary/other with `outcomeId`, harmonised `outcome` name + `timepoint` (+ `comparison` where known). Confirm is **gated** until a draft has a primary/secondary outcome (escape hatch: "Not in this review" → park). Out-of-scope outcomes park in "Also reported (not in this review)" and never reach Analysis. Analysis is untouched.

**Done→continue:** right-panel footer with "Next study", "View records/table", "Continue to Risk of Bias".

**PDF sourcing (3 ways):** upload (persisted as an attachment when the study is screening-linked; object-URL fallback otherwise) · reuse an already-attached PDF · auto-retrieve open-access by PMID/DOI via a new single-record endpoint reusing the shared resolver (+ PMID→DOI). A source bar is always visible (badge + Replace/Find-OA).

**OCR ("text recognition", local, deterministic — never "AI"):** lazy-loaded self-hosted Tesseract.js. Plug-in points: (a) `extractPages` per-page fallback when the text layer is empty/garbled; (b) `handleRegion` when a region yields no items; (c) a synthetic absolutely-positioned text layer in `AppPdfViewer` so click-assign + in-doc search work on scans. OCR output is mapped into the same `{str,x,y,w,h}` (PDF-user-space) shape the grid/click paths already consume, tagged `source:'ocr'`, `needsReview`, cached per (docFingerprint,page) for determinism.

---

## 3. Method-by-method fixes

### 3.1 Auto-generate (`autoExtract.js` + `records.js`, pure)
1. **Never silently drop:** the unmatched branch parks `meanSd` and `eventsTotal` (as `scope.level:'other'`), not just ratios; return a count so the UI can say "N off-protocol outcomes detected — see Also reported".
2. **`detectedOutcomes[]`:** collect candidate outcome noun-phrases near each statistic; when `protocol.outcomes` is empty OR `drafts.length===0`, the UI renders a chooser to extract a detected outcome as a draft. Closes the anti-silent-fail requirement.
3. **Auto-compute effect sizes:** for raw 2×2/continuous drafts call the existing `calcES` (OR/RR for 2×2, MD/SMD for continuous), populate `es/lo/hi` + a logged `conversions[]` entry (mirror the ratio path), keep `needsReview=true`.
4. **Table detection in the auto path:** run `itemsToRows/detectColumns/buildGrid` + the new `detectTableShape` per page to find effect+CI rows and two-arm tables; emit region-provenanced drafts. Requires an items-per-page channel from `extractPages` (keep `autoExtract` free of pdf.js imports — pass normalized items in).
5. **Precision:** stop passing whole sentences to `matchOutcome`; extract candidate noun-phrases and require positional proximity to the statistic; lower confidence + `needsReview` when >1 candidate outcome is in scope.
6. **`scope.canonical`:** store the canonical NAME on a distinct field (or rely on `outcome`) — align `autoExtract.js:80` with `records.js:159`.

### 3.2 Table mapping (`pdfTextGrid.js` + new `tableShape.js` + `TableRegionMapper.jsx`)
- **Engine (additive; keep `buildGrid` byte-identical):** add CI/range patterns to `NUMERIC_CELL_PATTERNS` (`0.99–1.03`, `(0.95, 1.08)`, `0.99 to 1.03`); a new exported **column-merge post-pass** (collapse adjacent columns whose joined body cells match a CI/continuation pattern, and re-merge "Age," + "years"); `detectHeaderSpan` (top-k header rows, concatenate per column for tagging); a **footnote filter** (`/^[*†‡a-d]\s|^Note|^Abbrev|^CI[,:]|^Values are/i`); and a pure `detectTableShape(cells, headerSpan) → {shape, columnTags, rowKind, confidence}` scoring the three e1 shapes.
- **Mapper UI:** consume `detectTableShape` in `buildInitialState` to **pre-fill** roles/measure/rows (confirm-only when confident; fall back to manual when low — never guess confidently). Add roles `row-label / effect / ciLow / ciHigh / ci(combined,auto-split) / pValue` and direct-effect measures (HR/OR/RR/GENERIC → `{es,lo,hi}`). For per-variable tables, **per-row checkboxes** (each checked row = one candidate record labelled by its row-label). **Hide** shape-irrelevant columns behind a "show N hidden" toggle. **Protocol scoping:** an outcome/timepoint/comparison selector (pre-matched from row label + caption); rows matching no protocol outcome route to park. **Live preview** of the resulting record(s) before Apply, including the direct-effect shape. Keep the "no statistics beyond `b = total − events`" invariant — CI splitting is string parsing, not stats. Dedup: `handleRegion` calls `gridFromRegion` instead of re-implementing the pipeline.

### 3.3 Figure digitizer (`PlotDigitizer.jsx` — UX/wiring only; engine untouched)
- Delete the `(px,py)` readout; never render canvas coordinates.
- True **one-instruction-at-a-time** sub-wizard with a worked example per figure type (KM: "Click where time = 0 → type 0", "Click a known later time e.g. 90 → type 90", then survival 0 and 1); auto-advance the single active calibration target.
- **Auto-read axis tick labels:** thread the figure region's text layer (or a local OCR pass on the region) into the digitizer; pre-fill calibration anchors + values for the reviewer to **confirm** (conservative — flag low-confidence, require confirmation).
- **KM axis defaults** (survival 0–1 / 0–100%, time origin 0 → max follow-up).
- **Live overlay:** back-project the cleaned/reconstructed step-function via `cal.toPx` so the user sees the digitized curve tracking the printed one; confirmation overlay for forest/box clicks too.
- **Guided numbers-at-risk** capture (per-tick table / click the printed numbers) instead of the free-text `time:n` field.
- **Arm direction:** explicit "which curve is intervention / comparator?" selection; echo direction in the result so HR is never silently inverted.
- Demote Cox/Guyot/pseudo-IPD jargon behind a "method details" disclosure; lead with `HR = x [lo, hi]`.
- Panel-side `figureResultToRecords`: guard `Math.log` positivity (reject with a visible error, never store `NaN`); require an explicit `measure` for forest.

### 3.4 Click-assign + OCR (`AppPdfViewer.jsx` + new `numberTokens.js` + new `ocr.js` + panel)
- **Fix push-to-field at the source:** resolve the click to a character offset (`caretPositionFromPoint`/`caretRangeFromPoint`, fallback: map via `cssToUser` and hit-test cached `getTextContent` items). Extend the `onTextClick` payload **additively**: `{page, str:runStr, offset, user:{x,y}, spanBox}`.
- **Pure token snapper (`src/research-engine/extraction/numberTokens.js`, no DOM, unit-tested):** given run string + offset, expand to the FULL token — decimals, thousands commas, `%`, `±`, en/em-dash **ranges → {lo,hi}**, `n/N` and `a/b` pairs, `est (95% CI lo–hi)` triplets. Reuse/extend `NUMERIC_CELL_PATTERNS`.
- **Stitch fragments** across adjacent same-baseline spans before snapping (reuse `itemsToRows` y-tolerance) so `12.`+`3` → `12.3` and a standalone `-` keeps the sign.
- **Combined one-action capture:** a "smart" assign target that writes `es+lo+hi` or `events+total` in one click when a triplet/pair is detected.
- **Provenance + no overwrite:** clicks build/patch through the record model (`mkExtractionRecord` draft, or a protection-ruled patch that skips non-empty base fields), stamping `{method:'click', page, region:tokenBox, excerpt:runStr, at}`; render the captured token via `pageOverlay` for confirmation.
- **Drag-into-field:** overlay draggable number chips (`pageOverlay`, `dataTransfer` JSON) with the field select + card inputs as drop targets.
- **Feedback on miss:** additive `onTextMiss({page})` → panel status ("zoom, or enable text recognition").
- **OCR fallback** as in §2 (lazy self-hosted Tesseract.js), labeled "text recognition".

### 3.5 PDF sourcing (`usePdfSource.js` + server)
- New single-record OA endpoint (reuse the shared resolver + `fetchOaPdf` + `savePdf`, mirror `screeningOaController`), **persist** the result as a `ScreenPdfAttachment`; add PMID→DOI (NCBI idconv / OpenAlex `works/pmid:`); keep flag + rate-limit + polite-pool email. Add an explicit "Find open-access PDF" action (never auto-fire).
- Persist uploads through the screening attachment API when screening-linked (object-URL fallback otherwise); always render a source bar with Replace/Find-OA; guard the in-flight resolve against a local-file supersede (fix the clobber race); keep effect deps identity-only; reuse the loaded `doc` to avoid re-download.

---

## 4. Risks & guardrails
- `project.studies[]` shape + `confirmDraft` APPEND semantics are load-bearing for Analysis/Subgroup/Sensitivity/forest/exports — keep additive; drafts/parked stay off `project.studies`.
- Two mounts (`StitchProjectWorkspace.jsx:264`, `Workspace.jsx:1562`) + the `ESCalcInline/ConversionPanel/AddStudyModal/StudyCard` exports must stay in sync.
- `AppPdfViewer` interaction/overlay props must stay default-inert (RoB/screening byte-identical); caret capture reads `dataset.t` (original text, not mark-mangled); overlay chips survive text-layer rebuilds + page virtualization; handle rotation (or disable rotate in click mode like region mode).
- `usePdfSource` effect deps stay identity-only (v3.69.1 fix — do not regress).
- Pure engines (`records.js`, `autoExtract.js`, `pdfTextGrid.js`, digitizer) stay `Date`-free + `idFn`-injectable; ship new logic as **additive exported functions** so golden unit tests stay byte-identical; OCR output is nondeterministic → gate + `needsReview` + version-pin Tesseract.
- Tesseract.js assets self-hosted + lazy (never in the main bundle); labeled "text recognition".
- Retire the toggle and rewrite `structured-living.spec.ts` in the same change; keep `extraction.spec.ts`'s classic manual path reachable.
- Preserve CSV export (49-col order + BOM), conversions, validation, duplicate detection; deterministic engine reproducible (same PDF → same output).

---

## 5. Test plan
- **Unit (pure, deterministic):** `numberTokens` (decimals/ranges/`%`/`n/N`/triplets/sign/offset-snap); `pdfTextGrid` CI patterns + column-merge + `detectHeaderSpan` + footnote filter (+ `buildGrid` unchanged golden); `tableShape.detectTableShape` on all three shapes + low-confidence fallback; `autoExtract` (park unmatched meanSd/evTot, `detectedOutcomes`, auto-compute es via `calcES`, table-path drafts, precision proximity, `scope.canonical`); digitizer math regression (calibration transform, KM IPD reconstruction, Cox/Peto HR, Wan box) unchanged; `records` (sourceStudyId, extractedBy, confirm append + protection rule).
- **Component/smoke:** `extractionUnifiedSmoke` extended for the promoted main surface, sticky layout presence, confirm-gated-on-scope, click-assign smart-capture record shape, figure positivity guard.
- **Server:** `/api/ai-extract` invariants (404 flag-off, no model leak, 20 MB cap, whitelist, needsReview) + `thinking:disabled`/`stop_reason` branch + conversions passthrough; single-record OA endpoint (flag-off skip, PMID→DOI, persist, manual_upload never overwritten).
- **e2e:** rewrite `structured-living.spec.ts` for the retired toggle; keep `extraction.spec.ts` green (manual path via the new layout).
- **Gate:** `npm run test:ci` (target: keep 3649 green + net-new), `npm run build` green.
