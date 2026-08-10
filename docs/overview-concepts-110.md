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

**Review round (F4, F6)**:
- The remaining-work sentence is emitted as structured `summaryParts`
  (`{count, text}`) and joined by the shared `formatSummaryParts(parts, fmt)`. The strip
  passes its own `toLocaleString` formatter, so a large project no longer reads
  "1,000 of 2,000 reviewer decisions" above "1000 awaiting another reviewer". The flat
  `summary` string stays on the model — locale-independent, because the module is
  imported by the Express controller too — and is the component's fallback for a server
  response that predates the parts.
- The conflict counts fed to `computeScreeningProgress` are now scoped to the
  non-duplicate pool, matching `poolSize`/`reviewerHistogram`. A conflict raised before a
  record was flagged as a duplicate used to add a permanent work unit to `totalUnits`,
  pinning the strip at 99% / "Conflict resolution — Now". `dataSummary.unresolvedConflicts`
  deliberately stays project-wide: it is the Conflicts tab badge and must keep matching
  `listConflicts`, which does list conflicts on duplicate-flagged records.

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

**Review round (F1, F2, F3)** — "toward `--t-bg`" was not the same as "`--t-bg`", and the
accent undid it:

| combination | plane vs card, before | plane vs card, now | de-emphasis, before | now |
|---|---|---|---|---|
| legacy day | 41 | 23 | 11 | 23 |
| legacy night | 16 | 39 | 18 | 39 |
| stitch light | 35 | 14 | 7 | 14 |
| stitch night | **2** | 31 | 14 | 31 |

(channel-sum `|Δr|+|Δg|+|Δb|` of the computed surfaces.)

- The plane is now the RAW `--t-bg`. `color-mix(--t-bg 95%, --t-acc)` resolved to
  rgb(26,28,37) against a rgb(26,29,38) card under Stitch + night — the shipped default
  design system with its one-click Dark toggle — because `--t-acc` is a LIGHT colour in
  both dark palettes, so the 5% wash pushed the plane up onto the cards.
- The accent survives only as the head gradient, capped from alpha `'14'` (8%) to `'08'`
  (3.1%): at 8% the wash *crossed* the card colour outright in both dark themes about 40px
  down, i.e. exactly where the first card sits.
- The inset top hairline moved from `--t-txt` (near-white in dark = a RAISED bevel on a
  plane meant to read recessed) to the ground-derived `alpha(C.bg,'40')`.
- The de-emphasised card lands ON the ground instead of 45% of the way there, and swaps the
  removed drop shadow for an inset one, so the cue survives in Stitch light where the two
  grounds are only 14 apart (and identical in blue) — no mix ratio can do better there.
- The e2e perceptual guard is numeric (`channelDelta ≥ 12`) instead of a string inequality,
  and a second test parameterises both surface pairs over `data-theme` ∈ {day, night} via
  the app's real `applyTheme` contract (attribute + `metalab_theme` + `metalab:theme-change`).

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
   `decision.saved`). **The same engine-exclusion gap sits inside this endpoint**: the
   `taReviewers` map that feeds `dataSummary.titleAbstractPending` counts *every* reviewer id,
   while the `taReviewerGroups` groupBy that feeds `screeningProgress` excludes
   `ELIGIBILITY_ENGINE_REVIEWER_ID`, so one payload can report a record both as awaiting
   another reviewer (histogram) and as not (pending count). Untouched here because
   `titleAbstractPending`, `progressEvidence.js` and `screeningController`'s mirror of it are
   one pre-existing contract that has to move together; the fix is to derive all of them from
   a single engine-excluding reducer over the already-loaded `decisions` array and drop the
   extra `groupBy`.
4. The `+ Add concept` ghost card and drag drop-zone still use pre-canvas styling.
5. A day/night visual-regression snapshot of the terms stage would defend the canvas's
   perceptual contract better than the numeric `channelDelta` floor can — the floor proves
   the surfaces differ, not that the result looks right.
6. Stitch light is the perceptual floor for the whole canvas mechanism: its `--t-bg`
   (#f7f9ff) and `--t-card` (#ffffff) are 14 channel-units apart and *identical in blue*, so
   both "plane vs card" and "open vs de-emphasised" sit at 14 there and cannot be widened
   without new tokens (e.g. a `--t-canvas` ground, or nudging `STITCH_LIGHT.surface`). The
   e2e floor of 12 is set by that combination.
7. The canvas's outer `0 1px 2px var(--t-shadow)` drop shadow is inherited from the original
   cut and is arguably wrong for a plane that reads recessed; the inset top hairline
   (`alpha(C.bg,'40')`) is deliberately near-invisible (~1.5 units) — it exists to *not* be a
   raised bevel rather than to be a strong cue. Both are candidates for a `var(--t-shadow)`
   inner edge if the recess should read harder.
