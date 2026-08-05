# META·SIFT Beta — Screening API Contract

Base path: `/api/screening`  
Auth: All endpoints require a valid `metalab_session` httpOnly JWT cookie (`requireAuth` middleware).  
Content-Type: `application/json` for all request bodies unless noted.

**403-vs-404 policy (prompt6):** non-members and pending invites always get **404** (existence-hiding). Authenticated **active members** who lack the specific permission for an action get **403** with a descriptive error. Permission changes take effect immediately — access is resolved per request from the DB (no cache). Owner-only endpoints (`DELETE` project, create/delete record) still 404 for everyone else.

---

## Projects

### List projects
`GET /api/screening/`

**Response 200**
```json
{
  "projects": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string",
      "reviewQuestion": "string",
      "stage": "title_abstract | fulltext | ...",
      "blindMode": false,
      "linkedMetaLabProjectId": "uuid | null",
      "recordCount": 0,
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

---

### Create project
`POST /api/screening/`

**Request body**
```json
{
  "title": "string (required)",
  "description": "string (optional)",
  "reviewQuestion": "string (optional)",
  "blindMode": false,
  "linkedMetaLabProjectId": "uuid | null (optional)",
  "alsoCreateMetaLab": false
}
```

- `linkedMetaLabProjectId` is **validated** (prompt6): it must be a live META·LAB project owned by the caller, else **400** `{ "error": "That META·LAB project was not found in your account" }` (previously stored unvalidated). The META·LAB project's PICO is snapshotted into `picoSnapshot` at create time.
- `alsoCreateMetaLab: true` (prompt6 Task 2, SIFT-side optional flow) creates **and links** a new META·LAB project with the same owner/title. Ignored when `linkedMetaLabProjectId` is provided (explicit link wins). META·LAB creation is never forced — default is SIFT-only.

**Response 201** — Full `ScreenProject` object plus `linkedMetaLabProjectTitle` (string | null), plus optional `warning` when `alsoCreateMetaLab`'s META·LAB create failed (the SIFT project is still created, unlinked). Default exclusion reasons are seeded automatically.

---

### Get project
`GET /api/screening/:pid`

**Response 200** — Full `ScreenProject` with `_count` of records and open conflicts, plus `linkedMetaLabProjectTitle` (string | null — best-effort, null if the META·LAB project was deleted). `picoSnapshot` is lazily refreshed from the linked META·LAB project's current PICO (compare-before-write, fire-and-forget — the response always carries the fresh value).  
**Response 404** `{ "error": "Project not found" }`

---

### Update project
`PUT /api/screening/:pid`

**Request body** (all fields optional)
```json
{
  "title": "string",
  "description": "string",
  "reviewQuestion": "string",
  "stage": "string",
  "blindMode": true,
  "progressStatus": "not_started | in_progress | done"
}
```

**Response 200** — Updated `ScreenProject` object.

Prompt6 behavior:
- **Status events**: a *real* `progressStatus` transition (old ≠ new) writes a `ScreenProjectStatusEvent` row (`projectId`, `status`, `previousStatus`, `changedById`, `changedByName`) + audit entry, feeding the ops done-today/week/month distinct metrics. Same-value writes create no event.

98.md §14 behavior (additive):
- **Sign-off corroboration warning**: setting `progressStatus: "done"` while the screening substep evidence shows pending work (records missing, title/abstract below quorum, unresolved conflicts/duplicate groups, or full-text decisions outstanding) still succeeds (leader freedom — never hard-rejected), but the 200 response additionally carries `statusWarning` (string) explaining what is pending, and the `PROJECT_STATUS_CHANGED` audit details gain `pendingWorkAtSignOff: true`. The canonical `_progress` model does not report Screening as complete until the evidence corroborates the sign-off.
- **Rename sync (sync-if-in-sync)**: when `title` changes and the linked META·LAB project's name equals the *old* SIFT title (and the link invariant holds — same owner, live project), the META·LAB name is updated too. Diverged titles never sync. Best-effort; the mirror behavior exists on `PUT /api/projects/:id` (see `api-contract.md`).
- Requires settings permission (`canManageSettings` — implicit for owner/leader); members without it get **403**.

---

### Delete project
`DELETE /api/screening/:pid`

**Response 204** — No content. Cascades to all records, decisions, labels, etc.

---

## Records

### List records
`GET /api/screening/:pid/records`

**Query params**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 50 | Per page (10–200) |
| `search` | string | — | Full-text search across title, authors, abstract, doi, pmid |
| `decision` | string | — | Filter by reviewer's decision: `include`, `exclude`, `maybe`, `undecided` |
| `hasAbstract` | `yes\|no` | — | Filter by abstract presence |

**Response 200**
```json
{
  "records": [
    {
      "id": "uuid",
      "title": "string",
      "authors": "string",
      "year": "string",
      "journal": "string",
      "doi": "string",
      "pmid": "string",
      "abstract": "string",
      "keywords": "string",
      "sourceDb": "string",
      "isDuplicate": false,
      "isPrimary": false,
      "myDecision": {
        "id": "uuid",
        "decision": "undecided",
        "exclusionReason": "string",
        "notes": "string",
        "rating": null,
        "labels": "[]"
      } | null,
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ],
  "total": 0,
  "page": 1,
  "pages": 1
}
```

---

### Create record
`POST /api/screening/:pid/records`

**Request body**
```json
{
  "title": "string",
  "authors": "string",
  "year": "string",
  "journal": "string",
  "doi": "string",
  "pmid": "string",
  "abstract": "string",
  "keywords": "string",
  "sourceDb": "string"
}
```

**Response 201** — New `ScreenRecord` object.

---

### Delete record
`DELETE /api/screening/:pid/records/:rid`

**Response 204** — No content.

---

## Import

### Import records from file content
`POST /api/screening/:pid/import`

**Permission (prompt6 Task 17):** outsider/pending invite → **404**; active member without (`canImportRecords` OR leader OR owner) → **403** `{ "error": "You do not have permission to import records in this project" }`. A viewer upgraded to leader can import immediately (no permission cache).

**Request body**
```json
{
  "format": "ris | pubmed | csv | ...",
  "content": "string (full file content)",
  "filename": "string (optional, for tracking)",
  "force": false
}
```

**Duplicate-file fingerprint (prompt6 Task 19):** the server computes SHA-256 over the CRLF→LF-normalized `content` (client hashes are never trusted). If a batch with the same hash already exists **in this project** and `force` is not strictly `true`:

**Response 409**
```json
{
  "error": "duplicate_import",
  "batch": {
    "filename": "pubmed_export.ris",
    "importedAt": "ISO8601",
    "importedByName": "Alice",
    "recordCount": 150
  }
}
```

`force: true` (JSON boolean) overrides the file-level block — but **record-level dedupe always applies** (exact DOI, exact PMID, normalized title — against existing project records AND intra-batch), so a forced re-import of an identical file yields `imported: 0` with everything in `skippedDuplicates`. Same file in a *different* project never 409s (per-project scope). Legacy batches with `fileHash` null never match the pre-check.

**Response 200**
```json
{
  "imported": 148,
  "skippedDuplicates": 2,
  "total": 150,
  "batchId": "uuid"
}
```

> **`total` semantics changed in prompt6**: `total` = parsed record count (`imported + skippedDuplicates`), no longer equal to `imported`. Each batch row stores `fileHash`, `fileSize`, `importedById`, `importedByName`, `parser` for provenance.

**Errors**  
- `400` — `content` is empty or no parseable records found  
- `400` — exceeds the records-per-project limit (checked against the post-dedupe kept count)  
- `403` — member without import permission  
- `404` — outsider / project not found  
- `409` — duplicate file fingerprint (see above)

---

## Export

### Export records
`GET /api/screening/:pid/export`

**Permission (prompt6):** member needs `canExportRecords` OR leader OR owner, else **403**; outsider → 404.

**Query params**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `csv\|json` | `csv` | Output format |
| `filter` | `all\|include\|exclude\|maybe\|undecided` | `all` | Filter by decision |

**Response** — File download (`Content-Disposition: attachment`).  
CSV columns: `title, authors, year, journal, doi, pmid, decision, exclusionReason, notes, rating, isDuplicate, abstract`

---

## Decisions

### Save / update decision
`POST /api/screening/:pid/records/:rid/decision`

**Request body**
```json
{
  "decision": "include | exclude | maybe | undecided",
  "exclusionReason": "string (optional)",
  "notes": "string (optional)",
  "rating": 1,
  "labels": ["label-uuid", "..."]
}
```

**Response 200** — `ScreenDecision` object (upserted).  
Conflict detection runs asynchronously after each save.

---

### List my decisions for project
`GET /api/screening/:pid/decisions`

**Permission (prompt6):** any **active** member (returns only the caller's own decisions) — 200; inactive member → 403; outsider → 404.

**Response 200**
```json
{
  "decisions": [
    {
      "id": "uuid",
      "recordId": "uuid",
      "projectId": "uuid",
      "reviewerId": "uuid",
      "decision": "string",
      "exclusionReason": "string",
      "notes": "string",
      "rating": null,
      "labels": "[]",
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

---

## Conflicts

### List conflicts
`GET /api/screening/:pid/conflicts`

**Response 200**
```json
{
  "conflicts": [
    {
      "id": "uuid",
      "recordId": "uuid",
      "record": { "id": "uuid", "title": "string", "authors": "string", "year": "string", "abstract": "string" },
      "reviewerDecisions": "{\"reviewerId\": \"decision\", ...}",
      "finalDecision": "string",
      "resolvedBy": "uuid | \"auto\"",
      "resolvedAt": "ISO8601 | null",
      "notes": "string",
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

---

### Resolve conflict
`POST /api/screening/:pid/conflicts/:cid/resolve`

**Request body**
```json
{
  "finalDecision": "include | exclude | maybe (required)",
  "notes": "string (optional)"
}
```

**Response 200** — Updated `ScreenConflict` object.

---

## Duplicates

### List duplicate groups
`GET /api/screening/:pid/duplicates`

**Response 200**
```json
{
  "groups": [
    {
      "id": "uuid",
      "projectId": "uuid",
      "primaryId": "uuid",
      "resolvedAt": "ISO8601 | null",
      "createdAt": "ISO8601",
      "records": [
        { "id": "uuid", "title": "string", "authors": "string", "year": "string", "doi": "string", "pmid": "string", "isPrimary": false }
      ]
    }
  ]
}
```

---

### Detect duplicates
`POST /api/screening/:pid/duplicates/detect`

**Permission (prompt6):** member needs `canManageDuplicates` OR leader OR owner, else **403**; outsider → 404. (Same rule for `POST /duplicates/:gid/resolve`.)

Runs duplicate detection (exact DOI, exact PMID, normalized title similarity ≥ 0.92). Creates `ScreenDuplicateGroup` records in the DB.

**Response 200**
```json
{
  "found": 5,
  "created": 3,
  "groups": [["uuid1", "uuid2"], ...]
}
```

---

### Resolve duplicate group
`POST /api/screening/:pid/duplicates/:gid/resolve`

**Request body**
```json
{
  "primaryId": "uuid (required — the record to keep)"
}
```

**Response 200**
```json
{
  "resolved": true,
  "primaryId": "uuid"
}
```

---

## Labels

**Permission (prompt6):** creating/deleting labels and exclusion reasons requires leader OR owner; other members get **403**; outsiders → 404. Listing is member-readable.

### List labels
`GET /api/screening/:pid/labels`

**Response 200**
```json
{ "labels": [{ "id": "uuid", "projectId": "uuid", "name": "string", "color": "#5b9cf6", "createdAt": "ISO8601" }] }
```

---

### Create label
`POST /api/screening/:pid/labels`

**Request body**
```json
{ "name": "string (required)", "color": "#hex (optional, default #5b9cf6)" }
```

**Response 201** — New `ScreenLabel` object.

---

### Delete label
`DELETE /api/screening/:pid/labels/:lid`

**Response 204** — No content.

---

## Exclusion Reasons

### List exclusion reasons
`GET /api/screening/:pid/reasons`

**Response 200**
```json
{ "reasons": [{ "id": "uuid", "projectId": "uuid", "text": "string", "createdAt": "ISO8601" }] }
```

---

### Create exclusion reason
`POST /api/screening/:pid/reasons`

**Request body**
```json
{ "text": "string (required)" }
```

**Response 201** — New `ScreenExclusionReason` object.

---

### Delete exclusion reason
`DELETE /api/screening/:pid/reasons/:rid2`

**Response 204** — No content.

---

## Stats

### Get screening stats
`GET /api/screening/:pid/stats`

**Response 200**
```json
{
  "total": 500,
  "screened": 320,
  "included": 120,
  "excluded": 180,
  "maybe": 20,
  "undecided": 180,
  "conflicts": 5,
  "duplicates": 12,
  "progress": 64
}
```

Stats are scoped to the authenticated reviewer's own decisions. `progress` is a percentage (0–100).

---

## Members — prompt6 additions

Member CRUD lives at `GET|POST /api/screening/projects/:pid/members` and `PATCH|DELETE /api/screening/projects/:pid/members/:mid` (owner/leader-gated mutations, owner-row protections — see prompt4/prompt5 reports). New in prompt6:

### Add member — module participation
`POST /api/screening/projects/:pid/members`

**Request body** now additionally accepts `modules`:
```json
{
  "email": "user@example.com",
  "preset": "reviewer | data_extractor | viewer | ...",
  "modules": "metalab | metasift | both"
}
```

- `modules` (optional) maps onto the resolved preset's flags: `canViewMetaLab` / `canViewMetaSift`. `modules: "metasift"` also clears `canEditMetaLab` (a leftover edit flag would silently re-grant META·LAB visibility). Absent = no change to the preset's flags.
- Invalid value → **400** `{ "error": "invalid modules (use 'metalab', 'metasift' or 'both')" }`.
- Response shape unchanged: `201 { member, pending }`.

### Notifications emitted
- Adding a **registered** user creates a `PROJECT_INVITE` notification (see `api-contract.md` → Notifications).
- Adding an **unregistered** email creates a pending member row (`userId` null); at registration the **claim-on-register hook** sets `userId`, flips `status pending→active`, and creates the deferred `PROJECT_INVITE` notification.
- `PATCH .../members/:mid` creates a `ROLE_CHANGED` notification on a real role/preset change to someone other than the actor.

---

## META·LAB link summary — membership-aware (prompt6 Task 3/8)

### `GET /api/screening/metalab/:mlpid/summary`

Returns the link status of a META·LAB project. Since prompt6 this is **membership-aware**: it returns `linked: true` (with `screeningProjectId` + `title`) for the workspace **owner OR any active member** of the linked ScreenProject — previously owner-only, which made added members see "not linked". When multiple workspaces link the same META·LAB id, the caller's own workspace is preferred. The link belongs to the workspace, not the user — added members never need to re-link.

---

## Error responses

All endpoints return consistent error objects:
```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error (missing/invalid field, dead/foreign link target, invalid `modules`) |
| 401 | Not authenticated |
| 403 | Active member lacking the specific permission (import/export/duplicates/labels/settings); inactive member |
| 404 | Resource not found — also returned to non-members and pending invites (existence-hiding) |
| 409 | Duplicate import-file fingerprint (`duplicate_import`) |
| 500 | Internal server error |

---

# Admin Control Panel — META·SIFT

Base path: `/api/admin/screening`
Auth: All endpoints require a valid `metalab_session` cookie **and** admin role
(`requireAuth` + `requireAdmin`, enforced at the router mount in `routes/admin.js`).
These endpoints expose **metadata + counts only** — they never return private
abstracts or per-reviewer decision content.

Settings defaults are the single source of truth in `server/screening/settings.js`
(`META_SIFT_DEFAULTS`, `SETTINGS_KEY`). The admin controller imports them; it does
not re-declare defaults.

## Settings

### Get settings
`GET /api/admin/screening/settings` → `200` returns the merged settings object
(`META_SIFT_DEFAULTS` overlaid with any stored overrides). Keys: `enabled`,
`badgeText`, `allowNewProjects`, `allowImport`, `allowExport`, `allowPdfUpload`,
`allowDuplicateDetection`, `allowConflictResolution`, `allowChat`,
`allowSecondReview`, `requireTwoReviewers`, `minIncludeQuorum`, `defaultBlindMode`,
`maxPdfSizeMb`, `maxRecordsPerProject`, `maintenanceMessage`.

### Update settings
`PUT /api/admin/screening/settings`
Body: any subset of the settings keys. Booleans are coerced; numerics are
validated/clamped (`minIncludeQuorum` int ≥ 1, `maxPdfSizeMb` int 1–200,
`maxRecordsPerProject` int ≥ 1). Returns the full updated settings object.

## Metrics

### Get metrics
`GET /api/admin/screening/metrics` → `200`
```json
{
  "totalProjects": 0, "activeProjects": 0, "archivedProjects": 0, "disabledProjects": 0,
  "doneProjects": 0, "inProgressProjects": 0,
  "totalRecords": 0, "totalDecisions": 0, "screened": 0,
  "included": 0, "excluded": 0, "maybe": 0, "undecided": 0,
  "totalConflicts": 0, "totalDisputes": 0, "resolvedConflicts": 0,
  "totalDuplicateGroups": 0, "resolvedDuplicateGroups": 0,
  "totalMembers": 0, "activeMembers": 0, "totalPdfs": 0,
  "eligibleSecondReview": 0, "acceptedToExtraction": 0, "handoffSent": 0,
  "sentToExtraction": 0, "rejectedSecond": 0, "totalChatMessages": 0,
  "projectsThisWeek": 0, "projectsThisMonth": 0,
  "doneToday": 0, "doneThisWeek": 0, "doneThisMonth": 0
}
```
`screened` = records with ≥1 non-undecided decision. `sentToExtraction` = records
where `handoffStatus='sent'` OR `finalStatus='accepted'`. `totalDisputes` =
unresolved conflicts (alias of `totalConflicts`).

`doneToday` / `doneThisWeek` / `doneThisMonth` (prompt6 Task 12) =
`COUNT(DISTINCT projectId)` in `ScreenProjectStatusEvent` where `status='done'`
and `createdAt >=` start of the calendar day/week (Sunday)/month. Distinct-by-project
means done → in_progress → done on the same day counts **once**; setting
`progressStatus` to its current value writes no event.

## Projects

### List projects
`GET /api/admin/screening/projects?page=1&limit=25` → `200`
```json
{
  "projects": [{
    "id": "uuid", "title": "string", "stage": "string",
    "archived": false, "disabled": false, "progressStatus": "not_started",
    "blindMode": false,
    "owner": { "id": "uuid", "name": "string", "email": "string" },
    "linkedMetaLabProjectId": "uuid | null",
    "linkedMetaLabProjectTitle": "string | null",
    "workspaceId": "uuid (= ScreenProject id)",
    "status": "not_started | in_progress | done (alias of progressStatus)",
    "linkedMetaLab": { "id": "uuid", "title": "string" },
    "recordCount": 0, "decisionCount": 0, "memberCount": 0,
    "secondReviewCount": 0, "acceptedCount": 0, "handoffSentCount": 0, "pdfCount": 0,
    "createdAt": "ISO8601", "updatedAt": "ISO8601"
  }],
  "total": 0, "page": 1, "pages": 1
}
```
`workspaceId` / `status` / `linkedMetaLab` (`{id,title} | null`) are prompt6 Task 11
additions; `linkedMetaLabProjectId/Title` are kept for back-compat.

### Get project
`GET /api/admin/screening/projects/:id` → `200` the full `ScreenProject` plus
`linkedMetaLabProjectTitle`, `decisionCount`, `secondReviewCount`, `acceptedCount`,
`handoffSentCount`, `pdfCount`. `404` if not found.

Prompt6 Task 11 additions — `workspaceId`, `status`, `linkedMetaLab: {id,title} | null`, and:
```json
{
  "progress": {
    "total": 0, "screened": 0, "unscreened": 0,
    "included": 0, "excluded": 0, "maybe": 0,
    "conflicts": 0, "duplicates": 0, "secondReview": 0, "sentToExtraction": 0
  },
  "memberProgress": [
    { "name": "string", "email": "string", "screened": 0, "included": 0, "excluded": 0, "maybe": 0 }
  ]
}
```
Semantics mirror the member-facing Overview: `screened` = distinct records with a
non-undecided title/abstract decision; `conflicts` = unresolved; `duplicates` =
records with `isDuplicate=true`; `secondReview` = `currentStage='full_text'`;
`sentToExtraction` = `handoffStatus='sent'` OR `finalStatus='accepted'`.

### Update project status
`PATCH /api/admin/screening/projects/:id/status`
Backward-compatible. Any of:
- `{ "stage": "active" | "archived" | "disabled" }` (legacy), or
- independent flags `{ "disabled"?: bool, "archived"?: bool }`, or
- `{ "progressStatus": "not_started" | "in_progress" | "done" }` (prompt6; may ride along with stage/flags).

Returns the updated project. A **real** `progressStatus` transition writes a
`ScreenProjectStatusEvent` (best-effort) feeding the done-today metrics.
Errors: `400` `{ "error": "invalid progressStatus" }` for a bad value;
`400` `{ "error": "Provide stage, disabled/archived, or progressStatus" }` when no
recognized field is provided (message changed in prompt6); `404` if not found.

### Get project members
`GET /api/admin/screening/projects/:id/members` → `200`
```json
{
  "projectId": "uuid", "title": "string",
  "members": [{
    "id": "uuid", "name": "string", "email": "string",
    "role": "leader|reviewer|viewer", "status": "active|pending|inactive",
    "canScreen": true, "canChat": true, "canResolveConflicts": false,
    "joinedAt": "ISO8601", "screenedCount": 0
  }]
}
```
`screenedCount` = that member's non-undecided decisions in the project. `404` if
the project does not exist.

## Handoffs

### Get handoff log
`GET /api/admin/screening/handoffs` → `200` — recent extraction-handoff events
across all projects (records where `handoffStatus != ''`, newest first, limit 100).
```json
{
  "handoffs": [{
    "id": "uuid", "projectId": "uuid", "projectTitle": "string | null",
    "linkedMetaLabProjectId": "uuid | null", "recordTitle": "string",
    "handoffStatus": "sent|failed|already_exists|pending",
    "handoffAt": "ISO8601 | null", "handoffError": "string",
    "finalStatus": "accepted|rejected|\"\"", "acceptedAt": "ISO8601 | null"
  }],
  "counts": { "sent": 0, "failed": 0, "already_exists": 0, "pending": 0 }
}
```

## Audit log

### Get audit log
`GET /api/admin/screening/audit?projectId=<uuid>` → `200` — global recent
`ScreenAuditLog` entries (newest first, limit 200). Optional `projectId` filter.
```json
{
  "entries": [{
    "id": "uuid", "projectId": "uuid", "projectTitle": "string | null",
    "actorId": "uuid", "actorName": "string", "action": "RECORD_ACCEPTED | ...",
    "entityType": "string | null", "entityId": "string | null",
    "details": "JSON string", "createdAt": "ISO8601"
  }],
  "total": 0
}
```

---

## Prompt 9 additions (2026-06-12)

### Members & invites

- `POST /projects/:pid/members` now **validates email format** (400 `{error:'Invalid email address'}` before
  any lookup). For unknown emails the pending member row carries the invite ceremony
  (`invitedByUserId`, `inviteTokenHash` — hash only, never exposed —, `inviteExpiresAt`,
  `inviteAcceptedAt`) and the 201 response gains an additive field for the inviter:
  `invite: { link, emailConfigured, emailSent, expiresAt }` (`link` is `<APP_BASE_URL>/invite/<token>`;
  the plaintext token appears only here). A styled invite email is sent best-effort when SMTP is configured
  and `appSettings.emailInvitesEnabled` is not false — email failure never fails the request.
- Invite expiry: `metaSiftSettings.inviteExpiryDays` (int 1–90, default 14, `coerceSettings`-whitelisted).
- Revoke = `DELETE /projects/:pid/members/:memberId` on a pending row (audited `INVITE_REVOKED`; the token
  dies with the row). Public token endpoints live under `/api/invites` (see api-contract.md).
- `POST /projects/:pid/leave` (auth) — self-service exit for any active non-owner member:
  200 `{left:true}`, audited `MEMBER_LEFT`, `members.changed` + targeted `permissions.changed` pokes.
  Owner → 400 (transfer ownership is not implemented; delete instead). Non-member → 404.

### Project lifecycle

- `DELETE /projects/:pid` keeps **204** but is now a soft delete (`deletedAt` + `deletedSource:'owner'`),
  audited `PROJECT_DELETED` *before* the mark so the workspace audit trail survives. Deliberately **one-way**:
  deleting from META·SIFT never touches the linked META·LAB project. `getProjectAccess` treats deleted
  workspaces as nonexistent → 404 everywhere (records, chat doors, members, overview, pdfs, leave).
  Admin restore: `PATCH /api/admin/screening/projects/:id/restore`.

### Export

- `GET /projects/:pid/export` accepts `format=ris` in addition to `csv`/`json`: standard RIS
  (`TY  - JOUR`, `TI`, one `AU` per author, `JO`, `PY`, `DO`, `AN` = pmid, `AB`, `ER  - `),
  `Content-Type: application/x-research-info-systems`, filename `sift-export-<pid8>.ris`.
  Permission gates unchanged (outsider 404, member without `canExportRecords` 403, admin `allowExport`
  kill-switch 403). Every export records a `UsageEvent EXPORT {format}` (best-effort) for ops metrics.

### Overview

- `GET /projects/:pid/overview` gains the additive field
  `linkedMetaLab: null | { id, title, missing, canOpen }` — `title` only while the target is live;
  `missing:true` when the linked META·LAB project is gone, soft-deleted, or not owned by the workspace
  owner; `canOpen` = caller is workspace owner (and target live) or member with `canViewMetaLab`.
  All pre-existing fields are byte-identical.

---

## 65.md additions (2026-07-01)

### List records — fast path (SCR-1, no shape change)

- `GET /projects/:pid/records` now serves the SAFE subset — no `search`, no `keywords`,
  no `hasAbstract`, no `aiQueue`/`aiBand` (or their defaults), and `filter` in
  `all | unopened_me | opened_me` — via a paged DB query (Prisma WHERE + orderBy +
  skip/take + count) instead of loading the whole project per page request.
  The response shape is **byte-identical in structure**; ordering stays `createdAt asc`
  (with a deterministic `id` tiebreak on the fast path so skip/take pagination is stable).
  Decision filters (`undecided`/`included`/…), text search, keyword filters and AI-queue
  ordering keep the existing in-memory path unchanged.

### Import preview (SCR-10)

- `POST /projects/:pid/import/preview` — body `{ format?, content, filename? }`. Runs the
  REAL parser registry (`parseImportContent`) over at most the first **256 KB** of `content`
  and returns:

```json
{
  "detectedFormat": "RIS",
  "sample": [ { "title": "…", "authors": "…", "year": "…", "journal": "…", "doi": "…", "decision": "undecided" } ],
  "counts": { "parsed": 120, "rejected": 2 },
  "decisionColumnDetected": false,
  "truncated": false
}
```

  Read-only (nothing inserted; the admin `allowImport` switch does not apply). Permission
  gate mirrors import: outsider 404, member without `canImportRecords` 403. 400 when
  `content` is empty. `sample` is the first 5 parsed records; `rejected` counts records
  with no usable title/DOI/PMID; `truncated:true` means counts describe only the head.

### Import row-issue reporting (SCR-3)

- `dedupeAndInsertRecords` now collects per-row reasons — rejected rows (no title/DOI/PMID)
  and unrecognised decision values — capped at **200** entries (`ERROR_REPORT_CAP`).
- `POST /projects/:pid/import` response gains the additive field
  `errorReport: [{ index, title, reason }]` (`index` = 1-based position in the parsed file).
- The async worker persists the same list to `ScreenImportJob.errorReport`; the job now
  reaches `completed_with_warnings` when there are rejects **or** invalid decision labels
  (`warningCount` = both).
- `GET /projects/:pid/import/jobs/:jobId` gains the additive field `errorReport` (parsed array).
- `GET /projects/:pid/import-batches/:batchId/error-report` (NEW, member-visible like the
  batch list) → `{ batchId, rejectedCount, warningCount, errorReport }`. Batches imported
  before this feature (or synchronously) return an empty `errorReport`.

### Export completeness (SCR-2, append-only columns)

- CSV/JSON exports (`GET /projects/:pid/export` and the async job) APPEND new columns after
  the AI CV columns — existing columns never move:
  `conflict_status` (authoritative consensus state from title/abstract decisions:
  `awaiting_screening | awaiting_second_reviewer | agreement_included | agreement_excluded |
  agreement_other | conflict`), `duplicate_group_id`, `is_primary`, `my_decided_at`, then
  `reviewer_N_name / reviewer_N_decision / reviewer_N_decided_at` for N = 1…6
  (`EXPORT_REVIEWER_CAP`; fixed schema — blank families beyond the project's reviewers).
- Reviewer ordinals are project-wide and deterministic (reviewerId ascending), so
  `reviewer_1` is the same person on every row of one export.
- Identity mirrors the listRecords policy: names are exported only when the project is not
  blind OR the requester is a leader/owner; otherwise `reviewer_N_name` is the anonymous
  ordinal `Reviewer N`. Per-reviewer decisions are the title/abstract-stage decisions
  (the same visibility the workbench already gives every member).

### Export CV cap (SCR-8)

- The synchronous export keeps `EXPORT_CV_MAX` (default 5000). The ASYNC export job now
  computes cross-validated AI scores up to `EXPORT_CV_MAX_ASYNC` (default **20000**, env
  override) — the CV runs fold-by-fold inside the compute worker_thread, off the event
  loop. Beyond the async cap the honest `too_large` status still blanks the CV columns.

### Duplicates (SCR-4)

- `POST /projects/:pid/duplicates/resolve-exact` (NEW; same permission gate as detect) —
  bulk-resolves every unresolved group whose records **all pairwise classify as
  `exact_duplicate`** (hard DOI/PMID match). Non-destructive: keeps the most
  metadata-complete record as primary (deterministic choice), flags the rest
  `isDuplicate`, and fills the primary's BLANK fields (doi/pmid/abstract/authors/year/
  journal/keywords) from the discarded copies — never overwriting non-empty values.
  Response: `{ resolvedGroups, flaggedDuplicates, mergedFieldCount, skippedGroups }`.
  Each group is audited `DUPLICATE_GROUP_RESOLVED` with `{ bulk, mergedFields, filledFrom }`.
- `POST /projects/:pid/duplicates/:gid/resolve` (primary path) now applies the same
  fill-blank-only merge to the chosen primary and gains the additive response field
  `mergedFields: string[]`. 400 when `primaryId` is not in the group.

### Decision import aliases (SCR-9)

- `normalizeImportedDecision` additionally accepts vendor labels: `in/keep/eligible` →
  include; `out/not relevant/ineligible` → exclude; `unclear` → maybe. POLICY:
  `conflict` → `maybe` — a per-reviewer decision can never BE `conflict` (that is a
  derived between-reviewers state), so exported conflict cells import as "needs another look".

---

## 96.md additions (2026-07-30) — search-import provenance, history & reset

### Metadata merge on duplicate match (imports)

`dedupeAndInsertRecords` (sync import, async job, Pecan landing, citation mining) no
longer silently skips a duplicate match: the matched existing record gets a SAFE
**fill-blank** merge (`mergeFillBlanks` over `doi/pmid/abstract/authors/year/journal/keywords`
— only BLANK fields are filled, non-empty values are never overwritten; decisions,
stage, finalStatus, notes, conflicts, PDFs, and assignments are NEVER touched).

- Import responses (`POST /import`, import job rows' underlying result) gain the
  ADDITIVE field `updated` — DISTINCT existing records that had ≥1 field filled.
  `updated ⊆ skippedDuplicates`; PRISMA accounting is unchanged (an updated record
  still counts as *already present* — rerun-stable).
- **`updated` count semantics (run level):** for search runs, `updated` counts
  DISTINCT records per run — a record filled by several pages/sources of one run
  counts once (the merge writer consults the run's existing
  `ScreenRecordMetadataChange` rows before counting). Residual imprecision: two
  sources of the same run merging the SAME record at the same instant (bounded by
  source concurrency 3) can each count it once — the check is query-first, not a
  DB constraint. File imports are one merge call per batch, so their `updated` is
  per-batch distinct by construction.
- Within-run cross-database duplicates (`exact_dup` / `fuzzy_dup` verdicts) get
  the SAME fill-blank merge as `existing_match` records — e.g. Europe PMC's copy
  supplies the abstract PubMed omitted in the same run. Their provenance rows
  carry outcome `updated` (with `changedFields`) when the merge filled fields,
  else `merged_duplicate`.
- Each filled field is logged as a `ScreenRecordMetadataChange` row
  (field, fromValue, toValue — values capped at 500 chars), written immediately
  after each record's update (crash-safe: at most the in-flight record's audit
  rows can be lost, never a whole batch).
- Every inserted AND matched record gains a `ScreenRecordSource` provenance row:
  `{ projectId, screenRecordId, metaLabProjectId, runId, batchId, provider,
     providerRecordId, outcome: new|already_present|updated|merged_duplicate,
     changedFields (JSON string[]), origin: search|file|api|mining, importedAt }`.
  Writes are idempotent (composite unique key, query-first) — page resumes and job
  retries never duplicate provenance. For rows with a `runId` the LOGICAL identity
  is `(screenRecordId, runId, provider, providerRecordId)` — `batchId` is ignored
  at write time, so a page retried after a mid-page crash (which lands in a NEW
  batch) never writes a second, contradictory row for the same run+provider+record.
- `ScreenImportBatch` gains additive columns `searchRunId` (PecanSearchRun id, "" for
  file/api imports) and `updatedCount`.
- **Provenance cleanup is consistent everywhere** (the tables are bare-scoped, no
  FK): the reset endpoint, `DELETE /import-batches/:batchId`, and
  `DELETE /records/:rid` all best-effort delete the `ScreenRecordSource` +
  `ScreenRecordMetadataChange` rows of the records they remove — nothing dangles
  by design.

### List import batches — additive fields

`GET /projects/:pid/import-batches` — each batch additionally carries:

- `searchRunId` — the run that produced it ("" for file/api). Legacy pecan batches
  (created before the column existed) are backfilled at read time by parsing the
  synthetic `fileHash` `pecan:<runId>:<provider>:<page>`.
- `updatedCount` — existing records whose blank metadata this batch's import filled.

All pre-existing fields are byte-identical.

### Import history timeline (NEW)

`GET /projects/:pid/import-history?limit=&offset=` — member-readable. Response:

```json
{
  "canReset": true,
  "canDelete": true,
  "total": 120,
  "hasMore": true,
  "limit": 50,
  "offset": 0,
  "entries": [
    {
      "kind": "search-run",
      "runId": "uuid", "name": "Search 2026-07-30", "state": "completed",
      "origin": "automated | living",
      "rolledBackAt": "ISO8601 | null",
      "initiatedByName": "Alice",
      "createdAt": "ISO8601", "completedAt": "ISO8601 | null",
      "canonicalText": "(cancer) AND (screening)",
      "canonicalTextTruncated": false,
      "errorSummary": "",
      "counts": { "found": 312, "imported": 224, "existingMatched": 76, "updated": 3, "duplicatesSkipped": 12, "ambiguous": 0, "failed": 0 },
      "perSource": [{ "provider": "pubmed", "state": "completed", "raw": 312, "imported": 224, "existingMatched": 76, "updated": 3, "duplicatesSkipped": 12, "failed": 0, "capReached": false, "errorClass": "", "errorDetail": "" }],
      "batches": [ { "id": "uuid", "filename": "pubmed search", "...": "same shape as import-batches" } ]
    },
    { "kind": "batch", "id": "uuid", "filename": "refs.ris", "source": "file", "...": "same shape as import-batches" }
  ]
}
```

- Entries are newest-first. Search-run entries group the run's per-page batches;
  counts for non-finalized runs are aggregated LIVE from the per-source rows.
- Batches whose run no longer exists (or file/api batches) appear as `kind:"batch"`.
- `canReset` (owner OR site admin) drives visibility of the reset action —
  server-computed capability flag, same pattern as `canDelete`.
- **Pagination (additive):** `limit` defaults to 50 (max 200), `offset` defaults
  to 0; both apply to the SORTED entry list. `total` = total entries, `hasMore` =
  `offset + entries.length < total`. Per-source breakdowns are computed only for
  the returned page. `canonicalText` in list entries is truncated to 500 chars
  with `canonicalTextTruncated: true` when cut — the full text is available from
  the run detail endpoint (`GET /api/pecan-search/...`).

### Record provenance (NEW)

`GET /projects/:pid/records/:rid/provenance` — member-readable; outsiders and
unknown records get an existence-hiding **404**. The 96.md 5D article-level view:
which imports introduced/re-found the article and which fields later imports
filled.

```json
{
  "sources": [
    {
      "runId": "uuid | \"\"",
      "runName": "Search 2026-07-30 | \"\"",
      "origin": "search | file | api | mining",
      "provider": "pubmed | \"\"",
      "providerRecordId": "12345 | \"\"",
      "outcome": "new | already_present | updated | merged_duplicate",
      "importedAt": "ISO8601",
      "batchId": "uuid | \"\"",
      "filename": "refs.ris | \"\"",
      "rolledBackAt": "ISO8601 | null"
    }
  ],
  "changes": [
    { "field": "abstract", "fromValue": "", "toValue": "…", "runId": "uuid | \"\"", "provider": "pubmed | \"\"", "createdAt": "ISO8601" }
  ]
}
```

- `sources` is sorted `importedAt` ASC — the FIRST element is the import that
  first introduced the article.
- `runName` / `rolledBackAt` resolve from `PecanSearchRun` (`""` / `null` for
  file/api rows or when the run is gone); `filename` resolves from the batch
  (`""` when batchless/deleted).
- `changes[].provider` is best-effort: the unique provider among the record's
  source rows sharing the change's `(runId, batchId)` context, else `""`.
- Records imported before 96.md have no provenance rows — both arrays are empty
  (legacy imports are undetectable by design).

### Delete imported records — reset (NEW)

**Permission (both endpoints): project OWNER or site ADMIN only** (deleteImportBatch
precedent; leaders are deliberately excluded). Outsiders → 404 (existence hiding).

`GET /projects/:pid/imported-records/reset-preview?scope=search|all`

```json
{
  "scope": "search",
  "projectName": "My review",
  "confirmToken": "My review",
  "counts": {
    "records": 500, "batches": 12, "decisions": 40, "notes": 5, "conflicts": 2,
    "pdfs": 3, "runsAffected": 2, "handedOff": 1, "manualRecordsKept": 120
  },
  "searchHistoryRemains": true,
  "strategyRemains": true,
  "undoable": false,
  "blockedBy": "A reference import is still running for this project. | null"
}
```

- `confirmToken` (additive) is the EXACT string the user must type: the project
  title, or the literal `DELETE` when the title is blank/whitespace (the typed
  confirm can never be vacuous). The POST validates against the same token.

`POST /projects/:pid/imported-records/reset` — body `{ "scope": "search" | "all", "confirm": "<confirmToken>" }`

- `scope: "search"` deletes records whose import batch is attributed to a search
  run — `source: "pecan-search"` OR a `searchRunId` / legacy `pecan:<runId>:…`
  fileHash (the SAME attribution the import-history grouping uses, so what
  displays under a run is exactly what the reset removes). Manually
  imported/created records are KEPT (`manualRecordsKept`).
  - **Shared provenance (kept):** a record in a search batch that ALSO arrived
    via a manual/file/api/citation-mining import (it has a `ScreenRecordSource`
    row with origin `file`/`api`/`mining`) is EXCLUDED from the search scope —
    it is kept, counted in `manualRecordsKept`, and only its `search`-origin
    provenance rows are stripped. Caveat: records whose shared provenance
    predates 96.md cannot be detected (no provenance rows exist for them) and
    are deleted with their search batch.
- `scope: "all"` deletes EVERY ScreenRecord in the project (incl. manual/file/api)
  and all import batches — complete screening restart.
- Typed confirm = `confirmToken` (project title, or `DELETE` when blank);
  mismatch → **400**.
- **409** `{ code: "RESET_IN_PROGRESS" }` when a reset is ALREADY running for the
  project (per-project in-process lock — double-submits and concurrent resets
  never race). While the lock is held, `POST /import`, `POST /import/start`,
  `POST /duplicates/detect` and Pecan `POST …/search/runs` also return **409**
  `{ code: "RESET_IN_PROGRESS" }`, and any in-flight landing fails fast with the
  same code — imports can never repopulate a project mid-reset.
- **409** `{ code: "JOBS_ACTIVE" }` while ANY project-scoped job is active
  (import, duplicate detection, AI, eligibility, full-text, or a queued/running
  Pecan search run/job for the linked META·LAB project). The fence is
  **fail-closed** (a fence query error blocks the reset) and is **re-run as the
  first operation inside the delete transaction**, so a job enqueued between the
  pre-check and the transaction aborts the reset with the same 409.
- Deletion is transactional + chunked (tx timeout 120 s — a pathological reset
  fails fast instead of stalling other writers): bare-scope rows (AI
  scores/feedback, duplicate labels, eligibility assessments, full-text
  candidates/requests, ScreenRecordSource / ScreenRecordMetadataChange, AI
  validation samples, PENDING engine dedup decisions of the project's runs) are
  cleaned; decisions / conflicts / PDF rows / open states cascade; duplicate
  groups that lost their PRIMARY or dropped under 2 surviving members are
  dissolved — surviving members get `isDuplicate`/`isPrimary` cleared and are
  detached, so no kept record is ever left suppressed by a dead group; scoped
  batches + TERMINAL ScreenImportJob rows are removed so **re-importing the same
  file after a reset works** (no 409 duplicate_import). Scope `all` clears EVERY
  terminal import job for the project (incl. jobs whose batch was deleted
  per-batch earlier).
- `PecanSearchRun` rows are **marked** `rolledBackAt`/`rolledBackById`, never
  deleted — search history and strategy versions remain; PRISMA excludes
  rolled-back runs' engine-side duplicate counts. Only runs in TERMINAL states
  are marked (queued/running runs cannot exist at that point — the in-transaction
  fence aborts first). The pecan worker additionally treats `rolledBackAt` as a
  page-boundary stop signal, so a marked run can never keep landing records.
- Side effects (best-effort, post-commit): `ScreenResetEvent` row (written in the
  transaction), `ScreenAuditLog` action `RESET_IMPORTED_RECORDS`, ProjectEvent
  `SCREENING_IMPORTED_RECORDS_RESET` (module `screening`), on-disk PDF cleanup
  (file names captured INSIDE the transaction, right before each delete chunk),
  and `project.updated` realtime pokes to both the screening room and the linked
  META·LAB project room.

**Response 200**
```json
{
  "deleted": true,
  "scope": "search",
  "counts": { "records": 500, "decisions": 40, "conflicts": 2, "pdfs": 3, "batches": 12, "runsMarked": 2, "manualRecordsKept": 120 }
}
```

Screening counts, project progress and PRISMA all recompute live from the surviving
rows (no cached counters exist to invalidate).
