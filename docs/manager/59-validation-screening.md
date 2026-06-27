# 59.md — validation-grade screening upgrades (implementation report)

Three changes for formal validation (WSS@95, AUC, calibration, Brier). All committed
+ pushed; 2474 unit tests green. No existing screening behavior broken.

## Change 1 — import the `decision` column (commit `a315b0e`)
A pre-labelled benchmark dataset now imports already screened.
- `src/research-engine/import-export/parsers.js`: `decision` added to
  `CSV_FIELD_SYNONYMS`; `mkRecord`/`rowToRecord` pass it through; new
  `normalizeImportedDecision()` — case-insensitive, trimmed, synonym-aware
  (yes/accept→include, no/reject→exclude, unsure→maybe); empty/missing→`undecided`;
  an UNRECOGNISED value → `""` so the caller warns (no silent corruption).
- `server/services/screeningImportService.js` `dedupeAndInsertRecords`:
  include/exclude/maybe become real `ScreenDecision` rows by the importer (stage
  `title_abstract`), idempotent via `@@unique(recordId,reviewerId,stage)`;
  undecided/empty left unscreened; returns `{decisionsApplied, invalidDecisions}`.
  Counts/progress/reviewer-status/the 50-screened threshold/training eligibility all
  derive from `ScreenDecision`, so nothing is double-counted.

## Change 2 — out-of-sample AI scores in CSV export (commit `725c550`)
The export carries leakage-free, reproducible scores a researcher can validate
independently.
- NEW `src/research-engine/screening/ai/crossValidate.js` — pure, deterministic
  K-fold per-record scoring. **Out-of-sample is guaranteed by full per-fold
  isolation:** for each fold the IDF/vectorizer, the logreg fit, AND the calibrator
  are fit on the training fold ONLY (the held-out fold's labels are removed from the
  label map), reusing the existing `trainAndScore`/calibration math. Seeded stratified
  folds (reuses the metrics path's `stratifiedFolds`) → identical on re-run.
  Reproducible FNV-1a `modelVersion`. Emits `cross_validated` or `not_available` —
  never an in-sample score.
- `activeLearning.js`: `trainAndScore` accepts an optional pre-fit vectorizer (the
  fold-isolation seam) + exports `stratifiedFolds`; `index.js` barrel.
- `screeningController.exportRecords`: appends `ai_relevance_score_raw`,
  `ai_relevance_probability_calibrated`, `ai_score_type`, `ai_score_fold`,
  `ai_score_model_version`, `ai_score_generated_at`, `ai_score_status` (existing
  columns + order unchanged → backwards compatible). Unscored/unavailable → blank +
  status; respects the 50-screened floor; best-effort (export never breaks).

## Change 3 — ≥50 screened before scoring (done in 58.md §8)
`minScreenedDecisions=50` centralized in the AI settings (global + per-project),
server-enforced in `getAiScores` (counts distinct decided title/abstract records;
withholds scores below threshold). Imported labelled decisions (Change 1) count toward
it. UI placeholder ("N/50 screened") + admin override already shipped (58 recs).

## Tests / build / commands
`tests/unit/importDecision.test.js` (+7: normalise + CSV round-trip + back-compat),
`tests/unit/screening/ai/crossValidatePerRecord.test.js` (+10: determinism, fold
partition, exact held-out reconstruction = anti-leakage, blank-safe, governance floor).
Fixed `parsers.test.js` mkRecord (decision default → 'undecided') + regenerated the
postgres schema via `server/scripts/sync-postgres-schema.mjs`. `npm run build` ✓ ·
`vitest run tests/unit tests/screening/unit` → **2474 passed**.

## Remaining limitations (honest)
- CV is recomputed at export time (always reflects current/imported labels; bounded by
  `maxRecordsForCv=20000`). Reusing a persisted CV run is a future optimization but
  risks staleness vs a fresh benchmark import.
- Calibration uses pooled out-of-fold scores from sibling folds (standard CV
  calibration); a full nested-CV calibration estimate is a documented refinement.
- CV runs for the `title_abstract` stage (where labels live); other stages are a
  trivial extension.
