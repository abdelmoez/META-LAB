# 104.md — Focus Mode + Search → Manuscript synchronization

Two application-wide features. Both are deliberately implemented in shared layers
rather than page by page, because both fail the moment two surfaces disagree.

---

## Part 1 — Focus Mode

### The shape of it

| Piece | File |
|---|---|
| State (above the router) | `src/frontend/focus/FocusModeContext.jsx` |
| Toggle + focus bar | `src/frontend/focus/FocusControls.jsx` |
| Linear step order | `src/frontend/stitch/nav/workflowSequence.js` |
| Chrome removal | `src/frontend/stitch/shell/StitchAppShell.jsx` |
| Page-header suppression | `StitchProjectWorkspace.jsx`, `StitchProjectOverview.jsx` |

### Why the state lives above the router

Focus Mode must survive navigation — 104.md's stated preference is that activating
it and clicking **Next** keeps you focused through the whole workflow. A page-local
`useState` resets on every route change, which turns the feature into the
"page-specific gimmick" the prompt explicitly rejects. So the provider sits beside
`DesignModeProvider` in `App.jsx`.

Persistence is `sessionStorage`. It survives a mid-session refresh (a reload during
deep work does not dump you back into full chrome) but not closing the tab, so
nobody is silently trapped in a chrome-less app days later.

### Opt-in, not automatic

`StitchAppShell` takes `focusable`. The project workspace and project overview opt
in; **the dashboard, profile and ops pages do not** — stripping their navigation
would leave no route out. A focused page that supplies no bar of its own gets a
default one (exit + breadcrumb), so opting a page in can never strand a user.

### Navigation is derived, never restated

`buildWorkflowSequence(ctx)` flattens `PROJECT_CATEGORIES × submenuForCategory()`
— the exact model the purple rail and white submenu render — into the linear order
a user would produce by clicking down the sidebar. Every destination is a sidebar
`href`.

Two properties fall out of deriving rather than duplicating:

- a step the sidebar disables (screening sub-pages with no linked workspace ⇒
  `href: null`) is disabled here too;
- a step behind a feature flag appears exactly when the sidebar shows it.

Permission gates live at render time in the workspace, not in the pure nav config,
so the caller passes `isBlocked`. The Analysis capability gate is wired through it.
`sequenceNeighbours` **steps over** a locked step rather than offering it — nothing
is bypassed, since a skipped step is one the sidebar would also refuse to open.

### Not remounting the engine

Two details do the work:

- the body wrapper div stays in the tree in both layouts, so toggling never changes
  the body's DOM position — React keeps the engine mounted and every piece of state
  104.md lists (form contents, editor caret, PDF position, screening position)
  survives because it is never torn down;
- the full-bleed height is derived from whichever bar is above it
  (`topChromeH = focusMode ? FOCUS_BAR_H : 57`) instead of a twice-hard-coded 57.

The rails are unmounted rather than `display:none`d — they run live subscriptions
(presence heartbeats, screening-summary polling) and they are siblings of the body,
so removing them cannot touch the workspace subtree.

### Keyboard and accessibility

- **Escape** exits. The listener is on `window` in the bubble phase, so a modal,
  popover or tooltip that handles Escape wins it first; typing targets are excluded.
- **Ctrl/Cmd+Shift+F** toggles. Not a browser default on any major platform: plain
  Ctrl+F (Find) and macOS's Cmd+Ctrl+F are both left alone. The tooltip states the
  shortcut, which is how it is discoverable.
- The icon carries a real `aria-label` (never icon-only semantics) and
  `aria-pressed`. The browser-default `title` is suppressed in favour of the
  designed tooltip, which now animates, delays on hover, appears instantly on
  keyboard focus, and supports a second hint line.

---

## Part 2 — Search → Manuscript

### One canonical source

`src/research-engine/search/searchMethodology.js` — `deriveSearchMethodology()`.

Before this, three places derived the database list independently: the Abstract, the
Methods narration, and the PRISMA-S search-strategy table. The table derived it from
the `project.search.dbs` **checkboxes**, so a manuscript could state in prose that it
searched three databases while its own appendix listed four — or list a database
that had only ever been ticked, never run.

All three now consume the one object, derived once per generation in
`composeGenOpts` and passed down as `opts.searchMethodology`.

It exposes: `databases`, `registers`, `all`, `otherMethods`, prose-ready phrases,
`firstSearchAt` / `latestSearchAt` / `searchDays` / `updateCount`, `workflow`
(`automated` | `manual` | `mixed`), `perDatabase`, `history`, and `excluded`.

### Manual searches are now real search events

`ScreenImportBatch` gained four columns:

| Column | Why |
|---|---|
| `sourceDatabase` | A file rarely says which database it came from. Without this, a hand-run Embase search was unattributable and vanished from the manuscript. |
| `searchedAt` | The date the search was **run**, not the day the file was uploaded. Searching on the 3rd and uploading on the 11th used to report the 11th. |
| `contributesToReview` | 104.md's "searches that are actually part of the review's final search methodology". An accidental or test import is flagged false: the batch, its records and its audit trail stay; the search stops being reported. |
| `exclusionNote` | Why, for the audit trail. |

Written via `PATCH /api/screening/projects/:pid/import-batches/:batchId/search`.
All four are additive + defaulted, so `prisma db push` stays safe and every existing
batch keeps counting. The loader also degrades to the legacy column set if the
database has not been migrated.

The automated side already had this concept: `PecanSearchRun.rolledBackAt`.

### The `sourceDb` fallback bug

`screeningImportService` stamped `sourceDb: r.sourceDb || r.source || format` — so
every RIS file with no per-record source stamped `sourceDb: 'ris'` on its records.
That string flows into the provenance layer and the PRISMA source rows, so a
manuscript could report that the team **"searched Ris"** — exactly the "internal
values should not accidentally appear in a manuscript" failure 104.md names.

The format fallback is gone. An empty `sourceDb` is honest and already handled
downstream: provenance drops unattributed records rather than inventing a database,
and PRISMA labels them "Unspecified source".

### Search history, and why the rollup was not enough

`deriveSearchProvenance` collapses to one record **per database**, whose
`lastSearchedAt` is its most recent search. For a Living Review that re-runs PubMed
every quarter, that is a single record — so "how many times was the search updated?"
is unanswerable from the rollup, and the earliest `lastSearchedAt` is *not* the day
searching began.

Provenance now also returns `history`: every reportable search event
(`{ at, database, label, method, origin, runId, batchId, recordCount }`), sorted.
`firstSearchAt` and `updateCount` derive from it. `updateCount` counts distinct
search **days**, not executions — one update that re-runs four databases is one
update, not four.

### The live-sync break this fixed

`computeDependencyState` fingerprinted `search.databases` and `search.date` from
`project.search.dbs` / `.date` — the settings page — while the manuscript *stated*
them from provenance. So running a brand-new Scopus search changed what the
manuscript said while leaving the fingerprints identical, and no dependent section
was ever flagged as out of date. Both now fingerprint the execution record, with the
legacy blob retained so pre-provenance projects keep their previous behaviour.

### PRISMA cross-check

`checkPrismaConsistency(methodology, flow)`, surfaced through
`checkConsistency` as check **(g)**.

Comparison is on **canonical keys**, not display strings — otherwise "PubMed",
"pubmed" and "PubMed/MEDLINE" read as three databases and the check cries wolf on
every project. Generic PRISMA labels ("Unspecified source", "Databases",
"Registers", the other-methods arm labels) are skipped: they name no database, so
they can neither confirm nor contradict.

- **Records from a source the manuscript never names** → error. This is the
  dangerous direction: the review reports fewer sources than it used.
- **A named database with no records** → warning. A search can legitimately return
  nothing, and PRISMA still requires reporting it.

It reports; it never rewrites either side.

---

## Known limitations

1. **The legacy `?ui=legacy` workspace does not get Focus Mode.** It is a
   deprecated monolith with no shared layout component, and it already has its own
   `navCollapsed` sidebar-hiding. Adding a second, differently-behaving focus
   concept there would create the inconsistency 104.md is trying to prevent.
2. ~~No UI yet for the manual-search fields.~~ **Resolved.**
   `src/frontend/screening/components/BatchSearchProvenance.jsx` adds a "Search
   record" row to every manual dataset in Import History: a canonical database
   picker (never free text — a name that does not canonicalize would be reported
   verbatim), a date-searched field capped at today and labelled "not when the file
   was uploaded", and a "Part of this review's search methodology" checkbox with an
   audit note. A live summary states what the manuscript will make of the current
   state, so the consequence is visible before saving rather than discovered later
   in the Methods section. Excluded datasets get a "Not reported" badge and keep all
   their numbers. Pecan runs do NOT get the editor — they already carry all three
   facts, and offering to override them would invite a contradiction with the
   execution record. Saves are non-optimistic: the server validates the date, so the
   row reflects what was accepted, not what was typed.
3. **`otherMethods` is read from the PRISMA other-methods arm**, so it reports
   citation/hand searching only once records with those origins exist. There is no
   separate place to declare "we hand-searched three journals" that produced nothing.
4. **`checkPrismaConsistency` needs both a methodology and a flow.** With either
   absent it returns `checked: false` rather than guessing — correct, but it means
   projects without a linked screening workspace get no cross-check at all.
5. **No backfill.** Existing import batches have `sourceDatabase: ''` and
   `searchedAt: null`, so they behave exactly as before until edited.
