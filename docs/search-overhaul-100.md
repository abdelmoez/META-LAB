# 100.md — Search + Screening UX refinement (v4.7.0)

Two engines, one round:

* **Search Engine** — the building screen now shows *meaning*, not syntax. Two panels
  were retired, one read-only explanation replaced them, and controlled vocabulary
  stopped being copied blindly from PubMed into every other database.
* **Screening Engine** — a returning reviewer presses one button and lands on the next
  article that needs *their* decision.

Everything below is what shipped, why, and what was deliberately not done.

---

## 1. What was removed, and where its capabilities went (§§1-2)

### "Your search so far" — `StrategyPreviewPanel.jsx` (deleted)

It was a second, weaker copy of the concept board. Every capability it carried already
had a better home:

| Capability | Where it lives now |
|---|---|
| Live PubMed count + `Retry` | `PubMedPulse` — the sticky header in `SearchWorkspace.jsx`, already shown on the terms/mode/strategy/results stages, with richer empty and "previous:" states |
| Between-concept **AND/OR toggle** | `sb-and-connector` **on the board**, between the two cards, where both operands are visible — and where it correctly renders *inert* next to a concept that does not compile |
| Click a concept row to open it | The board cards themselves (click, chevron, Enter — the 98.md H14 keyboard contract) |
| "editing" badge | The active card's 2px accent border + `aria-current="true"` + `aria-expanded="true"` |
| "Not in the search yet (no terms): X" | The new meaning panel's `sm-skipped` line |
| "Show database syntax" (PubMed only) | The new meaning panel's **Exact database queries** disclosure — all selected databases, not just PubMed |

The one orphaned string ("toggle it in the strategy preview below") was rewritten to
point at the board connector.

### "Database previews" — `sb-db-previews` (deleted)

16 always-expanded compiled-syntax panels sat between the concept board and the limits.
They are gone from the building screen. The compiler system is untouched: the same
memoized `compileAll` now feeds

* the **Exact database queries** disclosure in the meaning panel — read-only, **closed
  by default**, one click away; and
* the **Database Strategies** stage (manual mode) / the **Automated Search** run surface,
  which keep the editable versions with overrides, warnings and export.

§11 is satisfied in *both* modes without touching the stage model.

---

## 2. Cross-database vocabulary translation (§§3-4) — the substantive change

### The bug this fixes

Every renderer reached into `term.vocab.mesh` and pasted that **PubMed** string into its
own subject-heading syntax:

```
Embase    'non insulin dependent diabetes mellitus'/exp   ← a de-inversion heuristic
CINAHL    (MH "Diabetes Mellitus, Type 2+")               ← a MeSH string in EBSCO syntax
PsycInfo  DE "Diabetes Mellitus, Type 2"                  ← ditto, APA thesaurus
Scopus    INDEXTERMS("Diabetes Mellitus, Type 2")         ← a publisher-keyword field
ProQuest  MAINSUBJECT.EXACT("Diabetes Mellitus, Type 2")  ← demands an EXACT match
WoS       TS=("Diabetes Mellitus, Type 2")                ← the inverted string, as text
```

Several of those return **zero** whenever the target vocabulary words the concept
differently — and the searcher had no way to tell. That is precisely the "fake database
syntax" 100.md §3 forbids.

### The architecture (§4)

```
user concept
     ↓  toCanonicalConcept()          src/research-engine/searchBuilder/vocabulary/canonical.js
canonical semantic concept
     ↓  translateConcept()            …/vocabulary/mappings.js      ← the registry
controlled-vocabulary mapping, or an honest "no equivalent"
     ↓  controlledClause()            …/compilers/shared.js
database adapter → PubMed / Embase / CINAHL / … representation
```

`CanonicalConcept` carries `{ sourceSystem, sourceId, preferredLabel, naturalLabel,
entryTerms, narrower, explode, freeTextForms }`. Nothing in it is MeSH-specific except
the default `sourceSystem`; a term sourced from another thesaurus only has to arrive with
a different `vocab.system`.

**Renderers no longer read `term.vocab` at all.** `runRenderer` resolves every controlled
term and then either calls the adapter's new `renderHeading(plan)` hook or composes the
fallback out of the adapter's own `renderFree`. 12 of the 16 renderers *lost* their
bespoke `renderControlled` entirely; 4 gained a two-line `renderHeading`.

### What is registered, and why only that

| Target | Mapping | Basis |
|---|---|---|
| PubMed / MEDLINE, PubMed Central, Cochrane CENTRAL, Europe PMC | `mesh → mesh`, confidence **exact** | These databases index MEDLINE's own MeSH descriptors. It is an identity, not a guess. |
| Embase (Emtree), CINAHL (CINAHL Headings), PsycInfo (APA Thesaurus) | **none** | All three are proprietary and publish no MeSH crosswalk (the UMLS Metathesaurus, the only general crosswalk NLM publishes, does not carry them). 100.md §20: *do not invent mappings.* |
| Scopus, WoS, IEEE, ACM, ProQuest, Google Scholar, ClinicalTrials.gov, ICTRP, grey literature | **none** | No subject-heading thesaurus exists to map to. |

The fallback is a **properly formatted free-text phrase in the target database's own
grammar and field tags**, using the concept's **natural word order** —
`"Diabetes Mellitus, Type 2"` → `Type 2 Diabetes Mellitus`, because no abstract contains
the inverted catalogue form. Each fallback carries an explicit, actionable diagnostic:

* database with its own (unreachable) thesaurus → `VOCAB_NO_EQUIVALENT` **warning**
  naming the vocabulary and the recovery path (look it up, paste it via the existing
  per-database override);
* database with none at all → an `unsupported: {feature:'controlled-vocabulary'}` entry;
* an exploded heading with real narrower data → a **note** stating exactly how many
  narrower topics a free-text phrase cannot reach.

**Adding a vocabulary later is one registration** and zero renderer edits:

```js
registerVocabularyMapping({
  from: 'mesh', to: 'emtree', confidence: 'verified',
  authority: 'Emtree ↔ MeSH crosswalk, <source + release>',
  translate: (concept) => CROSSWALK[concept.sourceId] ?? null,  // null ⇒ free text
});
```

A `translate` that returns `null` for an unknown concept is required — partial coverage
must degrade *per concept*, never to a guessed heading. Both behaviours are unit-pinned.

### Knock-on honesty fixes

* `vocab.approximate` is now **never set** — nothing is approximated any more. Embase,
  CINAHL, PsycInfo, Scopus, WoS and ProQuest moved from `syntaxLevel: 'approximate'` to
  `'native'`: the strings they emit *are* valid syntax for those databases.
* `vocab` gained a `fallback` count; the DbStrategyPanel line now reads
  `Subject terms: 1 searched as mesh subject headings · 1 searched as free text (no verified emtree equivalent)`
  instead of a mapped/unmapped tally against a thesaurus we may not even reach.
* Explosion mismatches are reported **in the right direction**: PMC's `[MeSH Terms]`
  always explodes (warned only when the user asked it *not* to); Europe PMC's `MESH:`
  never does (warned when the user wanted narrower topics). Driven by a new
  `explosionDefault` capability field.
* `filtersApplied` no longer reports `true` for an empty strategy (98.md §12 fixed the
  query, not the flag — the UI told users with no terms that their limits "ride inside
  the query" when the query was empty).

### Dual-path parity (server connectors)

Client compilers (16 paste-ready databases) and server connectors (7 API providers)
share no code, only a hand-mirrored contract — and a mapping applied to only one side is
exactly how the two silently diverge. `normalizeCanonical` in
`server/pecanSearch/query/ast.js` now resolves the **same** canonical concept and stamps
each controlled term with `heading` (the indexed descriptor) and `freeTextHeading` (the
natural form), plus an exported `searchableText(t)` helper. PubMed/Europe PMC use
`heading` (unchanged output); ClinicalTrials.gov, Crossref, OpenAlex, DOAJ and Semantic
Scholar now search the concept in natural word order instead of the inverted string or
the user's shorthand.

---

## 3. "What this search is looking for" (§§6-11)

`src/research-engine/searchBuilder/interpretation.js` (pure) +
`src/features/searchBuilder/components/SearchMeaningPanel.jsx` (presentational).

```
WHAT THIS SEARCH IS LOOKING FOR

Find articles about Type 2 Diabetes, and also about Metformin, and also about Mortality.

┌ IDEA 1  Type 2 Diabetes ─────────────────────────────────────────────────────┐
│ The article can match any one of these:                                       │
│  SUBJECT     articles the database's own indexers filed under the topic        │
│              "Type 2 Diabetes Mellitus", plus the 2 more specific topics under │
│              it — or simply the words "Type 2 Diabetes Mellitus" where a       │
│              database has no subject list                                      │
│  PHRASE      the exact phrase "type 2 diabetes" in the title or abstract       │
│  WORD START  any word starting with "diabet" in the title or abstract          │
└───────────────────────────────────────────────────────────────────────────────┘
                    ── AND · the article must ALSO be about: ──
┌ IDEA 2  Metformin ────────────────────────────────────────────────────────────┐
…

NARROWED TO
Published between 2010 and 2025.  ·  Written in English.  ·  Only Randomized
Controlled Trial articles.

Not part of the search yet (no terms): Cost.

▸ Exact database queries (3)
```

Design decisions worth keeping:

* **§9 — no second state.** `interpretStrategy({concepts, filters})` is a pure function
  of the same in-memory strategy the compilers consume, so it re-renders in the *same*
  React commit as the query. There is nothing to save, refresh, or let drift. It also
  reuses the compilers' exact rules: `liveTermsOf` for which terms count, and the
  previous *surviving* concept's `op` for how blocks chain.
* **§8 — read-only by construction.** The panel renders **no `<button>` and no
  `<input>`** (unit-pinned). It carries no ids the UI could write back through. The
  hit-count retry stayed in PubMedPulse; the AND/OR toggle stayed on the board.
* **§10 — the layout *is* the Boolean logic.** One card per concept, "any one of these"
  inside, an explicit connector sentence between. The AND/OR chip and the sentence
  complete each other ("AND — the article must ALSO be about:") rather than repeating.
* **§6 — no syntax leaks.** A unit test serialises the whole model and asserts it
  contains none of `[Mesh]`, `[tiab]`, `TITLE-ABS-KEY`, `/exp`, `(MH `, `DE "`, `MESH:`,
  `:ti,ab`.

---

## 4. Resume Screening (§§12-15)

### There is no `lastScreenedRecordId` column — deliberately

`ScreenDecision` is already `@@unique([recordId, reviewerId, stage])` with `updatedAt`.
That *is* per user + project + stage, timestamped. Deriving the resume position from it
rather than storing a second mutable pointer makes every §15 edge case fall out for free:

| §15 case | Why it works |
|---|---|
| Two reviewers | Each reads only their own decision rows — nothing to overwrite |
| Logout / login / second browser / two tabs | The server is the only source of truth; nothing in localStorage can go stale |
| Article deleted | The decision row cascade-deletes with it, so a dangling pointer cannot exist |
| Article deduplicated | `isDuplicate` records are excluded from the pending pool at read time |
| Filters changed | Resume ignores the current filters, reports the canonical position, and the client **clears the filters and says so** |
| Last article excluded | An exclusion is a decision like any other; the anchor moves regardless |
| Undo (decision → `undecided`) | The anchor skips undecided rows, so the undone article becomes next again |
| Nothing screened yet | Falls back to the most recently **opened** still-undecided article (`ScreenRecordOpenState`), else the first eligible one |
| Everything screened | `status: 'complete'` → *"You have completed screening for Title & Abstract."* |

### The endpoint

`GET /api/screening/projects/:pid/resume?stage=&limit=` →

```json
{ "stage", "status": "resume|reopen|start|complete|empty", "recordId", "wrapped",
  "position", "page", "limit", "pending", "decided", "stageTotal", "listTotal",
  "lastDecidedAt", "message" }
```

Pure logic in `src/research-engine/screening/resumeState.js` (`pickResumeTarget`,
`afterCursor`, `resumePage`, `resumeMessage`) — unit-tested without a database; the
controller supplies the rows. `position`/`page` index the **default** records list so the
client jumps straight to the right page instead of paging through thousands of rows.

**`wrapped`** covers the case where the reviewer skipped articles earlier: nothing
follows the anchor, so resume goes *back* to the earliest outstanding one — and says so,
rather than teleporting backwards silently.

### The control

A two-line bar at the top of the records panel (`screening-resume-bar`):
`Continue where you left off →` / `3 done · 5 left · resumes at #4`. It disappears
entirely when there is nothing to resume, and becomes an explicit completion line when
the stage is finished. Wording comes from the shared pure `resumeMessage`, so the button,
the note and any future surface can never drift apart.

### One ordering fix it needed

`listRecords`' in-memory path ordered by `createdAt` alone — no id tiebreak — so a bulk
import (thousands of rows sharing one timestamp) could return a *different* order on
every request. "Article 412" has to mean the same article twice, so the tiebreak the fast
path already had is now on both paths.

### Also new: the first testids the screening list has ever had

`screening-record-row` / `data-record-id` / `data-selected` — needed for scroll-into-view
and, incidentally, the first stable hooks for screening e2e (which previously located
everything by copy).

---

## 5. Testing

| Suite | Result |
|---|---|
| `npm run test:ci` (hermetic unit) | **399 files / 6174 tests — all pass** |
| `npm run test:integration` (live API) | **95 files / 806 tests + 9 skipped — all pass** |
| Playwright `chromium` — search workspace | 35/35 |
| Playwright `webkit-search` — full search journey | 35/35 |
| Playwright `chromium` — screening | 18 pass, 1 documented skip |
| Playwright responsive (chromium/mobile-chrome/tablet) + search smoke (firefox/webkit) | 26/26 |

New test files:

* `tests/unit/searchVocabularyTranslation.test.js` — 39 tests: de-inversion, canonical
  model, registry contents, **extensibility** (a registered crosswalk changes Embase
  output with no renderer edit; partial coverage degrades per concept; a throwing
  crosswalk degrades safely), capability-aware planning, and §20's seven real concepts
  (type 2 diabetes, MI, hypertension, heart failure, CKD, breast cancer, aspirin) × 16
  databases asserting no fabricated heading survives anywhere.
* `tests/unit/searchCompilers/strategyShapes.test.js` — §19's shapes (1 / 2 / 3+
  concepts, free-text only, vocabulary only, mixed, no-equivalent) compiled for all 16
  databases with structural validity checks: balanced parens, balanced phrase delimiters
  in each grammar, no dangling/doubled operators, no empty groups.
* `tests/unit/searchInterpretation.test.js` — 16 tests, including operator chaining
  agreeing with `compileStrategy` on the same fixture, disabled-term liveness parity, and
  the no-syntax-leak sweep.
* `tests/unit/screening/resumeState.test.js` (17) and `resumeBar.test.jsx` (5).
* `tests/screening/integration/resume-screening.test.js` — 11 live-API tests covering
  per-user, per-stage, exclusion-as-anchor, undo, wrap-around, record deletion, and
  completion.
* All 16 compiler golden files rewritten to the new (correct) output.

Manual §23 review, in the running app:

* **Beginner** — reads the summary sentence and three plain-language blocks; meets no
  Boolean, no MeSH, no field tags.
* **Systematic reviewer** — the board above still shows every term with its scope,
  truncation and vocabulary badges; "Narrowed to" states the limits; "Not part of the
  search yet" flags gaps; PubMed Pulse gives the live count.
* **Search specialist** — the disclosure shows the exact per-database strings (with a
  `SUBJECT → FREE TEXT` badge where a fallback happened), and Database Strategies keeps
  overrides and export.

---

## 6. Deliberate limitations

1. **No Emtree / CINAHL / APA crosswalk ships.** None is publicly available. The
   registry, the confidence ladder and the per-concept degradation are all in place, so
   licensing one is a single `registerVocabularyMapping` call. Until then those databases
   get honest free text plus a warning naming the recovery path.
2. **Entry terms are not auto-expanded into the free-text fallback.** A MeSH descriptor
   can carry 40, which would blow past Google Scholar's ~256-character ceiling and bury
   the user's own synonyms. `freeTextForms` is an array precisely so this can change.
3. **Exploded headings do not expand narrower topics into free text.** The narrower list
   is capped at 40 by the SPARQL query and would balloon queries unpredictably; the
   compiler emits a note stating how many topics are not covered instead.
4. **Resume covers `title_abstract` and `full_text` (`ScreenDecision.stage`).** There is
   no review-round model in the schema — rounds are implicit in stage. Final Review
   decides through `finalize`, not `ScreenDecision`, so `SecondReviewTab` does not yet
   show a resume bar; the endpoint is already stage-parameterised for it.
5. **`server/pecanSearch` and `src/.../compilers` remain two query paths.** They now share
   the canonical-concept model, but not the renderers. Unifying them is a larger change
   than this round.
6. Carried over from 98/99: `TermEditorPopover` is absolute-positioned (not portaled);
   Beginner Mode is per-browser localStorage; within-group Boolean is fixed OR and NOT is
   unsupported.
