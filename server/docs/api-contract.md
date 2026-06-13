# META·LAB REST API Contract

**Base URL:** `http://localhost:3001/api`  
**Content-Type:** `application/json` (all requests and responses)  
**CORS origin allowed:** `http://localhost:3000`

---

## Table of Contents

1. [Health](#health)
2. [Authentication](#authentication)
3. [Profile](#profile)
4. [Projects](#projects)
5. [Studies](#studies)
6. [Records](#records)
7. [Meta-Analysis](#meta-analysis)
8. [Validation](#validation)
9. [Import / Export](#import--export)
10. [Notifications](#notifications)
11. [Realtime Events (SSE)](#realtime-events-sse)
12. [Error Shape](#error-shape)
13. [Common Data Types](#common-data-types)

---

## Health

### `GET /api/health`

Returns server status.

**Response 200**
```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "version": "2.5.0"
}
```

`version` tracks the root `package.json` (via `server/version.js`); see also the public `GET /api/version` for `{ name, version, commit, commitDate, buildDate, full }`.

---

## Authentication

### `POST /api/auth/register`
### `POST /api/auth/login`
### `POST /api/auth/logout`
### `GET /api/auth/me`

Auth routes are rate-limited: 20 requests per 15 minutes per IP.

---

## Profile

All profile endpoints require authentication (httpOnly session cookie).

### `GET /api/profile`

Returns the authenticated user's profile. Password hash is never returned.

**Response 200**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Alice",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "lastActive": "2025-06-07T14:00:00.000Z"
  }
}
```

---

### `PUT /api/profile`

Update display name. Also records `lastActive` timestamp.

**Request Body**
```json
{ "name": "Alice Smith" }
```

**Response 200** — Updated user profile (same shape as GET /api/profile).

**Error 400** — `name` is not a string.

---

### `PUT /api/profile/password`

Change the authenticated user's password.

**Request Body**
```json
{
  "currentPassword": "OldP@ssw0rd",
  "newPassword": "NewP@ssw0rd!"
}
```

| Field           | Type   | Required | Description |
|-----------------|--------|----------|-------------|
| currentPassword | string | yes      | Must match the current stored bcrypt hash |
| newPassword     | string | yes      | Minimum 8 characters; will be bcrypt-hashed before storage |

**Response 200**
```json
{ "ok": true }
```

**Error 400** — missing or too-short `newPassword`.  
**Error 401** — `currentPassword` does not match.

---

## Projects

Project endpoints return both **owned** projects and projects **shared** with the caller through a linked Review Workspace (the workspace is the META·SIFT `ScreenProject` row; membership and permissions live on `ScreenProjectMember`).

### Workspace annotations (prompt6)

`GET /api/projects`, `GET /api/projects/:id`, and the member path of `PUT /api/projects/:id` annotate every accessible project with transient keys. All `_`-prefixed keys are **stripped on persist** (`store.projectToData`) — clients may echo them back safely.

```json
{
  "_linkedMetaSift": { "id": "screenproject-uuid", "title": "My Systematic Review" },
  "_permissions": {
    "role": "owner | leader | reviewer | viewer | ...",
    "isOwner": true,
    "canView": true,
    "canEdit": true,
    "readOnly": false,
    "canExport": true
  }
}
```

- `_linkedMetaSift` is `null` when checked-and-not-linked. The reverse lookup enforces the link invariant (`ScreenProject.ownerId === Project.userId`); oldest workspace wins if linked twice.
- Shared rows additionally keep the prompt5 keys (`_shared`, `_role`, `_canEdit`, `_readOnly`, `_screenProjectId`, `_owner`) unchanged.
- Owner rows always carry `_permissions: { role: "owner", isOwner: true, canView: true, canEdit: true, readOnly: false, canExport: true }`.

---

### `GET /api/projects`

Returns all projects accessible to the caller (owned + shared). By default returns a lightweight list (studies and records arrays are omitted for performance). Every row carries the workspace annotations above.

**Query parameters**

| Param           | Values         | Description |
|-----------------|----------------|-------------|
| full            | `true` \| `1` | When present, returns full project objects including studies and records |
| includeArchived | `true` \| `1` | When present, includes archived projects in the result. Default: archived projects are **excluded** from all lists (both owned and shared). |

**Example:** `GET /api/projects?full=true`  
**Example:** `GET /api/projects?includeArchived=1`

**Response 200**
```json
[
  {
    "id": "a1b2c3d4",
    "name": "My Systematic Review",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z",
    "_archived": false,
    "_archivedAt": null,
    "_studyCount": 5,
    "_recordCount": 120,
    "_linkedMetaSift": {
      "id": "screenproject-uuid",
      "title": "My Systematic Review",
      "progressStatus": "screening",
      "recordCount": 120,
      "memberCount": 3
    },
    "_permissions": { "role": "owner", "isOwner": true, "canView": true, "canEdit": true, "readOnly": false, "canExport": true }
  }
]
```

**New `_`-prefixed transient fields (prompt11) — stripped on persist, safe to echo back:**

| Field            | Type           | Description |
|------------------|----------------|-------------|
| `_archived`      | boolean        | `true` when the project is archived |
| `_archivedAt`    | string \| null | ISO-8601 timestamp of archival, or `null` |
| `_studyCount`    | number         | Count of entries in the `data.studies` blob array |
| `_recordCount`   | number         | Count of entries in the `data.records` blob array |
| `_linkedMetaSift`| object \| null | Enriched with `{ id, title, progressStatus, recordCount, memberCount }` (previously `{ id, title }` only) |

---

### `POST /api/projects`

Create a new project, optionally with a linked META·SIFT screening project (prompt6 Task 2).

**Request Body**
```json
{
  "name": "My Systematic Review",
  "createLinkedSift": true
}
```

| Field            | Type    | Required | Description |
|------------------|---------|----------|-------------|
| name             | string  | yes      | Display name for the project |
| createLinkedSift | boolean | no       | When `true`, also creates and links a META·SIFT `ScreenProject` server-side (same owner, same title, PICO snapshot, seeded exclusion reasons/keywords, owner member row). Default off — **legacy behavior and response shape are unchanged when omitted.** |

**Response 201 (default / `createLinkedSift` omitted)** — bare project object (legacy shape, unchanged):
```json
{
  "id": "a1b2c3d4",
  "name": "My Systematic Review",
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z",
  "studies": [],
  "records": []
}
```

**Response 201 (`createLinkedSift: true`)** — wrapper object:
```json
{
  "project": { "...": "project fields + _linkedMetaSift + _permissions" },
  "linkedScreenProject": { "id": "screenproject-uuid", "title": "My Systematic Review", "picoSnapshot": "{...}", "...": "raw ScreenProject row" }
}
```

If the SIFT-side creation fails, the META·LAB project is **never rolled back** — the response is `201 { project, linkedScreenProject: null, warning: "Project created, but the linked META·SIFT screening project could not be created. ..." }`.

**Error 400** — missing or empty `name`.

---

### `GET /api/projects/:id`

Fetch the full project including its studies and records arrays. Accessible to the owner and to workspace members with META·LAB view permission. Carries the workspace annotations.

**Response 200** — Full project object (same shape as POST 201 above, plus annotations).

**Error 404** — project not found **or caller has no access** (outsiders are never told the project exists).

---

### `PUT /api/projects/:id`

Partial update of top-level project fields. The `id`, `studies`, and `records` fields are protected and cannot be overwritten through this endpoint (use the dedicated studies/records routes).

**Access (prompt6 Tasks 5/18):**
- **Owner** — 200, bare updated project (legacy shape).
- **Workspace member with edit permission** (owner/leader role or `canEditMetaLab`, not read-only) — 200, annotated project (same shape as the member GET).
- **Member without edit permission (viewer/read-only)** — **403** `{ "error": "Read-only access — you do not have permission to edit this project" }`.
- **Outsider** — 404.

**Rename sync (sync-if-in-sync):** when `name` changes and a linked `ScreenProject`'s title equals the *old* name, the linked title is updated too (and vice versa from the META·SIFT side). Titles that had already diverged are never touched. Sync is best-effort — a sync failure never fails the rename. This is the documented Task 18 behavior: one shared workspace title while the two stay equal; independent titles once they diverge.

**Request Body** — any subset of project fields:
```json
{
  "name": "Updated Review Name",
  "description": "A review of interventions for..."
}
```

**Response 200** — Updated full project object.

**Error 403** — member without edit permission.
**Error 404** — project not found / no access.

---

### `DELETE /api/projects/:id`

**Soft-delete** — marks the project as deleted (`deletedAt`, `deletedSource:'owner'`) so it is hidden from all lists including the owner's. The project data is not physically removed from the database. Owner-deleted projects return 404 on direct access; an admin can restore them via `PATCH /api/admin/projects/:id/restore`. Prefer `POST /api/projects/:id/delete` for owner-initiated deletion (requires typed-name confirmation). See prompt 9 additions below for full semantics.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project not found.

---

### `PUT /api/projects/:id/autosave`

Upserts the full project payload sent by the client-side `window.storage` bridge. Accepts the complete project object including `studies[]`, `records[]`, and all nested fields. Client-side IDs (short base-36 strings such as `"a3b2c1d4"`) are accepted and preserved as the project ID.

**Request Body** — Full project object:
```json
{
  "name": "My Systematic Review",
  "studies": [ { "id": "s1a2b3c4", "author": "Smith et al.", "es": 1.45 } ],
  "records": [ { "id": "r1a2b3c4", "title": "Effect of X on Y", "decision": "include" } ],
  "pico": { "population": "Adults with T2DM", "intervention": "SGLT2i" }
}
```

**Response 200** — Saved project object.

> **Pinned contract (do not change):** autosave **never returns 4xx for access reasons**. A workspace member, a read-only member, or a caller with no access gets `200 { "id": "...", "skipped": true, "readOnly": <bool>, "reason": "..." }` — the project is simply not written. Even a foreign-owner race in the owner path maps to `200 + skipped` (was a 500 before prompt6). Rationale: the client bridge PUTs **all** projects in one batch; a 4xx on a shared read-only project would lose the user's *own* edits. Read-only enforcement happens on `PUT /api/projects/:id`, export, and import instead.

**Error 400** — `name` is missing or not a string.

---

### `POST /api/projects/:id/duplicate`

Creates a copy of the specified project with a new server-generated ID. The copy's name gets a ` (copy)` suffix.

**Response 201** — The duplicate project object with a new `id`.

**Error 404** — original project not found.

---

### `POST /api/projects/:id/archive`   *(prompt11, owner-only)*

Archives the project. Archived projects are hidden from `GET /api/projects` unless `?includeArchived=1` is passed. Best-effort cascades to the linked META·SIFT workspace (sets `ScreenProject.archived=true` when `linkedMetaLabProjectId===id` and the owner matches). Records usage event `PROJECT_ARCHIVED` and writes an audit entry on the linked workspace if present.

**Access:** owner-only (404 if not found or not owned).

**Response 200**
```json
{ "archived": true, "archivedAt": "2026-06-13T12:00:00.000Z" }
```

**Error 404** — project not found or caller is not the owner.

---

### `POST /api/projects/:id/unarchive`   *(prompt11, owner-only)*

Unarchives the project (clears `archived` flag and `archivedAt`). Best-effort cascades the unarchive to the linked META·SIFT workspace. Records usage event `PROJECT_UNARCHIVED`.

**Access:** owner-only (404 if not found or not owned).

**Response 200**
```json
{ "archived": false }
```

**Error 404** — project not found or caller is not the owner.

---

### `POST /api/screening/projects/:pid/archive`   *(prompt11, owner-only)*

Archives the META·SIFT Review Workspace directly (i.e. the `ScreenProject` row). Owner-only (`ScreenProject.ownerId === req.user.id`). Writes an audit entry (`PROJECT_ARCHIVED`) and records usage event `WORKSPACE_ARCHIVED`. Can be triggered independently of the META·LAB project archive or as a cascade from it.

**Response 200**
```json
{ "archived": true }
```

**Error 403** — caller is not the workspace owner.  
**Error 404** — workspace not found.

---

### `POST /api/screening/projects/:pid/unarchive`   *(prompt11, owner-only)*

Unarchives the META·SIFT Review Workspace. Writes audit entry (`PROJECT_UNARCHIVED`) and records `WORKSPACE_UNARCHIVED` usage event.

**Response 200**
```json
{ "archived": false }
```

**Error 403** — caller is not the workspace owner.  
**Error 404** — workspace not found.

---

## Studies

All study endpoints are nested under a project.

### `GET /api/projects/:id/studies`

Returns all studies for the project.

**Response 200**
```json
[
  {
    "id": "s1a2b3c4",
    "author": "Smith et al.",
    "year": 2021,
    "esType": "OR",
    "es": 1.45,
    "lo": 1.10,
    "hi": 1.90
  }
]
```

**Error 404** — project not found.

---

### `POST /api/projects/:id/studies`

Add a new study to the project. All fields are optional — omitted fields use `mkStudy()` defaults. The `id` is always auto-generated.

**Request Body** — any study fields:
```json
{
  "author": "Smith et al.",
  "year": 2021,
  "esType": "OR",
  "es": 1.45,
  "lo": 1.10,
  "hi": 1.90,
  "n": 500,
  "design": "rct"
}
```

**Response 201** — The created study object (with auto-generated `id`).

**Error 404** — project not found.

---

### `PUT /api/projects/:id/studies/:studyId`

Partial update of a study. The `id` field is always preserved from the existing record.

**Request Body** — any subset of study fields:
```json
{
  "es": 1.52,
  "lo": 1.15,
  "hi": 2.00,
  "rob": "low"
}
```

**Response 200** — Updated study object.

**Error 404** — project or study not found.

---

### `DELETE /api/projects/:id/studies/:studyId`

Removes a study from the project.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project or study not found.

---

## Records

Citation records used for screening (title/abstract review). Nested under a project.

### `GET /api/projects/:id/records`

Returns all records for the project.

**Response 200**
```json
[
  {
    "id": "r1a2b3c4",
    "title": "Effect of X on Y: a randomised trial",
    "authors": "Smith J, Jones A",
    "year": "2021",
    "journal": "BMJ",
    "pmid": "12345678",
    "doi": "10.1136/bmj.xxx",
    "decision": "include",
    "notes": "Full text needed"
  }
]
```

**Error 404** — project not found.

---

### `POST /api/projects/:id/records`

Add a single citation record to the project. The `id` is always auto-generated.

**Request Body**
```json
{
  "title": "Effect of X on Y: a randomised trial",
  "authors": "Smith J, Jones A",
  "year": "2021",
  "journal": "BMJ",
  "pmid": "12345678",
  "doi": "10.1136/bmj.xxx",
  "decision": "pending",
  "notes": ""
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| title    | string | no       | Article title |
| authors  | string | no       | Author string |
| year     | string | no       | Publication year |
| journal  | string | no       | Journal name |
| pmid     | string | no       | PubMed ID |
| doi      | string | no       | DOI |
| decision | string | no       | `"pending"` \| `"include"` \| `"exclude"` (defaults to `"pending"`) |
| notes    | string | no       | Free-text screener notes |

**Response 201** — The created record object.

**Error 404** — project not found.

---

### `PUT /api/projects/:id/records/:recordId`

Partial update of a record (e.g., set screening decision or notes).

**Request Body**
```json
{
  "decision": "exclude",
  "notes": "Wrong population"
}
```

**Response 200** — Updated record object.

**Error 404** — project or record not found.

---

### `DELETE /api/projects/:id/records/:recordId`

Removes a record from the project.

**Response 200**
```json
{ "deleted": true }
```

**Error 404** — project or record not found.

---

## Meta-Analysis

All meta-analysis endpoints accept POST requests with a `studies` array. The `method` parameter defaults to `"random"` if omitted.

### Study object fields required for meta-analysis

At minimum each study must have `es` (effect size) and `se` (standard error) **or** `lo`/`hi` (95% CI bounds) from which SE can be derived. The `esType` field informs log-scale handling.

---

### `POST /api/meta/run`

Run a standard pooled meta-analysis.

**Request Body**
```json
{
  "studies": [ { "id": "s1", "author": "Smith", "es": 1.45, "lo": 1.10, "hi": 1.90, "esType": "OR" } ],
  "method": "random"
}
```

| Field   | Type   | Required | Values              |
|---------|--------|----------|---------------------|
| studies | array  | yes      | Array of Study objects |
| method  | string | no       | `"fixed"` \| `"random"` (default: `"random"`) |

**Response 200** — MetaResult object:
```json
{
  "k": 5,
  "pES": 1.42,
  "pSE": 0.11,
  "lo95": 1.21,
  "hi95": 1.67,
  "pval": 0.0001,
  "z": 3.84,
  "method": "random",
  "Q": 8.2,
  "Qpval": 0.085,
  "I2": 42.1,
  "I2desc": "moderate",
  "tau2": 0.03,
  "tau": 0.17,
  "W": 245.3,
  "fixed": { "es": 1.40, "se": 0.09, "lo": 1.24, "hi": 1.58 },
  "random": { "es": 1.42, "se": 0.11, "lo": 1.21, "hi": 1.67, "tau2": 0.03 },
  "hksj": { "es": 1.42, "se": 0.14, "lo": 1.15, "hi": 1.76, "t": 2.8, "df": 4, "pval": 0.048 },
  "predInt": { "lo": 0.98, "hi": 2.06 },
  "studies": [ { "id": "s1", "author": "Smith", "_es": 1.45, "_lo": 1.10, "_hi": 1.90, "_se": 0.136, "_w": 48.2 } ]
}
```

**Error 400** — missing/empty studies.  
**Error 422** — fewer than 2 valid studies.

---

### `POST /api/meta/sensitivity`

Runs leave-one-out analysis and influence diagnostics simultaneously.

**Request Body**
```json
{
  "studies": [ ... ],
  "method": "random"
}
```

**Response 200**
```json
{
  "leaveOneOut": [
    {
      "id": "s1",
      "author": "Smith",
      "pES": 1.38,
      "lo95": 1.15,
      "hi95": 1.65,
      "I2": 35.0,
      "tau2": 0.02
    }
  ],
  "influence": [
    {
      "id": "s1",
      "author": "Smith",
      "dffit": 0.12,
      "tau2Drop": 0.005,
      "I2Drop": 3.1,
      "influential": false
    }
  ]
}
```

**Error 400** — missing/empty studies.

---

### `POST /api/meta/subgroup`

Run meta-analysis separately within subgroups defined by a study field.

**Request Body**
```json
{
  "studies": [ ... ],
  "groupKey": "design",
  "method": "random"
}
```

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| studies  | array  | yes      | Array of Study objects |
| groupKey | string | yes      | Study field name to group by (e.g. `"design"`, `"rob"`, `"region"`) |
| method   | string | no       | `"fixed"` \| `"random"` (default: `"random"`) |

**Response 200** — SubgroupResult:
```json
{
  "groups": {
    "rct": { "k": 3, "pES": 1.35, "lo95": 1.10, "hi95": 1.65, "I2": 22.0 },
    "cohort": { "k": 2, "pES": 1.55, "lo95": 1.20, "hi95": 2.00, "I2": 55.0 }
  },
  "Qbetween": 2.1,
  "Qbetween_pval": 0.14,
  "df": 1
}
```

**Error 400** — missing studies or groupKey.

---

### `POST /api/meta/egger`

Run Egger's weighted regression test for funnel plot asymmetry (publication bias).

**Request Body**
```json
{
  "studies": [ ... ]
}
```

**Response 200** — EggerResult:
```json
{
  "intercept": 0.52,
  "slope": 0.88,
  "se_intercept": 0.31,
  "t": 1.68,
  "df": 8,
  "pval": 0.131,
  "bias": false
}
```

**Error 400** — missing studies.  
**Error 422** — fewer than 3 studies (minimum for Egger's test).

---

### `POST /api/meta/trimfill`

Run the trim-and-fill method to adjust for publication bias.

**Request Body**
```json
{
  "studies": [ ... ],
  "method": "random"
}
```

**Response 200** — TrimFillResult:
```json
{
  "k0": 2,
  "filled": [ { "id": "imputed_1", "es": 1.10, "se": 0.18, "imputed": true } ],
  "adjusted": { "es": 1.35, "lo": 1.12, "hi": 1.62 },
  "original": { "es": 1.42, "lo": 1.21, "hi": 1.67 }
}
```

**Error 400** — missing studies.  
**Error 422** — insufficient valid studies.

---

## Validation

### `POST /api/validation/check`

Validate a set of studies for poolability and per-study field errors.

**Request Body**
```json
{
  "studies": [ ... ]
}
```

**Response 200**
```json
{
  "poolability": {
    "ok": true,
    "blockers": [],
    "warnings": ["Studies mix RCT and cohort designs"],
    "valid": [ { "id": "s1", "author": "Smith", "es": 1.45 } ],
    "types": ["OR"],
    "designs": ["rct", "cohort"],
    "composition": {
      "total": 5,
      "nonPrimary": 0,
      "converted": 1,
      "primary": 4,
      "natures": ["primary"],
      "adj": ["adjusted"]
    }
  },
  "studyIssues": [
    {
      "studyId": "s1",
      "author": "Smith",
      "issues": [
        { "sev": "warn", "field": "rob", "msg": "Risk of bias not assessed" }
      ]
    }
  ],
  "typeWarnings": [
    { "sev": "warn", "id": "s2", "author": "Jones", "msg": "esType is OR but raw data suggests RR" }
  ]
}
```

**Error 400** — `studies` is not an array.

---

## Import / Export

### `POST /api/import/references`

Parse a citation text blob and import the records into a project. Auto-detects format (RIS, BibTeX, PubMed NBIB, EndNote XML, MEDLINE). Deduplicates by DOI, PMID, or normalised title+year.

**Request Body**
```json
{
  "text": "TY  - JOUR\nAU  - Smith, J\nTI  - Effect of ...\nER  -\n",
  "projectId": "a1b2c3d4"
}
```

| Field     | Type   | Required | Description |
|-----------|--------|----------|-------------|
| text      | string | yes      | Raw citation file contents |
| projectId | string | yes      | Target project ID |

**Response 200**
```json
{
  "imported": 12,
  "duplicates": 3,
  "total": 45,
  "format": "RIS",
  "records": [
    {
      "id": "r1a2b3c4",
      "title": "Effect of X on Y",
      "authors": "Smith J",
      "year": "2021",
      "journal": "BMJ",
      "pmid": "12345678",
      "doi": "10.1136/bmj.xxx",
      "decision": "pending",
      "notes": ""
    }
  ]
}
```

| Field      | Description |
|------------|-------------|
| imported   | Number of new (non-duplicate) records added |
| duplicates | Number of incoming records that were already present |
| total      | Total records in the project after import |
| format     | Detected citation format string |
| records    | Array of newly added record objects only |

**Access (prompt6 Task 5):** owner — 200; workspace member with edit permission — 200 (persisted via the membership path, ownership never reassigned); member without edit permission — **403** `{ "error": "Read-only access — you do not have permission to import references" }`; outsider — 404.

**Error 400** — missing `text` or `projectId`.  
**Error 403** — member without edit permission.  
**Error 404** — project not found / no access.

---

### `GET /api/export/project/:id`

Export the full project (including all studies and records) as a downloadable JSON file.

**Access (prompt6 Task 5):** owner — 200; workspace member with the META·LAB `canExport` flag (implicit for owner/leader) — 200; member without it — **403** `{ "error": "You do not have permission to export this project" }`; outsider — 404. All read-only presets ship `canExport: false`.

**Response 200**
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="My_Review_export.json"`
- Body: full project object

**Error 403** — member without export permission.  
**Error 404** — project not found / no access.

---

## Notifications

Per-user persistent notifications (prompt6 Task 1). Own router at `/api/notifications` behind `requireAuth` only — deliberately **not** under the rate-limited `/api/auth` or `/api/admin` mounts (the bell polls `unread-count`). All reads/writes are scoped to the authenticated user; touching another user's notification returns 404.

Notification types created today: `PROJECT_INVITE` (member added to a project; for pending invites the notification is created at registration via the claim-on-register hook) and `ROLE_CHANGED` (role/preset changed by someone else).

### Notification object

```json
{
  "id": "uuid",
  "userId": "uuid",
  "type": "PROJECT_INVITE",
  "title": "You were added to \"My Review\"",
  "message": "…",
  "app": "metalab | metasift | workspace",
  "relatedScreenProjectId": "uuid | null",
  "relatedWorkspaceId": "uuid | null",
  "relatedMetaSiftProjectId": "uuid | null",
  "relatedMetaLabProjectId": "uuid | null",
  "actorId": "uuid | null",
  "actorName": "string",
  "actorEmail": "string",
  "role": "preset/role granted (e.g. data_extractor)",
  "readAt": "ISO8601 | null",
  "dismissedAt": "ISO8601 | null",
  "createdAt": "ISO8601"
}
```

> `relatedWorkspaceId` and `relatedMetaSiftProjectId` are response **aliases** of `relatedScreenProjectId` — the Review Workspace IS the ScreenProject row.

### `GET /api/notifications`

Query: `?unread=1` (unread only) · `?all=1` (include dismissed) · `?page=&limit=` (default page 1, limit 50, max 200). Newest first. Dismissed notifications are hidden unless `?all=1`.

**Response 200** — `{ "notifications": [...], "total": 0, "unreadCount": 0 }` (`unreadCount` is always the caller's global unread count).

### `GET /api/notifications/unread-count`

**Response 200** — `{ "count": 0 }`. Unread = `readAt` null AND `dismissedAt` null. Cheap; polled by the bell every 30s (120s while SSE is healthy).

### `POST /api/notifications/:id/read`

Sets `readAt` (idempotent). **Response 200** — `{ "notification": {...} }`. **404** if the notification does not exist or belongs to another user.

### `POST /api/notifications/:id/dismiss`

Sets `dismissedAt` (idempotent). **Response 200** — `{ "notification": {...} }`. **404** as above.

### `POST /api/notifications/mark-all-read`

**Response 200** — `{ "updated": <count of rows marked read> }`.

---

## Realtime Events (SSE)

### `GET /api/events`

Server-Sent Events stream (prompt6 Task 7). Own router behind `requireAuth` only — never under rate-limited mounts (a reconnecting `EventSource` would burn those limiters). One stream per browser tab (the client hook enforces a shared singleton).

**Response 200** — `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Opens with `retry: 5000` and a `:connected` comment; a `:hb` comment heartbeat is sent every 25 seconds.

**Frames** are unnamed `data:` lines carrying one JSON **poke** — never content, never actor identity:

```json
{ "type": "project.updated", "projectId": "screenproject-uuid", "metaLabProjectId": "a1b2c3d4", "at": "ISO8601" }
```

Event types: `project.updated`, `members.changed`, `permissions.changed` (affected user only), `decision.saved`, `chat.message`, `status.changed`, `handoff.updated`, `notification.created`. Recipients are resolved at emit time from active workspace member rows + owner; clients react by refetching the relevant authorized endpoint (polling remains the fallback when the stream is down).

**Error 401** — no/invalid session cookie.

Full architecture, event catalog, and delivery semantics: `docs/manager/realtime-architecture.md`.

---

## Error Shape

All error responses follow this shape:

```json
{
  "error": "Human-readable description of the problem"
}
```

| Status | Meaning |
|--------|---------|
| 400    | Bad request — missing or invalid input |
| 401    | Not authenticated |
| 403    | Authenticated workspace **member** lacking the specific permission (edit/export/import). Outsiders never get 403 — they get 404 (existence-hiding) |
| 404    | Resource not found, or the caller has no access at all (project, study, record, or notification) |
| 422    | Unprocessable — input is structurally valid but cannot be computed (e.g., too few studies) |
| 500    | Internal server error |

---

## Common Data Types

### Project Object

```json
{
  "id": "a1b2c3d4",
  "name": "My Systematic Review",
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z",
  "studies": [ ],
  "records": [ ]
}
```

### Study Object (key fields)

| Field    | Type             | Description |
|----------|------------------|-------------|
| id       | string           | Auto-generated 8-char alphanumeric |
| author   | string           | Author string (e.g. "Smith et al.") |
| year     | number           | Publication year |
| esType   | string           | `"SMD"` \| `"MD"` \| `"OR"` \| `"RR"` \| `"HR"` \| `"COR"` \| `"PROP"` \| `"DIAG"` |
| es       | number \| null   | Effect size (point estimate) |
| lo       | number \| null   | 95% CI lower bound |
| hi       | number \| null   | 95% CI upper bound |
| se       | number \| null   | Standard error (derived from CI if not provided) |
| n        | number \| null   | Total sample size |
| design   | string           | Study design (e.g. `"rct"`, `"cohort"`, `"case_control"`) |
| rob      | string           | Risk of bias rating |
| weight   | number \| null   | Manual weight override (null = auto) |

### Record / Citation Object

| Field    | Type   | Description |
|----------|--------|-------------|
| id       | string | Auto-generated |
| title    | string | Article title |
| authors  | string | Author string |
| year     | string | Publication year |
| journal  | string | Journal name |
| pmid     | string | PubMed ID |
| doi      | string | DOI |
| abstract | string | Abstract text |
| decision | string | `"pending"` \| `"include"` \| `"exclude"` |
| notes    | string | Screener notes |

---

## Prompt 9 additions (2026-06-12)

### Notifications — combined open

- `POST /api/notifications/:id/opened` (auth) — the click-through endpoint: idempotently stamps `readAt`,
  `dismissedAt`, and `clickedAt` (each only if null) in one call and returns `{ notification }`.
  Foreign/unknown id → **404** (existence-hiding, same as `/read`). `/read`, `/dismiss`, `/mark-all-read`
  are unchanged; `opened` is additive. The bell calls `opened` and awaits it before any full-page
  `/app?project=` navigation (the request would otherwise be aborted by unload).

### Project lifecycle — soft delete

- `DELETE /api/projects/:id` keeps its wire contract (`{deleted:true}`, owner-scoped, 404 otherwise) but is
  now a **soft delete**: sets `deletedAt` + `deletedSource:'owner'`. Owner-deleted projects are hidden from
  every list **including the owner's** and return 404 on direct access; admin can see and restore them
  (`PATCH /api/admin/projects/:id/restore` clears both fields). Admin archive keeps its old semantics under
  `deletedSource:'admin'` (hidden from members, still visible to the owner).
- `POST /api/projects/:id/delete` (auth, owner-scoped) — typed-name confirmed delete.
  Body `{ confirmName, cascadeLinked? }`. `confirmName` must equal the project name (trimmed) →
  else **400** `{error:'Project name does not match'}`. With `cascadeLinked:true`, every live linked
  ScreenProject owned by the caller is soft-deleted too (audited before the mark, so the trail survives).
  Returns `{ deleted:true, cascaded:[screenProjectIds] }`.
- **Resurrection guard:** any save against a soft-deleted project is refused —
  `PUT /api/projects/:id` → 404; `PUT /api/projects/:id/autosave` → **200 `{id, skipped:true}`**
  (the pinned never-4xx autosave contract). A stale tab can no longer revive a deleted project.

### Public invite endpoints

- Mounted at `/api/invites` with a dedicated rate limiter. **Mount-order invariant:** public mounts must sit
  BEFORE the bare `'/api'` importExport router in `server/index.js` (that router applies `requireAuth` at
  router level and would 401 every unauthenticated `/api/*` request behind it).
- `GET /api/invites/:token` (**public**) — sanitized landing info for a pending invite:
  `{ projectName, inviterName, roleLabel, email (masked j***@e***.com), expiresAt }`.
  Not-found / revoked / already-accepted are indistinguishable → **404** `{error:'This invite is invalid or
  no longer available'}`. Expired → **410** `{error:'This invite has expired'}` (no oracle: the link holder
  already knows the invite existed). Tokens are 32-byte CSPRNG hex; only the SHA-256 hash is stored.
- `POST /api/invites/:token/accept` (auth) — binds the pending member row to the logged-in user
  (single-use: nulls the hash, stamps `inviteAcceptedAt`, activates the row) and returns
  `{ projectId, projectName }`. Works for accounts whose email differs from the invited address.
  Already-a-member callers consume the invite and get the same success shape.

### Auth

- `POST /api/auth/register` accepts an optional `inviteToken`; after user creation the invite is claimed
  best-effort (never fails or slows registration) alongside the legacy email-match claim. Email format is
  validated server-side (400 on invalid). When `appSettings.registrationOpen === false` → **403**
  `{error:'Registration is currently closed'}`.

### Maintenance gate

- When `appSettings.maintenanceMode === true`, non-staff API requests get **503**
  `{ error: <maintenanceMessage>, maintenance: true }`. Exempt: `/api/health`, `/api/version`,
  `/api/settings/public`, `/api/auth/*`, `/api/admin/*`, `/api/events`. Sessions with role admin|mod pass
  (JWT role claim; admin routes still DB-verify). 10s settings cache, busted on settings write. Default off.
