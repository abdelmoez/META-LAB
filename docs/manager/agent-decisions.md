# META·SIFT Beta — Architectural Decision Record

*META·LAB internal document — records key design choices for the SIFT Beta
screening module. Last updated: 2026-06-08.*

---

## 1. Why META·SIFT Is a Separate Module

**Decision**: META·SIFT Beta is implemented as a parallel route namespace
(`/sift-beta`) and a set of new database models, not as an extension to the
existing meta-analysis project model.

**Rationale**:

The existing `Project` model is designed around meta-analysis: it stores
studies with effect sizes, heterogeneity settings, and statistical outputs.
A screening project has a fundamentally different data model — it stores
bibliographic records (not studies), decisions per reviewer, conflict flags,
and PRISMA flow counts. Conflating the two would require either awkward
schema gymnastics or frequent null fields.

Keeping the modules separate also means the screening beta can be iterated
on or even removed without risk to the existing meta-analysis pipeline. It
also makes it easier to write isolated tests.

---

## 2. Database Design: 7 New Models

**Models added**:

| Model | Purpose |
|-------|---------|
| `SiftProject` | A screening project, owned by one user, has a blind-mode flag |
| `SiftRecord` | One imported bibliographic record (title, authors, doi, pmid, abstract, year) |
| `SiftDecision` | One reviewer's decision on one record (unique per reviewer+record) |
| `SiftImport` | Log of each import batch (filename, format, count, timestamp) |
| `SiftDuplicate` | Detected duplicate pair (recordA, recordB, method, similarity) |
| `SiftConflict` | Detected conflict on a record (two decisions disagree) |
| `SiftLabel` | Label definition scoped to a project |

**Rationale**: Normalizing into separate models keeps each table narrow and
queryable. Storing decisions in a join table (rather than on the record itself)
allows multi-reviewer workflows where each reviewer has their own decision.

---

## 3. Why Blind Mode Is a Project-Level Flag

**Decision**: `SiftProject.blindMode: Boolean` — either all reviewers in a
project are blind to each other's decisions, or none are.

**Rationale**: Blind mode is a methodological choice made at study design time,
not a per-reviewer preference. Allowing individual reviewers to toggle blind
mode within the same project would produce inconsistent data — some records
would have been screened with social influence and others without, making
inter-rater reliability metrics meaningless.

A project-level flag enforces consistency. The project owner sets it when
creating the project, and it cannot be changed mid-screening (that would
require retroactive data correction).

---

## 4. Why Decisions Use Upsert

**Decision**: Saving a decision uses `upsert` on the `(reviewerId, recordId)`
unique constraint — it creates the decision row if it does not exist, or
updates the existing one.

**Rationale**: A reviewer can change their mind while screening. A strict
"insert only" model would require explicit delete-then-insert with race
conditions. An upsert is atomic and idempotent: calling it twice with the same
data produces the same state.

The unique constraint on `(reviewerId, recordId)` is the business rule
enforcement layer — it is impossible to accidentally create two decisions for
the same reviewer on the same record.

---

## 5. Why Import Uses Existing Parsers

**Decision**: The `/sift-beta/import` route calls `detectAndParse` from
`src/research-engine/import-export/parsers.js`, the same module used by the
main app's import flow.

**Rationale**: The parsers are already tested, handle all four major formats
(RIS, BibTeX, PubMed NBIB, EndNote XML), and are maintained in one place.
Duplicating them would create maintenance divergence. The parsers are pure
functions with no side effects, so importing them from a screening route adds
no coupling beyond the function call.

---

## 6. Deduplication Strategy: DOI > PMID > Title Similarity

**Decision**: `findDuplicateGroups` runs three passes in priority order:

1. Exact DOI match (trimmed, case-insensitive)
2. Exact PMID match (trimmed)
3. Title similarity >= 0.92 (Levenshtein, normalized) — only within same year

**Rationale**:

DOI is the most reliable identifier — it is persistent, globally unique, and
format-agnostic. PMID is similarly reliable for PubMed-indexed articles.
Title similarity catches duplicates imported from different databases where
one export included a DOI and the other did not.

The 0.92 threshold was chosen by testing against known duplicate sets: lower
thresholds produce false positives (different articles with similar titles),
higher thresholds miss duplicates with minor transcription errors.

The same-year filter in pass 3 prevents marking a retraction notice and its
original article as duplicates when they share most title words.

---

## 7. Conflict Detection on Every Decision Save

**Decision**: After every `POST /api/screening/records/:id/decision`, the
server re-runs conflict detection on that record and upserts a `SiftConflict`
row if a conflict is found (or deletes it if the conflict is resolved).

**Rationale**: Conflicts must be detected eagerly so that the conflict list
is always current. Lazy detection (compute on demand) would require a full
table scan on every conflict-list request. Event-driven detection (on every
save) keeps the `SiftConflict` table as a real-time index into the conflict
state.

This approach is O(1) per save: only the record that was just decided needs
to be re-evaluated.

---

## 8. Export: CSV and JSON, Filtered by Decision

**Decision**: `GET /api/screening/projects/:id/export?format=csv&decision=include`
exports all records matching the decision filter in the chosen format.

**Rationale**: Researchers need to hand off included records to data extraction
tools. CSV is the universal interchange format; JSON is useful for programmatic
pipelines. Filtering by decision means the export payload is always the working
set, not the full import corpus.

Supported decision filters: `include`, `exclude`, `maybe`, `all`.

---

## 9. Rating: 1–5 Integer Stored in DB

**Decision**: `SiftDecision.rating: Int?` — nullable integer from 1 to 5.

**Rationale**: Some systematic review protocols prioritize the full-text
retrieval queue by relevance score. A 1–5 integer is simple to store, sort,
and display. It is nullable because rating is optional — most reviewers only
use include/exclude/maybe.

Storing it on the decision row (rather than on the record) means each reviewer
can assign an independent rating, which supports inter-rater reliability
analysis for prioritization.

---

## 10. Labels: JSON String in Decision Record

**Decision**: `SiftDecision.labels: String` — JSON-encoded array of label
strings, e.g. `'["PICO-P","RCT"]'`.

**Rationale**: Labels are per-reviewer (in blind mode, reviewers should not see
each other's labels). Normalizing labels into a join table adds two extra joins
per query and a migration for every new label definition. Storing as a JSON
string in the decision row is simple, fast to read, and sufficient for the
expected scale (< 50 labels per project).

The `SiftLabel` model stores the canonical label list for a project, which
is used to populate the label picker UI. The JSON string on the decision row
is the materialized selection.

---

## 11. Why the `/sift-beta` Route Prefix

**Decision**: All screening API routes are under `/api/screening/` on the
backend; the frontend uses `/sift-beta` as the URL prefix.

**Rationale**:

- **Clearly separate**: Reviewers navigating the app know they are in a
  different module (screening vs. meta-analysis).
- **Beta-labeled**: The `beta` suffix signals to users that this module is not
  yet feature-complete and may change. It sets expectations without hiding the
  feature behind a flag.
- **Easy to namespace in tests**: All screening integration tests can target
  `/api/screening/` without risk of colliding with existing project or study
  endpoints.

The prefix will be changed (or the routes merged) when the module reaches v1.

---

## 12. Integration with META·LAB: Same Auth, Separate Data

**Decision**: META·SIFT Beta uses the same session-based authentication as the
main META·LAB app. Screening projects are owned by the same `User` model.

**Rationale**:

- **Single sign-on**: No separate login for screening vs. analysis. Teams
  working across both workflows use one account.
- **Access control reuse**: The existing `requireAuth` middleware is applied to
  all screening routes without modification.
- **Data isolation**: `SiftProject.userId` foreign key ensures each user sees
  only their own projects. Cross-user access returns 404 (not 403) to avoid
  information leakage about project existence.

Future work: team-shared projects will require a `SiftProjectMember` join table
and a corresponding permission check layer.
