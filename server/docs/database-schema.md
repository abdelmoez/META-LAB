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
| lastActive   | DateTime? | Nullable            | Set on profile update and password change |

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

## Migrations

Migration files live in `server/prisma/migrations/`. Each migration has a timestamped directory containing `migration.sql`.

| Migration name                            | Description |
|-------------------------------------------|-------------|
| `20260607134620_init`                     | Initial schema: User and Project models |
| `20260607145855_add_autosave_profile_contact` | Added `User.lastActive`, `Project.deletedAt`, `Project.lastSavedAt`, and the `ContactMessage` model |
| `20260607170903_admin_roles_settings_audit` | Added `User.role`, `User.suspended`, `ContactMessage.read`, `ContactMessage.archived`; new models: `SiteSetting`, `AdminAuditLog`, `SecurityEvent` |

---

## Security Invariants

- `userId` is enforced on **every** `Project` query — users can never access another user's projects.
- The `password` column is **never** selected in API responses; only hashed with bcrypt (12 rounds).
- The `data` column must only contain serialized JSON, never executable content.
- `DATABASE_URL` is stored in `server/.env` which is gitignored — never committed.
