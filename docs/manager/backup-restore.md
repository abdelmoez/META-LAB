# Backup & restore verification (93.md §2.5)

Backups that have never been restored are hopes, not backups. This runbook
defines what gets backed up, how, and — the part that actually matters — the
recurring scratch-restore test that proves the backups work.

## 1. Backup policy

| Store | What | How | When | Retention |
|---|---|---|---|---|
| Main DB (SQLite, transitional) | `/var/lib/metalab/prod.db` | `sqlite3 prod.db ".backup '/backups/prod-$(date -u +%F).db'"` — the online-safe copy method; **never** `cp` a live SQLite file | Nightly (cron) | 7 daily + 4 weekly, oldest pruned |
| Waitlist DB (SQLite) | the `BETA_WAITLIST_DATABASE_URL` file | same `.backup` ceremony | Nightly, same job | same |
| WAL checkpoint | before each backup | `sqlite3 prod.db "PRAGMA wal_checkpoint(TRUNCATE);"` so the `.backup` contains everything and the `-wal` file doesn't grow unbounded | Nightly, in the backup job | n/a |
| Uploaded files | `/opt/pecanrev/shared/storage/` (study docs, screening PDFs, exports) | `tar -czf /backups/storage-$(date -u +%F).tgz -C /opt/pecanrev/shared storage` (or rsync to the offsite target) | Nightly | 7 daily + 4 weekly |
| Main + waitlist DB (PostgreSQL, after cutover) | `pecanrev` + `pecanrev_waitlist` databases | **Provider snapshots** (Neon/Supabase point-in-time recovery — enable it in the provider dashboard: *external, requires provider account*) **plus** a nightly logical dump: `pg_dump --format=custom "$POSTGRES_DATABASE_URL" > /backups/pecanrev-$(date -u +%F).dump` (and the waitlist DB likewise) | Provider: continuous. `pg_dump`: nightly | Provider: per plan. Dumps: 7 daily + 4 weekly |
| Secrets | `/opt/pecanrev/shared/server.env` | encrypted copy in the team password manager — **not** in the plain backup set | On every change | current + previous |
| Offsite copy | everything above | sync `/backups/` to storage that does not share the VPS's fate (object storage / second host). *External: requires a provider/bucket decision* | Nightly, after local backup | mirror of local |

Backups containing user data must be **encrypted at rest** wherever they leave
the VPS (see `vps-hardening.md` § Backup encryption) and readable only by root
(`chmod 600`, `/backups` mode `700`).

Example cron (root, after installing `sqlite3`):

```cron
# /etc/cron.d/pecanrev-backup — nightly at 03:10 UTC
10 3 * * * root /usr/local/bin/pecanrev-backup.sh >> /var/log/pecanrev-backup.log 2>&1
```

(The backup script itself is a few lines assembled from the table's commands;
keep it dumb and readable. Alert if the log stops advancing — see
`uptime-monitoring.md`.)

## 2. Scratch restore procedure

Restore into a **scratch target** — never over the live data.

### SQLite (transitional)

```bash
mkdir -p /tmp/restore-test && cd /tmp/restore-test
cp /backups/prod-<DATE>.db ./scratch.db
sqlite3 scratch.db "PRAGMA integrity_check;"        # must print: ok
# Boot a throwaway API against the scratch copy on a scratch port:
cd /opt/pecanrev/current/server
DATABASE_URL="file:/tmp/restore-test/scratch.db" PORT=3299 node index.js &
curl -sf http://127.0.0.1:3299/api/health/ready      # {"status":"ok",...}
# … run the validation checklist below, then:
kill %1 && rm -rf /tmp/restore-test
```

### PostgreSQL (after cutover)

```bash
createdb pecanrev_restore_test                       # scratch DB, same instance or local
pg_restore --no-owner -d pecanrev_restore_test /backups/pecanrev-<DATE>.dump
# Point verification (and optionally a scratch API on PORT=3299) at it:
#   POSTGRES_DATABASE_URL="postgresql://…/pecanrev_restore_test"
# … validate, then:
dropdb pecanrev_restore_test
```

For provider snapshots (Neon branch / Supabase PITR): restore into a **new
branch/project**, never in place — the provider console steps are external,
but the validation below runs unchanged against the restored connection string.

## 3. Restore-validation checklist

Run against the scratch restore, in order:

- [ ] Integrity: `PRAGMA integrity_check` = `ok` (SQLite) / `pg_restore`
      completed with zero errors (PG).
- [ ] Schema + data verification: `npm run db:verify:restore` (from `server/`,
      pointed at the scratch DB) — row counts per table, sampled deep
      row-equality against expectations, relationship spot-checks. Non-zero
      exit = the backup is NOT proven; investigate before trusting it.
- [ ] A scratch API boots against the restore and `GET /api/health/ready`
      returns 200.
- [ ] Spot-check business data: user count is plausible for the backup date;
      a known project opens; a known user row exists
      (`SELECT count(*) FROM User;` etc.).
- [ ] Uploaded-file backup: pick 2–3 records with stored PDFs and confirm the
      files exist in the restored `storage/` tarball.
- [ ] Record the run in the log below.

## 4. Restore-test log (recordable template — 93.md §2.5)

Perform a scratch restore **at least monthly** and after any backup-pipeline
change. Copy this template into the log section below for every run:

```markdown
### Restore test — YYYY-MM-DD
- **Date:** YYYY-MM-DD
- **Backup source:** (e.g. /backups/prod-2026-07-17.db, nightly cron)
- **Scratch target:** (e.g. /tmp/restore-test/scratch.db on the VPS / pecanrev_restore_test)
- **Restore duration:** (copy + integrity + verify, minutes)
- **Validation results:** (each checklist item: pass/fail + numbers, e.g. "verify: 41 tables, counts OK, 200 sampled rows equal")
- **Problems encountered:** (none / description + follow-up issue)
- **Tester:** (name)
```

### Log

*(no restore tests recorded yet — the first entry proves the pipeline)*
