# Search Builder ⇄ PICO Sync — SE2 Final Report

**Version:** 3.25.1 · **Scope:** Search Builder engine only (no monolith/Protocol/PICO,
Screening, Extraction, RoB, GRADE, PRISMA, Analysis, Project Control, permissions,
dashboard, or Ops Console edits). Flag-gated behind `searchEngine` (default OFF).

## Root cause found

The Search Builder seeded concepts with `picoToConcepts(pico)`, which grouped by **medical
family** (e.g. "type 2 diabetes", "heart failure") and **only for non-empty fields** — so
the five fixed PICO-field cards never appeared, empty fields produced nothing, and there was
no Time Frame field at all. On mount, `if (saved && saved.concepts)` adopted any saved
state, including a truthy-empty `[]`, and **never re-seeded from PICO** ("blank state shadows
the PICO concepts"). PICO changes only flipped a `picoDirty` flag behind a manual
"+N suggestions" button — sync was opt-in, not automatic. Net: no five-group default, no
Time Frame, and PICO edits didn't reliably reach the builder.

Fix: a single **idempotent, field-grouped** sync (`syncSearchBuilderFromPico`) that always
materialises the five PICO groups and is safe to run on mount and on every PICO change.

## What changed

- **Field-grouped, idempotent sync.** New pure `syncSearchBuilderFromPico(pico,
  existingConcepts, ignored)` always returns the five canonical groups (stable `picoField`
  key `P/I/C/O/T`) followed by the user's manual concepts. Each P/I/C/O group is populated by
  flattening that field's extraction (family ladders + synonyms) into one deduped term list,
  minus hidden/deleted terms. Time Frame carries the restriction as a `note` (no keyword).
- **Init no longer adopts blank state.** On mount the tab loads saved state then **always**
  runs the sync, so the five groups exist and are populated even over a blank/legacy save.
- **Automatic PICO sync.** A `picoKey` effect (now including the Time Frame fields) re-runs
  the sync whenever any PICO field changes — no manual button. The editor sees it immediately;
  collaborators converge via the monolith's existing `project.updated` refetch (their `pico`
  prop changes → same effect runs) and via the SE1 `search.updated` poke.
- **Preservation.** Manual concepts (no `picoField`) and manual terms are kept; auto terms the
  user converted to MeSH survive even if no longer extracted; hidden terms (in `ignored`) are
  never re-added (restored only via "Reset suggestions"); existing term/concept ids + MeSH
  `vocab` are reused; SE1-era family concepts are **migrated** into the five groups.
- **UI.** The five PICO groups are non-deletable (only manual concepts show ×), carry a
  "PICO" badge, and the Time Frame group shows "⏱ Time restriction: …" (or a hint to set one).
  MeSH suggestions attach per term, so they land under the correct PICO group.

## Files changed (Search Builder only)

**Frontend**
- `src/research-engine/searchBuilder/searchState.js` — new `syncSearchBuilderFromPico`,
  `extractFieldTerms`, `timeframeLabel`, `conceptFieldKey`, `PICO_FIELD_DEFS` (+ existing
  SE1 helpers). Pure, network-free.
- `src/features/searchBuilder/SearchBuilderTab.jsx` — init + auto-sync rewired to the new
  function (`syncFromPico`/`lookupAuto`); removed the opt-in `picoDirty`/"+N suggestions"
  path; per-field MeSH lookup; Time Frame note; non-deletable PICO groups; "Reset
  suggestions" re-syncs.

**Backend / data model / realtime:** unchanged. The SE1 contract already covers it
(revision-aware `getSearch`/`putSearch`, `search.updated` poke, `updatedBy`). The concept
shape gains additive `picoField` and optional `note` (Time Frame); persisted document shape
`{concepts, overrides, ignored}` is unchanged.

## Real-time sync

Reuses the existing infrastructure end-to-end (no new channel):
- PICO edit → monolith saves PICO + emits `project.updated` → every collaborator's monolith
  refetches the project → their `pico` prop changes → the tab's auto-sync effect runs.
- Search Builder change → debounced autosave (revision-aware) → `search.updated` poke →
  collaborators refetch and adopt when idle (SE1 `remoteAdoptDecision`). Idempotent sync means
  PICO-driven and poke-driven updates converge to the same five-group result.

## Tests added/updated

`tests/unit/searchState.test.js` (+14, now 30): five default groups (incl. empty PICO),
field→group mapping, connector/filler words excluded, Time Frame note, idempotent/no-duplicate
re-sync, hidden terms stay hidden, manual concepts preserved, manual terms preserved,
MeSH-converted term preserved, SE1-era migration, PICO-edit-updates-only-that-field,
`extractFieldTerms`, `timeframeLabel`, `conceptFieldKey`. No live NLM in CI (extraction pure).

## Build / test result

- `npm run test:unit`: **1247 passed / 1 failed** (75 files). Search suites green:
  `searchState` (30) + `conceptExtraction` (18) + `searchEngine` (10).
- `npm run build` (vite): **success**. Edited JSX also esbuild-transform-checked
  (`SearchBuilderTab.jsx` is rendered via `SearchDispatcher` in the monolith, gated by the
  `searchEngine` flag).
- **Pre-existing failures (unchanged, not from this work):** 6 files fail to load
  `@prisma/client` (Prisma client not generated under Prisma CLI 7.8.0 + no `DATABASE_URL`)
  and 1 `emailService` assertion (optional `nodemailer` not installed). None touch Search
  Builder.

## Acceptance criteria

All met: opening the Search Builder shows Population, Intervention/Exposure, Comparator/Control,
Outcomes, and Time Frame as concepts; each P/I/C/O group holds its own extracted keywords;
MeSH attaches per group; editing PICO updates the matching group without a page refresh; no
duplicate terms on repeated open/sync; manual concepts and terms are preserved; hidden PICO
terms don't reappear; collaborators see updates without refreshing; features outside the
Search Builder are untouched.

## Version / commit / push

- Version: 3.25.0 → **3.25.1** (patch — corrective fix, per SE2 + repo convention).
- Commit: see `fix(search-builder): sync PICO concepts and extracted terms`.
- Push: see status below.

## Known limitations

- **Within-field OR.** Per SE2's UI spec, all of a field's terms live in one group (OR'd).
  A field naming two distinct concepts ("T2DM with HFrEF") ORs them rather than ANDing; users
  who need AND can split via **Add Concept**. Syntax renderers are unchanged.
- **MeSH** stays heuristic/server-proxied; never called from CI (mocked via `props.api`).
- **Same-user PICO→Search update** happens on tab switch (Protocol and Search are separate
  tabs; the Search tab re-syncs on mount) — not a page refresh. Live in-place update applies
  to collaborators viewing the Search tab while another edits PICO.
- **Last-write-wins** on the whole-document save (revision + lastSaved guard prevent
  self-clobbering/ping-pong); idempotent sync makes concurrent syncs converge.
- **Time Frame presets** label map is duplicated in `searchState.js` (mirrors
  `features/protocol/constants.js`) to keep the engine free of a `features/*` dependency.

## Recommended next steps

1. Component/integration test for the mount→sync→autosave→poke loop (needs jsdom +
   `@testing-library/react` + a fake `EventSource`, not currently in devDependencies).
2. Optionally apply the Time Frame restriction as a real date filter on generated queries
   (e.g. PubMed `("2015"[Date - Publication] : "3000"[Date - Publication])`) — today it is
   informational only.
3. When clustering, back the SSE bus with a broker (Redis pub/sub) for instant cross-instance
   sync; the load-on-mount path remains the fallback.
