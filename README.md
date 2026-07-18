# PecanRev

PecanRev is a systematic review and meta-analysis platform with screening, data
extraction, risk of bias, search building, project collaboration, and a complete
review workflow.

## Quickstart (local development)

Prerequisites: Node.js ≥ 20, git.

```bash
git clone <repo-url> pecanrev && cd pecanrev

# 1. Env files — copy the examples (defaults work for local dev as-is)
cp .env.example .env
cp server/.env.example server/.env

# 2. Install dependencies (root = frontend + tooling, server = API)
npm install
cd server && npm install          # postinstall also prepares the waitlist DB/client

# 3. Create the dev databases (both Prisma schemas)
npx prisma db push                # main schema  → server/prisma/dev.db
npm run db:ensure:waitlist        # waitlist schema → its own isolated SQLite file
cd ..

# 4. Run (Vite on :3000 + API on :3001, /api proxied)
npm run dev
```

Sign in with the seeded dev admin: **admin@example.com** with the
`ADMIN_SEED_PASSWORD` from your `server/.env` (accounts are ensured on boot;
details + password rotation: `server/docs/admin-seeding.md`).

Tests: `npm run test:unit` (hermetic) · `npm run test:integration` (needs the
API running on :3001; runs serially by design).

## Operations runbook index (93.md)

| Topic | Document |
|---|---|
| Production deploy script + rollback script | `deploy/metalab-deploy.sh`, `deploy/rollback.sh` |
| Deployment readiness / env / build | `docs/manager/deployment-readiness.md` |
| Production config (cookies, CORS, SSE, trust proxy) | `docs/manager/deployment-config.md` |
| nginx + TLS (certbot / Cloudflare) | `deploy/nginx/pecanrev.conf.example`, `deploy/nginx/README.md` |
| PM2 operation | `docs/manager/pm2-operations.md` |
| Rollback policy (code + DB migrations) | `docs/manager/rollback-runbook.md` |
| PostgreSQL migration + versioned migration workflow | `docs/manager/postgres-migration.md` |
| Staging environment + migration rehearsal | `docs/manager/staging-deployment.md`, `server/.env.staging.example` |
| Backup & restore verification | `docs/manager/backup-restore.md` |
| VPS hardening | `docs/manager/vps-hardening.md` |
| Secret rotation | `docs/manager/secret-rotation.md` |
| Security incident response | `docs/manager/incident-response.md` |
| Uptime monitoring | `docs/manager/uptime-monitoring.md` |
| Email domain auth (SPF/DKIM/DMARC) | `docs/manager/email-domain-auth.md` |
| Sentry (server + client) | `docs/manager/sentry-setup.md` |
| External launch checklist | `docs/manager/launch-checklist.md` |

## Production domain

PecanRev runs in production at **https://pecanrev.com**.

Local development uses **http://localhost:3000** (frontend) and
**http://localhost:3001** (API). In production, `APP_BASE_URL` and `CORS_ORIGIN`
must be set to the production domain (`https://pecanrev.com`). The runtime base URL
is env-driven, but note that `pecanrev.com` still appears as a hard-coded fallback /
UA string / support address in a few places (`server/routes/publicView.js`,
`server/routes/citation.js`, `server/pecanSearch/connectors/crossref.js`,
`src/features/publicSynthesis/PublicSynthesisPage.jsx`) — self-hosters should grep
for it (86.md P3.24).
