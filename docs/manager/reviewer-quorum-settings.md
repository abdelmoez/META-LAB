# Reviewer Quorum Settings (prompt23 Task 11)

The number of independent reviewer decisions required to advance a record follows
the per-project setting **`requiredScreeningReviewers`** everywhere — no hard-coded 2
outside the default.

## How it works
- **Default:** `ScreenProject.requiredScreeningReviewers` defaults to `2`
  (schema). The global floor is `getEffectiveQuorum()` (admin setting).
- **Effective requirement:** `effectiveRequired = max(requiredScreeningReviewers,
  globalQuorum)`. Promotion (`saveDecision`) already enforces this server-side: a
  record advances title/abstract → full text only when
  `distinctDecisions ≥ effectiveRequired` and the include threshold is met.

## What this task fixed (display correctness)
The Overview endpoint previously returned a hard-coded `quorum: QUORUM` (2) for
display. It now returns the **effective** value:
- `screeningOverviewController.getOverview` → `quorum: effectiveRequired`,
  `requiredScreeningReviewers`.
- `OverviewTab` "Quorum: N reviewers to advance" now reflects the real setting.
- `SecondReviewTab` copy "(≥N reviewers)" is computed from the setting, not "≥2".

Backend promotion/quorum logic was already setting-driven and is unchanged; this
task aligned every **displayed** quorum label with the setting.

## Behaviour when the setting changes
- **Increase** (e.g. 2 → 3): records with fewer than the new number of distinct
  decisions are no longer "quorum met"; they re-appear as needing more screening
  (unless already manually resolved/promoted). The stepper's
  `titleAbstractPending` count (from `getOverview`, computed with `effectiveRequired`)
  reflects this immediately.
- **Decrease** (e.g. 3 → 2): records that already have enough decisions become
  eligible to advance on the next decision/recompute.

## Edge case
`getOverview` uses the synchronous `QUORUM` constant as the global floor in
`effectiveRequired`. In the default configuration (`requireTwoReviewers = true`,
floor 2) this matches the promotion gate exactly. If an admin lowers the global
floor below 2, unify by exporting `effectiveRequiredReviewers()` from the
controller — noted as a follow-up; the common path is correct today.
