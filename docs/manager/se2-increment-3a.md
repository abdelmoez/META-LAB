# SE2 — Increment 3a: duplicate-detection calibration (se2.md §10)

> First slice of Increment 3 (§7/§10/§11/§12), split into sub-increments for
> reviewable, shippable units (like 1/1b). 3a = §10. Additive; one new table; no
> destructive migration. The duplicate engine stays honestly **unvalidated** until
> accrued reviewer labels show adequate accuracy.

## Problem (se2.md §10)
The existing duplicate heuristic produced a single 0–100 likelihood and could
silently merge two **separate reports of the same study** (preprint ↔ journal,
conference ↔ full article, secondary analysis) — which are *not* duplicate records.
It also had no labelled-data feedback loop, so its accuracy was unknown.

## What shipped

### Typed, conflict-aware classification (pure engine)
`src/research-engine/screening/deduplication.js` (additive — existing exports
unchanged):
- **`extractDupFeatures`** — richer signals: DOI/PMID match **and conflict**, title
  similarity, author Jaccard, abstract token-Jaccard, year match/conflict, journal
  match/conflict, volume/issue/pages match, language conflict, publication-type match.
- **`classifyPair`** → a typed verdict: `exact_duplicate` / `probable_duplicate` /
  `possible_duplicate` / **`related_report`** / **`same_study_family`** / `not_duplicate`,
  each with `mergeable`, `score`, `confidence`, `reasons[]`, and **`conflicts[]`**. The
  crux: strong author overlap + similar title but a **different venue/year/DOI** →
  `related_report` / `same_study_family` with **`mergeable:false`** — these are surfaced
  but never auto-merged.
- **`DUP_MERGEABLE`** (only exact/probable/possible) + **`DUP_MODEL_VERSION`**
  (`dup-1.0.0`) so the dup model is versioned separately from the relevance model.
- **`evaluateDuplicateLabels`** — evaluation harness → precision / recall / specificity /
  F1 / **false-merge rate** / **false-split rate** / by-type, from reviewer labels.

### Labelled dataset — accrued from existing reviewer actions (no new UI friction)
- New table **`ScreenDuplicateLabel`** (additive; canonical pair order A<B; upsert on
  `@@unique([projectId, recordIdA, recordIdB])`).
- `resolveDuplicateGroup` now **opportunistically** records a label for every pair when a
  reviewer resolves a group: merge → `duplicate`, "keep all" → `not_duplicate`. The
  classifier's verdict at decision time is stamped alongside. Best-effort (try/catch) —
  labelling can never block resolution.
- `listDuplicates` returns a leader-only **`evaluation`** computed from accrued labels.

### UI (`DuplicatesTab.jsx`)
- A **typed verdict badge** per group (colour-coded; teal "Related report — likely not a
  duplicate" / "Same study family" for non-mergeable types).
- A **conflict warning** ("⚠ Conflicting metadata: Different journals · Different years.
  Verify before merging.").
- Non-mergeable groups get explicit guidance to prefer "keep all" unless confirmed.
- A leader **accuracy line**: honestly shows "not yet validated — N reviewer decisions
  logged (need ≥ 20)" until enough labels exist, then precision/recall/false-merge.

## DB / API / files
- **DB (additive `prisma db push`):** `ScreenDuplicateLabel`. No destructive change.
- **API:** `GET /screening/projects/:pid/duplicates` now returns `dupType`,
  `dupTypeLabel`, `dupConflicts`, `mergeable` per group + a leader `evaluation`.
  `resolveDuplicateGroup` accrues labels. No new routes.
- **New:** `tests/screening/unit/dupClassify.test.js` (11 tests).
- **Changed:** `deduplication.js`, `screeningDuplicateService.js`,
  `screeningController.js`, `DuplicatesTab.jsx`, `schema.prisma`.

## Verified
- +13 pure unit tests (each type, conflict detection, non-mergeable safety, evaluation
  harness incl. false-merge/false-split, + the two adversarial identifier-conflict cases
  below). Full suite **1679 green / 97 files** (was 1666); existing `deduplication.test.js`
  (50 tests) still green — existing exports unchanged. Production build green.
- **Real-DB smoke:** label upsert is idempotent (compound key correct — 1 row after 2
  writes), evaluation harness runs against the DB and returns precision/confusion/version.

## Adversarial review (9 agents, 4 lenses + verify) — 3 findings, all fixed
- **HIGH (fixed):** `classifyPair` could return a **mergeable** verdict for a pair whose
  hard identifiers CONFLICT — a different PMID gated no branch, and a different DOI was
  ungated in the `possible` branch — so the exact preprint↔journal / erratum case the
  rule targets could be nudged toward a false merge. Fix: a DOI **or** PMID conflict
  (`idConflict`) is now a hard no-merge signal — it routes similar-title pairs into
  `related_report`/`same_study_family` and disqualifies both the `probable` and
  `possible` branches (+2 regression tests).
- **LOW (fixed):** the label upsert's `update` clause omitted `reason`, so a re-resolved
  pair could carry a stale reason — now refreshed alongside the verdict.
- **LOW (fixed):** the leader accuracy gate keyed the "≥ 20, not yet validated" threshold
  off total stored rows (incl. `uncertain`) while metrics use scored labels — now both
  use the scored count.

## Honesty (se2.md §10/§19)
`classifyPair` is a transparent **heuristic** — NOT validated against a labelled duplicate
benchmark. The UI says so until ≥ 20 reviewer labels accrue and `evaluateDuplicateLabels`
shows the real numbers. We never flip a "validated" claim on training completion alone.

## Next (remaining Increment 3)
- **3b — §11:** model versioning, drift tracking, rollback.
- **3c — §7:** real biomedical embeddings (service + model selection + text representation).
- **3d — §12:** background-job scalability beyond the 5,000-record cap.
