# META·SIFT Beta — Screening API Contract

Base path: `/api/screening`  
Auth: All endpoints require a valid `metalab_session` httpOnly JWT cookie (`requireAuth` middleware).  
Content-Type: `application/json` for all request bodies unless noted.

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
  "linkedMetaLabProjectId": "uuid | null (optional)"
}
```

**Response 201** — Full `ScreenProject` object. Default exclusion reasons are seeded automatically.

---

### Get project
`GET /api/screening/:pid`

**Response 200** — Full `ScreenProject` with `_count` of records and open conflicts.  
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
  "blindMode": true
}
```

**Response 200** — Updated `ScreenProject` object.

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

**Request body**
```json
{
  "format": "ris | pubmed | csv | ...",
  "content": "string (full file content)",
  "filename": "string (optional, for tracking)"
}
```

**Response 200**
```json
{
  "imported": 150,
  "total": 150,
  "batchId": "uuid"
}
```

**Errors**  
- `400` — `content` is empty or no parseable records found  
- `400` — exceeds 5000-record batch limit

---

## Export

### Export records
`GET /api/screening/:pid/export`

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

## Error responses

All endpoints return consistent error objects:
```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error (missing/invalid field) |
| 401 | Not authenticated |
| 404 | Resource not found (or does not belong to user) |
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
  "projectsThisWeek": 0, "projectsThisMonth": 0
}
```
`screened` = records with ≥1 non-undecided decision. `sentToExtraction` = records
where `handoffStatus='sent'` OR `finalStatus='accepted'`. `totalDisputes` =
unresolved conflicts (alias of `totalConflicts`).

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
    "recordCount": 0, "decisionCount": 0, "memberCount": 0,
    "secondReviewCount": 0, "acceptedCount": 0, "handoffSentCount": 0, "pdfCount": 0,
    "createdAt": "ISO8601", "updatedAt": "ISO8601"
  }],
  "total": 0, "page": 1, "pages": 1
}
```

### Get project
`GET /api/admin/screening/projects/:id` → `200` the full `ScreenProject` plus
`linkedMetaLabProjectTitle`, `decisionCount`, `secondReviewCount`, `acceptedCount`,
`handoffSentCount`, `pdfCount`. `404` if not found.

### Update project status
`PATCH /api/admin/screening/projects/:id/status`
Backward-compatible. Either:
- `{ "stage": "active" | "archived" | "disabled" }` (legacy), or
- independent flags `{ "disabled"?: bool, "archived"?: bool }`.
Returns the updated project. `400` if neither form is provided, `404` if not found.

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
