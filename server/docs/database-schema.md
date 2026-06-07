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
| createdAt    | DateTime  | Default: now()      | Account creation timestamp |
| updatedAt    | DateTime  | Auto-updated        | Last record update timestamp |
| lastActive   | DateTime? | Nullable            | Set on profile update and password change |

**Relations:** one User has many Projects (cascade delete).

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
| createdAt | DateTime  | Default: now()   | Submission timestamp |

---

## Migrations

Migration files live in `server/prisma/migrations/`. Each migration has a timestamped directory containing `migration.sql`.

| Migration name                            | Description |
|-------------------------------------------|-------------|
| `20260607134620_init`                     | Initial schema: User and Project models |
| `20260607145855_add_autosave_profile_contact` | Added `User.lastActive`, `Project.deletedAt`, `Project.lastSavedAt`, and the `ContactMessage` model |

---

## Security Invariants

- `userId` is enforced on **every** `Project` query — users can never access another user's projects.
- The `password` column is **never** selected in API responses; only hashed with bcrypt (12 rounds).
- The `data` column must only contain serialized JSON, never executable content.
- `DATABASE_URL` is stored in `server/.env` which is gitignored — never committed.
