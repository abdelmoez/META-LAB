# 101.md — Live manuscript synchronization, search provenance, change tracking, Newcastle–Ottawa (v4.8.0)

One principle drove every decision in this round:

> **The Manuscript Editor must be a live, evidence-backed representation of what
> actually happened in the research project.**

Two things had to be true for that to mean anything:

1. The manuscript must state only what the project can **prove**. Before this round it
   named databases from a settings checkbox, printed a hand-typed search date, and
   asserted "by independent reviewers" and "Two reviewers extracted data" for every
   project regardless of who actually worked on it.
2. Facts must be able to change **without rewriting the researcher's sentences**.

Everything below is what shipped, why it is shaped that way, and what was deliberately
left undone.

---

## 1. What already existed (and was extended, not replaced)

§40 forbids building a second architecture next to a working one. The audit found the
88.md provenance ledger already had almost everything §29 asks for:

| §29 asks for | Already existed |
| --- | --- |
| unified project event | `ProjectEvent` (`schema.prisma`), one writer in `server/provenance/recordEvent.js` |
| materiality | `ProjectEvent.significance` + `provenance/classify.js` (7 levels, computed not free-text) |
| affected dependencies | `provenance/taxonomy.js` — every event type declares `dependencyKeys` |
| manuscript impacts | `classify.js` REVERSES `manuscript/dependencies.js` `SECTION_DEPENDENCIES` |
| transaction grouping | `ProjectEvent.correlationId` |
| atomic write | `server/provenance/mutateWithEvents.js` (CAS + one transaction) |

So none of that was rebuilt. **The gap was that nothing fed it**: the taxonomy defined
`SEARCH_EXECUTED`, but `server/pecanSearch/` never called `recordEvent`. The ledger
existed and was empty of search history. That is now wired (§4 below).

The manuscript engine's 84.md live-sync layer also existed — but as a *review-and-apply*
workflow: `buildSyncPlan` produced a section-level diff the user had to accept. That is
precisely the "press Refresh" model §4 rules out, and it operates on whole sections,
which is why it could not update a number without offering to replace a paragraph.

---

## 2. Search provenance — `src/research-engine/search/searchProvenance.js` (§1, §2)

The manuscript may not name a database it cannot prove was searched. `deriveSearchProvenance`
consumes execution records and classifies each database into exactly the states §1 enumerates:

```
configured   selected in settings, never attempted        → NOT reportable
attempted    started, never reached a terminal state      → NOT reportable
failed       terminal error                               → NOT reportable
invalidated  genuinely searched, then rolled back         → NOT reportable
zero_results executed successfully, returned nothing      → REPORTABLE
imported     manual import attributed to this database    → REPORTABLE
completed    executed successfully with records           → REPORTABLE
```

The states are **ranked**, because the same database legitimately appears more than once.
The ordering is load-bearing:

* a later successful run **supersedes** an earlier failure — so a retry that works fixes
  the record;
* `invalidated` outranks `failed` (it describes a search that really ran) but sits **below
  every reportable state**, so a rolled-back run can never be superseded *into* being
  reportable, and a valid re-run after a rollback correctly wins.

No schema was needed. `PecanSearchSource` already carries `state`, `rawCount`,
`startedAt`, `completedAt`, `errorClass`; `PecanSearchRun.rolledBackAt` already marks a
reset; `ScreenRecord.sourceDb` already carries per-record database attribution for file
imports. This is a derivation, not a new store.

**Two honesty details worth naming.**

*A zero-result search is reported.* It really happened, and PRISMA requires it. Only
`rawCount <= 0` on a **completed** source produces `zero_results` — a failure never
silently becomes "we searched and found nothing".

*An import with no source attribution names no database.* A RIS file whose records carry
a blank `sourceDb` contributes its records to PRISMA but cannot name a database. That is
correct: we do not know where it came from, and guessing would be exactly the fabrication
§17 forbids.

`dbKind()` uses an explicit map rather than text classification, because CENTRAL's own
name ("Cochrane Central **Register** of Controlled Trials") would otherwise misfile it as
a trial register when PRISMA 2020 counts it as a database.

### §2 — the latest valid search date

`latestValidSearchAt` is the maximum timestamp across **reportable** databases only.
Consequences, both tested:

* a failed retry after a good search does **not** move the date;
* a rolled-back later run does **not** move the date.

Nobody types this date; there is no field for it.

---

## 3. The fact layer — how a number changes without touching a sentence (§5)

This is the crux of the whole brief, and the shape of the answer came from the codebase
rather than from a new invention.

The editor already renders two kinds of **atomic, `contenteditable=false` chip islands**
that live in the markdown as stable tokens and survive caret movement:
`[[cite:id]]` and `[[table:id]]` / `[[figure:id]]`. Asset chips already **renumber
themselves in place** ("Table 2" ⇄ "Table ?") without disturbing the caret. That is
precisely the mechanic §5 and §33 need.

So a third token type was added, following that precedent exactly:

```
"We searched [[fact:search.databases]] [[fact:search.dateRange]]."
```

`src/research-engine/manuscript/factTokens.js` defines the grammar, a registry of 25
facts, and `resolveFacts(project, opts)`. **The token is what is persisted; the value is
resolved at render.** Four requirements fall out of that for free:

* **§4** — no refresh button, because nothing needs regenerating. A project change is
  visible as soon as the data arrives.
* **§5** — human prose is safe *by construction*. The sync path can only alter the inside
  of a token; there is no code path that rewrites section text.
* **§16** — no contradictory partial states. Every token in a render resolves from **one**
  project snapshot, so Results, PRISMA and the Abstract cannot disagree about the study
  count.
* **§31** — the common case costs one string comparison per stated fact and **zero writes**.

Each fact declares the `depKey` it derives from — the *same* `DEPENDENCY_KEYS` the
manuscript dependency graph and the event taxonomy already use — so an event's dependency
keys map to the exact spans it can change. `factsForDependencyKeys()` is what makes §15
targeted instead of "regenerate everything": an event touching only `search.date` cannot
mark the database list changed.

### §17 is enforced here, not trusted

A fact the project cannot answer resolves `missing: true` and renders a visible bracketed
placeholder. There is no path by which an unknown fact becomes a confident sentence. One
specific trap is tested: `Number(null)` is `0`, so a naive resolver would render an
unknown PRISMA count as **"0 records identified"**. The numeric coercion rejects
`null`/`undefined`/`''` explicitly.

---

## 4. What now feeds the ledger (§3, §29, §30)

`server/pecanSearch/pipeline.js` emits into `ProjectEvent` when a run reaches a terminal
state — `SEARCH_EXECUTED`, and `SEARCH_RESULTS_IMPORTED` when records actually landed —
sharing **one `correlationId` per run** so §14 grouping works downstream.

Materiality is **not** hand-set. `classify.js` computes significance, affected manuscript
sections and the recalc/refresh flags from the event type's declared `dependencyKeys`.
That is what keeps §30's domain-vs-UI separation honest: a UI event has no dependency
keys, so it can never reach the manuscript.

A run that failed with nothing completed emits **nothing** — §2 is explicit that a failed
test search must not rewrite the methodology.

`GET /api/search-builder/:projectId/provenance` serves the derived provenance (same
router as `methods-text`; note the historical `/api/search-builder` mount).

---

## 5. Provenance, grouping and revert — `factProvenance.js` (§8–§14)

`reconcileFacts(draft, resolved, ctx)` compares freshly resolved facts against what the
draft last saw and records the differences.

**Where authority lives** (this matters for §12 and §32):

* the **authoritative** append-only audit is the server `ProjectEvent` ledger —
  transactional, CAS-protected, survives concurrent editors;
* the per-draft `factLog` written here is a **bounded rendering cache** so the overlay
  paints without a round trip. It may be capped; the ledger cannot. Nothing scientific
  depends on the cache alone.

**§38 honesty — the first-observation rule.** The first time a fact is seen its value is
*recorded* but no change is emitted. An existing project that predates this system starts
with a clean slate instead of a fabricated "changed from nothing" history. Relatedly, a
transition *into* `missing` is never reported — a fetch blip must not read as though the
researcher deleted a result.

**§14 grouping.** One reconcile pass shares one `groupId`, so an updated search that moves
the date, the database count, the database list and the coverage period produces **one**
panel entry, not four notifications.

**§10 revert.** `overrideFact` pins a wording. It changes **only what the manuscript
says** — §10 is explicit that reverting manuscript wording and reverting the underlying
research event are different acts. The override stores the project value it disagreed with,
and `factDiscrepancies()` keeps reporting the divergence for as long as it exists, so the
manuscript cannot quietly drift from the record. The reverted change is **marked**, never
deleted (§12).

Worked example from §8, reproduced verbatim by a test:

```
July 1:   "three databases were searched from inception to July 1, 2026."
Aug 6:    "four databases were searched from inception to August 6, 2026."
changes:  Number of databases (in words):  "three" → "four"     [Search Engine]
          Search coverage period:  "…July 1, 2026" → "…August 6, 2026"  [Search Engine]
grouped:  1 entry
```

---

## 6. Show Changes (§6, §7, §9, §34, §35)

`showChanges` is **view state only**. It sets one attribute on the editor root; all
overlay styling hangs off `[data-show-changes="true"]`. The DOM content is identical in
both modes, which is what makes §6's "the underlying manuscript content should be
identical" true by construction rather than by discipline.

The fact chip is **visually indistinguishable from surrounding prose when the toggle is
off** — no background, no border, inherited font and colour. It is a chip only
*structurally* (so it stays atomic and caret-safe), never visually. That is what makes
"turn Show Changes off → completely clean manuscript" exact rather than approximate.

Colour is never the only indicator (§7, §35): every engine also carries a label and a
glyph, surfaced in the chip title, the legend and the provenance card.

`FactProvenanceCard` renders exactly the §9 fields (Updated by / Changed / Reason /
Previous value / Current value / Affected manuscript field) plus the §10 actions.
`ChangeTrackingPanel` lists grouped updates newest-first; clicking one navigates to the
first section that states the fact.

---

## 7. Newcastle–Ottawa Scale (§18–§27)

§21 says: *"Verify this against authoritative Newcastle–Ottawa documentation before
implementation. Do not rely solely on memory or assumptions."* So the two official OHRI
artefacts were fetched and read, not recalled:

* Scale (rating sheet) — `https://www.ohri.ca/sites/ohri/files/2025-09/nosgen.pdf`
* Coding manual — `https://www.ohri.ca/sites/ohri/files/2025-09/nos_manual.pdf`

(The URL in 101.md now 301-redirects to the current OHRI page.)

Both forms are encoded **verbatim**, including the instrument's own blanks (`____`),
which are protocol-defined and filled by the review team — never by us.

### The structural detail that prevents over-scoring

The official header note caps each numbered Selection/Outcome/Exposure item at **one**
star. But several items have **two starred options** (cohort Selection 1 a&b, Selection 3
a&b, Outcome 1 a&b; case-control Exposure 1 a&b). They are mutually exclusive
*alternatives*, not additive. **Comparability is the only additive item on either form**
(0–2 stars from one item).

That is expressed structurally, not stylistically:

```js
question.select === 'one'   → radio group,  scores max 1 star
question.select === 'many'  → checkboxes,   scores 1 star per starred option (Comparability only)
```

`questionStars()` caps a single-select item at one star even if two starred values are
somehow stored, so a corrupted blob or a UI bug cannot inflate a quality score. A test
feeds a fully over-ticked cohort assessment and asserts the total is still 9, not 12.

### §22 — thresholds, handled honestly

Both official documents were read end to end. **Neither contains any threshold, band, or
good/fair/poor mapping. There is no official NOS interpretation rule.** In particular the
familiar **0–3 / 4–6 / 7–9** bands appear in no OHRI document — they are a
secondary-literature convention.

So `nosThresholds.js` ships three modes and defaults to the honest one:

* `none` **(default)** — star profile only, no verdict;
* `ahrq` — the AHRQ EPC per-domain standard (CER No. 88, Penson et al. 2012, Appendix E),
  carrying its attribution;
* `custom` — the review team's own protocol bands.

`interpretNos().official` is **always `false`**, in every mode, and every non-`none`
result carries an `attribution` string, so no UI can render a verdict without saying whose
rule produced it. The conventional bands are available only as an explicitly labelled
opt-in preset with a notice.

A consequence worth surfacing, and tested: AHRQ is **per-domain**, so a study with 7/9
stars but **zero comparability stars is Poor** — while the conventional total-score bands
would call the same study "high". That disagreement is the reason total-score banding is
not the default.

### Reuse rather than new tables (§25, §24)

The RoB schema already had what NOS needed:

* `RobAssessment.instrumentId` → `NOS` | `NOS-CC`
* `RobAssessment.variant` (was `assignment|adherence`) → reused for `cohort|case-control`
* `RobAssessment.reviewerId` + `status: draft|complete|consensus` → **dual reviewer and
  consensus already existed**. Two rows sharing (project, study, instrument) with different
  reviewers are the two independent assessments; consensus is a third row. Neither
  reviewer's row is ever overwritten.
* `RobAnswer.rationale` / `evidenceQuote` / `evidenceLocator` → **that is the §23/§24
  evidence linkage**, wired rather than rebuilt.

Only two additive, nullable columns were introduced (`proposedStars`/`finalStars` on
`RobDomainJudgment`, plus `maxStars` on `RobOverall`) so `prisma db push` stays safe and
no reader has to parse a numeral out of a judgement string.

The two forms are separate instruments (`NOS`, `NOS-CC`) because their third domain
genuinely differs (Outcome vs Exposure). `toolsForStudyDesign()` routes by design — and
tests that **"nested case-control study within a cohort" routes to case-control**, since a
cohort-first match would offer the wrong form.

### §26 — the summary is a table, not a traffic light

`NosStarProfile` renders Study / Selection / Comparability / Outcome-or-Exposure / Total
as counts. §26 explicitly forbids presenting NOS as if it were RoB 2's traffic-light
domains, so it does not.

---

## 8. §17 — the fabrication audit

Every claim below was previously emitted **unconditionally**, for every project:

| Site | Was | Now |
| --- | --- | --- |
| `methodsText.js` | "We searched \<configured databases\>" | execution record, or a placeholder |
| `methodsText.js` | "screened **by independent reviewers**" | reviewer count only when recorded; single-reviewer said plainly |
| `methodsText.js` | "**Disagreements were resolved by discussion.**" | recorded process, or an explicit gap for a 2-reviewer project |
| `methodsText.js` | extraction field list asserted as fact | the project's own extraction fields, else no list |
| `methodsText.js` | RoB tool from the **selected** setting | instruments with completed assessments (§27) |
| `draft.js` (Abstract) | databases from `project.search.dbs` | execution record |
| `draft.js` (Abstract) | "**Two reviewers extracted data**" | reviewer count only when recorded |

`searchFacts()` in `draft.js` is now the single place the generator learns the databases
and date, so Methods, Abstract and the fact tokens cannot disagree. Both it and the RoB
paragraph keep a **legacy fallback** for callers not yet migrated, so no existing export
regressed — the fallback is labelled, not silent.

`deriveRobUsage()` counts **distinct studies**, so a study assessed by two reviewers plus
a consensus row counts once, not three times (§25).

---

## 9. Export (§36)

Fact tokens are resolved once in `prepareExport`, against freshly re-fetched sources, so
(a) no export path can leak raw `[[fact:…]]` syntax into a submitted document and (b) the
exported numbers are the ones the editor was showing. `[[cite:…]]` and asset tokens
deliberately survive, because numbering, placement and the exporter's own inline renderer
run downstream and still need them.

A normal export cannot carry a provenance overlay, because the overlay does not exist
outside the editor's view state. There is nothing to strip.

---

## 10. Testing

`npm run test:ci` — **408 files, 6415 tests, all passing** (was 401 / 6246).

New suites:

| File | Covers |
| --- | --- |
| `tests/unit/searchProvenance.test.js` (18) | every §1 state, §2 date rules, register/database split, CENTRAL |
| `tests/unit/searchProvenanceService.test.js` (14) | row adaptation, `sourceDb` grouping, degrade paths |
| `tests/unit/manuscript/factTokens.test.js` (24) | grammar, §17 honesty, §5 prose-safety, §8 example, §10, §14, §38 |
| `tests/unit/manuscript/liveSyncScenarios.test.js` (12) | the §37 workflow scenarios |
| `tests/unit/manuscript/factChips.test.js` (18) | token ⇄ chip round trip, no collisions |
| `tests/unit/manuscript/showChanges.test.jsx` (32) | engine styles, no colour-only signalling, §9 card, §34 panel |
| `tests/unit/nos.test.js` (29) | both forms, arity cap, additive comparability, §22 thresholds (all 60 AHRQ triples) |
| `tests/unit/nosUi.test.jsx` (34) | radio-vs-checkbox structure, running totals, §26 table |
| `tests/unit/nosPersistence.test.js` | option validation, star columns, disagreement detection |

The §37 scenarios are tested as behaviour, not units — including the two that matter most
for trust: *changing a search term without executing changes nothing*, and *a failed test
search never enters the manuscript*.

---

## 11. Deliberate limitations

1. **`buildSyncPlan` (84.md) still exists alongside the fact layer.** They address
   different scopes — sync plan proposes whole-section regeneration, fact tokens patch
   spans — and the section-level flow is still the right tool for "regenerate Methods from
   scratch". Retiring it is a separate round; it is not wired to any automatic path.
2. **Existing (pre-101) drafts contain no fact tokens.** A manuscript written before this
   round is plain prose, so it gets no live updates until its sections are regenerated.
   This is deliberate — §38 forbids fabricating provenance for text whose origin we do not
   know. **Newly generated sections do carry tokens** (`factTokens`, applied at the two
   generation call sites next to the existing `assetRefs` flag), so from this version on
   the Methods paragraph, the search date and the PRISMA counts re-resolve on every render.
   The engine default stays `false` so the pure generator's legacy output is byte-identical.
3. **DOCX native Track Changes is not implemented.** §36 permits deferring it and warns
   against risking normal export. The clean export path is guaranteed; a tracked export
   would need `w:ins`/`w:del` support in the OOXML writer.
4. **Ctrl+Z covers editor text, not accepted/reverted fact changes.** Native
   `document.execCommand` undo is preserved and is correctly scoped — it can never reach
   research data, which is the hard requirement in §11. A revert is undone through the
   provenance card, not the undo stack.
5. **Concurrency relies on the existing `autosaveRev` CAS.** The `factLog` is a bounded
   per-draft cache and can lose an entry under simultaneous edits by design; the
   `ProjectEvent` ledger is the durable record (§12/§32). True multi-user manuscript
   merging is out of scope for this round.
6. **No cross-sectional NOS.** There is no official one — OHRI publishes exactly two
   forms. Shipping an adaptation (Modesti 2016 et al.) under the NOS name would misattribute
   it. It belongs as a separately named instrument.
7. **The Comparability star-2 dependency is left independent.** The official form does not
   state whether "any additional factor" requires the primary factor first. The instrument
   is genuinely silent, so it is not hard-coded; a protocol switch is the right home.
8. **Screening and extraction do not yet emit their own domain events.** The blob-diff
   emitter (`recordBlobDiff`) already covers everything that lives in `Project.data`
   (analysis model, effect measure, study roster, RoB tool). Search and **risk of bias**
   now emit explicitly — the RoB emitter hangs off the single `audit()` funnel in
   `robController.js`, so every answer / override / finalise / delete reaches the ledger
   without instrumenting each handler, and `ROB_CREATE` / `ROB_EXPORT` deliberately map to
   no event (§30). Screening still writes only `ScreenAuditLog`.
