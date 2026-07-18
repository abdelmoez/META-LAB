# PM2 operations runbook (93.md §3.1)

Process definition: `ecosystem.config.cjs` (repo root). App name: **`pecanrev-api`**.
The deploy script (`deploy/metalab-deploy.sh`) drives PM2 for you on every
deploy; this runbook is for direct operator work on the VPS.

## Daily commands

```bash
pm2 status                                      # process list + restarts + memory
pm2 startOrReload /opt/pecanrev/current/ecosystem.config.cjs --update-env
                                                # zero-downtime reload (what deploys use)
pm2 reload pecanrev-api                         # reload without re-reading the config file
pm2 restart pecanrev-api                        # hard restart (brief downtime — prefer reload)
pm2 stop pecanrev-api                           # stop (does NOT survive-proof anything)
pm2 logs pecanrev-api --lines 200               # tail structured JSON logs
pm2 logs pecanrev-api --err --lines 200         # stderr only
pm2 describe pecanrev-api                       # full config incl. cwd (= live release dir)
pm2 monit                                       # live CPU/memory TUI
```

Always pass the ecosystem file **through the `current` symlink** when reloading
after a deploy — PM2 re-reads the config (and the new release's realpath) only
when given the file; `pm2 reload pecanrev-api` alone reuses the old snapshot.

## Boot persistence (survive a VPS reboot)

```bash
pm2 startup            # prints the systemd command to run once (as root/sudo)
pm2 save               # snapshot the CURRENT process list for resurrection
```

`deploy/metalab-deploy.sh` runs `pm2 save` after every successful deploy, so a
reboot resurrects the release that was live. If you manually change the process
list, run `pm2 save` again or the change is lost on reboot.

## Memory restart

`max_memory_restart` (default `900M`, override with `PM2_MAX_MEMORY`) restarts
the API if RSS exceeds the threshold — leak containment, not a fix. Durable job
workers (import/export/duplicates/AI scoring/full-text) recover safely across
restarts (atomic DB claims + heartbeat recovery), so a memory restart cannot
lose queued work. If you see recurring memory restarts (`pm2 status` restart
counter climbing), capture `GET /api/admin/metrics/runtime` (memory + event-loop +
queue depths) and treat it as a leak investigation, not normal operation.

## kill_timeout rationale (do not lower)

`server/index.js` drains on SIGTERM: stops accepting connections, finishes
in-flight requests, disconnects Prisma, and force-exits after
`SHUTDOWN_GRACE_MS` (default 15s). `kill_timeout: 20000` in the ecosystem file
is deliberately **above** that bound so PM2 never SIGKILLs a cleanly-draining
process. If you raise `SHUTDOWN_GRACE_MS`, raise `kill_timeout` above it too.

## Why fork mode with 1 instance (the four cluster blockers)

Cluster mode is deliberately OFF. Four subsystems are single-process by design
today — enabling cluster mode without fixing them produces real correctness
bugs, not just degraded performance:

1. **In-memory rate limiting** — express-rate-limit uses per-process stores;
   N workers multiply every limit by N (login brute-force limit included).
2. **SSE realtime bus + presence** — streams live in in-process maps
   (`server/realtime/bus.js`); events emitted in worker A never reach clients
   connected to worker B (polling keeps features *correct* but realtime breaks).
3. **Living-review scheduler** — ticks per process; N workers run every
   scheduled job N times.
4. **SQLite** (current prod DB) — serializes writers; more processes contend,
   they don't scale.

Durable job workers are already multi-process-safe (atomic claims, attempts,
heartbeats). Revisit cluster mode only after ALL of: a shared rate-limit store,
an SSE pub/sub broker (e.g. Redis), scheduler leader election, and the
PostgreSQL cutover. This is also recorded in the `ecosystem.config.cjs` header.

## Staging

`pm2 start ecosystem.config.cjs --env staging` applies the `env_staging` block
(`APP_ENV=staging`). On a **dedicated staging host** that is all you need. On a
**shared host**, the ecosystem name `pecanrev-api` would collide with
production — start the staging process explicitly under its own name (the app
reads NODE_ENV/APP_ENV/PORT from its staging `server/.env`, so no ecosystem
env block is required):

```bash
cd /opt/pecanrev-staging/current
pm2 start server/index.js --name pecanrev-api-staging --time \
  --kill-timeout 20000 --max-memory-restart 900M
pm2 save
```

Full staging pattern: `docs/manager/staging-deployment.md`.

## Log rotation

PM2 log files (`~/.pm2/logs/`) grow forever by default. Install rotation once:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

(nginx logs rotate via the distro's logrotate — see
`docs/manager/vps-hardening.md` § Log rotation.)
