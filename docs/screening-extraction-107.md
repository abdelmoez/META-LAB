# Screening Workflow + Proportion Extraction Upgrade — 107.md

Implementation report for `.claude/Prompts/107.md`. Version **4.12.0**.
Round 2 (adversarial review + fixes) is documented in §15 at the end.

## 1. What was inspected first

Six parallel read-only investigations (duplicate-detection lifecycle, keyword system, screening
workspace UI, proportion extraction, analysis builder, repo conventions) preceded any edit. The
findings that determined the design:

1. Screening duplicate detection is already a durable server-side job (`ScreenDuplicateJob`) with
   explicit `queued/processing/completed/failed/cancelled` states — the bug was never in the job,
   it was in how the overview endpoint *summarised* it (see §2).
2. Screening keywords are two flat JSON `string[]` columns on `ScreenProject`
   (`inclusionKeywords`/`exclusionKeywords`) with no per-term metadata, no review state, no CAS,
   and a purely mechanical criteria tokenizer whose connector list includes `without` — which is
   exactly how `epilepsy` landed as an *exclusion* keyword from "patients without epilepsy".
3. Extraction rows are `mkStudy()` JSON rows in the `Project.data` blob, so the new per-estimate
   fields need **no database migration** — but they do need ~12 hand-maintained allow-lists
   touched, and both duplicated `mkStudy`/`validateStudy` copies kept in step.
4. There is no persisted analysis configuration at all; the only poolability override was an
   ephemeral `useState`. The persistent override store had to be created.
5. The UI-test house style is SSR (`renderToStaticMarkup`, no jsdom), so every interactive
   behaviour was factored into pure modules first and pinned there, with Playwright covering the
   real interaction.

## 2. Root cause — stale "Pending" duplicate status (107 §1)

The string "Pending" is produced by the workflow stepper model
(`src/frontend/screening/ui/screeningSteps.js`), not the Duplicates tab. It was gated on
`dataSummary.duplicateDetectionRun`, which `server/controllers/screeningOverviewController.js`
computed as **`dupGroups.length > 0`** — inferring "detection has run" from the *existence of
duplicate groups*. A detection run that completed and found **zero duplicates** creates no group
rows, so the stepper said "Pending" forever while the tab body simultaneously said "Detection
finished — no duplicates were found". The flag also regressed whenever batch-delete or a scoped
reset removed the last group rows.

Compounding session-scoped causes: the worker emitted its completion events with
`{ exclude: job.createdById }` (the person who clicked Detect was the one client that never heard
about completion), **no client subscribed to `duplicates.completed` at all**, the Stitch vertical
stepper's summary hook refreshes only on realtime pokes (no polling), and the tab's slow
cross-session poll refreshed the group list but not the shell summary — with the refresh call
placed inside a `setState` updater (StrictMode double-invocation hazard).

### The fix

- The **job row is authoritative**: the overview now also returns
  `dataSummary.duplicateDetection = { status, lastCompletedAt, lastError, stale, staleReason }`,
  and `duplicateDetectionRun` is true when a completed job exists *or* groups exist (name kept for
  backward compatibility).
- **Stepper states**: never run → "Pending"; queued/processing → "Processing…"; failed →
  "Failed" (attention); completed with zero groups → "No duplicates" (done); unresolved groups →
  "N unresolved"; resolved → "Resolved". A summary without the new projection falls back to the
  exact pre-107 strings.
- **Out-of-order protection**: `src/research-engine/screening/duplicateJobState.js`
  `pickNewerJob(prev, next)` is applied at every network-fed `setJob` site — a stale poll response
  can never move a job backward (`completed → pending`); a *newer* queued retry job legitimately
  supersedes an old completed one. `publicDuplicateJob` now exposes `updatedAt` so the guard has a
  clock.
- **Realtime**: terminal emits no longer exclude the initiator, fire on all terminal paths
  (completed/failed/cancelled/kill-switch), and both summary owners
  (`useScreeningSummary`, `SiftProject`) subscribe to `duplicates.completed`.
- **Staleness is explicit and deterministic**: the worker records the project-wide record count in
  `statsJson.projectRecordCount` at completion; the overview flags `stale` when the current record
  count differs or a record was created after `completedAt`. (The naive comparison against
  `job.totalRecords` would have been wrong: that counts only *considered* records — members of
  resolved groups are frozen out of reruns.) Jobs completed before this field fall back to the
  timestamp rule alone. The Duplicates tab shows a "records changed since last detection" notice;
  nothing reruns automatically.
- Failed jobs already had an error banner + safe Retry (fresh job row; resolved groups and
  decisions untouched) — verified and left as-is.

## 3. Keyword suggestion redesign (107 §2)

**Previous behaviour**: criteria text was shredded by a connector-splitting tokenizer and every
surviving fragment became an immediately *active* highlight/filter term — negation discarded,
generic nouns kept, the same word activatable on both sides, and the "Auto-generate from PICO"
button destructively replaced both stored lists.

**New model**:

- **Active vs suggested are different things.** The stored lists remain the only *active* terms
  (user-added, accepted, or seeded defaults). Criteria-derived terms are now **suggestions**,
  derived live from `picoSnapshot` by a new generator and requiring explicit review — they no
  longer highlight, filter, or count until accepted.
- **The generator is context-aware** (`src/research-engine/screening/suggestKeywords.js`):
  negated clauses ("without X", "no X", "absence of X", …) contribute nothing; bare generic nouns
  (patient, disease, study, outcome, population, …) are blocked; qualifiers stay attached
  (`drug-resistant epilepsy`, not `epilepsy`); output is capped and deduplicated on a canonical
  key. A concept whose normalized key would land on **both** sides is activated on **neither** —
  it is surfaced in a "needs review" conflict group instead. The regression fixture ("epilepsy"
  appearing under both criteria headings, and "Exclude studies without confirmed epilepsy") is
  pinned in three test files.
  The old extractor (`conceptKeywords.js`) is byte-untouched: the governed Criteria Screener and
  the AI cold-start prior deliberately keep their documented, reproducible behaviour.
- **Review state persists** in a new additive `ScreenProject.keywordMeta` column (`String
  @default("{}")`): per-term accept/reject decisions and origins (`manual` / `accepted` /
  `default`), keyed by the canonical normalized term. Suggested term lists themselves are never
  persisted, so editing criteria updates suggestions automatically and regeneration is
  structurally incapable of overwriting manual terms.
- **Atomic keyword operations**: `POST /api/screening/projects/:pid/keywords/ops`
  (add/remove/move/accept/reject) runs a shared pure reducer (`keywordModel.applyKeywordOp`)
  inside a transaction server-side — single-term read-modify-write replaces the old full-array
  last-write-wins PUT for these operations (107 §16). Leader-gated (`canManageSettings`), 403
  otherwise; realtime `project.updated` emitted. The legacy full-array path still works and now
  shape-validates `keywordMeta`.
- **UI**: a distinct "Suggested" panel with per-term Accept/Reject, a flagged conflict group,
  origin badges on active chips, move-between-lists, and a confirm-gated reset. The destructive
  auto-generate button was removed. Keyword filters continue to never write screening decisions.

## 4. Abstract selection → keyword shortcuts (107 §3)

`Cmd+E`/`Ctrl+E` (exclusion) and `Cmd+I`/`Ctrl+I` (inclusion), implemented as a pure guard chain
(`selectionShortcut.js`) plus a thin DOM hook. `metaKey` (macOS/Safari) and `ctrlKey`
(Windows/Linux) both accepted; `altKey` rejected. The shortcut fires only when: the normalized
selection is non-empty, both selection endpoints are inside the abstract container, the active
element is not an input/textarea/select/contenteditable/`.sift-in` field, and no screening modal
is open (`Modal` now stamps a detectable attribute). `preventDefault()` is called only after all
guards pass — browser shortcuts are never globally hijacked.

Selected text is normalized (`normalizeSelectedPhrase`): whitespace/line breaks collapsed, edge
punctuation stripped conservatively, internal medically-meaningful punctuation preserved
(`'  drug-resistant\n epilepsy,  '` → `'drug-resistant epilepsy'`). Duplicate detection uses the
canonical case/unicode-insensitive key: a same-list duplicate shows "already exists" without
duplicating; an opposite-list hit opens a Move / Cancel dialog (move is one atomic op). Adds
persist through the server ops endpoint (survive refresh/reopen/devices; realtime-synced), with a
snackbar **Undo** that issues the inverse operation — real persistence, not local state.
Non-leaders get a "Only project leaders can edit keyword lists" notice (the keyword lists were
already leader-only; the shortcut respects the existing permission model).

## 5. Structured abstract formatting (107 §4)

`src/research-engine/screening/abstractSegments.js` segments the flat abstract string (PubMed
structured abstracts are flattened to `"LABEL: text"` at import) into heading/text segments: a
known heading phrase followed by `:`, positioned at the string start, after a line break, or after
sentence-terminal punctuation, matched case-insensitively while **preserving the original casing
and punctuation**. ~60 heading forms are recognised (Background, Objective(s), Methods, Results,
Conclusion(s), Importance, Findings, Interpretation, Design, Participants, …). Prose occurrences
("The methods used in previous studies…") never match. A pinned invariant: concatenating the
segments reproduces the input byte-identically.

`renderAbstract()` renders heading segments as `<strong>` and runs the existing keyword
highlighter per text segment — headings and `<mark>` ranges cannot overlap by construction, all
React elements (no raw HTML anywhere). Applied in the screening workbench and Final Review;
selection, copying, and both highlight toggles are unchanged. Segmentation is memoized per
abstract.

## 6. Selected-study visibility + decision UX (107 §§5-6)

- **Auto-scroll**: a new pure `nearestScrollTop()` computes the *minimal* scroll that keeps the
  selected row visible; the effect writes `container.scrollTop` directly (never
  `scrollIntoView`, which can scroll ancestors/the page) and handles the hand-rolled
  virtualization (unmounted rows via row-height estimate, converging after mount). It fires on
  selection change only, so hand-scrolling is never fought; the one-shot Resume centering is
  untouched.
- **Decision bar**: the Include/Maybe/Exclude buttons moved into a sticky bar at the bottom of
  the middle column (never covers the abstract; fits laptop heights), with a `DecisionChip`
  showing the current decision (Undecided renders unselected — nothing falsely active),
  `aria-pressed` on the buttons, the existing focus-visible ring, and the save confirmation in an
  `aria-live` slot on the bar itself. The left-list per-row decision glyph (existing convention)
  continues to update optimistically.

## 7. Automatic pagination during keyboard navigation (107 §7)

`moveIntent({index, dir, count, hasMore, loadingMore})` → `'move' | 'load-next' | 'end' | 'noop'`
(pure, in `recordListQuery.js`). Arrow-forward past the last loaded record triggers the normal
load-more path (same search/filter/keywords/AI-queue parameters), guarded by an in-flight lock —
repeated presses cannot fire concurrent page requests or advance into nonexistent indexes. When
the batch lands, the first **genuinely new** record is selected by identity (a `Set` of
pre-request ids — index arithmetic would misbehave under AI-queue reordering) and the auto-scroll
keeps it visible. Failure preserves the current study and surfaces the existing non-destructive
list error with the Load-more button as retry. At the true end the final study stays selected and
a subtle "End of list" indication renders; no repeat requests. The manual Load-more button
remains. A modal-open guard was added to the screening shortcut hook (a decision keypress behind a
modal used to act on the record underneath).

## 8. Proportion extraction metadata (107 §8) and derived percentage (§9)

### Data model

Per-estimate flat row fields on `studies[]` rows (blob — **no DB migration**):
`denominatorPopulation`, `denominatorCustom`, `actionStatus`. Enums in
`monolithConstants.js` with the exact required labels:

| internal | label |
|---|---|
| `plp_molecular_diagnoses` | P/LP molecular diagnoses |
| `all_patients_tested` | All patients tested |
| `patients_with_management_change` | Patients with management change |
| `patients_with_follow_up` | Patients with follow-up |
| `other` | Other/custom |

| internal | label |
|---|---|
| `implemented` | Implemented |
| `recommended_planned` | Recommended/planned |
| `potential_theoretical` | Potential/theoretical |
| `unclear` | Unclear |

Both `mkStudy` factories mint the fields as `""`.

### Legacy-data semantics (107 §8C)

**`""`/missing ≡ "not classified (legacy/unset)" — a distinct semantic state, never `unclear`.**
No load-path normalizer stamps the keys onto old rows (byte-stability); the self-healing readers
(`proportionMeta.js`) treat absence and unknown values as unclassified without rewriting them.
The forms show "— Not classified —" as the explicit first option so reviewers can see and resolve
the state; exports emit empty strings; the analysis layer reports unclassified rows as their own
line and never merges them into any real category.

### Forms, validation, display

Both extraction UIs (Pecan engine + classic tab) render the two selects (excluded from
click-to-pick — a picked PDF token is never a controlled term) and the conditional
**required** "Denominator description" when Other/custom is selected (blocking validation rule,
mirrored into *both* `validateStudy` copies; enforced server-side at the completion boundary via
`completionGate` → `completionService`, consistent with the repo's passthrough autosave
architecture). Legacy rows raise no new errors and do not regress to "incomplete"
(`expectedFieldsFor` untouched). The out-of-registry **warning** asks
`isDenominatorPopulationKey`/`isActionStatusKey` (proportionMeta's Sets), never
`DENOMINATOR_POPULATION_LABEL[value]`: the label maps are plain objects, so a stored
`"constructor"`/`"toString"` read truthy and suppressed the warning while every reader still showed
"— Not classified —".

The derived percentage (`23 / 59 = 39.0%`) renders beside Events/Total in both forms —
display-only, recomputed at render, one decimal via the centralized `fmtPct`/
`PCT_DEFAULT_DECIMALS` convention, screen-reader-exposed (`aria-live` + visually-hidden text), and
suppressed for blank/nonnumeric/`total ≤ 0`/negative/`events > total` inputs.

### Wiring

The analysis-sync hash, manuscript `rosterSlice`, and provenance `STUDY_VALUE_FIELDS` all carry the
three fields (editing them flags analysis-sync staleness, manuscript dependency drift, and
project-history events). In `computeSyncHash` they ride in `SYNC_OPTIONAL_FIELDS`, **not**
`SYNC_INPUT_FIELDS`: a fixed member emits `key=` for a row that never had the key, which would
change the digest of every pre-107 row and flip every previously-synced article to "Updated since
sync" on upgrade — the `syncHash` already persisted in `extractionMeta` cannot be migrated. Emitting
them only when they carry a value keeps an unclassified row byte-identical to pre-107 while a real
classification still moves the hash (the same rule as the 106.md `cv_*` block).
`propagateArticleFields` does **not** fan them out (per-estimate, not
article-level); new outcome rows start unclassified; `duplicateCase` keeps the classification;
project duplication copies the blob verbatim. The AI extraction mapper deliberately cannot
populate them (§8D "do not infer").

### Import/export (107 §8F)

- Extraction CSV, journal-submission study CSV (human labels), and the case-level CSV all carry
  the three columns; legacy rows export empty.
- `denominatorCustom` is exported **only when the effective population is `other`**
  (`exportedDenominatorCustom`). The select clears an orphaned description in the same write when
  the population moves away from Other/custom (`denominatorPopulationPatch`), but the input is
  hidden for every other option, so a project saved before that fix can still hold text the
  reviewer cannot see — exporting it would ship two contradictory denominator statements.
- Project JSON export/import is whole-blob passthrough: values round-trip verbatim, and **older
  files without the fields import successfully with the fields absent = unclassified** (pinned by
  test, including a forward-version unknown-value round trip).
- There is no CSV importer for `studies[]` in the codebase (confirmed), so JSON is the only
  import surface; nothing to map.

## 9. Analysis builder integration (107 §§10-13)

### Filters and grouping (§10)

- **Subgroup/stratification**: "Denominator population" and "Action status" join the grouping
  keys. Buckets are label-resolved; missing/unknown values bucket as **"Not classified
  (legacy)"** — provably distinct from "Unclear" (pinned by a real `subgroupAnalysis` run in
  tests).
- **Filters**: per-outcome-pair proportion filters persist in
  `project.analysisSettings.proportionFilters` and are applied in the Analysis, Forest, Subgroup,
  Sensitivity and MetaRegression paths, rendered as clearable chips that survive refresh/reopen.
- `denominatorCustom` is deny-listed from meta-regression covariates; the two enums are
  discoverable as categorical moderators with pretty labels.

### Compatibility guard (§11)

`src/research-engine/statistics/proportionCompatibility.js` evaluates the selected PROP estimates
before pooling: ≥2 real categories in either field → blocking; a real category mixed with
unclassified rows → blocking (unclassified listed separately); distinct Other/custom texts →
blocking; **all-unclassified → an informational note only** (legacy projects keep pooling
unchanged — regression guard). The warning card identifies the conflicting variable, every value
with label + estimate count, the number affected, and the affected studies, and the pooled result
is gated until resolved — never silently pooled.

### Resolution + explicit override (§12)

Five resolution paths on the card: filter to one category (persisted), group by the variable
(Subgroup tab), correct extraction metadata, exclude estimates (existing mechanism), or an
**explicit documented override**: persisted in
`project.analysisSettings.proportionOverrides[outcomeKey]` with the conflicting categories/counts,
timestamp, actor, and optional rationale. An active override renders a permanently visible banner
with a Clear action and survives refresh/reopen. Overrides are bound to an **issue signature**: if
the estimate set changes, the override is shown as stale and the warning returns — consent is for
a specific set, never silently transferred. Unclassified is never treated as equivalent to any
real category.

### Outputs (§13)

When (and only when) a filter/override/grouping is in use: `ResearchExport` gains metadata lines
and the per-study classification column; the reproducibility bundle
(`readiness.analysisSettings()` + `buildReproManifest()`) carries `proportionFilters` /
`proportionOverrides`. Unused → byte-identical outputs to before (pinned by render-equality
test).

### Directly related defect fixed (sanctioned by 107 §21)

SubgroupTab, SensitivityTab and MetaRegression previously pooled **raw `project.studies` across
every outcome** with no exclusion filtering (the 86.md P1.6 bug class, never fixed for these
tabs). Grouping proportions by denominator across different outcomes would be scientifically
meaningless, so all three now use the same outcome-pair scoping as the Analysis/Forest tabs,
honour `isExcludedFromAnalysis`, and apply the persisted proportion filter. Behaviour change:
multi-outcome projects now require an explicit outcome choice on Subgroup/Sensitivity instead of
silently pooling everything.

## 10. Migration behaviour (107 §15)

- One additive schema change: `ScreenProject.keywordMeta String @default("{}")` — nullable-safe
  default, `prisma db push`-compatible, applied to the canonical SQLite schema, the generated
  Postgres schema (`npm run db:sync-postgres-schema`; drift test green), and a hand-written
  additive PG migration (`20260809000000_screening_keyword_meta`).
- Everything else is additive blob/JSON semantics: no data rewritten, no defaults fabricated, no
  columns destroyed, unknown keys survive round trips. Historical Events/Total values untouched.
- Known deliberate behaviour change (not a data migration): criteria-derived keyword terms stop
  auto-highlighting until reviewed (see §14.2).

## 11. Concurrency and collaboration (107 §16)

- Keyword mutations moved from full-array last-write-wins PUT to atomic per-term server-side ops.
- Duplicate job state is server-authoritative with a monotonic client guard.
- Extraction metadata and analysis overrides ride the existing `Project.data` CAS
  (`autosaveRev` / `mutateProjectBlob`) via the established choke points.
- Screening decisions were already per-record upserts (unchanged).

## 12. Verification

All commands run on the final tree:

| Command | Result |
|---|---|
| `npm run test:ci` | **433 files / 7064 tests — all passed** (6767 before this round; ~300 added) |
| `npm run lint` | clean |
| `npm run build` (vite production) | ✓ built |
| `npm run test:integration` (live server) | **96 files, 817 passed / 9 skipped** |
| new integration files re-run live | `duplicate-jobs` + `keyword-ops`: **17/17 passed** |
| `npx playwright test e2e/screening/screening.spec.ts --project=chromium --workers=1` | **19 passed, 1 flaky (passed on retry), 1 skipped** |
| esbuild parse-check, every edited `.jsx` | clean (note: use `--loader:.jsx=jsx`; bare `--loader=jsx` fails on file input) |
| `tests/unit/postgres-schema-sync.test.js` | 8/8 (schema drift gate) |

Key new test files: `duplicateJobState.test.js` (13), `screeningSteps.test.js` (+10, incl. the
zero-duplicates "Pending" regression), `suggestKeywords.test.js` (17, incl. the epilepsy
fixtures), `keywordModel.test.js` (25), `keywordNormalize.test.js` (11),
`selectionShortcut.test.js` (14; extended to 35 in the 108 round), `abstractSegments.test.js` (16), `abstractRender.test.jsx` (8),
`keywordSuggestionsUi.test.jsx` (9), `criteriaKeywords.test.js` (rewritten, 20),
`proportionMeta.test.js` (35), `proportionMetaDownstream.test.jsx` (34),
`proportionCompatibility.test.js` (39), `proportionAnalysisBuilder.test.jsx` (42),
`decisionNavUi.test.jsx` (19), `listWindow.test.js` (+7), `recordListQuery.test.js` (+8),
`keyword-ops.test.js` (7, integration), `duplicate-jobs.test.js` (+3, integration), three new
Playwright specs.

## 13. Invariants (do not regress)

1. **The duplicate-job ROW is the source of truth for detection status.** Never re-derive "has
   detection run" from group existence; never let a network response move a job backward —
   route every job-state write through `pickNewerJob`.
2. **`""`/missing proportion metadata is "not classified (legacy)", never `unclear`.** No
   normalizer may stamp the keys onto old rows; no analysis/output may merge unclassified into a
   real category.
3. **Suggested keywords are never active.** Only stored-list terms highlight/filter/count.
   Suggestion lists are derived, not persisted; only decisions persist in `keywordMeta`.
4. **`conceptKeywords.js`, `coldStart.js`, `ai/eligibility.js` stay byte-stable** unless the
   Criteria Screener / AI-scoring reproducibility contract is deliberately re-versioned.
5. **Keyword mutations go through the ops endpoint** (atomic per-term), not full-array PUT.
6. **`segmentAbstract` reconstruction**: segments must concatenate byte-identically to the input.
7. **Compatibility overrides are signature-bound**: a changed estimate set must re-surface the
   warning; an override is never silently honoured for a different set, never silently deleted.
8. **Subgroup/Sensitivity/MetaRegression are outcome-pair-scoped** and honour
   `isExcludedFromAnalysis` + proportion filters — do not reintroduce cross-outcome pooling.
9. New per-estimate row fields must be added to *both* `mkStudy` factories, *both*
   `validateStudy` copies, `SYNC_INPUT_FIELDS`, a dependency slice, `STUDY_VALUE_FIELDS`, and
   every CSV column list — silence is the failure mode.

## 14. Known limitations

1. **Manuscript pipeline ignores analysis filters** (pre-existing, now more visible):
   `draft.js primaryAnalysis/allAnalyses` → SoF table / `analysis.k` fact tokens apply neither
   `isExcludedFromAnalysis` nor the new proportion filters, so a filtered Analysis tab and the
   manuscript can disagree on k. The repro settings *document* the filter; the manuscript numbers
   don't honour it. Highest-value follow-up; requires touching `journalSubmission.js`/`draft.js`
   and re-baselining manuscript expectations.
2. **Criteria-derived terms no longer auto-highlight** until reviewed. Deliberate (§2), but a
   project mid-review sees its highlight set shrink to the stored lists with no migration
   pre-accepting previous derivations. A "N suggestions to review" nudge would soften this.
3. **Negation handling is conservative**: "Studies that exclude children" (exclusion verb
   mid-clause) yields nothing rather than risking a wrong suggestion — omission over
   mis-suggestion, per 107 §2.
4. **Rapid-fire keyword ops from one client are not queued**: each op is transactional
   server-side, but two overlapping Accepts may read pre-commit snapshots. A per-project client
   op queue (or batch op body) would close it. `resetDefaults` intentionally remains the one
   destructive full-array write, behind a confirm.
5. **Staleness detection for pre-107 completed duplicate jobs** relies on the timestamp rule only
   (they lack `statsJson.projectRecordCount`), so a pure deletion on such a project goes unnoticed
   until the next run repopulates the field.
6. **AI-band keyboard auto-load advances at most one page per keypress** when the next page has
   no in-band records (no keep-loading loop, by design).
7. **The citation-list rows are still not keyboard-focusable** (no `role`/`tabIndex`/
   `aria-selected`) — §6's list-level a11y remains as before; the decision *controls* are fully
   accessible.
8. **Keyword editing (incl. the §3 shortcuts) is leader-only** (`canManageSettings`), matching
   the pre-existing permission model; non-leaders get an explanatory notice.
9. **`POST /api/meta/subgroup` (server endpoint, no UI caller)** was not taught the new label
   mapping or legacy/unclear distinction; engine copy #2 (`statistics/meta-analysis.js`) is
   untouched.
10. **No proportion transform work**: pooling remains logit-only (no Freeman-Tukey / GLMM) —
    unchanged from before, documented in `methods-content.js`.
11. Two structural gaps verified but out of scope: the classic-tab StudyCard body is
    SSR-unverifiable (renders only when open; covered by parse checks + shared registries), and
    `analysisSettings.proportionFilters/Overrides` are not yet registered as manuscript
    dependency keys (moot until limitation 1 is fixed).

## 15. Round 2 — adversarial review and fixes (r2)

After the feature commit, a 6-dimension adversarial review (every finding cross-examined by two
independent verifiers; 19 confirmed, 3 split, 3 refuted) drove a fix round. What was fixed:

### Correctness
- **[critical] `canEditKeywords` was always false in the real app** — `SiftProject`'s access
  literal never forwarded `canManageSettings`, so the §3 shortcut and the §2 suggestion panel
  were unreachable and the keyword editor regressed for leaders. Access shaping is now the pure
  `src/frontend/screening/lib/screenAccess.js` (`buildScreenAccess`), and the gate is
  `canManageSettings || isLeader` — pinned by tests.
- **[critical] The §11/§12 pooling gate was bypassable via the Forest and Sensitivity tabs.**
  The gate derivation is now the shared pure `proportionGate(...)`; both tabs suppress the
  pooled plot/robustness outputs *and their exports* while blocked, rendering a compact
  read-only compatibility panel; ForestTab also shows the active-filter chips. The
  all-outcomes summary table applies filters/exclusions and renders a
  "blocked — incompatible estimates" marker instead of pooling.
- **keywordOps lost updates under Postgres READ COMMITTED** — the transaction now uses an
  optimistic pre-image `updateMany` guard with a bounded retry (modelled on
  `mutateProjectBlob`), returning 409 `KEYWORD_OP_CONTENTION` after 5 attempts.
  Mutation-tested: weakening the WHERE fails 4 regression tests.
- **`remove` recorded a 'rejected' verdict, so Undo permanently killed a live suggestion** —
  the reducer gained a non-verdict `reject:false` variant for `remove`/`move` (an exact
  inverse, restoring origins verbatim); the snackbar and conflict-dialog Undo paths use it.
- **Cross-polarity conflicts were computed over synonym-expanded lists**, suppressing the
  authored concept and reporting phrases the user never wrote — conflicts now come from the
  deduped concept lists; a synonym reaching both sides is kept only where it is authored.
- **Removing the last active term resurrected the ~80 shared defaults** — `keywordMeta.seeded`
  now marks a deliberately-emptied side; `activeTerms` and the backfill script both honour it.
- **`SYNC_INPUT_FIELDS` had invalidated every stored syncHash** — the three proportion keys are
  now value-conditional (like `cv_*`), so legacy rows hash byte-identically to pre-107
  (pinned against a hardcoded pre-107 digest) and previously-synced articles stay "synced".
- **Stale `denominatorCustom`** — switching the population away from Other/custom now clears
  the text in the same write; all four exporters and the filter comparison route through
  `exportedDenominatorCustom` (empty unless effectively 'other').
- **Compatibility check/signature ran over rows `runMeta` never pools** — both now use the
  poolable subset (es+lo+hi), and the override signature (`v2|`) embeds a per-bucket digest of
  contributing row ids, so offsetting swaps and CI-fills flip it. Pre-v2 count-only signatures
  read as stale (safer direction; re-record the override).
- **Navigation races** — auto-load now respects reset loads (generation counter discards
  superseded appends), `pendingAdvance` is scoped to `{pid, filter, search, gen}`, the
  nearest-scroll accounts for the sticky Load-more bar (`insetBottom`), and the Resume one-shot
  claims the selection before the nearest-scroll pass so its smooth centering is not cancelled.
- **Realtime gaps** — poison-pill duplicate-job failures now emit the terminal events;
  duplicate-group resolution emits no longer exclude the initiator; `runKeywordOp` responses
  are sequence-guarded against out-of-order adoption.
- **Hardening** — enum label lookups use Set predicates (`'constructor'`-style keys read as
  unclassified everywhere); SubgroupTab gained the dominant-measure fallback so blank-first-row
  PROP outcomes still offer the stratification variables; "Time Point"/"Outcome Measured"
  grouping works again via explicit cross-pair scoping with an on-screen scope note.

### r2 verification
`npm run test:ci` **439 files / 7230 tests passed** (7064 at v4.12.0 r1); `npm run lint` clean;
`npm run build` clean; `npm run test:integration` against a fresh server **96 files, 819
passed / 9 skipped**; screening e2e (chromium) **20 passed / 1 skipped**, no flakes.

### r2 additions to known limitations
- Pre-r2 persisted overrides (count-only signatures) surface as stale and must be re-recorded.
- The KeywordEditor accordion itself is still `isLeader`-gated (pre-existing; a non-leader with
  `canManageSettings` can use the suggestion panel and shortcuts but not the chip editor).
- The forward move's `seeded` marker is not cleared by its Undo (inert — the side is non-empty).
- Two racing *reset* loads can still land out of order (append-vs-reset is guarded; reset-vs-
  reset was left per the surgical-fix rule).
- An arrow press at the end of the loaded window during a reset load is now a deliberate no-op.
