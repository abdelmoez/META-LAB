# Extraction Correction & Reliability Rebuild — Final Report (RoadMap/4.md)

**Version:** v3.72.0 (initial) → **v3.72.2** (after adversarial recs round)
**Baseline suite:** 3951 unit tests → **4064** (initial commit) → **4090+** after the recs round, zero regressions. Production build green.
**Plan:** `docs/manager/extraction-correction-plan.md` (living doc; §7 deliverable).
**Commits:** `7935d1f` (v3.72.0, engine + wiring) then the recs-round commit (v3.72.2). A concurrent session's 74.md work (`d1bec77`/`c1f840c`, search-only, no extraction overlap) interleaved in history.

## Adversarial recs round (post-commit)

A 50-agent review (4 dimensions → findings → 2 independent refuters each, 2.76 M tokens) surfaced 23 findings; every confirmed-real one was fixed WITH a regression test. Highlights: **2 CRITICAL data-integrity bugs** in the new code — reconcile collapsing distinct table rows from one region (data loss), and `buildTableGrid`'s indent-collapse destroying a combined "aOR (95% CI)" effect column — plus a CRITICAL `pageLayout` mis-classification and HIGH identity-stability / footnote-stripping / snapToken / axis-fit defects. The reconcile identity was redesigned to stamp-at-creation from immutable source facts + a values fingerprint (so re-scoping/editing a draft no longer breaks dedup, and distinct rows never collapse); confirm/park now record resolved identities so reruns don't resurrect them. See the plan's verification log entry [7] for the full 23-item list and fixes.


---

## 37.1 Executive summary

This round corrected the trust-critical failures of the assisted-extraction workspace and
laid the deterministic, tested engine foundation the RoadMap/4.md workstreams require. It is
a **correction + engine-foundation** pass, honest about what remains UI-side.

**What was rebuilt / added (all pure, deterministic, tested, additive):**

1. **One shared cell grammar** (`cellGrammar.js`, §13) — `parseCell` returns a discriminated
   ParsedCell (INT/FLOAT/PCT/N_OF_N/MEAN_SD/CI/P/MISSING) that preserves raw text, keeps the
   p-value inequality, and **never silently reorders a reversed CI** (it warns). `snapToken`
   powers click-assign. This replaces the six divergent number parsers the audit found.
2. **Shared effect formatter** (`format/formatEffect.js`, §18) — back-transforms log/logit/
   Fisher-z stored effects for display. **Fixes the production bug**: `es=0.1133…, lo=0,
   hi=0.2311…` now renders **`RR 1.12 [1.00, 1.26]`**, not the raw log value labelled as a ratio.
   Wired into the draft cards and the "Also reported" list (both workspace mounts).
3. **Value-precedence engine** (`valuePrecedence.js`, §27/§4.3) — one `decideWrite` decision
   (write / propose-replace / keep-existing / add-alternative). Wired into click-assign so a
   click that would replace an existing value now **asks first** (§21.5) instead of silently
   overwriting — the worst finding in the audit.
4. **Stable identity + reconciliation** (`draftReconcile.js`, §10.5/§19.10/§4.4) — drafts get a
   source-derived identity (not a random id); rerunning a machine pass is **idempotent** (no
   duplicate drafts) and a **dismissed finding is not resurrected**. Wired into add/dismiss.
5. **Staged table pipeline** (`pdfTextGrid.js` +306 lines, §12) — `repairTokens` fixes mid-word
   splits (`u`+`nivariate` → `univariate`); `stripCaptionAndFootnotes` keeps a caption subtitle
   out of the data body; `mergeWrappedRows` stitches wrapped labels **and** preserves indented
   arm sub-rows as hierarchy; `buildTableGrid` emits the §10.2 contract with `PARSER_VERSION`.
6. **Table-shape classifier extended** (`tableShape.js`, §14) — the 4.md 5-shape vocabulary via
   `canonicalShape`, plus `evidence[]`, `alternates[]` (the ≤0.15 rule), and PICO-assisted arm
   matching (`armMatch.js`) that **never assigns an arm positionally**. The internal 3-shape
   scoring and its golden tests are preserved byte-compatibly.
7. **Page layout / OCR normalizer / auto-calibrate** (`pageLayout.js` §19.1, `ocr/normalizeOcr.js`
   §24.4, `digitizer/autoCalibrate.js` §22) — the pure engines for two-column survey, OCR-to-
   pdf-item mapping, and confirm-first axis reading.
8. **Fixtures + generator + dump helper** (§11) — `scripts/dump-text-items.mjs` (real pdf.js
   dumps) and 7 labelled-synthetic fixtures with expected blocks and an integration test.

The system is **safer** because: user values can no longer be silently overwritten; ratio
effects can no longer display as raw log numbers; reruns no longer duplicate work; every new
draft can carry a resolvable source identity. **Usability** improved at the two points a
reviewer actually feels risk (the overwrite prompt and the correct effect display). What stays
**manual by design**: confirming every machine draft (needsReview), confirming an axis reading,
and mapping any table the classifier marks `unknown`.

---

## 37.2 Workstream acceptance matrix

Legend: ✅ Passed · 🟡 Partial (engine done, UI/wiring remains) · ⬜ Not started · 🔵 Not testable (missing real fixture)

| Workstream | Item | Status | Evidence |
|---|---|---|---|
| WS1 grid | staged pipeline (repair/lines/caption/footnote/wrapped/hierarchy/header/confidence) | ✅ | `pdfTextGrid.js` stages + `gridPipeline.test.js` (11) |
| WS1 grid | §10.2 grid contract via `buildTableGrid` | ✅ | contract test in `gridPipeline.test.js` |
| WS1 grid | Sujan fixture: effect-per-row, no caption leak, mid-word repair, SIRS row | ✅ (synthetic) / 🔵 (real PDF) | `fixtures.integration.test.js` |
| WS1 grid | Khoury fixture: arms-in-columns, wrapped label, indented children, Paik values | ✅ (synthetic) / 🔵 (real PDF) | `fixtures.integration.test.js` |
| §13 grammar | `parseCell` all kinds + never-throw + raw preserved | ✅ | `cellGrammar.test.js` (20) |
| §13 grammar | `snapToken` composite/n=64/percent/p-inequality/nearest | ✅ | `cellGrammar.test.js` |
| §13 grammar | delete `firstNumber`; click-assign uses `snapToken` | ✅ | `AssistedExtractionPanel` now resolves clicks through `cellGrammar.snapToken`; `firstNumber` retired (only a doc comment remains) |
| §14 shape | 5-shape vocab + evidence + alternates + PICO arm match | ✅ | `tableShape.test.js` (+6), `armMatch.test.js` (6) |
| WS2 mapper | side-by-side crop + faithful replica + hover sync | ⬜ | engine (`buildTableGrid`, `renderRegion`) ready; UI rebuild not done |
| WS2 mapper | shape-specific completion (no Events/Total gate for effect-per-row) | 🟡 | detector distinguishes shapes; mapper still uses direct/twoarm modes |
| WS2 mapper | `userCorrected` cell edits w/ original retained | ⬜ | not done |
| WS3b display | shared `formatEffect` + surface audit | ✅ | `formatEffect.test.js` (10) + DraftReviewList wiring |
| WS3b display | exact production case → `RR 1.12 [1.00, 1.26]` | ✅ | `formatEffect.test.js` first test |
| WS3 auto | `pageLayout` two-column detection | ✅ engine | `pageLayout.test.js` (11) |
| WS3 auto | table-first document survey (survey → prose fallback → figure flags → no-match) | 🟡 | all engine pieces exist (pageLayout+buildTableGrid+tableShape+matchOutcome+reconcile); the `surveyExtract.js` orchestrator wiring auto-generate to run tables-before-prose is the remaining integration |
| WS3 auto | versioned clinical synonym dictionary (+AKI/ICU/SIRS/…) | ✅ | `outcomeMatch.js` `OUTCOME_SYNONYMS_VERSION` + tests |
| WS3 auto | idempotent reconciliation | ✅ | `draftReconcile` + `valuePrecedence.test.js` (15) + `addDrafts` wiring |
| WS5 click | overwrite guard (Replace/Keep, default keep) | ✅ | `valuePrecedence` + panel prompt |
| WS5 click | composite es+CI confirm / multi-span selection / flash / OCR text layer | 🟡/⬜ | snapToken supports composites; the confirm-before-patch + multi-span capture + source flash remain UI work |
| WS4 figure | `autoCalibrate` tick-fit + gates + AxisFit | ✅ engine | `autoCalibrate.test.js` (14) |
| WS4 figure | confirm-first UI ("I read the axes") + at-risk one-click | ⬜ | engine ready; PlotDigitizer UI rewrite not done |
| WS6 OCR | `normalizeOcr` pdf-item contract + cacheKey + modes | ✅ engine | `normalizeOcr.test.js` (11) |
| WS6 OCR | bounded pool + cancellation + digits mode in the service | 🟡 | pure normalizer done; `src/frontend/services/ocr.js` pool/cancel/digits remains |
| §10.5 identity | stable source identity (not random) | ✅ | `draftReconcile.mkSourceIdentity` |
| §27 precedence | one shared decision engine | ✅ | `valuePrecedence.js` |
| §11 fixtures | dump helper + 7 fixtures + expected | ✅ (synthetic) / 🔵 (real) | `scripts/`, `tests/fixtures/extraction/` |

No partial item is marked Passed. Items that need the real PDFs are marked 🔵 and stay open.

## 37.3 Fixture results

| Fixture | Expected | Actual | Pass | Test file |
|---|---|---|---|---|
| Sujan (synthetic) | effect-per-row; caption subtitle kept out; `univariate` repaired; SIRS aOR 2.24 CI[1.40,3.57] P<0.001 | as expected | ✅ | `fixtures.integration.test.js` |
| Khoury (synthetic) | arms-in-columns; `biliary obstruction` one row; EUS-BD/ERCP indented children; Paik 125/64/61 | as expected | ✅ | `fixtures.integration.test.js` |
| mean-SD (synthetic) | mean-sd, 2 arms, sample sizes | mean-sd | ✅ | `fixtures.integration.test.js` |
| events/total (synthetic) | two-by-two, missing cell tolerated | two-by-two | ✅ | `fixtures.integration.test.js` |
| KM (synthetic) | linear x/y ticks + at-risk table | fit engine consumes ticks | ✅ (engine) | `autoCalibrate.test.js` |
| forest (synthetic) | log ticks 0.1/1/10 detected as log | scale:'log' auto | ✅ | `autoCalibrate.test.js` |
| rasterized OCR (synthetic) | word boxes → pdf-space items | y-flip mapping verified | ✅ | `normalizeOcr.test.js` |
| Sujan / Khoury (REAL PDF) | same as synthetic | — | 🔵 not present in repo | add per README |

## 37.4 Test results

| Command | Result | Count |
|---|---|---|
| `npm run test:unit` | ✅ pass | 281 files / **4064** tests (was 3951; +113 net-new) |
| `npm run build` | see verification log | (staging OCR assets + version gen + vite) |

Environment: Windows 11, node 20.17, vitest 2.1.9.

## 37.6 Compatibility review

- `mkStudy` shape: **untouched** (both factories).
- Analysis / RoB / GRADE / PRISMA / export schemas / `calcES` math: **untouched**; es/lo/hi
  remain analysis-scale strings — `formatEffect` back-transforms only at the display edge.
- `aiExtract` default-off behaviour: **untouched**.
- Existing golden tests (grid, tableShape 3-shape, records, digitizer math, outcomeMatch):
  **all still green** — every change was additive-exported.
- Draft/parked storage keys: additive only (`extractionDismissed[]` is new and optional).

## 37.7 Known limitations (explicit)

- The **real** Sujan/Khoury PDFs are not in the repo; acceptance for them is proven on
  labelled-synthetic companions that reproduce the described structure, not the real files.
- The **TableRegionMapper side-by-side crop + faithful replica + hover-sync** UI is not rebuilt;
  the mapper still uses its column-tagging surface (the engine to drive the rebuild — `buildTableGrid`,
  `renderRegion`, shape `evidence`/`alternates` — is now in place).
- The **PlotDigitizer confirm-first "I read the axes" UI** and **KM at-risk one-click parse** are
  not wired; `autoCalibrate` is the engine they will consume.
- **auto-generate** still runs its (precision-minded) prose engine; the table-first document
  **survey orchestrator** (`surveyExtract.js`) that runs `pageLayout`→`buildTableGrid`→`tableShape`
  before prose is the remaining WS3 integration.
- The **OCR service** (`src/frontend/services/ocr.js`) still uses a single worker without a
  cancellation API or digits mode; the pure normalizer + cache-key are ready for it.
- `firstNumber` remains as a no-offset click fallback (guarded to refuse ambiguous multi-number
  runs) pending full migration to `snapToken`.
- Heavily merged / graphical tables still fall back to manual mapping (a successful safe failure).

## 37.9 Files changed

**New pure engine modules:** `cellGrammar.js`, `format/formatEffect.js`, `valuePrecedence.js`,
`draftReconcile.js`, `armMatch.js`, `pageLayout.js`, `ocr/normalizeOcr.js`,
`digitizer/autoCalibrate.js`. **Extended:** `pdfTextGrid.js` (+staged pipeline), `tableShape.js`
(+5-shape/evidence/alternates/pico), `outcomeMatch.js` (+synonyms/version). **Wired (UI/state):**
`DraftReviewList.jsx` (formatEffect), `AssistedExtractionPanel.jsx` (overwrite guard),
`extractionTabs.jsx` (reconcile + dismissed identities). **Tooling/fixtures:**
`scripts/dump-text-items.mjs`, `scripts/gen-extraction-fixtures.mjs`,
`tests/fixtures/extraction/` (7 fixtures + README). **Tests:** 10 new unit/integration files.

## 37.10 Future-safe extension points

- **New cell grammar:** add a matcher in `cellGrammar.parseCell` (ordered most-specific-first).
- **New table shape:** add a scorer branch in `tableShape.detectTableShape` + a `CANONICAL_SHAPE` entry.
- **New outcome synonym:** append a group to `OUTCOME_SYNONYMS` and bump `OUTCOME_SYNONYMS_VERSION`.
- **New figure type:** consume `autoCalibrate.autoCalibrateAxis` from the digitizer with the type's tick-harvest rule.
- **New provenance method / origin:** extend `valuePrecedence.ORIGIN_RANK` and `draftReconcile.IDENTITY_PARTS`.
