#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy/rollback.sh — fast manual rollback for PecanRev (93.md §3.6)
#
# Flips the `current` symlink back to the previous release (or an explicitly
# named one), reloads PM2, and polls readiness. This is the seconds-fast manual
# path; deploy/metalab-deploy.sh already auto-rolls-back when a deploy's
# readiness gate fails. Full policy (including why database state is NEVER
# blindly reversed): docs/manager/rollback-runbook.md.
#
# Usage:
#   rollback.sh                # roll back to the release just before `current`
#   rollback.sh 20260718120000-abc1234   # roll back/forward to a named release
#   rollback.sh --list         # show available releases and the live one
#
# Idempotent: flipping to the release already live is a harmless reload.
# Contains no secrets. Install alongside metalab-deploy.sh on the VPS.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pecanrev}"
RELEASES_DIR="${RELEASES_DIR:-$APP_DIR/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_DIR/current}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health/ready}"
READY_TIMEOUT_S="${READY_TIMEOUT_S:-60}"

log()  { printf '[rollback] %s\n' "$*"; }
fail() { printf '[rollback] FATAL: %s\n' "$*" >&2; exit 1; }

[ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK is not a symlink — nothing deployed yet?"
CURRENT_TARGET="$(readlink -f "$CURRENT_LINK")"

if [ "${1:-}" = "--list" ]; then
  log "releases in $RELEASES_DIR (live: $CURRENT_TARGET):"
  ls -1d "$RELEASES_DIR"/*/ 2>/dev/null | sort | while read -r r; do
    r="${r%/}"
    marker=" "
    [ "$(readlink -f "$r")" = "$CURRENT_TARGET" ] && marker="*"
    printf '  %s %s\n' "$marker" "$r"
  done
  exit 0
fi

# ── Resolve the target release ────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
  TARGET="$RELEASES_DIR/$1"
  [ -d "$TARGET" ] || fail "release $TARGET does not exist (try --list)"
else
  # Newest release strictly older than the live one (names are UTC-timestamped,
  # so lexical sort == chronological).
  TARGET=""
  for r in $(ls -1d "$RELEASES_DIR"/*/ 2>/dev/null | sort); do
    r="${r%/}"
    if [ "$(readlink -f "$r")" = "$CURRENT_TARGET" ]; then break; fi
    TARGET="$r"
  done
  [ -n "$TARGET" ] || fail "no release older than the live one — nothing to roll back to (try: $0 --list)"
fi

log "flipping current: $CURRENT_TARGET -> $TARGET"
ln -sfn "$TARGET" "$CURRENT_LINK.tmp.$$"
mv -T "$CURRENT_LINK.tmp.$$" "$CURRENT_LINK"   # atomic rename

log "reloading PM2"
# Same stable-path contract as metalab-deploy.sh (PM2 freezes cwd at first
# registration; PECANREV_ROOT pins it to the `current` symlink).
PECANREV_ROOT="$CURRENT_LINK" PM2_APP_NAME="${PM2_APP_NAME:-pecanrev-api}" \
  pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --only "${PM2_APP_NAME:-pecanrev-api}" --update-env

log "polling readiness ($HEALTH_URL, up to ${READY_TIMEOUT_S}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT_S ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "READY — rollback to $(basename "$TARGET") succeeded"
    pm2 save >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done

printf '[rollback] CRITICAL: rolled-back release is NOT ready after %ss\n' "$READY_TIMEOUT_S" >&2
printf '[rollback]   inspect: pm2 logs pecanrev-api --lines 200 ; curl -v %s\n' "$HEALTH_URL" >&2
printf '[rollback]   if a schema migration broke compatibility, see docs/manager/rollback-runbook.md\n' >&2
exit 1
