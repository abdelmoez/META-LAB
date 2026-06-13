# META·LAB Admin API Contract

All admin endpoints are under `/api/admin`. They require:
1. A valid `metalab_session` httpOnly cookie (JWT) — enforced by `requireAuth`.
2. A staff role verified **in the database on every request** (never trusting the JWT alone):
   - Most endpoints require `role = 'admin'` and `suspended = false` (`requireAdmin`).
   - A limited set is open to **mods** as well (`requireAdminOrMod`, per-route in `routes/admin.js`): `GET /console`, users read/edit/status/password-reset, and contact messages (+ replies, unread-count, mark-read). Metrics, settings, landing content, feature flags, audit log, security events, health, projects, role assignment, message delete, and **all** `/api/admin/screening/*` stay admin-only (mods get a 403 + SecurityEvent).
   - `GET /api/admin/console` returns `{ role, sections, emailConfigured }` — the capability descriptor the ops console renders from (mods get `sections: ["users","messages"]`).

Rate limit (reshaped in prompt6): **300 requests per 15 minutes per IP in production** (1000 otherwise). The two cheap console-polling GETs — `GET /console` and `GET /contact-messages/unread-count` — are **exempt**, so a mod polling its own badge can never rate-limit itself out of the console.

> Screening admin endpoints (`/api/admin/screening/*`) are documented in `screening-api-contract.md` → "Admin Control Panel — META·SIFT" (incl. the prompt6 `doneToday/doneThisWeek/doneThisMonth` metrics, linked/workspace columns, the expanded per-project `progress` + `memberProgress` blocks, and the `progressStatus` PATCH).

---

## 1. GET /api/admin/metrics

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "users": {
    "total": 42,
    "today": 3,
    "thisWeek": 10,
    "thisMonth": 28,
    "suspended": 1,
    "admins": 2
  },
  "projects": {
    "total": 100,
    "today": 5,
    "thisWeek": 20,
    "thisMonth": 60
  },
  "studies": 3500,
  "records": 820,
  "contactMessages": { "total": 15, "unread": 4 },
  "securityEvents": { "failedLogins7d": 7 },
  "logins": { "day": 5, "week": 12, "month": 30, "quarter": 38, "year": 41 },
  "db": "ok"
}
```

`logins` (prompt6 Task 9): **distinct** userIds with a successful login per **rolling**
window — past 24 hours / 7 days / 30 days / 90 days / 365 days — counted from the
`LoginEvent` table. One user logging in three times today moves `day` by exactly 1.
Monotonic: `day ≤ week ≤ month ≤ quarter ≤ year`.

---

## 1b. GET /api/admin/metrics/timeseries

**Auth:** admin required  
**Query params:**
- `days` — window size in days, default `14`, clamped to `[7, 90]`; non-numeric values fall back to the default

**Response:**
```json
{
  "days": [
    {
      "date": "2026-06-01",
      "logins": 5,
      "uniqueLogins": 3,
      "newUsers": 1,
      "newProjects": 2,
      "screeningDecisions": 40,
      "doneTransitions": 1,
      "contactMessages": 0,
      "failedLogins": 2
    }
  ]
}
```

**Behavior (prompt8 — ops console sparklines):**
- `days` is **ascending by date**, contains **exactly N entries** (zero-filled for
  empty days), and the **last entry is today** in server-local time. Buckets are
  local calendar days (`YYYY-MM-DD`), not UTC.
- Per-day sources:
  - `logins` — successful `LoginEvent` rows (`success = true`); `uniqueLogins` —
    **distinct** userIds among them that day
  - `newUsers` / `newProjects` — `User.createdAt` / `Project.createdAt`
  - `screeningDecisions` — `ScreenDecision.createdAt`
  - `doneTransitions` — `ScreenProjectStatusEvent` rows with `status = 'done'`
  - `contactMessages` — `ContactMessage.createdAt`
  - `failedLogins` — `SecurityEvent` rows with `type = 'FAILED_LOGIN'`
- Read-only: does **not** write to `AdminAuditLog` (same policy as `GET /metrics`).

---

## 2. GET /api/admin/users

**Auth:** admin required  
**Query params:**
- `search` — partial match on email or name
- `role` — `"user"` or `"admin"`
- `suspended` — `"true"` or `"false"`
- `page` — default 1
- `limit` — default 20, max 100

**Response:**
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "Alice",
      "role": "user",
      "suspended": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "lastActive": "2026-06-01T12:00:00.000Z",
      "projectCount": 3
    }
  ],
  "total": 42,
  "page": 1,
  "pages": 3
}
```

---

## 3. GET /api/admin/users/:id

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Alice",
  "role": "user",
  "suspended": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "lastActive": "2026-06-01T12:00:00.000Z",
  "updatedAt": "2026-06-05T09:00:00.000Z",
  "projectCount": 3
}
```
Returns 404 if not found.

---

## 4. PATCH /api/admin/users/:id/status

**Auth:** admin required  
**Request body:**
```json
{ "suspended": true }
```
**Behavior:**
- Cannot suspend admin users (400).
- Logs the action to `AdminAuditLog`.

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Alice",
    "role": "user",
    "suspended": true,
    "createdAt": "...",
    "lastActive": "..."
  }
}
```

---

## 5. GET /api/admin/projects

**Auth:** admin required  
**Query params:**
- `userId` — filter by owner
- `page` — default 1
- `limit` — default 20, max 100

**Response:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "userId": "uuid",
      "userEmail": "user@example.com",
      "owner": { "id": "uuid", "name": "Alice", "email": "user@example.com" },
      "name": "My Review",
      "status": "active",
      "linkedMetaSift": { "id": "screenproject-uuid", "title": "My Review" },
      "workspaceId": "screenproject-uuid",
      "createdAt": "...",
      "updatedAt": "...",
      "deletedAt": null,
      "studyCount": 45,
      "recordCount": 12
    }
  ],
  "total": 100
}
```

Prompt6 Task 11 additions: `owner` (`{id,name,email}` — `userId`/`userEmail` kept for
back-compat), `status` (`"active" | "archived"`, derived from `deletedAt`),
`linkedMetaSift` (`{id,title} | null` via the reverse `ScreenProject.linkedMetaLabProjectId`
lookup), and `workspaceId` (= the linked ScreenProject id, `null` when unlinked).

---

## 6. GET /api/admin/settings

**Auth:** admin required  
**Request body:** none  
**Response:**
```json
{
  "appSettings": { "appName": "META·LAB", "registrationOpen": true, ... },
  "landingContent": { "heroHeadline": "...", ... },
  "featureFlags": { "autosave": true, ... }
}
```

---

## 7. PUT /api/admin/settings

**Auth:** admin required  
**Request body:** (any combination of keys)
```json
{
  "appSettings": { "registrationOpen": false },
  "featureFlags": { "exportTools": false }
}
```
**Behavior:** Updates only the provided keys. Logs to `AdminAuditLog`.  
**Response:** Full updated settings object (same shape as GET /api/admin/settings).

---

## 8. GET /api/admin/landing-content

**Auth:** admin required  
**Response:** Parsed `landingContent` object from `SiteSetting`.

---

## 9. PUT /api/admin/landing-content

**Auth:** admin required  
**Request body:** Full or partial `landingContent` object  
**Response:** Updated `landingContent` object.  
Logs to `AdminAuditLog`.

---

## 10. GET /api/admin/feature-flags

**Auth:** admin required  
**Response:** Parsed `featureFlags` object.

---

## 11. PUT /api/admin/feature-flags

**Auth:** admin required  
**Request body:** Full or partial `featureFlags` object  
**Response:** Updated `featureFlags` object.  
Logs to `AdminAuditLog`.

---

## 12. GET /api/admin/audit-log

**Auth:** admin required  
**Query params:**
- `adminId` — filter by admin who performed the action
- `page`, `limit`

**Response:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "action": "SUSPEND_USER",
      "entityType": "User",
      "entityId": "uuid",
      "details": "{\"email\":\"...\",\"suspended\":true}",
      "ip": "127.0.0.1",
      "createdAt": "...",
      "admin": { "id": "uuid", "email": "admin@example.com", "name": "Admin" }
    }
  ],
  "total": 50
}
```

---

## 13. GET /api/admin/security-events

**Auth:** admin required  
**Query params:**
- `type` — `"FAILED_LOGIN"`, `"ADMIN_ACCESS_DENIED"`, `"RATE_LIMITED"`
- `page`, `limit`

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "type": "FAILED_LOGIN",
      "userId": null,
      "email": "attacker@example.com",
      "ip": "1.2.3.4",
      "userAgent": "...",
      "details": "{\"reason\":\"invalid_credentials\"}",
      "createdAt": "..."
    }
  ],
  "total": 200
}
```

---

## 14. GET /api/admin/contact-messages

**Auth:** admin required  
**Query params:**
- `read` — `"true"` or `"false"`
- `archived` — `"true"` or `"false"`
- `page`, `limit`

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "email": "sender@example.com",
      "name": "Bob",
      "subject": "Question",
      "message": "...",
      "read": false,
      "archived": false,
      "createdAt": "..."
    }
  ],
  "total": 15
}
```

---

## 14b. PATCH /api/admin/contact-messages/:id

**Auth:** admin required  
**Request body:** (at least one field required)
```json
{ "read": true, "archived": false }
```
**Response:**
```json
{ "message": { ...updated ContactMessage fields... } }
```

---

## 15. DELETE /api/admin/contact-messages/:id

**Auth:** admin required  
**Request body:** none  
**Behavior:** Permanently deletes the message. Logs to `AdminAuditLog`.  
**Response:** `{ "ok": true }`  
Returns 404 if not found.

---

## 16. GET /api/admin/health

**Auth:** admin required  
**Response:**
```json
{
  "status": "ok",
  "db": "ok",
  "env": "development",
  "version": "2.5.0",
  "uptime": 12345.6,
  "timestamp": "2026-06-07T17:00:00.000Z"
}
```

---

## Error responses

All endpoints return JSON errors in the form:
```json
{ "error": "Description of the problem" }
```

Common HTTP status codes:
- `400` — bad request / missing required fields
- `401` — not authenticated
- `403` — not an admin (or suspended)
- `404` — resource not found
- `429` — rate limited
- `500` — internal server error (no stack traces exposed)

---

## Prompt 9 additions (2026-06-12)

### Metrics (additive keys)

`GET /api/admin/metrics` gains six top-level groups (all counts, cheap queries):
`invites {pending, accepted, expired}` · `notificationsStats {sent, clicked, dismissed}` ·
`lifecycle {projectsDeleted, siftProjectsDeleted, membersLeft}` · `exportsByFormat {<format>: count}` ·
`emailStats {sent, failed}` · `linking {linkedWorkspaces, unlinkedSiftProjects, unlinkedMetaLabProjects}`.
Sources: pending/accepted/expired from the invite columns on ScreenProjectMember; clicked from
`Notification.clickedAt`; deletes from `deletedSource:'owner'` rows; membersLeft/exports/emails from the
new no-FK `UsageEvent` table (`type` ∈ EXPORT, EMAIL_SENT, EMAIL_FAILED, MEMBER_LEFT, PROJECT_DELETED,
INVITE_CREATED/ACCEPTED/REVOKED, NOTIFICATION_CLICKED; indexed `[type, createdAt]`).
`GET /api/admin/screening/metrics` gains `pendingInvites`, `acceptedInvites`, `expiredInvites`.

### Project lifecycle

- `PATCH /api/admin/projects/:id/archive` now stamps `deletedSource:'admin'`;
  `PATCH /api/admin/projects/:id/restore` clears `deletedAt` **and** `deletedSource` (so it also recovers
  owner-deleted projects). `GET /api/admin/projects` rows carry additive `deletedSource` + `deleted`.
- NEW `PATCH /api/admin/screening/projects/:id/restore` (admin) → `{ok:true}` | 400 not-deleted | 404;
  logs `RESTORE_SIFT_PROJECT`; admin screening project lists include deleted rows with
  `deleted`/`deletedAt`/`deletedSource`.

### Settings

New `appSettings` keys (all editable via `PUT /api/admin/settings`, seeded defaults in
`settingsController.DEFAULTS`): `notificationsEnabled` (gates the notification-creation chokepoint),
`emailInvitesEnabled` (gates invite emails), `defaultTheme` (`night`|`day` — first-visit fallback, exposed
publicly), `maintenanceMessage` (the 503 body text), `exportFormats` (allowlist shown in the export dialog),
`projectDeletion` (`'soft'` — policy display; hard delete is not exposed). **Now actually enforced:**
`registrationOpen` (register → 403 when false) and `maintenanceMode` (non-staff API → 503; see
api-contract.md). `GET /api/settings/public` additionally exposes top-level `defaultTheme` and
`maintenanceMessage`. `landingContent` gains `animationSpeed` (`off`|`slow`|`normal`|`fast`) — flows to the
landing page through the existing schemaless passthrough.

### Audit

Previously-unaudited writes now log: `UPDATE_SIFT_SETTINGS {updatedKeys}` (updateScreeningSettings),
`SIFT_PROJECT_STATUS {projectId, changes}` (updateScreeningProjectStatus), `RESTORE_SIFT_PROJECT`.
