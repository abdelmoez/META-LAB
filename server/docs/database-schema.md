# META·LAB Database Schema

**Provider:** SQLite (via Prisma ORM)  
**ORM:** Prisma 5.x  
**Location:** `server/prisma/dev.db` (local dev) — path configured in `server/.env` via `DATABASE_URL`

---

## Models

### User

Stores authenticated user accounts. Passwords are **always** stored as bcrypt hashes — never plain text.

| Column       | Type      | Constraints         | Description |
|--------------|-----------|---------------------|-------------|
| id           | String    | PK, UUID default    | Unique user identifier |
| email        | String    | Unique, not null    | Login email (lowercased and trimmed on write) |
| name         | String?   | Nullable            | Display name |
| password     | String    | Not null            | bcrypt hash (12 rounds) — never returned in API responses |
| role         | String    | Default: "user"     | `"user"` or `"admin"` — only set via seed script |
| suspended    | Boolean   | Default: false      | If true, login is blocked and admin access is denied |
| createdAt    | DateTime  | Default: now()      | Account creation timestamp |
| updatedAt    | DateTime  | Auto-updated        | Last record update timestamp |
| lastActive   | DateTime? | Nullable            | Set on login, profile update, password change, and (since prompt6) throttled to one write per user per 5 minutes on any authenticated request via `requireAuth` (in-memory throttle map, fire-and-forget) |

**Relations:** one User has many Projects (cascade delete), one User has many AdminAuditLog records.

---

### Project

Stores systematic review projects. Uses a "fat blob" pattern: only core identity columns are first-class; all domain data (PICO, search strategy, settings) is serialized to the `data` JSON column.

| Column       | Type      | Constraints           | Description |
|--------------|-----------|-----------------------|-------------|
| id           | String    | PK                    | Project identifier — may be a client-provided base-36 string or a UUID |
| userId       | String    | FK → User.id          | Owner; enforced on every query |
| name         | String    | Not null              | Display name |
| data         | String    | Default: "{}"         | JSON-serialized payload: studies[], records[], pico, search, etc. |
| createdAt    | DateTime  | Default: now()        | Creation timestamp |
| updatedAt    | DateTime  | Auto-updated          | Last DB write timestamp |
| deletedAt    | DateTime? | Nullable              | Soft-delete marker (not yet used by queries; reserved for future trash-bin feature) |
| lastSavedAt  | DateTime? | Nullable              | Reserved for client-driven "last autosave" tracking |

**Note:** Studies and records are stored inside the `data` blob, not as separate table rows. This keeps the store simple and avoids N+1 joins on project load.

---

### ContactMessage

Stores inbound contact form submissions.

| Column    | Type      | Constraints      | Description |
|-----------|-----------|------------------|-------------|
| id        | String    | PK, UUID default | Unique message ID |
| email     | String    | Not null         | Sender's email address |
| name      | String?   | Nullable         | Sender's name |
| subject   | String?   | Nullable         | Message subject |
| message   | String    | Not null         | Message body |
| read      | Boolean   | Default: false   | Whether an admin has viewed the message |
| archived  | Boolean   | Default: false   | Whether the message has been archived |
| createdAt | DateTime  | Default: now()   | Submission timestamp |

---

### SiteSetting

Key–value store for application-wide configuration. Values are JSON-serialised strings.

| Column    | Type      | Constraints      | Description |
|-----------|-----------|------------------|-------------|
| key       | String    | PK               | Setting key (e.g. `appSettings`, `landingContent`, `featureFlags`) |
| value     | String    | Not null         | JSON-serialised value |
| updatedAt | DateTime  | Auto-updated     | Last modification timestamp |
| updatedBy | String?   | Nullable         | Admin userId who last changed this setting |

---

### AdminAuditLog

Immutable record of every admin action. Entries are created by `server/utils/audit.js` and are never deleted through the application.

| Column     | Type      | Constraints      | Description |
|------------|-----------|------------------|-------------|
| id         | String    | PK, UUID default | Log entry ID |
| adminId    | String    | FK → User.id     | Admin who performed the action |
| action     | String    | Not null         | Action type: `SUSPEND_USER`, `UPDATE_SETTING`, `DELETE_MESSAGE`, etc. |
| entityType | String?   | Nullable         | Type of affected entity: `User`, `SiteSetting`, `ContactMessage` |
| entityId   | String?   | Nullable         | ID of the affected entity |
| details    | String?   | Nullable         | JSON-serialised context (before/after values, etc.) |
| ip         | String?   | Nullable         | Client IP from `req.ip` |
| userAgent  | String?   | Nullable         | Client user-agent string |
| createdAt  | DateTime  | Default: now()   | Log creation timestamp |

---

### SecurityEvent

Records security-relevant incidents for monitoring and alerting.

| Column    | Type      | Constraints      | Description |
|-----------|-----------|------------------|-------------|
| id        | String    | PK, UUID default | Event ID |
| type      | String    | Not null         | `FAILED_LOGIN`, `ADMIN_ACCESS_DENIED`, `RATE_LIMITED` |
| userId    | String?   | Nullable         | Authenticated user ID (if known) |
| email     | String?   | Nullable         | Attempted email (for FAILED_LOGIN) |
| ip        | String?   | Nullable         | Client IP |
| userAgent | String?   | Nullable         | Client user-agent |
| details   | String?   | Nullable         | JSON-serialised extra info |
| createdAt | DateTime  | Default: now()   | Event timestamp |

---

### Notification (prompt6)

Per-user persistent notifications (bell). The "Review Workspace" is the `ScreenProject` row — `relatedScreenProjectId` doubles as the `workspaceId` exposed in API responses.

| Column                  | Type      | Constraints      | Description |
|-------------------------|-----------|------------------|-------------|
| id                      | String    | PK, UUID default | Notification ID |
| userId                  | String    | Not null         | Recipient (no FK — see rationale below) |
| type                    | String    | Not null         | `PROJECT_INVITE`, `ROLE_CHANGED`, … |
| title                   | String    | Not null         | Display title |
| message                 | String    | Default: ""      | Body text |
| app                     | String    | Default: ""      | `metalab` \| `metasift` \| `workspace` |
| relatedScreenProjectId  | String?   | Nullable         | Linked ScreenProject (= workspaceId) |
| relatedMetaLabProjectId | String?   | Nullable         | Linked META·LAB project |
| actorId                 | String?   | Nullable         | Who triggered it (may be unknown for claim-on-register) |
| actorName / actorEmail  | String    | Default: ""      | **Denormalized** so the notification survives actor deletion |
| role                    | String    | Default: ""      | Role/preset granted (invite notifications) |
| readAt / dismissedAt    | DateTime? | Nullable         | Read/dismiss state (unread = both null) |
| createdAt               | DateTime  | Default: now()   | Creation timestamp |

**Indexes:** `[userId, readAt]` (unread-count poll), `[userId, createdAt]` (list, newest first).

---

### LoginEvent (prompt6)

Login events for the ops unique-login metrics. Kept **separate from `SecurityEvent`** so high-volume successful logins don't pollute the security forensics table (and SecurityEvent has no indexes suited to window queries).

| Column    | Type     | Constraints      | Description |
|-----------|----------|------------------|-------------|
| id        | String   | PK, UUID default | Event ID |
| userId    | String   | Not null         | User who attempted login (no FK — see rationale) |
| email     | String   | Default: ""      | Login email |
| ip        | String   | Default: ""      | Client IP |
| userAgent | String   | Default: ""      | Client user-agent |
| success   | Boolean  | Default: true    | `true` on success; `false` for wrong-password (existing user) and suspended attempts. Unknown emails are not recorded here (they stay in SecurityEvent `FAILED_LOGIN`) |
| createdAt | DateTime | Default: now()   | Event timestamp |

**Indexes:** `[createdAt]`, `[userId, createdAt]`. Metrics = `COUNT(DISTINCT userId)` per rolling window. Writes are fire-and-forget in the login path.

---

### ScreenProjectStatusEvent (prompt6)

History of `ScreenProject.progressStatus` transitions — written only on a **real** change, by both the member-facing (`PUT /api/screening/projects/:pid`) and admin (`PATCH /api/admin/screening/projects/:id/status`) endpoints. "Done today" = `COUNT(DISTINCT projectId) WHERE status='done' AND createdAt >= startOfDay` — distinct-by-project makes toggle-twice count once.

| Column         | Type     | Constraints      | Description |
|----------------|----------|------------------|-------------|
| id             | String   | PK, UUID default | Event ID |
| projectId      | String   | Not null         | ScreenProject (no FK cascade — history survives) |
| status         | String   | Not null         | New `progressStatus` |
| previousStatus | String   | Default: ""      | Prior value |
| changedById    | String   | Default: ""      | Actor user ID |
| changedByName  | String   | Default: ""      | Denormalized actor name/email |
| createdAt      | DateTime | Default: now()   | Transition timestamp |

**Indexes:** `[status, createdAt]` (the done-today metric), `[projectId, createdAt]`.

---

### ScreenImportBatch — fingerprint columns (prompt6)

Five additive columns on the existing `ScreenImportBatch` model for duplicate-import prevention (all nullable/defaulted so legacy rows migrate clean and never match the pre-check):

| Column         | Type    | Constraints   | Description |
|----------------|---------|---------------|-------------|
| fileHash       | String? | Nullable      | SHA-256 of the CRLF→LF-normalized file content, computed **server-side** |
| fileSize       | Int?    | Nullable      | `Buffer.byteLength` of the raw content |
| importedById   | String? | Nullable      | Importing user ID |
| importedByName | String  | Default: ""   | Denormalized importer name/email (shown in the 409 warning) |
| parser         | String  | Default: ""   | Detected parser/format used |

**New index:** `[projectId, fileHash]` — the per-project duplicate pre-check (`409 duplicate_import` unless `force:true`).

Also new in prompt6: `@@index([linkedMetaLabProjectId])` on **ScreenProject** — the linked-display, member-visibility, and ops reverse lookups all query by it.

---

### Why no FK to User on the new tables

`Notification`, `LoginEvent`, and `ScreenProjectStatusEvent` deliberately store bare `userId`/actor strings with **no foreign key** to `User` (the `SecurityEvent` precedent): ops metrics, status history, and notification rows must survive user deletion, and a cascade would silently erase audit-relevant history. Actor display fields are denormalized (`actorName`/`actorEmail`/`changedByName`) for the same reason.

---

## Migrations

Migration files live in `server/prisma/migrations/`. Each migration has a timestamped directory containing `migration.sql`.

| Migration name                            | Description |
|-------------------------------------------|-------------|
| `20260607134620_init`                     | Initial schema: User and Project models |
| `20260607145855_add_autosave_profile_contact` | Added `User.lastActive`, `Project.deletedAt`, `Project.lastSavedAt`, and the `ContactMessage` model |
| `20260607170903_admin_roles_settings_audit` | Added `User.role`, `User.suspended`, `ContactMessage.read`, `ContactMessage.archived`; new models: `SiteSetting`, `AdminAuditLog`, `SecurityEvent` |
| `20260608065320_add_metasift_screening`   | META·SIFT `Screen*` data model (ScreenProject, ScreenRecord, ScreenDecision, labels/reasons/duplicates/conflicts/import batches) |
| `20260608213133_metasift_collab_upgrade`  | Collaboration upgrade: members, two-stage workflow, chat, PDFs, admin lifecycle columns, audit log |
| `20260609044944_add_handoff_status_promotedvia` | `ScreenRecord` handoff-status + `promotedVia` columns |
| `20260609164836_add_chat_read_state`      | `ScreenChatRead` (per-user chat unread state) |
| `20260609220139_workspace_perms_and_contact_replies` | Member module-permission flags (Review Workspace presets), `ContactReply`, `ContactMessage.replied` |
| `20260609230000_add_contact_message_read` | `ContactMessageRead` (per-staff message read receipts) |
| `20260610034844_prompt6_notifications_logins_status_fingerprint` | **prompt6 (additive, no destructive changes — all data preserved):** new `Notification`, `LoginEvent`, `ScreenProjectStatusEvent` tables; `ScreenImportBatch` fingerprint columns (`fileHash`, `fileSize`, `importedById`, `importedByName`, `parser`) + `[projectId, fileHash]` index; `@@index([linkedMetaLabProjectId])` on `ScreenProject` |

---

## Security Invariants

- `userId` is enforced on **every** `Project` query — users can never access another user's projects.
- The `password` column is **never** selected in API responses; only hashed with bcrypt (12 rounds).
- The `data` column must only contain serialized JSON, never executable content.
- `DATABASE_URL` is stored in `server/.env` which is gitignored — never committed.
