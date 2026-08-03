# Search Builder Boolean workspace + portable Screening export (97.md) — implementation report

Date: 2026-08-02 · Version: v4.4.0 · Builds on the 96.md overhaul (docs/search-overhaul-96.md).
Planning document (97 Phase 1, all 20 sections): docs/manager/search-builder-workspace-and-screening-export-plan.md

## 1. Investigation findings

- **Root cause of silent Search Builder overwriting: already eliminated by 96.md.**
  `syncSearchBuilderFromPico` has zero production callers (retired-effect comment in
  SearchBuilderTab; seeding happens only at revision 0 from the research question;
  PICO fields are never read by the builder). 97's Phase 3 therefore reduced to
  *metadata tracking* (generated/manually-modified provenance), which is now stored.
- Screening previously had per-format sync exports (CSV/JSON/RIS) with a frozen
  append-only column contract and blind-mode ordinal anonymization; no ZIP, no
  structured backup, no README, no partial-failure model.

## 2. Screening export (Phase 2)

`Screening → Export` gains **“Download screening file (ZIP)”** — an async job
(reuses ScreenExportJob + worker; legacy per-format exports untouched):

- `references-and-screening-decisions.csv` — NEW pinned append-only schema v1
  (32 base columns + stage-explicit `reviewer_N_ta_*`/`ft_*`/`note` families;
  best-effort volume/issue/pages/URL via provenance join + guarded rawData parse).
- `references.ris` — new `renderRisRecord` (TY/TI/AU/JO/PY/VL/IS/SP/EP/DO/AN/UR/AB/KW);
  screening state deliberately excluded from RIS.
- `screening-backup.json` — schemaVersion "1", streamed per-table (records,
  decisions, conflicts, duplicates, eligibility, import batches, handoff, project
  metadata, timestamps, stable ids); **full blind-mode ordinal remapping** including
  conflict `reviewerDecisions` keys, `resolvedBy`, eligibility assessments, import-batch
  importers, and the exporter identity itself.
- `README.txt` — project-specific file map, what transfers where, no
  universal-compatibility claims, versions; `EXPORT-WARNINGS.txt` on optional-format
  failure (core = CSV+JSON+README; RIS optional; job stays completed with a
  non-blocking amber warning in the UI).
- Zero-dependency `server/utils/zip.js` (STORE + CRC-32 + raw DEFLATE via node:zlib,
  sink-streamed member-at-a-time; >4 GB fails loudly — ZIP64 unsupported by design).
- Filename `project-title-screening-export-YYYY-MM-DD.zip` (cross-OS sanitizer).
- Permissions: existing chain reused verbatim (admin toggle, tier entitlement,
  canExportRecords, creator-only artifacts); `SCREENING_EXPORTED` audit rows.
- Bounded memory: all reads cursor-paged (1000/page); verified on a 2,300-record
  project; per-member transient Buffer documented as the scale ceiling.
- Schema: additive `ScreenExportJob.warningCount/warnings` + committed Postgres
  migration `20260802000000_screening_export_zip_warnings`.

## 3. Search Builder (Phases 3–16)

- **Manual-authoritative state**: one new whitelisted persisted key `meta`
  {generatedAt/By, sourceQuestion, manuallyModifiedAt/By} wired through all six
  byte-stability touch points (pre-97 saves keep byte-identical signatures);
  stamped on every manual mutation. Drift banner remains informational only.
- **Explicit Regenerate**: toolbar button + verbatim Phase-4 confirmation dialog;
  snapshot-FIRST via the versions service (“Before regeneration”; aborts with an
  error and zero state change if the snapshot fails); regenerates neutral
  `Search Group N` groups from the research question (never PICO-labeled;
  `source:'generated'`); “Search strategy regenerated. Undo” toast (whole-state
  undo); `SEARCH_REGENERATED` audit; visible in version history; saved with
  `baseRevision` strict CAS (stale writers get 409 + reconcile-adopt-newer).
- **Select & Build Key Terms** (renamed first workspace tab, stage id unchanged):
  question tokens click/Shift-click-span/drag-onto-token combine (distinct merge
  ring + hover threshold + Esc; insertion-line reorder is a separate affordance);
  “Combined into “…” — Undo” toasts; phrase edit + split (recorded component
  boundaries; safe line-per-part manual split for edited phrases; editing a
  controlled term honestly converts it to free text).
- **Boolean workspace**: neutral `Search Group N` headers (rename inline), explicit
  OR separators between chips and AND connectors between groups, live preview;
  group add/delete/reorder/merge/split all undoable; chip drag between groups
  moves (never clones; explicit Copy action) preserving id/type/vocab/source/
  overrides; drop on “＋ New group” creates a group; every drag gesture has a
  keyboard/menu equivalent; the old silent term-loss on move-to-duplicate is fixed
  (blocked with “Find existing term”).
- **Exact duplicates** (chip-integrated; Quality Check card removed): new
  conservative shared normalizer (case, whitespace, straight/curly surrounding
  quotes — the spec's exact/not-exact matrices are unit-pinned); cross-AND-group
  duplicates mark EVERY affected chip dark-red with icon + verbatim tooltip +
  SR label + focus-visible (never color alone) and a menu: find other (scroll+
  focus), move, remove, keep-both-intentionally (persisted, auto-reevaluated when
  the term/group config changes), dismiss; same-OR-group duplicates are prevented
  at every add path with “Find existing term”; family-equivalent terms show a
  soft non-blocking “Possible variant” instead.
- **MeSH** (Phase 13): exact vocabulary wording everywhere (“Subject heading
  suggested” retired); individual `"X"[MeSH]` chips; hover/focus details popover
  (preferred term, scope note, entry terms, tree, identifier, explode as
  “Include narrower indexed terms”, source) with zero new network calls; bulk
  accept-all removed — entry terms/synonyms are added ONLY via per-term
  “Add this term”; low-confidence suggestions marked and never auto-added.
- **Undo**: 9 new inverse kinds (move/copy/rename/add-concept/combine/split/
  dup-override/regenerate/restore) + guarded global Ctrl/Cmd+Z
  (never fires while typing in any input/textarea/contentEditable).
- **Migration** (Phase 15): idempotent legacy-label migration converts canonical
  P/I/C/O/Time-frame group names to `Search Group N` (custom names preserved,
  `labelMigrated` marker, internal picoField retained for hash/drift/rejection-key
  stability); converts + autosaves exactly once on first open; version snapshots
  restore correctly; fixture archetypes extended to prove byte-stability.
- **Collaboration** (Phase 16): canonical state server-backed (no new
  localStorage); optimistic UI + save states; `baseRevision` on all full-state
  PUTs → strict CAS 409 → adopt-newer reconcile (“A collaborator updated this
  strategy — your view was refreshed”); blank-over-valid impossible; single-key
  writers unaffected.

## 4. Testing

- Hermetic unit + screening unit: **381 files / 5,948 tests green** (57 new export
  tests; ~120 new/extended builder tests incl. the spec's verbatim duplicate
  matrices, migration archetypes, regeneration flows, undo inverses).
- Integration (live server, serialized): **93 files / 787 passed / 9 skipped, 0 failed**
  (new: export-ZIP job flow, live-HTTP permission matrix incl. creator-only 404 +
  sync-zip refusal, full-archive blind-leak scan, injected RIS failure, 2,300-record
  streaming).
- E2E (Playwright chromium, quiet single-worker): see §7 — all search/screening/
  export journeys green; the 6 documented pre-existing failures (see
  docs/search-overhaul-96.md §6, verified by reverted-tree reruns) remain the
  baseline evidence for unrelated areas.
- No live external MeSH/NLM calls in unit/integration tests (nlmClient fully
  mocked; the pre-existing e2e suggestion journey exercises the live backend by
  design and is documented).

## 5. Known limitations

1. BibTeX export deferred (no writer exists in the repo; 97 marks it optional).
2. ZIP64 unsupported — >4 GB archives fail loudly rather than corrupt.
3. A failed ZIP job consumes one export-allowance unit (pre-existing enqueue-
   reservation policy, documented).
4. Source-sentence tokens don't drag-reorder (the question's word order is fixed);
   reorder lives on group chips — plan-documented decision.
5. Cross-group combine-by-drag is intentionally not offered (move, then combine).
6. Regeneration derives from the research question only (PICO no longer feeds the
   builder post-96; plan Decision R1).
7. Touch: navigator pills use `touch-action:none` during drag; scrolling that row
   uses surrounding whitespace (menu alternatives cover all actions).

## 6. Deployment

`git pull` → Postgres: `npm run db:migrate:deploy:postgres` → `npm run
db:generate:postgres` (dev SQLite: `npx prisma db push`) → `npm run build` →
restart via PM2. No new workers; no cache invalidation; no flag changes.

## 7. Verification results (final)

- **Adversarial QA**: 7 independent reviewers, 68 findings — all 3 high and all 36
  medium fixed (revision-race redesign, regenerate hardening, undo/edit gaps,
  type-aware duplicate keys, MeSH popover/terminology, true ZIP streaming,
  export e2e journey); 29 lows: export lows all fixed, rest documented here.
- **Unit + screening unit (hermetic)**: 390 files / 5,987 tests passing.
- **Integration (live server, serialized)**: 593 + 202 passed, 9 skipped, 0 failed.
- **E2E (Playwright chromium, single worker)**: search + responsive 45/45;
  screening file 13 passed / 1 documented skip (incl. the export-ZIP download
  journey verified with jszip); a11y 8, api 11, auth 15, permissions 10 (1 skip),
  visual 5 — all passing.
- **Notable root causes fixed during verification**: (a) five new drag/duplicate/
  MeSH specs were spec bugs (curated-phrase token collision, off-viewport drag
  coordinates, master-detail rendering assumption, locator aliasing) — zero UI
  bugs, gestures work under real pointer events; (b) the export-ZIP journey
  exposed a React 18 StrictMode hazard — a cleanup-only `mountedRef` pattern is
  permanently false in dev, killing the poll loop; fixed in ExportTab and in two
  other latent instances (useScreeningAi, useEligibility) that had silently made
  the AI/eligibility surfaces inert in dev.
- **Pre-existing e2e failures (unrelated, with evidence per Phase 19)**: 13
  dashboard/projects/public-synthesis specs fail from ONE environmental cause —
  the shared dev DB has accumulated ~2,750 leaked e2e projects ("E2E Tmp *"/
  "E2E *"), making `GET /api/projects` return 2,774 projects in ~4s and the
  unpaginated overview grid render ~2,700 cards past the expect timeouts. Timed
  and counted directly; the same cause (smaller then) is documented with
  reverted-tree evidence in docs/search-overhaul-96.md §6. The two extraction
  failures are likewise the 96-documented baseline. **Recommended remediation**
  (needs sign-off — bulk data mutation): soft-delete `E2E Tmp *`/`E2E *`-named
  projects in the dev DB, make e2e fixtures clean up on failure, and/or paginate
  the dashboard grid.
