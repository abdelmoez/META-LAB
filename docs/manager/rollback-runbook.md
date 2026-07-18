# Rollback runbook (93.md §3.6)

How to get the previous working release serving again in seconds, and the
policy for the one thing a symlink flip cannot undo: the database.

## The fast path (application rollback)

Releases are immutable directories under `/opt/pecanrev/releases/`; the live
one is whatever `/opt/pecanrev/current` points at. Rolling back is a symlink
flip + PM2 reload + readiness poll — no rebuild, no `git`, no npm:

```bash
sudo bash /usr/local/bin/rollback.sh              # → the release before current
sudo bash /usr/local/bin/rollback.sh --list       # inspect what's available
sudo bash /usr/local/bin/rollback.sh 20260718120000-abc1234   # a specific release
```

(Installed from `deploy/rollback.sh`; keep it next to `metalab-deploy.sh`.)

The script polls `http://127.0.0.1:3001/api/health/ready` for up to 60s and
exits non-zero loudly if the rolled-back release doesn't go ready either.

**Automatic case:** `deploy/metalab-deploy.sh` already performs this rollback
itself whenever a fresh deploy fails its readiness gate — manual rollback is
for regressions discovered *after* a deploy went green (bad behavior, not bad
boot).

After a manual rollback, production is intentionally *behind* `origin/main`.
Fix forward: land the fix on `main` and let the normal deploy replace the
rolled-back state. Do not leave a rollback in place silently — the next push
to `main` will redeploy the broken code unless it contains the fix.

## Database migration rollback policy

The symlink flip reverts **code only**. Database state follows these rules:

1. **Never blindly reverse a migration that touched user data.** `prisma
   migrate` has no safe automatic "down" in production, and hand-written
   reversals of data-bearing changes (dropped/renamed columns, backfills)
   destroy data. A restored backup loses everything written since the backup.
   Reversal is a last resort for a corrupted database, executed via
   backup restore (`docs/manager/backup-restore.md`), accepting the data loss
   explicitly.
2. **Schema changes must be backward-compatible for at least one release**
   (this is what makes the fast path safe). Additive changes — new nullable
   columns, new tables, new plain indexes — are ignored by the previous
   release's code, so code rollback needs no DB action. This has been the
   repo's standing rule since the prompt9 deploy failure (see
   `deployment-readiness.md` §2's db-push-safety rule) and remains the rule
   under versioned migrations.
3. **Risky changes use expand-and-contract**, split across releases:
   - *Expand* (release N): add the new column/table alongside the old one;
     write to both, read from old.
   - *Migrate* (release N, background/idempotent): backfill new from old.
   - *Switch* (release N+1): read from new; keep writing both.
   - *Contract* (release N+2, only after N+1 is proven): stop writing old;
     drop it in its own tiny migration.
   A rollback at any step lands on a release that still understands the
   schema it finds.
4. **Rehearse on staging first.** Every migration is applied to staging and
   smoke-tested before production (`docs/manager/staging-deployment.md`).
   Migrations that pass staging and are backward-compatible make production
   rollback a pure code operation — which is the goal.

## Decision table

| Symptom | Action |
|---|---|
| Deploy failed its readiness gate | Nothing — the deploy script already rolled back; read its output + `pm2 logs` |
| Bad behavior found after a green deploy, schema unchanged | `rollback.sh`, then fix forward |
| Bad behavior after a deploy that ran an **additive** migration | `rollback.sh` — previous code ignores the new columns; fix forward |
| A migration itself failed mid-apply (postgres) | Do NOT flip anything yet: `npm run db:migrate:status:postgres`, resolve the failed migration (`prisma migrate resolve`), then decide; see `postgres-migration.md` |
| Data corruption / destructive migration applied in error | Incident: `docs/manager/incident-response.md` + restore from backup (`backup-restore.md`) — accept and announce the data-loss window |

## Verification after any rollback

```bash
curl -s http://127.0.0.1:3001/api/health/ready    # {"status":"ok",...}
curl -s https://pecanrev.com/api/version           # version matches the intended release
pm2 status                                         # single pecanrev-api, stable, no restart loop
pm2 logs pecanrev-api --lines 50                   # no error storm
```
