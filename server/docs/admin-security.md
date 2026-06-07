# META·LAB Admin Security

## Admin Role Enforcement

Admin access uses a two-layer check on every request:

1. **JWT layer** (`requireAuth`): Verifies the `metalab_session` httpOnly cookie. Attaches `req.user = { id, email, role }`. The role from the JWT is a hint only — it is never used to grant admin access.

2. **DB layer** (`requireAdmin`): Performs a live database lookup (`prisma.user.findUnique`) to verify `role = 'admin'` and `suspended = false`. If the DB check fails for any reason (wrong role, suspended account, DB error), access is denied with 403.

This means:
- A forged or stolen JWT with a spoofed role cannot gain admin access.
- Revoking admin privileges in the database takes immediate effect — no need to invalidate tokens.
- A suspended admin cannot access admin routes even with a valid token.

## Admin Route Rate Limiting

Admin routes have a dedicated rate limiter: **60 requests per 15 minutes per IP** (`express-rate-limit`). This is separate from the auth limiter (20 req/15 min) applied to `/api/auth`.

## Audit Logging Policy

Every state-changing admin action is recorded in the `AdminAuditLog` table via `logAdminAction()` in `server/utils/audit.js`. Logged fields:

| Field       | Description |
|-------------|-------------|
| adminId     | ID of the admin who acted |
| action      | Action type (e.g. `SUSPEND_USER`, `UPDATE_SETTING`, `DELETE_MESSAGE`) |
| entityType  | Type of affected entity (`User`, `SiteSetting`, `ContactMessage`, etc.) |
| entityId    | ID of the affected entity |
| details     | JSON blob with before/after context or relevant metadata |
| ip          | Client IP from `req.ip` |
| userAgent   | Browser/client user-agent |
| createdAt   | Timestamp (auto, UTC) |

Audit failures are swallowed (`console.error` only) — they never break the main operation.

Actions currently logged:
- `SUSPEND_USER` / `UNSUSPEND_USER`
- `UPDATE_SETTING` (for appSettings, landingContent, featureFlags)
- `DELETE_MESSAGE`

## Failed Login Tracking

Every failed login attempt (wrong password or non-existent email) is recorded in `SecurityEvent` with:
- `type = 'FAILED_LOGIN'`
- `email` — the attempted email
- `ip`, `userAgent`
- `details = { reason: 'invalid_credentials' }`

These events are queryable via `GET /api/admin/security-events?type=FAILED_LOGIN`. The last 7 days of failed logins are surfaced in `GET /api/admin/metrics`.

## Security Events

The `SecurityEvent` table records security-relevant incidents:

| Type                  | When recorded |
|-----------------------|---------------|
| `FAILED_LOGIN`        | On every failed login attempt |
| `ADMIN_ACCESS_DENIED` | When a non-admin (or suspended admin) hits an admin route |
| `RATE_LIMITED`        | Reserved for future rate-limit middleware integration |

## Revoking Admin Access

To revoke an admin user's admin privileges immediately:

1. In the database, set `role = 'user'` for the target user:
   ```sql
   UPDATE User SET role = 'user' WHERE email = 'former-admin@example.com';
   ```
   Or use Prisma Studio: `npx prisma studio` from `server/`.

2. Effect is immediate — the `requireAdmin` DB check will deny access on the next request, regardless of any existing session cookie.

3. To also invalidate their session, clear the `metalab_session` cookie from the client side, or wait for the JWT to expire (7 days).

To suspend an admin (block login + admin access):
- Use `PATCH /api/admin/users/:id/status` with `{ "suspended": true }` from another admin account (note: the API blocks suspending admins — you must change role to 'user' first).
- Or directly set `suspended = true` in the database.

## Passwords

- Passwords are always hashed with bcrypt (12 rounds) via `server/auth/password.js`.
- Passwords are never stored plain-text, never returned in API responses, never logged.
- Admin passwords are set only via the `seed-admins.js` script.

## Admin Creation Policy

Admins can only be created or promoted via the seed script (`server/scripts/seed-admins.js`). There is no UI pathway to grant admin role. This is intentional — it prevents privilege escalation through the application layer.
