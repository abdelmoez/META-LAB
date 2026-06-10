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
