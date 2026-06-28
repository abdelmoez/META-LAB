# Prompt 60 — Unify Search into one 3-step guided wizard (Define → Build → Run)

## What shipped
The two separate search tabs — **Search Builder** (`?tab=search`) and **Search & Discovery**
(`?tab=discovery`) — are collapsed into ONE guided **Search** stage with a linear 3-step
flow: **Define → Build → Run**. It is a frontend consolidation: the proven feature engines
are EMBEDDED, not rebuilt, and the backend build→run→auto-import pipeline is reused as-is.

- **Define + Build** are served by the existing `SearchBuilderTab` via a new additive
  `phase` prop (`'define'` = keyword selection + concept editor + a new **Limits** panel;
  `'build'` = choose-databases + per-database strategy with the existing manual override
  editor). `phase=undefined` keeps the standalone 5-step builder unchanged.
- **Run** is the existing `PecanSearchTab`, **pre-filled** from the live in-memory query
  (no separate "load strategy" round-trip) via new optional props
  `initialCanonicalQuery` / `initialSources` / `initialOverrides`.
- New orchestrator: `src/features/searchWizard/SearchWizard.jsx` (+ `index.js`).

## Phases
**Phase 0 — flag co-dependency (safety).** `pecanSearch` is INERT unless `searchEngine` is
also on (it runs the strategy the Search Builder produces). Enforced at the real gates:
`runService.pecanSearchEnabled()` (server, every `/api/pecan-search` endpoint) and
`pecanSearchFlagEnabled()` (client) now require BOTH flags. Ops/AdminConsole adds a visible
"requires Search Builder Engine" note + an "⚠ Inactive" warning when `pecanSearch` is on but
`searchEngine` is off. Both flags stay independently togglable (tests unaffected; backend is
the authority).

**Phase 1 — the 3 dead handoffs.**
1. `databases`: `loadCanonicalQuery` now surfaces the persisted `databases` + `readyForScreening`;
   `PecanSearchTab` seeds its `selected` sources via the new pure helper `selectSourceIds()`.
   When the user EXPLICITLY chose a database set it is **intersected** with the Pecan provider
   ids (the builder catalogue lists embase/cochrane/scopus which have no connector); when there
   is NO explicit choice it defaults to **all selectable providers** (full multi-database recall,
   not PubMed-only). An explicit choice that maps to nothing runnable also falls back to all —
   the run is never silently empty. The builder reports its RAW `selectedDbs` (empty = "not
   chosen") so the wizard can tell the two cases apart.
2. `overrides`: `PecanSearchTab` seeds per-source overrides from `query.overrides` (and from
   the wizard's `initialOverrides`), keyed by the providers that share ids (e.g. pubmed).
3. `filters`: added to the `putSearch` allowlist via the exported `sanitizeFilters()` (mirrors
   the AST clamps). The builder now owns a `filters` state, persisted through its own autosave
   (`pickPersisted` includes `filters` ONLY when non-empty → pre-filters signatures stay
   byte-identical, no spurious saves). The **Limits** panel (date range / languages /
   pub-types) writes the AST `filters` block the engine already applies per provider.

**Phase 2 — wizard + nav consolidation.**
- `SearchWizardDispatcher` (protocolTabs.jsx) replaces the two mounted dispatchers:
  searchEngine OFF → legacy `SearchTab`; searchEngine ON → the wizard, whose Run step is live
  only when `pecanSearch` (co-dependency-checked) is on, else a clear "enable in Ops" note.
- `projectHelpers.js TABS`: folded `discovery` into a single `search` stage (relabelled
  "Search"), renumbered. `?tab=discovery` redirects to `?tab=search` in BOTH shells
  (`navConfig.activeProjectStage` + legacy `Workspace.jsx` initialTab normalization), so old
  deep links never 404. Stitch `SCOPE`/lazy-mount + `StitchProjectOverview` grouping updated;
  `stepperModel STEP_DESC.search` → "Build and run your multi-database search".

**Phase 3 — UX + tests.** Stitch-native wizard chrome (`--t-*` tokens), 3-step progress
header, honest on-demand per-source estimates in Build (graceful when pecan off), closing CTA
on completion → `?tab=screening&screen=import`. The embedded builder stays MOUNTED (hidden)
during Run so its autosave completes and the strategy is preserved on step-back.

## Tests
`npm test` green (2969 passed; the only failures are pre-existing/environmental — an untracked
Playwright spec mis-collected by vitest and two live-server reachability guards). Production
build green. New/updated coverage:
- `searchState.test.js` — `normalizePersistedFilters` + filters round-trip / signature stability.
- `searchEngine.test.js` — `sanitizeFilters` allowlist clamps/caps.
- `pecanSearchTab.test.jsx` — flag co-dependency, `loadCanonicalQuery` surfaces databases,
  `selectSourceIds` db-id↔provider-id intersection + fallbacks.
- `stitchNavRedesign.test.jsx` — workflow counts (18/15), `?tab=discovery`→`search` redirect,
  one-entry Search submenu.
- `stitch55Categories.test.js` — Search is now a single destination.
- `searchWizard.test.jsx` — NEW SSR smoke (3-step chrome + embedded builder).

## Out of scope (unchanged)
AST, connectors, dedup engine, durable worker, `dedupeAndInsertRecords`,
`resolveLandingProject`, `createLinkedScreenProject`, `report.js`, the do-not-edit per-database
syntax renderers. No new connectors (databases without one remain "copy & run externally").
No Prisma migration (filters are JSON in `WorkflowModuleState`).

## Operator / follow-ups
- To use the full flow, enable BOTH `searchEngine` and `pecanSearch` in Ops › Feature Flags.
- Manual verification (recommended on a running instance): Define → Build (auto AND manual) →
  Run → records land in Screening with the "Pecan Search" badge + live PRISMA, in BOTH legacy
  and Stitch; and the graceful Run note with `pecanSearch` off.

## Post-review fixes (adversarial review, applied before the second push)
- **Recall (MEDIUM):** the default Run pre-selection no longer collapses to PubMed-only — with
  no explicit database choice it pre-selects ALL connector-backed providers (`selectSourceIds`
  now defaults to all selectable; the builder reports raw `selectedDbs`; BuildEstimates estimates
  across all providers when nothing is explicitly chosen).
- **Reactivity (LOW):** the wizard's "Run" CTA gate moved from a render-time ref read to a cheap
  `hasConcepts` state (kept out of the builder memo deps); the Run step pip now respects the same
  gate as the footer button.
- **Cleanup (LOW/NIT):** the orphaned `SearchDispatcher` + `DiscoveryDispatcher` were removed
  (and their now-unused imports trimmed); stale comments/test fixtures referencing the retired
  `discovery` stage were corrected.
