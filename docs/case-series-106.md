# Case Series Extraction Mode — 106.md

Implementation report for `.claude/Prompts/106.md`. Version **4.11.0**.

One publication can now yield N independently-extracted patient **cases**, while the
publication stays the unit that PRISMA, the study counts and the manuscript report.

---

## 1. What was inspected first

106.md required an architecture pass before coding. Seven areas were mapped (the
extraction workflow, the DB schema, the analysis handoff, PRISMA counting, the
manuscript feed, provenance storage, and autosave/audit/versioning). Four findings
determined the design:

1. **Extraction data is not relational.** It lives in the `Project.data` JSON blob as
   `studies[]`, one `mkStudy()` row per analysis unit (`server/prisma/schema.prisma:328`).
   There is therefore **no database migration** — the only extraction tables
   (`ExtractionValue` et al.) belong to the *other*, flag-gated `extractionAssist`
   workspace, which 106.md does not touch.
2. **A "one paper, many rows" pattern already exists.** 82.md's
   `extraction/outcomeGroups.js` models multi-outcome papers as sibling rows grouped by
   citation identity. Cases reuse that spine exactly.
3. **The PDF is already resolved per-publication.** `publicationSourceFor()` returns a
   stable `anchorId`, and `usePdfSource` keys its resolve effect on it — which is why
   switching sibling rows does not re-fetch or remount the viewer. Cases inherit this.
4. **Per-value provenance is keyed by field NAME** (`extractionMeta.provenance[field]`),
   with no sub-entity dimension. Anything stored as a flat key on the row gets
   click-to-pick source linking for free.

## 2. The data model

A **case is an `mkStudy` row**, tagged in the additive `extractionMeta` namespace:

```js
study.extractionMeta.caseSeries = {
  publicationId: 'pub_ab12cd34',   // immutable parent-article id, shared by every case
  caseId:        'case_9x8y7z6w',  // immutable per-case id (survives renumbering)
  caseNumber:    3,                // 1-based ordinal within the publication
  label:         '',               // custom name; '' → `Case ${caseNumber}`
}
```

This satisfies 106.md's `Study / Publication → Case → Extracted Variables` with a unique
internal case id, a parent article id, a human-readable case number, extracted data and
provenance — and a row **without** the namespace is an ordinary study, unchanged.

### Why an explicit `publicationId` rather than the citation key

`citationKey()` is derived from mutable text (`doi`, `pmid`, `author|year|title`).
Correcting a DOI would silently split a case series in half, and the weak
`a:author|year` fallback can merge two genuinely different papers. 106.md is explicit
that the case→article relationship must **never** be lost, so the link is an immutable
id the reviewer asserted, not a string match. `citationKey()` now returns `pub:<id>`
first for a case row, and `isStrongCitationKey()` accepts it — so the shared PDF, the
file switcher and the availability spread all follow the assertion rather than the text.

### Article-level vs case-level

`ARTICLE_LEVEL_FIELDS` = `CITATION_FIELDS ∪ PUBLICATION_LINK_FIELDS` — authors, year,
journal, DOI, PubMed ID, country, design, funding, the population/intervention/
comparator definitions, plus the screening link and stored document. Every study write
in the engine routes through `propagateArticleFields()`, which mirrors those keys onto
every sibling case and leaves everything else on the edited case alone. For an ordinary
study it is a plain single-row patch, byte-identical to the previous behaviour.

### Case variables (the patient-level data)

DEFINITIONS are project-wide (`project.caseVariables`, `mkCaseVariable` shape: label,
type, options, unit, group, required). VALUES live **flat on the case row** at
`cv_<id>` (`caseVarKey`). Flatness is the whole trick: `extractionMeta.provenance` is
keyed by field name, so `Case 3 → Age = 54` gets page + bbox + fileKey provenance and a
"⌖ source" jump with no changes to the provenance engine.

Turning the mode on for the first time seeds the 14 fields 106.md names (age, sex,
presentation, symptoms, comorbidities, labs, imaging, treatment, intervention,
complications, follow-up, outcome, survival, time-to-event) with **stable ids**, so an
export column header is reproducible across projects. They are fully editable.

## 3. The counting contract

`caseSeriesCounts(studies)` is the single source:

| figure | meaning | who uses it |
| --- | --- | --- |
| `publications` | distinct articles | PRISMA `included`/`includedQuant`, `studies.included`, the consistency check, the list header |
| `caseSeriesArticles` | how many of those are case series | `studies.caseSeriesCount` |
| `cases` | individual patients | `studies.caseCount`, the case export |
| `rows` | raw `studies[]` rows | progress denominators only |
| `analyticalUnits` | cases + non-case rows | patient-level synthesis |

`countPublications` collapses rows on **provable** identity only: an explicit
`publicationId`, else a *strong* citation key (`doi:` / `pmid:` / `t:`). A row whose
citation is too thin to identify a paper counts as its own publication — over-counting
an ambiguous row is honest; merging two different trials is not.

**Twelve publications comprising 47 cases report 12 included studies**, pinned by test.

### Count paths that were wrong before and are now fixed

Each of these counted extraction ROWS and called the number "studies". A multi-outcome
trial already inflated them; a case series would have made every one of them acute.

- `prismaCounts.js` — the last-resort `included` and `includedQuant`.
- `factTokens.js` — `studies.total` (rendered by `studies.included`), and `withEffect`
  (rendered by `studies.inAnalysis`, "Studies contributing to the synthesis"). The
  latter also counted rows whose `es` was an empty string, because `Number('') === 0`
  is finite. `analysis.k` deliberately stays a ROW count — it is the denominator of a
  pooled estimate, not a study count.
- `consistency.js` — the `included-vs-extracted` warning, which would have shipped a
  permanent "reconcile the flow counts with extraction" warning on every correctly
  configured case series.
- `contradictions.js` — the `includedCount` fallback, which drives a **critical**
  severity contradiction: an honest manuscript saying "1 study was included" would have
  been flagged as contradicting a project that had 8 case rows.
- `readiness.js` — the "Included studies" checklist item.
- `tables.js` — the study-characteristics table (Table 1) rendered eight identical
  "Smith 2024" rows. Each case row is now labelled `Smith 2024 — Case 3`, and the table
  states in its warnings and note how many rows represent how many publications.
- `PublicSynthesisPage.jsx` — the published "Included studies (N)" heading.
- `StitchProjectOverview.jsx` — the "Studies extracted" metric card, which sat directly
  beside "Included" (a PRISMA figure) and disagreed with it. Individual cases now get
  their own card.
- `study-validator.js` — `findDuplicates` flags any two rows sharing author+year, so all
  eight cases of Smith 2024 would have carried a false "duplicate" badge. Cases of the
  **same** publication are now skipped; cases of different publications still compare.
- `articleStatus.js` — `hasAnyValue` ignored `cv_*` values, so a fully extracted case
  report with no poolable effect size read "Not started" at 0% forever.

## 4. Downstream wiring

**Manuscript.** Three new fact tokens, all `depKey: 'studies.roster'`, all `null`
(→ a visible placeholder) when the review has no case series:

- `studies.caseCount` — "47"
- `studies.caseSeriesCount` — "12"
- `studies.publicationsAndCases` — "twelve publications comprising 47 individual cases"

`studies.included` keeps its meaning and is now genuinely publication-scoped, so the two
can be used in one sentence without contradiction. The Results *Study characteristics*
generator adds a case sentence only when cases exist; an ordinary review is
byte-identical. With `factTokens` on (the live-manuscript mode from 101.md) that
sentence is emitted as **tokens, not numerals**, so adding, deleting or correcting a
case updates the manuscript with nothing to click — 106.md's auto-update requirement.

**Staleness.** `computeDependencyState`'s two projections are explicit allow-lists — a
value absent from them changes on screen while every section still reports "Fully
synchronized". The roster slice now carries the case identity (add / delete / renumber /
rename), and the values slice carries the `cv_*` values.

**Analysis sync.** `computeSyncHash` includes `cv_*` keys, sorted, so editing a patient
value flips the article to *Updated since sync* instead of leaving it "In analysis".

**Analysis warning.** The unit-of-analysis banner no longer reports cases as duplicated
cohorts. It reports them as **clustered observations**: N cases from M publications
share a centre, protocol and reporting bias, so pooling them as fully independent
understates uncertainty.

**Export.** `⤓ Export cases (CSV)` in the article list emits one row per patient, each
carrying Publication, Author, Year, Journal, DOI, PubMed ID, design, country, the
publication/study/case ids, the case label, every case variable, and the effect columns.
The classic tab's extraction CSV gains the same case columns when cases exist.

## 5. Interface

One bar renders above the workspace — the case navigator for a case, the outcome
navigator otherwise. Both at once was confusing, and the outcome bar would have listed
all eight cases as unnamed outcomes (they share the paper's identity by design).

- OFF: `☐ This article contains multiple cases / case series`
- ON: `Cases (3) [Case 1] [Case 2] [Case 3] [+ Add case] … ✎ Rename ⧉ 🗑 ☑ Case series`

Each chip shows its own completion (`✓`, `80%`, or `not started`) and the active one is
`aria-selected` — status is never colour alone. The workspace shows which case is being
edited and states that the article-level fields are shared. The article list badges each
case (`Smith 2024 · Case 3`) and its header reads "12 publications · 47 individual cases
· 47 rows".

The **PDF is not reloaded when switching cases**: `publicationSourceFor` resolves through
the shared `publicationId`, `anchorId` is stable, and `AppPdfViewer`'s `key={effUrl}`
therefore does not change.

Turning the mode ON makes the open article Case 1 — nothing is copied and no extracted
value moves. Turning it OFF is non-destructive: the namespace is stripped, every row and
value is kept.

## 6. Structured case tables

`buildCasesFromTable(studies, publicationId, table, opts)` maps a patient-column grid

| Variable | Patient 1 | Patient 2 | Patient 3 |
| --- | --- | --- | --- |
| Age | 42 | 56 | 61 |

onto three case records, one case per column, with optional per-cell provenance keyed
`"<patientIndex>:<variableId>"` so each value points at its own table cell. Re-running it
fills the same cases rather than duplicating them. 106.md asked only that the data model
support this cleanly; there is no UI for it yet (see §8).

## 7. Verification

- `tests/unit/caseSeries.test.js` — 52 tests over the pure engine.
- `tests/unit/caseSeriesDownstream.test.jsx` — 38 tests over PRISMA counts, fact tokens,
  the consistency check, dependency fingerprints, the sync hash, duplicate detection,
  publication-stable PDF anchors, list stats, and the SSR shape of the new UI.

An adversarial multi-agent review over six dimensions (correctness, counting, React
state, data safety, provenance, spec coverage) produced ~30 candidate defects; each was
independently refuted or confirmed by a second agent. The confirmed ones are fixed above
and pinned by the new tests — most importantly the remaining row-counted "studies"
surfaces (§3), `duplicateCase` copying another patient's PDF coordinates, the
publication anchor churning on delete, the variable editor being untypable, and the
rename box committing to whichever case was open when Save was pressed.
- `npm run test:ci` (hermetic: `tests/unit` + `tests/screening/unit`): **6742 passing**,
  no regressions (6652 before this change).

## 8. Known limitations

1. **No UI for the table mapper.** `buildCasesFromTable` is tested and callable, but
   nothing in the workspace surfaces "map this table's columns to cases" yet. Reviewers
   extract each case by hand (or by click-to-pick per cell).
2. **`select` case variables cannot be filled by clicking the PDF.** A picked token is
   never a controlled term, so they are excluded from the pick targets and must be
   chosen from the dropdown. Number variables take the snapped number; text and date
   variables take the clicked text run verbatim.
3. **Cases are not reorderable from the UI.** `reorderCases()` exists and is tested; no
   drag handle is wired.
4. **Statistical pooling treats cases as independent rows.** `runMeta`'s `k` counts
   rows, so pooling eight cases reports `k = 8`. That is the correct denominator for a
   pooled estimate, and the Analysis tab now warns explicitly that they are clustered
   observations — but no clustered/multilevel estimator was added. That is a
   statistics-engine change, not an extraction one.
5. **Patient-level variables do not reach Analysis or Reports.** `cv_*` values are
   extracted, provenance-linked and exported, but nothing aggregates them (no
   "median age across 47 cases", no case-level subgroup analysis). The case-level CSV is
   the handoff for now.
6. **No per-case audit-log granularity.** `ExtractionAuditLog` and the ProjectEvent
   ledger record blob-level study changes; a case edit is attributed to its row, not
   labelled "Case 3 of Smith 2024".
7. **Removing a case variable hides its values rather than deleting them.** The `cv_*`
   values stay on the rows (deliberately — so a mis-click is recoverable) but stop being
   shown and exported. There is no "restore" affordance. Adding or removing a definition
   also does not invalidate any manuscript fingerprint, because no manuscript fact is
   derived from the definitions themselves.
8. **The `boolean` case-variable type renders as free text**, and `required` is neither
   settable in the editor nor enforced by the completion gate.
9. **`studies.included` semantics changed for multi-outcome projects too.** A trial
   contributing three outcome rows now counts as one included study rather than three.
   This is the correct PRISMA reading (studies, not reports) and it fixes a pre-existing
   over-count, but it *is* a behaviour change for existing projects that relied on the
   old number. Two genuinely independent studies reported in a single paper (same DOI)
   likewise collapse to one publication, with no way to declare them separate.
10. **Turning Case Series Mode OFF can raise the publication count.** While the mode is
    on, all cases share one `publicationId`. Turning it off strips that, so rows of a
    paper with only a weak citation (author + year, no DOI/PMID/title) each become their
    own publication. Adding a DOI or title restores the collapse.
11. **Enabling the mode on an article that already has several OUTCOME rows converts
    them all into cases.** All rows of a paper must share the publication id or the
    article splits in two for counting, so this is the only consistent state. The banner
    says exactly how many rows were converted, and turning the mode off restores them.

## 9. Invariants (do not regress)

1. **A case is an `mkStudy` row.** Not a nested array. Every existing consumer —
   provenance, autosave, PDF resolution, completion, validation, export — keeps working
   because of this.
2. **`publicationId` is immutable and outranks every citation heuristic.** It is what
   makes the parent link survive a DOI correction and what makes publication counting
   provable.
3. **`countPublications` collapses only on PROVABLE identity.** Never on a weak citation
   key. Over-counting an ambiguous row is honest; merging two trials is not.
4. **Case counts reach the manuscript ONLY through the three case facts.** No PRISMA box
   and no study count may ever read a case count.
5. **Case-variable values are FLAT (`cv_*`) on the row.** Nesting them would silently
   remove per-value provenance, the sync hash, and the dependency fingerprint at once.
6. **The dependency projections are allow-lists.** Anything the manuscript renders that
   is absent from `rosterSlice`/`valuesSlice` changes on screen while every section
   reports "Fully synchronized".
7. **Disabling the mode never deletes data.** Only the namespace is stripped.
8. **One navigator renders at a time.** The outcome navigator must not be shown for a
   case row — it groups by citation identity and would list every case as an outcome.
9. **Every new mutation is pure and takes an injectable `idFn`.** `updateProject` is a
   React state updater, so StrictMode invokes it twice in dev and the blob writer may
   re-run it on a CAS retry. Ids are seeded OUTSIDE the updater and counted inside, so
   two invocations produce byte-identical output.
10. **A value must never carry another case's coordinates.** `duplicateCase` downgrades
    provenance to `manual` (keeping the entry and its history) rather than copying the
    page/bbox, and `buildCasesFromTable` invalidates a stale entry when it overwrites a
    value without fresh provenance. Claiming false evidence is the worst thing a
    provenance system can do.
11. **`anchorId` for a case series is the publication id, not a row id.** A row-id
    anchor churns when the first case is deleted, and `usePdfSource` keys its whole
    resolve on it — which unmounts the viewer (losing scroll position and any
    session-local upload) on a delete that had nothing to do with the PDF.
12. **Only the RAW title may feed citation identity.** The article-list summary's
    `title` falls back to the author when a paper has none; using it would forge a
    strong `t:author|year|author` key and merge two different untitled papers. That is
    what `citationTitle` exists for.
