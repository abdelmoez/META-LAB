# Staging deployment (93.md §3.3)

The full staging pattern: an isolated instance that runs **production
hardening** (`NODE_ENV=production`) while sharing **nothing** with production
— no database, no secrets, no email delivery, no storage, no Sentry stream.
Staging exists for one reason: **everything risky (especially migrations)
happens there first.**

## The isolation contract

| Concern | Production | Staging | Enforced by |
|---|---|---|---|
| Hostname | `pecanrev.com` | `staging.pecanrev.com` | nginx staging server block (`deploy/nginx/pecanrev.conf.example`) |
| Port | 3001 | 3002 | staging `server/.env` (`PORT=3002`) |
| Main DB | `/var/lib/metalab/prod.db` → PG `pecanrev` | staging-only file → PG `pecanrev_staging` (Neon branch / separate project) | separate `DATABASE_URL`/`POSTGRES_*` |
| Waitlist DB | isolated prod file/DB | isolated staging file/DB | separate `BETA_WAITLIST_DATABASE_URL` |
| JWT secret | production value | **fresh staging-only value** (a shared secret would make staging cookies valid on prod) | separate `JWT_SECRET` |
| Email | real delivery via Brevo | `EMAIL_REDIRECT_ALL_TO=team@…` — every message diverted to the team inbox (+ optional `EMAIL_ALLOWLIST`) | staging env file |
| Sentry | `SENTRY_ENVIRONMENT=production` | `SENTRY_ENVIRONMENT=staging` (separate DSN ideal) | staging env file |
| Uploads/storage | `/opt/pecanrev/shared/storage` | staging checkout's own storage dir | separate checkout |
| Identity | — | `APP_ENV=staging` (admin-visible staging banner, Sentry env, email protection) | env file / PM2 `env_staging` |

Template with all values + warnings: **`server/.env.staging.example`** — copy
to the staging instance's `server/.env`, fill values, `chmod 600`.

**Staging must never point at production user data.** If a rehearsal needs
realistic volume, restore a backup into the *staging* DB (which doubles as a
restore test — record it in `backup-restore.md` §4) or use seeded test data.

## Bringing staging up

**Dedicated staging host** (cleanest): identical to production —
`deploy/metalab-deploy.sh` with `APP_DIR=/opt/pecanrev`, staging values in
`shared/server.env`, and `pm2 start ecosystem.config.cjs --env staging`.

**Shared host with production** (typical for beta): a second release tree +
its own PM2 name (the ecosystem file's `pecanrev-api` name would collide):

```bash
# One-time bootstrap
sudo mkdir -p /opt/pecanrev-staging/shared/storage
sudo git clone <repo-url> /opt/pecanrev-staging/repo
sudo cp server/.env.staging.example /opt/pecanrev-staging/shared/server.env   # then EDIT + chmod 600
# The staging env file already sets NODE_ENV=production, APP_ENV=staging, PORT=3002

# Each staging deploy (same script, different root + no port clash):
sudo APP_DIR=/opt/pecanrev-staging \
     HEALTH_URL=http://127.0.0.1:3002/api/health/ready \
     DEPLOY_REF=origin/main \
     bash /usr/local/bin/metalab-deploy.sh
```

Caveat for the shared host: `metalab-deploy.sh` reloads via the ecosystem file
(name `pecanrev-api`). For the staging tree, start/reload its process under a
distinct name instead (the app reads all env from its own `server/.env`):

```bash
cd /opt/pecanrev-staging/current
pm2 start server/index.js --name pecanrev-api-staging --time \
  --kill-timeout 20000 --max-memory-restart 900M
pm2 save
# subsequent deploys: pm2 reload pecanrev-api-staging (after the symlink flip)
```

Frontend build note: `VITE_*` vars (e.g. `VITE_SENTRY_DSN`,
`VITE_SENTRY_ENVIRONMENT=staging`) are baked at build time — put staging
values in the staging tree's **root** `.env` so its `npm run build` embeds
them (see `sentry-setup.md`).

nginx: the staging server block in `deploy/nginx/pecanrev.conf.example`
proxies `staging.example.com` → `127.0.0.1:3002` with identical SSE/API
semantics. DNS for `staging.` + the TLS cert are external
(`deploy/nginx/README.md`).

## Migration rehearsal flow (the point of staging — 93.md §2.2)

Every schema change rides this pipeline; production never sees an untested
migration:

1. **Develop locally** — edit the canonical schema, generate a versioned
   migration (`postgres-migration.md` § Versioned migration workflow).
2. **Apply to staging**: deploy the branch/ref to staging —
   `metalab-deploy.sh` runs `npm run db:migrate:deploy:postgres` (or the
   transitional sqlite `db push`) against the **staging** DB.
3. **Smoke staging**:
   ```bash
   curl -s http://127.0.0.1:3002/api/health/ready         # 200, database ok
   SMOKE_BASE=https://staging.pecanrev.com node scripts/smoke-deploy.mjs
   npm run db:migrate:status:postgres                      # from server/, staging env: nothing pending
   ```
   plus a manual pass over the workflows the migration touches.
4. **Only then production**: merge/push to `main` (or run the deploy script
   with the same pinned ref) — production applies the *exact same* committed
   migrations. Rollback story: `rollback-runbook.md` (backward-compatible
   migrations make code rollback a pure symlink flip).

## Safe seeded test data

Staging accounts come from the seeded admins (`ADMIN_EMAIL_*` +
`ADMIN_SEED_PASSWORD` in the staging env file, staging-only values) plus
ordinary registration on the staging host. Never copy production users in.
Email is redirected anyway, but data isolation is the primary defense, not the
redirect.
