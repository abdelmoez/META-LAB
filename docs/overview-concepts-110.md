# Screening Progress Truth + Concepts Workspace — 110.md

Implementation report for `.claude/Prompts/110.md`. Version **4.15.0**.

## 1. Whole-project screening progress (§1)

**Previous behaviour**: "Screening completion across all reviewers" was record-denominated —
one reviewer screening everything read 100% even when the project requires N independent
reviewers.

**New model** (pure `src/research-engine/screening/screeningProgress.js`, fed by one
`groupBy` aggregate in the overview controller — never a decision list):
- `requiredDecisions = screeningPool × effectiveRequiredReviewers` (per-project setting
  composed with the global quorum floor; never hard-coded 2; clamp range 2-10).
- `completedDecisions = Σ min(distinctHumanReviewers, required)` per record — the eligibility
  engine's reviewer id is excluded, matching the promotion gate.
- Unresolved conflicts are their own work units in the denominator; auto-resolved history
  rows are not. T/A-closed records count at the required number (leader conflict-resolution
  promotions cannot deadlock the model below 100%).
- `honestPct` never rounds up to 100 (1999/2000 → 99) nor down to 0 once work exists.
- Emitted additively as `dataSummary.screeningProgress`; every pre-existing field (incl.
  `projectProgress.completion`, which deliberately keeps its legacy semantics) is untouched.

**UI**: `ScreeningProgressStrip` in the Overview — headline % + a left-to-right pipeline
strip (reviewer passes → conflict resolution → complete; later stages render pending while an
earlier pass runs) + tiles for passes completed / records awaiting another reviewer /
conflicts awaiting resolution. Screening design system only; debounced (1.2s) realtime
refetch on decision pokes.

## 2. Concepts workspace (§2)

The hierarchy is inverted rather than shouted: surrounding containers stay informational
cards while the Concepts board becomes a recessed **build canvas** (accent-washed ground with
a faint dot grid, larger radius, inset hairline) on which concept cards are the raised
objects. Open card: elevation + accent ring. Non-open cards while one is open: settle toward
the ground (`color-mix`), restoring fully on hover/focus so clickability survives
de-emphasis. Transitions ride the existing card transition list (cross-fade alongside the
View-Transition morph; `prefers-reduced-motion` already covered). No DOM/testid changes to
the board; drag, popover anchoring, click-outside exemption, persisted `searchState` shapes
all untouched.

**Token lesson (regression-pinned)**: the canvas and de-emphasis derive from `--t-bg`, NOT
`--t-surf` — Stitch's `legacyRemap` maps `--t-surf` and `--t-card` to the same colour, which
made the first cut invisible under the live design system. A unit pin forbids `C.surf` in the
canvas rules and documents why.

## 3. Verification

| Command | Result |
|---|---|
| `npm run test:ci` | **464 files / 7992 tests passed** (7949 at v4.14.0) |
| `npm run lint` / `npm run build` | clean |
| `tests/screening/integration/overview-progress.test.js` (live server) | 5/5 incl. the raise-required-reviewers case (test's PATCH→PUT corrected in-round) |
| e2e responsive search-workspace (chromium) | 6/6 incl. the new §2 canvas test (which caught the token collision on its first live run) |
| e2e searchWorkspace (webkit-search) | 34 passed, 1 flaky-passed (pre-existing MeSH edit test) |
| e2e responsive (tablet/WebKit) | 6/6 — `color-mix` confirmed rendering in WebKit |
| e2e ops (chromium) | passed |

## 4. Known limitations / follow-ups

1. `projectProgress.completion` still reads record-denominated 100% in the one-reviewer case
   (kept for back-compat; divergence pinned by test). Consider migrating the workflow stepper
   / prismaFlowService to `screeningProgress` and deprecating it.
2. The headline can tick DOWN a point when a new conflict surfaces (honest "newly discovered
   work"); `decisionCompletion` is exposed separately as the monotone figure.
3. Pre-existing: `progressEvidence.js` does not exclude the eligibility-engine reviewer from
   its pending groupBy (disagrees with the promotion gate); `OverviewTab` `STATUS_COLOR` uses
   the non-token `C.ylw`; `conflict.changed` is subscribed but never emitted (refresh rides
   `decision.saved`).
4. The `+ Add concept` ghost card and drag drop-zone still use pre-canvas styling.
5. A day/night visual-regression snapshot of the terms stage would defend the canvas's
   perceptual contract better than testids can.
