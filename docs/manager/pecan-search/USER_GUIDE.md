# Pecan Search Engine — User Guide (P1)

How to run an automated multi-database literature search inside a PecanRev project: build
or paste a strategy, inspect how it translates per source, read count previews, run the
search, follow progress, review duplicates, understand the PRISMA impact, export the
PRISMA-S report, and import licensed databases by file.

The Pecan Search Engine is available when an administrator has enabled the
**Pecan Search** feature for your instance. It lives in your project's search workspace
(`:projectId` is your META·LAB project). Everything runs server-side, so a search keeps
running even if you close the tab.

---

## 1. Build or paste a query

A search strategy is a structured Boolean query, not a flat string. The canonical model
(`server/pecanSearch/query/ast.js`) is:

- **Concepts** — the building blocks (e.g. *Population*, *Intervention*). Concepts combine
  with **AND**.
- **Terms** inside a concept combine with that concept's operator (**OR** by default, or
  AND). Each term has a **field** (title, abstract, title/abstract, author, journal, doi,
  pmid, mesh, keyword, all), and optional flags: `phrase` (auto for multi-word text),
  `truncate` (`term*` where supported), `noExplode` (for MeSH), and `vocab` (a controlled
  MeSH descriptor).
- **Filters** — `dateFrom` / `dateTo` (YYYY or YYYY/MM/DD), `languages[]`, `pubTypes[]`.

You can build this in the search builder UI, or paste a strategy and let it parse into
concepts/terms. Per-source caps are optional (defaulting to the admin `defaultResultCap`,
bounded by each provider's `maxCap`).

**Validate before you run:** `POST /api/pecan-search/projects/:projectId/validate`
(`validateCanonical`) returns `{ ok, errors[], warnings[] }` — e.g. "The query has no
search terms", or a warning that a date isn't a recognised YYYY/MM/DD value.

---

## 2. Inspect the source translation

Different databases speak different query languages. Before running, see exactly what
each source will execute: `POST …/translate` returns, per selected provider:

```
{ query, queryHash, warnings[], supported[], unsupported[], assumptions[], hasOverride }
```

- **`query`** — the exact provider string (e.g. a PubMed term string, a Europe PMC
  Lucene expression, a Crossref params object). This is the query that will be stored and
  reported.
- **`warnings`** — anything the engine had to approximate or drop. The engine **never
  silently weakens** a query — if a field or operator isn't supported by a source, you get
  a warning. Examples:
  - Crossref / OpenAlex / ClinicalTrials.gov approximate strict Boolean (relevance-ranked
    or free-text) → warned per concept.
  - DOAJ drops wildcard truncation and caps at 1000 records → warned.
  - PubMed can't truncate a quoted phrase → warned.
  - MeSH has no native tag in several sources → best-effort + warned.
- **`assumptions`** — explicit choices the connector made (e.g. PubMed searches DOI via
  the `[AID]` field).
- **Manual override:** if you need a hand-tuned source query, supply an `override` string;
  it is used verbatim, `hasOverride` is set, and the override is recorded with who set it
  (`PecanSearchSource.overrideById`).

Always read the per-source `query` + `warnings` before a real run — this is what makes the
search reproducible and reviewer-defensible.

---

## 3. Interpret count previews

`POST …/preview-count` returns, per provider, a `{ count, kind, at }`:

- **`kind: 'exact'`** — the provider reported a precise hit count (PubMed, Europe PMC,
  ClinicalTrials.gov, Crossref, DOAJ, OpenAlex).
- **`kind: 'estimate'`** — an approximate corpus-match count (Semantic Scholar's `total`).
  Treat it as a ballpark.
- **`kind: 'unsupported'`** — the source can't preview a count for this query.
- **`kind: 'unavailable'` / `count: null`** — the live call failed (network/quota/disabled
  or the circuit breaker is open). Retry shortly.

Previews are debounced and briefly cached server-side (5 min) so rapid typing never floods
a provider. Use previews to right-size your strategy and your per-source caps before
committing to a full run — a count of 40,000 against a 2,000 cap means you'll only retrieve
the first 2,000.

---

## 4. Run a search

Start the run: `POST …/runs` with `{ name, canonicalQuery, sources[], caps }`. A run:

- Validates the query and resolves your selected sources (unavailable/unimplemented/
  disabled sources are dropped **with a warning** in the run's `warnings`).
- Lands results into the project's linked screening project (created automatically if it
  doesn't exist) — results flow straight into your normal screening flow.
- Returns `202` with the run summary (`state: queued`) and starts immediately in the
  background.
- Is **idempotent**: send an `Idempotency-Key` header (the UI does) so a refresh or a
  double-click returns the same run instead of launching a duplicate.

Requires edit access to the project (read-only members get `403`). At least one usable
source is required.

---

## 5. Interpret progress

The run streams live updates (`search.run.progress` SSE) so the workspace updates without
refreshing. You'll see:

- **Run state:** `queued → running → completed` | `partial` | `cancelled` | `failed`.
- **Per-source stage:** `queued → validating → counting → fetching → normalizing →
  deduplicating → importing → … → completed` (or `partial` / `failed` / `skipped`).
- **Live counts per source:** raw retrieved, normalized, imported (net new), existing
  matched, exact/fuzzy/ambiguous duplicates, failed records, and whether the cap was
  reached.

Closing the tab does **not** stop the run — it keeps going server-side, and a worker
restart resumes each source from where it left off (no double-imports).

**Controls:**
- **Cancel** (`POST …/runs/:runId/cancel`) — a durable intent observed between pages; the
  run finalizes as `cancelled`.
- **Retry** (`POST …/runs/:runId/retry`) — re-runs only the `failed` / `partial` sources,
  resuming from their cursor. Safe to repeat; completed sources are skipped.

**Honest partial success:** if one source fails (e.g. a provider outage) but others
succeed, the run is `partial`, not `failed` — you still get every result that came back,
and you can retry just the failed source.

---

## 6. Review duplicates

P1 deduplicates with PecanRev's existing **explainable** engine (the same `scorePair` /
`classifyPair` used in screening) — precision-first, because a wrong merge could hide an
eligible study.

Outcomes are applied automatically except the genuinely ambiguous ones:

- **Auto-handled (no action):** records sharing a DOI/PMID identity, exact in-run
  duplicates, and high-confidence (PROBABLE) fuzzy duplicates are merged automatically and
  counted as "duplicates removed". Records already in your project are matched and not
  re-added.
- **Needs your review (ambiguous):** POSSIBLE / RELATED / FAMILY pairs (e.g. preprint ↔
  journal version, erratum, secondary analysis) are **landed as distinct records** and
  queued for review — never silently merged.

Review them: `GET …/runs/:runId/duplicates` lists each pending pair **side-by-side** with
the explainable breakdown — the match score, `matchType`, the reasons it matched, and the
conflicting fields. For each pair, resolve with `POST …/duplicates/:decisionId/resolve`:

- **merge** — group the two via the standard screening duplicate model
  (`ScreenDuplicateGroup`), so it shows up in the normal Duplicates view and counts toward
  "duplicates removed".
- **keep_separate** — they're genuinely different studies.
- **defer** — decide later.

Because merges reuse the existing screening duplicate model, duplicate uncertainty never
leaks into your screening decisions/conflicts.

---

## 7. Understand the PRISMA impact

Every retrieved record is tracked so your PRISMA 2020 identification numbers are exact and
derive from stored data (`server/pecanSearch/report.js`):

- **Records identified** = total raw records retrieved across all sources (before
  deduplication), broken down **by source**.
- **Duplicates removed** = exact + auto-merged fuzzy duplicates.
- **Already in project** = records that matched a pre-existing project record (matched, not
  re-added).
- **Records to screening** = net new records that entered screening.
- **Ambiguous (review)** = ambiguous duplicate pairs awaiting your decision (informational
  — they were landed, pending review).
- **Failed records** = malformed records skipped (a single bad record never stops a run).

These reconcile exactly: per-source counts roll up into the run, and "to screening" =
"identified" − duplicates removed − existing matched (with ambiguous landed but flagged).
The numbers feed the project's PRISMA flow just like file-imported records.

---

## 8. Export the search report (PRISMA-S)

`GET …/runs/:runId/report` returns the full PRISMA-S–oriented report object: search name,
run date (ISO-8601 UTC), who ran it, the database-neutral canonical strategy, the engine +
deduplication method, and **per source**: the exact executed query + its hash, any
translation warnings, the cap and whether it was reached, preview count, retrieved /
imported / existing-matched / duplicates-removed / ambiguous-pending / failed counts, and
status.

Export it: `GET …/runs/:runId/report/export?format=…`:

- **`json`** — the structured report (default; download).
- **`csv`** — per-source table with a metadata header (spreadsheet formula-injection
  guarded).
- **`html`** — a self-contained, print-friendly PRISMA-S report (all text escaped) you can
  save as PDF and attach to your manuscript / PROSPERO record.

Because every count derives from persisted run data and the **exact executed query is
stored per source**, the report is fully reproducible — exactly what PRISMA-S and peer
reviewers expect.

---

## 9. Use file import for licensed databases (RIS / BibTeX / NBIB)

Not every database can be searched via API — many institutional / licensed databases
(Embase, Scopus, CINAHL, Web of Science, Ovid…) don't offer an open programmatic search.
For these, **export from the database and import the file** — this path is unchanged and
fully supported alongside the Pecan Search Engine.

- Supported formats: **RIS**, **BibTeX**, **NBIB**, EndNote XML, CIW, plus CSV/TXT
  (the pure parser engine `src/research-engine/import-export/parsers.js`; format is
  auto-detected by extension or header sniff).
- Imported records go through the **same** dedup + landing pipeline
  (`dedupeAndInsertRecords`) and land in the **same** screening project — so API-searched
  and file-imported records are byte-compatible, dedup against each other, and roll into
  one PRISMA count.
- Record the database name + the executed query + date in your report so file-imported
  sources appear in your PRISMA-S documentation alongside the API sources.

Workflow: run the open sources via the Pecan Search Engine, export your licensed databases
to RIS/BibTeX/NBIB and import them into the same project, then screen and report on the
combined, deduplicated set.

---

## Quick reference — endpoints

| Action | Endpoint |
|--------|----------|
| Provider catalogue | `GET /api/pecan-search/providers` |
| Validate query | `POST …/projects/:projectId/validate` |
| Translate per source | `POST …/projects/:projectId/translate` |
| Count preview | `POST …/projects/:projectId/preview-count` |
| Start run | `POST …/projects/:projectId/runs` |
| List runs / get run | `GET …/runs` · `GET …/runs/:runId` |
| Cancel / retry | `POST …/runs/:runId/cancel` · `POST …/runs/:runId/retry` |
| Duplicates list / resolve | `GET …/runs/:runId/duplicates` · `POST …/runs/:runId/duplicates/:decisionId/resolve` |
| Report / export | `GET …/runs/:runId/report` · `GET …/runs/:runId/report/export?format=json\|csv\|html` |

## See also
- `PROVIDERS.md` — which databases are available and how they translate.
- `ARCHITECTURE.md` §6 (dedup), §8 (PRISMA counts).
