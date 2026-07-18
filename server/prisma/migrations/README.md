# Frozen SQLite-era migration history (93.md)

This directory is the FROZEN migration history from the SQLite era of the main
application database. Do NOT add new migrations here.

It is superseded by the versioned PostgreSQL migration workflow:

- `server/prisma/postgres/migrations/` — main DB (baseline `000000000000_init`)
- `server/prisma/postgres/waitlist-migrations/` — beta-waitlist DB baseline

Schema changes are made in the canonical SQLite schemas
(`server/prisma/schema.prisma`, `server/prisma/waitlist/schema.prisma`), applied
to dev SQLite via `prisma db push`, mirrored with
`npm run db:sync-postgres-schema`, and captured as a new timestamped PostgreSQL
migration via `npm run db:migrate:diff:postgres`. See `server/package.json`
(`db:migrate:*:postgres` scripts) and the "PostgreSQL migration workflow"
section of `server/.env.example`.
