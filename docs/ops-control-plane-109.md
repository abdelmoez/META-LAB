# Ops Console Control Plane — 109.md

Implementation report for `.claude/Prompts/109.md`. Version **4.14.0**.
Builds on docs/screening-extraction-107.md and docs/interaction-history-108.md.

## 1. What was inspected first

Three parallel investigations mapped: the Ops Console (one 9,272-line AdminConsole.jsx, 19
sections, server-authoritative `getConsole` section list, one-bit admin/mod authorization with
an unused `requirePermission` seam), the settings substrate (a single `SiteSetting` JSON
key/value table read through merge-under-defaults getters, whole-blob PUTs auditing only key
names), the flag system (28 booleans in one row, unvalidated whole-blob PUT, a hand-maintained
FLAG_META list already drifted from the server graph, `featureAccess()` giving flag-off =
admin-only existence-hiding), and the governed 107/108 systems' knobs, jobs, and audit trails
(keyword ops wrote NO audit rows; DUP_CFG is env-frozen; no undo/redo telemetry exists).

## 2. Architecture: organize the substrate, don't replace it

- **Typed settings catalogue** `src/shared/opsSettingsCatalog.js` (pure, shared client+server):
  every governed setting/flag declared once with type, default, clamp/options, category,
  danger class (`safe | guarded | scientific | env`) and source (`database | environment |
  hardcoded`). The catalogue DRIVES server coercion, the Ops UI rendering, per-setting
  before/after audit diffs, and the flag UI list — ending the FLAG_META three-copy drift
  (server FEATURE_DEPS, client mirror, and the UI now share the same frozen objects).
  `scientific`/`env` entries carry no writable storage path — read-only **by construction**.
- **Storage unchanged**: a new `researchGovernanceSettings` SiteSetting row (merge-under-
  defaults, additive); NO new settings tables.
- **Audited writers**: settings PUTs record per-key before→after diffs plus an optional
  admin-supplied `reason` (the previously-unused AdminAuditLog.reason column — now also
  surfaced by the audit read API); feature flags gained a validated single-key
  `PATCH /api/admin/feature-flags/:key` (read-merge-write, so two admins can't clobber each
  other) while the legacy whole-blob PUT is now validated and diff-audited.
- **Scientific-integrity line (109 §2)**: the proportion compatibility gate has NO off switch
  (rationale in its catalogue entry, pinned by test); dedup thresholds (MAX_BLOCK,
  MAX_COMPARISONS, titleThreshold) render read-only as scientific; no Ops action can
  bulk-classify legacy proportion rows; enum internal keys are immutable, labels display-only.
- **Env honesty (109 §45)**: the nine `SCREEN_DUP_*` worker knobs and `EXTRACTION_LLM_*`
  render as "Managed by environment" badges showing the RUNNING values (never secrets), and
  `server/.env.example` now documents them.

## 3. New capabilities

- **Feature flags for the 107/108 features, all defaulting ON** (upgrading cannot regress
  shipped behavior): `keywordSuggestions`, `abstractKeywordShortcuts` (feeds the guard chain's
  `canHandle` — never bypasses it), `keywordContextMenu`, `projectUndoRedo` (off = pre-108
  behavior; stacks preserved for in-session re-enable).
- **Research Governance section** (`research`, admin-only; extracted package
  `src/frontend/pages/admin/research/` — not inline in AdminConsole): five sub-tabs —
  Duplicate Detection (job health, queue chips, sanitized failures, env-badged worker config,
  filtered/paginated job table, requeue with required reason + confirm), Keywords (governance
  settings + the new keyword audit feed), Extraction & Analysis (read-only scientific display
  + safe knobs), Interaction (navigation/history knobs, documented shortcut map, honest
  no-telemetry states), Client Errors (bounded crash-beacon feed + capture stats). Plus a
  settings search across the whole catalogue and reset-to-defaults with preview.
- **Duplicate-job admin API**: list/health/detail/requeue under
  `/api/admin/research/duplicate-jobs*`. Requeue reuses the worker's recovery semantics
  byte-for-byte (attempts NOT reset; live jobs refused; CAS-guarded), is audited with reason
  and previousStatus, and never leaks cpuMs/heapUsedMb or import content (allow-listed stats).
- **Keyword audit**: `keywordOps` now writes ScreenAuditLog rows for every mutation
  (ADDED/REMOVED/MOVED/SUGGESTION_ACCEPTED/REJECTED/DECISION_CLEARED/UNDO/REDO); history
  executors send `via: 'undo'|'redo'`. The screening audit read API gained real pagination +
  filters (the old handler loaded 200 rows unpaginated — 109 §24 forbade that).
- **Client-error capture**: `POST /api/client-errors` now persists bounded, deduped
  `ClientErrorReport` rows (additive table, four-place Prisma checklist; 5000-fingerprint cap)
  fed by a new client reporter (undo/redo persistence failures, autosave 409s, stale-mutation
  refusals; ≤500-char redacted messages, fire-and-forget). Health cards render honest
  "capture-only, no telemetry" states rather than invented metrics (109 §46).
- **Capability seam (109 §39)**: the dormant `requirePermission` middleware now guards the
  new routes — `view_research_diagnostics` (admin + mod) vs `manage_research_jobs`
  (admin only). Mods hold API view access but no sidebar entry (documented asymmetry).
- **Client wiring**: every writable catalogue knob is consumed via one cached
  `publicOpsSettings()` reader with shipped-behavior fallbacks — batch size, navigation
  toggles, suggestion caps/stop-lists/conflict behavior, history cap, toast timing, redo and
  the Ctrl+Y alias, percent decimals, override policy. At catalogue defaults, behavior is
  byte-identical to v4.13.0 (two catalogue defaults were corrected in-round to preserve
  exactly that: Ctrl+Y stays a redo alias; the suggestions panel stays collapsed).

## 4. Verification

| Command | Result |
|---|---|
| `npm run test:ci` | **461 files / 7917+ tests passed** (7703 at v4.13.0) |
| `npm run lint` / `npm run build` | clean |
| `npm run test:integration` (live server) | **98 files, 853 passed / 9 skipped** — incl. both 109 files (31 tests) with admin-gated cases exercised live |
| e2e (ops + research-governance + screening undo/keyword chords + visual baseline) | see the commit message for the executed run result |
| Postgres drift gate + four-place schema checklist | green (`ClientErrorReport` migration hand-written) |

Live-verified during implementation: keyword audit ledger end-to-end, real failed-job requeue
picked up by the worker, beacon dedupe (3 POSTs → 1 row count:3), flag PATCH round-trip,
public payload shape.

## 5. Known limitations

1. Mods have `view_research_diagnostics` at the API but no `research` sidebar entry; granting
   it needs getConsole + write-control hiding in the tabs.
2. Force-rerun of duplicate detection (§9) is not implemented — requeue revives failed/stuck
   jobs only; a deliberate rerun needs its own confirmation flow. Requeue is now
   cancellation-safe: a job carrying `cancelRequested` is refused with 409
   `JOB_CANCEL_REQUESTED` and the writer no longer clears the flag, so Ops cannot override a
   researcher's cancel. Resuming a cancelled run therefore has no path today — it is exactly
   the missing force-rerun flow above.
3. No shortcut conflict detector (§16): the router inventory covers the four routed bindings;
   per-user screening keys and unrouted Escape/FocusMode handlers are documented, not modeled.
4. `analysis.allowCompatibilityOverride` / `requireOverrideRationale` are client-enforced only
   (the override write is a blob mutation; a determined API caller bypasses policy).
5. ClientErrorReport still has no time-based retention job, but the row cap is now EVICTIVE
   rather than terminal: at `CLIENT_ERROR_MAX_ROWS` the oldest-`lastSeenAt` rows are deleted
   to make room, so a full table degrades to a recent-failures window instead of permanently
   dropping every new fingerprint. The beacon stays unauthenticated (userId null) by design —
   a crashed shell has no session to offer — and an unauthenticated report may only evict rows
   that are themselves unauthenticated, so anonymous traffic cannot displace a crash captured
   from a signed-in researcher. The fingerprint excludes the per-report `correlationId` (it is
   kept in `context` as an exemplar), so repeats genuinely collapse onto one row; rows written
   before this change carry poisoned single-use fingerprints and simply age out via eviction.
6. §28 legacy-classification counts have no server aggregate; the card says so.
7. Flag flips still propagate by reload semantics (5s public-settings cache; no SSE broadcast
   channel exists) — documented, not claimed otherwise.
8. The "prevent duplicate activation" half of `conflictBehavior` relies on the pre-existing
   cross-list prompt + server reducer; no new server-side refusal was added.

## 6. Invariants (do not regress)

1. Catalogue `scientific`/`env` entries must stay structurally unwritable; the compatibility
   gate never gets an off switch.
2. New-feature flags default ON; a flag key absent from the payload resolves to its catalogue
   default, never false.
3. Flag/settings writes are per-key read-merge-write with before/after audit; never revert to
   unvalidated whole-blob writes.
4. `abstractKeywordShortcuts` gates via `canHandle` inside the guard chain — never bypasses it.
5. Requeue reuses worker recovery semantics; job stats stay allow-listed; import content and
   process metrics never reach Ops responses.
6. Audit ledgers remain append-only and separate from undo history.
7. getConsole ↔ NAV_SECTIONS ↔ OpsPage POM sync is test-pinned (`opsSectionSync.test.js`) —
   keep it green when adding sections.
