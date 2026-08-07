# 103.md — PRISMA as a study-selection provenance system (v4.10.0)

> The PRISMA diagram should no longer be thought of as a chart that gets updated.
> It should be the **visual output of PecanRev's complete study-selection provenance system.**

This round delivers the **engine** that makes that true: a canonical, record-level PRISMA
model with structural reconciliation, PRISMA 2020 conformance, and the full §20 scenario
suite. What is wired and what is not is stated explicitly in §7 below — this is a large
brief and partial delivery honestly labelled is worth more than a claim of completeness.

---

## 1. What was actually wrong

`manuscript/prismaCounts.js` resolved every box **independently** through a precedence
chain — `OVERRIDE > MANUAL > COMPUTED > DERIVED`. Three consequences:

1. **A number the user typed outranked real project data.** `draft.prismaOverrides` and
   `project.prisma` beat the live screening rollup. That is precisely what 103.md's core
   principle forbids: *"PRISMA should never depend on the user manually entering numbers
   that PecanRev already knows."*
2. **No count could answer "which records created this number?"** (§11/§12), because the
   numbers never came from records.
3. **Duplicates removed at two stages could not be reconciled** (§3) — "duplicates removed"
   was a single scalar, so search-time and screening-time dedup could only be added blindly.

Two boxes were **absent entirely**: `Reports sought for retrieval` and `Reports not
retrieved`. The old diagram jumped straight from *Records screened* to *Reports assessed
for eligibility*, and the SVG was a **single-column** layout — it had no
"Identification via other methods" column at all, so citation-mined and manually-added
records had nowhere correct to go (§5, §6).

`included` also fell back to `studies.filter(s => numeric es)`, conflating records with
studies (§9).

---

## 2. The model: records, not counters

`src/research-engine/prisma/` — the unit is the **record**. Every box is a predicate over
record projections; a count is the size of the matching set. Three properties fall out, and
they are the entire point:

| Requirement | How the model satisfies it |
| --- | --- |
| §3 no double-counting | A record has exactly **one** terminal disposition. It can be removed as a duplicate once, however many stages ran dedup. |
| §12 inspectable | The set behind a count **is** the explanation. Every box carries its record ids; nothing extra is stored. |
| §13 reconciliation | Dispositions **partition** the records exhaustively and disjointly, so totals cannot drift. `reconcile.js` asserts the invariant instead of re-adding numbers. |

`DISPOSITIONS` is the closed set: `removed_duplicate`, `removed_automation`, `removed_other`,
`excluded_screening`, `awaiting_screening`, `not_retrieved`, `excluded_full_text`,
`awaiting_full_text`, `included`. A test asserts they sum to the record count.

### The two arms

PRISMA 2020's defining feature is the split between *"Identification of studies via databases
and registers"* and *"…via other methods"*. This is **not cosmetic** — the other-methods
column has **no "records screened" box**, because those records are not screened as a pool.
Misusing the two-column layout is the commonest flow-diagram error, so the arm is decided
once per record in `armOf()`.

`origin` (from `ScreenRecordSource.origin`) **outranks** the database name: a record mined
from a reference list is *citation searching* even when its `sourceDb` says "PubMed" — how it
was found is what PRISMA asks about. `origin: 'mining'` was already being written by
`ORIGIN_BY_SOURCE` in `screeningImportService.js`; nothing consumed it until now.

One deliberate call: a file import whose records carry **no usable source name** stays in the
database arm rather than being reclassified as "other methods". Moving it across arms would
misreport the search, which is worse than an unnamed database.

---

## 3. Retrieval — the stage that did not exist

`FullTextCandidate.status` (`found|no_oa|not_found|failed`), `FullTextRequest.status`
(`requested|received|none`) and `ScreenPdfAttachment` were all already in the schema and
completely ignored by PRISMA. `resolveRetrieval()` now derives the two missing boxes.

The distinction that matters: **"not retrieved" is a positive finding, not an absence.** A
record nobody has tried to retrieve is `retrieved: null` and never inflates the box. A stored
PDF, or a librarian request marked `received`, overrides a failed automated lookup.

---

## 4. Studies vs reports (§9)

There was **no** report→study link in the schema (the mapping agent confirmed this). Rather
than add one prematurely, the model reads an optional `studyId` per record:

* records sharing a `studyId` collapse to **one study**;
* a record with **no** `studyId` is its own study — the correct default, and it keeps every
  existing project working unchanged (§9's "without breaking the current workflow").

So `Studies included in review` and `Reports of included studies` are genuinely different
numbers, and the meta-analysis count is **distinct studies**, not reports. Reconciliation
asserts `studies ≤ reports`, which catches a broken link.

---

## 5. PRISMA 2020 conformance (§17)

Box labels are **verbatim** from the four official `prisma-statement.org` `.docx` templates,
cross-checked against Figure 1 of Page MJ et al. BMJ 2021;372:n71 — fetched, not recalled, as
§17 requires. Details that a from-memory implementation gets wrong and are now pinned by test:

* `Records identified from*:` carries a footnote asterisk in the **database** arm and **not**
  in the other-methods arm. That asymmetry is in the official templates.
* `Records excluded**` carries the automation-tools footnote.
* The removal box has exactly three official sub-lines: *Duplicate records removed*, *Records
  marked as ineligible by automation tools*, *Records removed for other reasons*.
* The terminal box is **shared** by both columns and never duplicated.
* Updated reviews are a **different template**: a "Previous studies" column, a split into
  *New studies included* + *Total studies included*, and headers that gain the word **"new"**
  (a string swap, not just extra columns). Encoded as `UPDATED_REVIEW_BOXES` / `COLUMN_HEADERS`.

---

## 6. Testing

`npm run test:ci` — **412 files, 6544 tests, all passing** (was 410 / 6487).

`tests/unit/prisma/flow.test.js` (36) covers **all ten** §20 scenarios A–J plus the structural
invariants. Highlights:

* **B** — 1,000 search-time + 200 screening-time duplicates = 1,200, with the stage breakdown
  a *partition* of the same set, so it cannot exceed the total.
* **G** — 3 articles for one trial: 4 reports, 2 studies.
* **I** — a living-review rerun where 350 already-known records are re-retrieved: screened
  stays 2,350, **not** 2,700.
* **§19** — a 100,000-record project derives in one pass in ~0.7 s.
* Reconciliation is asserted to **fail** on a hand-built contradictory flow, proving it does
  not smooth over inconsistency.

---

## 7. What is wired, and what is not — read this before trusting the round

**Delivered and tested:**
- the canonical model, deriver, reconciler and projection layer (`src/research-engine/prisma/`);
- PRISMA 2020 conformance including the updated-review variant;
- the manuscript adapter: `computePrismaCounts(project, { flow })` now **short-circuits to the
  record-derived flow**, so when a caller supplies it, the manuscript, the counts table, the
  fact tokens and the narrative all read records and the user-typed tiers cannot outrank real
  data (§15). Provenance for every key becomes `'records'`.

**Wired in the follow-up round:**
- `server/screening/prismaFlowService.js` loads the records and derives the flow — one
  indexed query per table, only the columns the projection reads, then a single in-memory
  pass (§19). Tables that may be absent on an older Prisma client are probed and skipped.
- `GET /api/screening/projects/:pid/prisma` serves the flow **and** its reconciliation report.
- The manuscript fetches it (`manuscriptData.js`) and passes it as `opts.flow`, so
  `computePrismaCounts` now short-circuits to record-derived numbers in production and the
  user-typed tiers no longer win (§15).

**Wired in the second follow-up (the diagram round):**
- `src/research-engine/prisma/svg.js` — a **new PRISMA 2020 builder** driven by the
  canonical flow. Two columns, the retrieval boxes, all three official removal
  sub-lines, the shared terminal box, the stage rail, the official footnotes and
  citation, and the updated-review variant. Every number is read out of `flow.boxes`;
  there is no arithmetic in the file, so the drawing cannot disagree with the manuscript.
- `src/features/prisma/PrismaFlowDiagram.jsx` — the §12 inspection layer. Clean diagram
  by default; every box is a labelled hit-target, and clicking one opens a panel naming
  the records behind it, plus the relevant breakdown (duplicate stage, exclusion reasons,
  per-source identification). Hit-targets are positioned from the builder's own returned
  geometry, so they cannot drift from the drawing.
- `PrismaValidationBanner` surfaces the §13 reconciliation, with `role="alert"` on a
  contradictory flow — never silent.
- `figures.js` now draws the export with the SAME builder when a flow is available
  (§16: "do not create a separate export calculation path"). The legacy single-column
  builder remains only for projects with no record-level data.

**NOT yet wired — deliberately listed rather than implied:**
1. ~~**The old single-column builder still exists**~~ *Resolved:* the screening tab now
   renders `PrismaFlowDiagram` (inspectable, PRISMA 2020) whenever the linked workspace has
   records, and its figure export routes through the same builder. The legacy builder remains — still single-column, still missing the retrieval boxes.
   ONLY as the fallback for a project with no linked records, alongside the manual number
   fields — which are likewise now fallback-only rather than the primary input.
2. **No inspection UI** (§12). Every count already carries its record ids, so the data for
   click-to-inspect exists; the panel does not.
3. **No PRISMA-specific events emitted** (§11). The taxonomy and ledger are in place from
   101.md and screening already writes `ScreenAuditLog`, but the §11 event names are not
   emitted.
4. **No migration/backfill run** (§18). The projection maps existing tables, so an existing
   project derives correctly the moment the endpoint exists — but nothing has been backfilled
   and no "unreconstructable" marking is persisted.
5. **`studyId` has no writer.** The model supports report→study linking; no UI or column sets
   it, so today every included record is its own study (the safe default).

---

## 8. Deliberate limitations

1. **`reg` is folded into the database arm** in the legacy adapter rather than reported
   separately, because PRISMA 2020 already splits databases-and-registers from other methods.
   The per-source breakdown still names each register individually.
2. **An unresolved reviewer disagreement counts as undecided.** `resolveDecisions` returns
   `null` for a split with no resolution rather than picking a side — the record stays
   "awaiting screening" instead of being silently resolved in the diagram.
3. **Automation-tool removals need a writer.** `removed_automation` is modelled and tested,
   but no code path currently sets it; PecanRev's AI screening marks records rather than
   removing them pre-screening.
4. **Import-time duplicates are counted but not inspectable.** PecanRev discards an import
   duplicate *before* it becomes a `ScreenRecord`, so the only trace is
   `ScreenImportBatch.duplicateCount`. Those are added back to "records identified" and
   "duplicates removed" as a COUNT with no ids — §2 is explicit that the duplicate count
   must not disappear just because dedup happened early, but they can never be inspected
   record-by-record, and the breakdown labels them "Discarded at import (not stored as
   records)" rather than pretending otherwise.
5. **Duplicates found in the other-methods arm are not shown in a removal box**, because
   PRISMA 2020 gives that column no removal box. They are still excluded from the flow
   correctly; they simply have nowhere official to be reported.
6. **A title/abstract exclusion has no record-level column.** The mapping confirmed nothing
   writes "excluded at T/A" onto `ScreenRecord` — the state lives only in `ScreenDecision`.
   The projection therefore derives it from decisions, which is why `resolveDecisions` is
   load-bearing rather than a convenience.
7. **Reconciliation is structural, so it should always pass.** A failure means the derivation
   or the projection is wrong, not that a researcher typed inconsistent numbers. That is the
   intended reading, and it makes the checks a genuine self-audit rather than user nagging.
