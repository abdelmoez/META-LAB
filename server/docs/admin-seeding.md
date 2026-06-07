# META·LAB Admin Seeding

## Overview

Admin users can only be created via the seed script `server/scripts/seed-admins.js`. There is no UI pathway to create admins — this is by design to prevent privilege escalation through the application layer.

## Required Environment Variables

Add these to `server/.env` before running the script:

```env
ADMIN_EMAIL_1=your-first-admin@example.com
ADMIN_EMAIL_2=your-second-admin@example.com
ADMIN_SEED_PASSWORD=change-me-immediately-12chars
```

Requirements:
- `ADMIN_EMAIL_1` and `ADMIN_EMAIL_2` must both be set.
- `ADMIN_SEED_PASSWORD` must be at least 12 characters.

## How to Run the Seed Script

From the project root:

```bash
node server/scripts/seed-admins.js
```

Or from the `server/` directory:

```bash
cd server
node scripts/seed-admins.js
```

The script will print a summary like:

```
=== Admin Seed Summary ===
  admin1@example.com: created (role=admin)
  admin2@example.com: updated (role=admin, password reset, unsuspended)
=========================

Done. Remember to change admin passwords after first login.
```

## What Happens If Admins Already Exist

The script checks each email against the database:

- **If the user exists:** updates `role = 'admin'`, resets the password to the seed password, and sets `suspended = false`.
- **If the user does not exist:** creates a new user with `role = 'admin'` and the hashed seed password.

If there are admins in the database that are NOT in the seed list (e.g. a third admin added manually via SQL), the script will print a warning but will not remove them. It also warns if the total admin count after seeding would exceed 2.

## How to Change Admin Password After Seeding

Admin passwords set by the seed script are meant to be temporary. After the first login:

1. Use the profile/settings UI to change the password (if implemented).
2. Or re-run the seed script with a new `ADMIN_SEED_PASSWORD` value.

Never leave the default seed password in production.

## Warning: Do Not Create Admins Through the UI

The application does not expose any endpoint to set `role = 'admin'`. All admin creation must go through:
1. The seed script (recommended)
2. Direct database update via Prisma Studio (`npx prisma studio` from `server/`) — for emergency use only

Creating admins any other way bypasses the audit trail and security controls.

## Removing an Admin

To demote an admin back to a regular user:

```bash
# Via Prisma Studio
npx prisma studio
# Navigate to User, find the admin, set role = 'user'
```

Or directly via SQL:
```sql
UPDATE User SET role = 'user' WHERE email = 'former-admin@example.com';
```

Effect is immediate — the `requireAdmin` middleware always verifies from the DB.
