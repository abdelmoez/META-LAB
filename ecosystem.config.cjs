/**
 * ecosystem.config.cjs — PM2 process definition for the PecanRev API (93.md §3.1).
 *
 * IMPORTANT — WHY FORK MODE WITH instances: 1 (do not "optimize" this):
 * cluster mode is deliberately OFF because four subsystems are single-process
 * by design today:
 *   1. express-rate-limit uses in-memory stores → per-worker limits multiply.
 *   2. The realtime layer (SSE bus + presence) holds streams in in-process
 *      maps → events emitted in worker A never reach clients on worker B.
 *   3. The living-review scheduler ticks per process → duplicate scheduled runs.
 *   4. SQLite (current prod DB) serializes writers; multi-process hurts, not helps.
 * Durable job workers ARE multi-process-safe (atomic DB claims), but the above
 * are not. Revisit only after: shared rate-limit store, SSE pub/sub broker,
 * scheduler leader election, and the PostgreSQL cutover. See
 * docs/manager/pm2-operations.md.
 *
 * Secrets: NONE live here. The app loads server/.env via server/load-env.js;
 * deployment injects real values into that file (chmod 600).
 *
 * Ops quickstart (full runbook in docs/manager/pm2-operations.md):
 *   pm2 start ecosystem.config.cjs                    # production
 *   pm2 start ecosystem.config.cjs --env staging      # staging
 *   pm2 reload pecanrev-api                           # brief-gap reload (see below)
 *   pm2 startup && pm2 save                           # survive VPS reboot
 *
 * HONEST RELOAD SEMANTICS (93.md round 2): in fork mode a "reload" is
 * stop-then-start — there is NO overlap process, so every reload/deploy has a
 * brief service gap (target < 2-3s: SSE streams are ended at SIGTERM so the
 * old process drains fast, then the new one boots). True zero-downtime needs
 * cluster mode, which is blocked by the four single-process subsystems above.
 */
// Review fix (round 2): PM2 FREEZES cwd/script at first registration — a later
// `pm2 startOrReload` re-reads env but NOT the paths, so pointing cwd at
// __dirname (a per-release directory under releases/<ts>-<sha>/) would pin the
// process to the FIRST release forever and let release pruning delete the live
// code. Instead cwd points at the stable `current` symlink (PECANREV_ROOT,
// exported by deploy/metalab-deploy.sh): the frozen value never changes, while
// each reload's fresh node process resolves server/index.js THROUGH the symlink
// to the newly flipped release. Dev fallback: __dirname (repo checkout).
const DEPLOY_ROOT = process.env.PECANREV_ROOT || __dirname;

module.exports = {
  apps: [
    {
      // PM2_APP_NAME lets a shared-host staging tree run under its own PM2
      // name (e.g. pecanrev-staging) without touching the production process.
      name: process.env.PM2_APP_NAME || 'pecanrev-api',
      script: 'server/index.js',
      cwd: DEPLOY_ROOT,

      // Single process by design — see header before changing.
      exec_mode: 'fork',
      instances: 1,

      // Crash resilience: always restart, with backoff so a boot-loop cannot
      // peg the CPU; cap restarts within a window via min_uptime.
      autorestart: true,
      exp_backoff_restart_delay: 200, // ms, doubles up to 15s
      min_uptime: 5000,               // a process dying <5s after boot counts as a failed start
      max_restarts: 25,

      // Memory guard: restart the API if RSS exceeds the threshold (leak
      // containment; durable jobs recover safely across restarts).
      max_memory_restart: process.env.PM2_MAX_MEMORY || '900M',

      // Graceful shutdown alignment: server/index.js drains on SIGTERM and
      // force-exits after SHUTDOWN_GRACE_MS (default 15s). kill_timeout must
      // exceed that bound so PM2 never SIGKILLs a cleanly-draining process.
      kill_timeout: 20000,
      listen_timeout: 15000,

      // Structured stdout/stderr: keep JSON lines intact — `time: false`
      // because a PM2 timestamp prefix would break NDJSON parsing, and the
      // app's JSON log lines already carry their own `t` field (requestLogger).
      time: false,
      merge_logs: true,
      out_file: process.env.PM2_OUT_FILE || undefined,   // default ~/.pm2/logs
      error_file: process.env.PM2_ERR_FILE || undefined,

      env: {
        NODE_ENV: 'production',
        LOG_FORMAT: 'json',
      },
      env_staging: {
        NODE_ENV: 'production',      // staging runs production hardening…
        APP_ENV: 'staging',          // …but identifies itself as staging (banner,
        LOG_FORMAT: 'json',          //    Sentry environment, email protection)
      },
    },
  ],
};
