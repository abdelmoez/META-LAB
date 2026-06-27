# 58.md — reliability / branding / screening hardening (implementation report)

Audit-first (8-domain parallel audit). Landed across 4 commits (`pt1`–`pt4`). No
existing project/screening/PRISMA/membership/permission data or the Stitch/legacy
switch is broken. Several tasks were already largely built — the audit surfaced that
and we completed the gaps rather than rebuilding.

## Per-task outcome

**§1 Member-count consistency** — root cause: project-list cards read the cached
`_linkedMetaSift.memberCount` (`ScreenProject._count.members`, ALL statuses) while the
Overview reads a live roster. Canonical definition now = **active accepted members
(owner included)**: `getLinkedSiftByProjectIds` counts `members where status='active'`,
the one scalar the list cards AND the Overview presence (`totalMembersOf`) read — they
can no longer disagree. `server/controllers/projectsController.js`.

**§2 Branding** — verified: every user-facing surface already says **PecanRev** (browser
title, manifest, OG/Twitter, emails, waitlist, auth/landing, the project link badge).
Remaining `Meta·Lab`/`Meta·Sift` hits are internal identifiers (cookies, localStorage
keys, routes, DB columns, permission keys, component names) + code comments, deliberately
kept per the 47.md rebrand. No change needed.

**§3/§9/§12 Upload limit** — the import pipeline was already built for scale
(`MAX_RECORDS_PER_IMPORT=200000`, `DEFAULT_MAX_RECORDS_PER_PROJECT=100000`, chunked
`createMany`, indexed-column dedup, durable async job + progress). Completed: Ops
"Screening upload limit" default raised 10k→**100,000** (min 1,000); new
**`server/screening/uploadLimit.js` `resolveScreeningUploadLimit()`** — the ONE layered
resolver (per-user → workspace → tier → global Ops → code default, clamped to the
ceiling); the import endpoint uses it (no scattered reads); future paid tiers drop in
here. `AdminConsole.jsx`, `screeningController.js`.

**§4 Done(0) stat** — the dashboard "Project completion / Done (0)" card is now a
momentum-led **"Your progress"** card: leads with "N reviews in progress" / records
screened, completed work is calm secondary context, brand-new users get "Start your
first review". `StitchDashboard.jsx`.

**§5 Delete by import batch** — `ScreenImportBatch` already exists. New
`screeningImportBatchController.js`: `GET /projects/:pid/import-batches` (history list)
and `DELETE /projects/:pid/import-batches/:batchId` (owner/admin only, type-to-confirm
the dataset name). Deletes the batch's records (decisions/conflicts/PDF/open-states
cascade via FK), cleans bare-scope AI rows by recordId, removes now-empty duplicate
groups, deletes the batch, writes an `IMPORT_BATCH_DELETED` audit entry. PRISMA/analytics
recompute LIVE from surviving records — no orphan counts. Records aren't canonicalized
across batches, so one batch's deletion can't remove another's records. **Limitation:**
the Import History UI + api-client wiring is the remaining piece (backend complete).

**§6 /sift-beta admin-only** — the 3 direct `/sift-beta` routes are now `AdminRoute`
(staff, 404-cloaked) instead of `ProtectedRoute`, matching the staff-gated entry link.
Integrated project-workspace screening is unaffected (different render path), and the
server already gates every screening API by project membership. `src/App.jsx`.

**§7 PRISMA for Pecan Search imports** — `ScreenImportBatch` now records
`preDedupCount`/`duplicateCount`/`rejectedCount`/`source` (both schemas, additive);
`dedupeAndInsertRecords` populates them for file AND Pecan imports (pipeline tags
`source=pecan-search`). The screening summary's PRISMA block now reports
`identified` = pre-dedup total and `duplicatesRemoved` = import-time + post-import
duplicates — correct for file, Pecan, and mixed sources; recomputes on batch delete.

**§8 AI score threshold** — scores are HIDDEN until ≥ threshold (**default 50**) screened
(decided) title/abstract records. SERVER-SIDE: `getAiScores` counts distinct decided
records and below threshold withholds the scores entirely (returns `{}` + metadata:
`screenedCount`, `threshold`, `belowThreshold`, `scoresHidden`, `canOverride`).
`minScreenedDecisions` added to AI global + per-project settings. **Admin override**:
`?showBelowThreshold=1` bypasses the gate for testing (admin role enforced server-side,
request-level, never persisted). Hook `useScreeningAi` exposes `{ gate, override,
setOverride }`; `aiApi.scores` passes the override flag. **Limitation:** the placeholder
UI ("17/50 screened") + the admin override button render is the remaining piece (the
gate + data are wired).

## Migrations (additive, `prisma db push` on deploy)
`ScreenImportBatch.{preDedupCount, duplicateCount, rejectedCount, source}` (both schemas).
AI settings (`minScreenedDecisions`) live in JSON, no migration.

## Tests / build
`tests/unit/uploadLimit.test.js` (+5: resolver default/global/clamp/precedence). `npm
run build` ✓ across all commits.

## Remaining limitations (for the recs round)
1. §5 Import History UI + api-client (backend done; needs a screening-tab view + delete dialog).
2. §8 below-threshold placeholder UI + admin override button (server gate + hook done).
3. Member-count: if the project list's `_linkedMetaSift` enrichment is ever absent on a fetch
   path, the card falls back to 0; the canonical active-count fix addresses the definition.
