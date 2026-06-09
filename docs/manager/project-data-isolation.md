# META·SIFT — Project Data Isolation

**Status:** Implemented (collaboration upgrade, 2026-06-08)

## The requirement (and how we interpreted it)

The original ask was for "a different database for each project, so project data doesn't become messy." Spinning up a **physical database per project** would multiply operational cost, break cross-project admin/reporting, and complicate backups for no real benefit. We implement the *intent* — projects never see each other's data — as **strict logical isolation in one application database**.

## Model: one DB, project-scoped, membership-gated

- **One SQLite database** (`server/prisma/dev.db`) via Prisma. No per-project databases.
- **Every META·SIFT row is scoped by `projectId`.** All `Screen*` tables (`ScreenRecord`, `ScreenDecision`, `ScreenLabel`, `ScreenExclusionReason`, `ScreenDuplicateGroup`, `ScreenConflict`, `ScreenImportBatch`, `ScreenProjectMember`, `ScreenChatMessage`, `ScreenPdfAttachment`, `ScreenRecordOpenState`, `ScreenAuditLog`) carry a `projectId` and cascade-delete with the project.
- **Access = ownership OR active membership.** Every project-scoped request resolves access through one seam: `server/screening/access.js → getProjectAccess(pid, user)`. It returns `null` (→ HTTP 404, no existence leak) unless the caller is the project **owner** or an **active member**. The owner is always treated as a **leader**.
- **Role/permission gates** layer on top: `leader` (full control), `reviewer` (can screen/decide if `canScreen`), `viewer` (read-only, cannot decide); plus `canChat`, `canResolveConflicts`, and `status` (`active`/`inactive`/`pending`). Inactive and viewer members cannot record decisions; non-members get 404; only leaders mutate membership/settings.

## Query discipline

- No screening query runs without first resolving `getProjectAccess` (or the legacy owner guard for owner-only mutations). Handlers translate "no access" to **404**.
- Prisma parameterises all queries (no SQL injection). `projectId` is always taken from the resolved project, never trusted from the client beyond the `:pid` used to resolve access.
- `listProjects` returns only projects the caller **owns or is an active member of**.

## Cross-table & cross-module boundaries

- The only foreign keys leaving the `Screen*` cluster are to `User`: `ScreenProject.ownerId → User.id` and `ScreenProjectMember.userId → User.id` (both cascade). No main META·LAB table references any `Screen*` table.
- **The single cross-module write** is the Second-Review → Data-Extraction handoff: when a leader accepts a full-text record, the server appends a study to the **linked META·LAB project's** `studies[]` — and only when that META·LAB project is owned by the screening project's owner (`linkedMetaLabProjectId` + `ownerId` both checked). Dedupe by DOI/PMID/normalised title prevents repeats.

## Removability / failure isolation

- META·SIFT is a self-contained module. The admin `enabled` flag (and a 1-line route un-mount) takes it offline returning **503** on `/api/screening/*` while META·LAB continues normally — verified by an automated test ("disabling META·SIFT does NOT break META·LAB").
- The `checkEnabled` middleware fails open on DB error; screening handlers self-contain errors (no propagation to other routes).

## Result

A user can only ever read or write screening data for projects they own or are an active member of; projects are mutually invisible; and removing or disabling META·SIFT leaves META·LAB fully functional.
