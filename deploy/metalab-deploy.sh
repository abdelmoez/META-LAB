#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy/metalab-deploy.sh — PecanRev production deploy (93.md §3.6)
#
# Release-based, health-gated replacement for the legacy in-place
# /usr/local/bin/metalab-deploy.sh. Install on the VPS as:
#     sudo cp deploy/metalab-deploy.sh /usr/local/bin/metalab-deploy.sh
#     sudo chmod +x /usr/local/bin/metalab-deploy.sh
# The GitHub Actions deploy job (.github/workflows/deploy.yml) invokes it over
# SSH; it can equally be run by hand. Root-run today (like the legacy script);
# see docs/manager/vps-hardening.md for the non-root deploy-user migration.
#
# What it does, in order — every step BEFORE the symlink flip leaves the live
# site untouched, so any pre-flip failure is a safe no-op deploy:
#   1. Pre-deploy checks: node >= 20, shared env file present, free disk.
#   2. git fetch a pinned ref → extract into releases/<utc-ts>-<short-sha>/.
#   3. Link shared persistent state INTO the release (server/.env, storage/).
#   4. npm ci (root + server, dev deps included — the build needs them),
#      prisma client generation, npm run build (stamps server/version.json).
#   5. DB schema apply:
#        DATABASE_PROVIDER=postgres → npm run db:migrate:deploy:postgres
#          (versioned `prisma migrate deploy`; see docs/manager/postgres-migration.md)
#        otherwise (TRANSITIONAL sqlite path) → prisma db push, which ABORTS on
#          any data-loss operation (no --accept-data-loss; the db-push-safety
#          rule in docs/manager/deployment-readiness.md §2 still applies).
#   6. Atomically flip the `current` symlink to the new release.
#   7. pm2 startOrReload ecosystem.config.cjs (start on first run).
#   8. Poll http://127.0.0.1:3001/api/health/ready for up to READY_TIMEOUT_S.
#   9. Success → prune old releases (keep KEEP_RELEASES).
#      Readiness FAILURE → flip back to the previous release, reload, poll,
#      exit 1 loudly (deploy job + post-deploy smoke test both go red).
#
# Idempotent: re-running produces a fresh release and flips again; a failed run
# never leaves `current` pointing at an unhealthy release (auto-rollback).
# Contains NO secrets — all secrets live in $SHARED_DIR/server.env (chmod 600).
#
# Layout on the VPS (created on first run except repo + shared/server.env):
#   /opt/pecanrev/repo/       git clone used only for fetch/archive
#   /opt/pecanrev/releases/   <utc-ts>-<sha>/ immutable builds
#   /opt/pecanrev/shared/     server.env (chmod 600), storage/ (uploaded PDFs,
#                             exports — persisted ACROSS releases)
#   /opt/pecanrev/current     symlink → the live release
# The SQLite prod DBs stay OUTSIDE the release tree (absolute file: URLs, e.g.
# /var/lib/metalab/prod.db) so releases never contain data.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration (env-overridable; no secrets) ───────────────────────────────
APP_DIR="${APP_DIR:-/opt/pecanrev}"
REPO_DIR="${REPO_DIR:-$APP_DIR/repo}"
RELEASES_DIR="${RELEASES_DIR:-$APP_DIR/releases}"
SHARED_DIR="${SHARED_DIR:-$APP_DIR/shared}"
CURRENT_LINK="${CURRENT_LINK:-$APP_DIR/current}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"     # pin a tag/sha to deploy exactly that
KEEP_RELEASES="${KEEP_RELEASES:-3}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health/ready}"
READY_TIMEOUT_S="${READY_TIMEOUT_S:-60}"
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"

log()  { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] FATAL: %s\n' "$*" >&2; exit 1; }

# ── Single-flight lock (GH Actions serializes too; this guards manual runs) ───
mkdir -p "$APP_DIR"
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || fail "another deploy is already running (lock: $APP_DIR/.deploy.lock)"

# ── 1. Pre-deploy checks ──────────────────────────────────────────────────────
command -v node >/dev/null || fail "node is not installed"
command -v git  >/dev/null || fail "git is not installed"
command -v pm2  >/dev/null || fail "pm2 is not installed (npm i -g pm2)"
command -v curl >/dev/null || fail "curl is not installed"

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] || fail "node >= $MIN_NODE_MAJOR required, found $(node -v)"

[ -f "$SHARED_DIR/server.env" ] || fail "missing $SHARED_DIR/server.env — create it from server/.env.example (chmod 600) and REPLACE the relative file: DB URLs with absolute paths (see the check below); secrets are never in git"
mkdir -p "$RELEASES_DIR" "$SHARED_DIR/storage"

# Review fix (round 2): a RELATIVE sqlite URL (file:./dev.db — the .env.example
# default) would resolve inside each release's server/ directory: every deploy
# would silently start from an EMPTY database and release pruning would then
# destroy the old one. Production sqlite URLs must be absolute (file:/...).
env_val() { grep -E "^$1=" "$SHARED_DIR/server.env" | tail -n1 | sed -E "s/^$1=//; s/^[\"']//; s/[\"']\$//" || true; }
for VAR in DATABASE_URL BETA_WAITLIST_DATABASE_URL; do
  VAL="$(env_val "$VAR")"
  case "$VAL" in
    file:/*) : ;;                       # absolute sqlite path — OK
    file:*)  fail "$VAR in server.env is a RELATIVE sqlite URL ('$VAL') — it would point inside the per-release directory and be lost on every deploy. Use an absolute path, e.g. file:/opt/pecanrev/shared/prod.db" ;;
    *)       : ;;                       # postgres URL / unset — not this check's concern
  esac
done

FREE_MB="$(df -Pm "$APP_DIR" | awk 'NR==2{print $4}')"
[ "$FREE_MB" -ge "$MIN_FREE_MB" ] || fail "only ${FREE_MB}MB free on $APP_DIR (< ${MIN_FREE_MB}MB) — prune releases/logs first"

[ -d "$REPO_DIR/.git" ] || fail "no git clone at $REPO_DIR — bootstrap once with: git clone <repo-url> $REPO_DIR"

# ── 2. Fetch the pinned ref and extract an immutable release ──────────────────
log "fetching $DEPLOY_REF"
git -C "$REPO_DIR" fetch --all --prune --tags --force
SHA="$(git -C "$REPO_DIR" rev-parse --verify "${DEPLOY_REF}^{commit}")"
SHORT_SHA="$(git -C "$REPO_DIR" rev-parse --short "$SHA")"
TS="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$TS-$SHORT_SHA"

log "building release $TS-$SHORT_SHA ($SHA)"
mkdir -p "$RELEASE_DIR"
git -C "$REPO_DIR" archive "$SHA" | tar -x -C "$RELEASE_DIR"

# ── 3. Link shared persistent state into the release ──────────────────────────
# server/.env: single source of secrets, loaded by server/load-env.js.
ln -sfn "$SHARED_DIR/server.env" "$RELEASE_DIR/server/.env"
# server/storage: uploaded PDFs / study docs / exports resolve relative to the
# server dir (server/studyDocs/studyDocStorage.js, server/screening/pdfStorage.js)
# — MUST persist across releases or uploads vanish on every deploy.
rm -rf "$RELEASE_DIR/server/storage"
ln -sfn "$SHARED_DIR/storage" "$RELEASE_DIR/server/storage"

# ── 4. Reproducible install + build ───────────────────────────────────────────
# --include=dev: the root build needs Vite et al. even if NODE_ENV=production
# leaks into this shell. server npm ci runs postinstall (waitlist client gen).
export GIT_COMMIT="$SHORT_SHA"
GIT_COMMIT_DATE="$(git -C "$REPO_DIR" log -1 --format=%cI "$SHA")"; export GIT_COMMIT_DATE
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; export BUILD_DATE

log "npm ci (root)";   (cd "$RELEASE_DIR" && npm ci --include=dev)
log "npm ci (server)"; (cd "$RELEASE_DIR/server" && npm ci --include=dev)
log "prisma generate"; (cd "$RELEASE_DIR/server" && npx prisma generate)
log "npm run build";   (cd "$RELEASE_DIR" && npm run build)

# ── 5. Apply the DB schema (pre-flip: a failure here leaves prod untouched) ───
# Read DATABASE_PROVIDER from the shared env file (line-parse, never sourced —
# the env file holds secrets and this script must not echo them on `set -x`).
DB_PROVIDER="$(grep -E '^DATABASE_PROVIDER=' "$SHARED_DIR/server.env" | tail -n1 \
  | sed -E 's/^DATABASE_PROVIDER=//; s/^["'\'']//; s/["'\'']$//' || true)"
DB_PROVIDER="${DB_PROVIDER:-sqlite}"

if [ "$DB_PROVIDER" = "postgres" ]; then
  # Versioned migrations (93.md §2.2): `prisma migrate deploy` applies only the
  # committed, already-tested migrations. One-time baseline for a pre-existing
  # DB: docs/manager/postgres-migration.md ("Baselining an existing database").
  log "DB: postgres — prisma migrate deploy (versioned)"
  (cd "$RELEASE_DIR/server" && npm run db:generate:postgres)
  (cd "$RELEASE_DIR/server" && npm run db:migrate:deploy:postgres)
else
  # TRANSITIONAL sqlite path — mirrors the legacy VPS behavior until the
  # PostgreSQL cutover. `db push` (no --accept-data-loss) diffs schema.prisma
  # against the live DB and ABORTS the deploy on any data-loss operation, so
  # the site stays on the previous release. Keep schema changes db-push-safe
  # (deployment-readiness.md §2) until this branch is deleted post-cutover.
  log "DB: sqlite (TRANSITIONAL) — prisma db push"
  (cd "$RELEASE_DIR/server" && npx prisma db push --skip-generate)
  (cd "$RELEASE_DIR/server" && npm run db:ensure:waitlist)
fi

# ── 6. Atomic flip of the `current` symlink ───────────────────────────────────
PREV_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK.tmp.$$"
mv -T "$CURRENT_LINK.tmp.$$" "$CURRENT_LINK"   # rename(2): atomic
log "current -> $RELEASE_DIR (previous: ${PREV_RELEASE:-none})"

# ── 7+8. Reload under PM2 and gate on readiness ───────────────────────────────
reload_app() {
  # Review fix (round 2): PM2 freezes cwd/script at FIRST registration, so the
  # ecosystem file reads PECANREV_ROOT and pins cwd to the stable `current`
  # symlink — every reload's fresh process then resolves server/index.js
  # through the freshly flipped symlink. PM2_APP_NAME (default pecanrev-api)
  # lets a staging tree on the same host run under its own PM2 name.
  # HONEST SEMANTICS: fork-mode reload is stop-then-start — expect a brief
  # (<2-3s) service gap per deploy; SSE streams are ended at SIGTERM so the old
  # process drains fast. True zero-downtime would require cluster mode (blocked
  # — see ecosystem.config.cjs header).
  PECANREV_ROOT="$CURRENT_LINK" PM2_APP_NAME="${PM2_APP_NAME:-pecanrev-api}" \
    pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --only "${PM2_APP_NAME:-pecanrev-api}" --update-env
}

poll_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT_S ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

reload_app
log "polling readiness ($HEALTH_URL, up to ${READY_TIMEOUT_S}s)"
if poll_ready; then
  log "READY — deploy of $TS-$SHORT_SHA succeeded"

  # ── 9. Prune old releases (keep newest $KEEP_RELEASES; never the live one) ──
  CURRENT_TARGET="$(readlink -f "$CURRENT_LINK")"
  # Release names are UTC-timestamp-prefixed, so lexical sort == chronological.
  ls -1d "$RELEASES_DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP_RELEASES" | while read -r old; do
    old="${old%/}"
    if [ "$(readlink -f "$old")" != "$CURRENT_TARGET" ]; then
      log "pruning old release $old"
      rm -rf "$old"
    fi
  done
  # pm2 save so the reboot resurrection (pm2 startup) resurrects THIS release.
  pm2 save >/dev/null 2>&1 || true
  exit 0
fi

# ── FAILURE: readiness never went green — roll back ───────────────────────────
printf '[deploy] ================= DEPLOY FAILED =================\n' >&2
printf '[deploy] release %s did not become ready within %ss\n' "$TS-$SHORT_SHA" "$READY_TIMEOUT_S" >&2

if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
  printf '[deploy] rolling back to %s\n' "$PREV_RELEASE" >&2
  ln -sfn "$PREV_RELEASE" "$CURRENT_LINK.tmp.$$"
  mv -T "$CURRENT_LINK.tmp.$$" "$CURRENT_LINK"
  reload_app || true
  if poll_ready; then
    printf '[deploy] rollback succeeded — previous release is serving again\n' >&2
  else
    printf '[deploy] CRITICAL: rollback release is ALSO not ready — manual intervention required\n' >&2
    printf '[deploy]   inspect: pm2 logs pecanrev-api --lines 200 ; curl -v %s\n' "$HEALTH_URL" >&2
  fi
else
  printf '[deploy] no previous release to roll back to (first deploy?) — app is DOWN\n' >&2
  printf '[deploy]   inspect: pm2 logs pecanrev-api --lines 200 ; curl -v %s\n' "$HEALTH_URL" >&2
fi
# NOTE: schema changes are NOT auto-reverted — see docs/manager/rollback-runbook.md
# (never blindly reverse data migrations; releases are kept backward-compatible).
exit 1
