#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy/cloudflare/update-cf-ip-ranges.sh — safely refresh the nginx real-IP
# config from Cloudflare's published ranges (94.md §3.5/§3.6).
#
# WHAT IT DOES
#   1. Fetches https://www.cloudflare.com/ips-v4 and /ips-v6.
#   2. Sanity-checks the output (non-empty, every line a CIDR, plausible counts).
#      Fails HARD on empty/garbled output — a truncated fetch must NEVER be
#      allowed to shrink the trusted range list.
#   3. Renders a new set_real_ip_from block into a temp file and, ONLY if it
#      differs from the live file, atomically replaces the live file (tmp + mv).
#   4. Runs `nginx -t`. If it passes, reloads nginx. If it fails, the previous
#      file is restored and the script exits non-zero.
#   On ANY failure the previous, known-good file is left in place and the exit
#   code is non-zero — so a broken run can never degrade origin real-IP handling.
#
# This script is IDEMPOTENT: with unchanged upstream ranges it makes no changes,
# does not reload nginx, and exits 0. Safe to run from cron.
#
# It only rewrites the managed block between the BEGIN/END markers that
# deploy/nginx/cloudflare-real-ip.conf.example ships with; the human-authored
# header and the real_ip_header/real_ip_recursive lines below the block are
# preserved. If the target file does not yet exist, seed it once from the
# example (see FIRST-TIME SETUP below) before running this.
#
# FIRST-TIME SETUP (operator, one time):
#   sudo install -m 0644 deploy/nginx/cloudflare-real-ip.conf.example \
#       /etc/nginx/conf.d/cloudflare-real-ip.conf
#   sudo install -m 0755 deploy/cloudflare/update-cf-ip-ranges.sh \
#       /usr/local/bin/update-cf-ip-ranges.sh
#   # then include it (conf.d/*.conf is auto-included) and: sudo nginx -t && reload
#
# CRON (monthly is plenty; Cloudflare ranges change rarely). Logs to syslog so a
# failure is visible; the non-zero exit is what a monitoring wrapper alerts on:
#   # /etc/cron.d/cf-ip-ranges
#   17 4 * * 1 root /usr/local/bin/update-cf-ip-ranges.sh --reload 2>&1 | logger -t cf-ip-ranges
#
# USAGE
#   update-cf-ip-ranges.sh [--file PATH] [--reload] [--check]
#     --file PATH   target conf file (default: /etc/nginx/conf.d/cloudflare-real-ip.conf)
#     --reload      run `nginx -t` and reload nginx after a change (default: off —
#                   without it the file is updated but you reload manually)
#     --check       fetch + validate + diff only; make NO changes (exit 0 = would
#                   be no change, exit 10 = would change, non-zero <10 = error)
#
# OPTIONAL COMPANION: ufw origin lockdown (SEPARATE, deliberate step — NOT run
# here). To only accept 80/443 from Cloudflare (94.md §3.5), the same range list
# feeds a ufw variant. See docs/manager/vps-hardening.md § Origin lockdown for
# the full procedure and its critical caveat: locking 80/443 to CF ranges BREAKS
# certbot HTTP-01 renewal (the ACME challenge arrives from Let's Encrypt, not
# Cloudflare) — pair the lockdown with a Cloudflare Origin Certificate (no
# HTTP-01) or a DNS-01 challenge, and NEVER touch the SSH (22) rule.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

IPV4_URL="https://www.cloudflare.com/ips-v4"
IPV6_URL="https://www.cloudflare.com/ips-v6"
TARGET="/etc/nginx/conf.d/cloudflare-real-ip.conf"
DO_RELOAD=0
CHECK_ONLY=0
BEGIN_MARK="# ── BEGIN CLOUDFLARE RANGES (managed by update-cf-ip-ranges.sh) ───────────────"
END_MARK="# ── END CLOUDFLARE RANGES ─────────────────────────────────────────────────────"

log()  { printf '%s\n' "$*" >&2; }
die()  { printf 'update-cf-ip-ranges: ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --file)   TARGET="${2:?--file needs a path}"; shift 2 ;;
    --reload) DO_RELOAD=1; shift ;;
    --check)  CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl not found"

# Fetch into a temp dir that is always cleaned up.
TMPDIR_CF="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_CF"' EXIT
V4="$TMPDIR_CF/v4"
V6="$TMPDIR_CF/v6"

fetch() {
  # curl: fail on HTTP errors, bounded timeouts, a couple of retries.
  curl -fsS --max-time 20 --retry 2 --retry-delay 2 "$1" -o "$2" \
    || die "fetch failed: $1"
}

# A CIDR line: IPv4 a.b.c.d/nn or IPv6 xxxx::/nn. Strict-ish, rejects junk/HTML.
V4_RE='^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$'
V6_RE='^[0-9A-Fa-f:]+/[0-9]{1,3}$'

validate() {
  # $1 = file, $2 = regex, $3 = human label, $4 = minimum plausible line count
  local file="$1" re="$2" label="$3" min="$4" n
  [ -s "$file" ] || die "$label list is empty (fetch returned nothing)"
  # Reject any line that is not a bare CIDR (guards against an HTML error page
  # or a captive-portal response sneaking through with a 200).
  if grep -vqE "$re" "$file"; then
    die "$label list contains a non-CIDR line — refusing to use it:
$(grep -nvE "$re" "$file" | head -3)"
  fi
  n="$(grep -cE "$re" "$file")"
  [ "$n" -ge "$min" ] || die "$label list has only $n entries (< $min expected) — suspicious, refusing"
}

fetch "$IPV4_URL" "$V4"
fetch "$IPV6_URL" "$V6"
# Normalise line endings (strip CR) before validation.
sed -i 's/\r$//' "$V4" "$V6"
validate "$V4" "$V4_RE" "IPv4" 5
validate "$V6" "$V6_RE" "IPv6" 3

# Build the managed block (markers + set_real_ip_from lines) into a temp file.
BLOCK="$TMPDIR_CF/block"
{
  printf '%s\n' "$BEGIN_MARK"
  printf '# IPv4 (%s)\n' "$IPV4_URL"
  while IFS= read -r cidr; do [ -n "$cidr" ] && printf 'set_real_ip_from %s;\n' "$cidr"; done < "$V4"
  printf '# IPv6 (%s)\n' "$IPV6_URL"
  while IFS= read -r cidr; do [ -n "$cidr" ] && printf 'set_real_ip_from %s;\n' "$cidr"; done < "$V6"
  printf '%s\n' "$END_MARK"
} > "$BLOCK"

[ -f "$TARGET" ] || die "target $TARGET does not exist — seed it once from deploy/nginx/cloudflare-real-ip.conf.example (see FIRST-TIME SETUP in this script's header)"
grep -qF "$BEGIN_MARK" "$TARGET" || die "target $TARGET has no managed BEGIN marker — is it the right file?"
grep -qF "$END_MARK"   "$TARGET" || die "target $TARGET has no managed END marker — is it the right file?"

# Splice the fresh block in place of the old managed block (awk: print outside
# the markers verbatim; substitute the block once between them).
NEW="$TMPDIR_CF/new.conf"
awk -v begin="$BEGIN_MARK" -v end="$END_MARK" -v blockfile="$BLOCK" '
  $0 == begin { while ((getline line < blockfile) > 0) print line; close(blockfile); skip=1; next }
  $0 == end   { skip=0; next }
  skip != 1   { print }
' "$TARGET" > "$NEW"

# Guard against the splice producing an empty/degenerate file.
grep -qF "$BEGIN_MARK" "$NEW" || die "internal: rendered file lost its markers — aborting without touching $TARGET"

if cmp -s "$NEW" "$TARGET"; then
  log "cloudflare ranges unchanged — no update needed"
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  log "cloudflare ranges WOULD change (run without --check to apply):"
  diff -u "$TARGET" "$NEW" >&2 || true
  exit 10
fi

# Atomic replace: write to a temp file on the SAME filesystem, then mv (rename is
# atomic within a filesystem). Preserve the previous file for rollback on a bad
# `nginx -t`.
BACKUP="${TARGET}.prev"
cp -p "$TARGET" "$BACKUP"
TMP_TARGET="$(mktemp "${TARGET}.XXXXXX")"
cat "$NEW" > "$TMP_TARGET"
chmod --reference="$TARGET" "$TMP_TARGET" 2>/dev/null || chmod 0644 "$TMP_TARGET"
mv -f "$TMP_TARGET" "$TARGET"
log "updated $TARGET (previous saved as $BACKUP)"

if [ "$DO_RELOAD" -eq 1 ]; then
  command -v nginx >/dev/null 2>&1 || die "nginx not found but --reload requested"
  if nginx -t; then
    # Reload; if the reload itself somehow fails, roll back and surface it.
    if ! nginx -s reload && ! systemctl reload nginx; then
      mv -f "$BACKUP" "$TARGET"
      die "nginx reload failed — restored previous $TARGET"
    fi
    log "nginx config valid and reloaded"
  else
    mv -f "$BACKUP" "$TARGET"
    die "nginx -t FAILED with the new ranges — restored previous $TARGET (no reload)"
  fi
else
  log "file updated; NOT reloading (pass --reload to validate + reload nginx)"
  log "verify manually: sudo nginx -t && sudo systemctl reload nginx"
fi
