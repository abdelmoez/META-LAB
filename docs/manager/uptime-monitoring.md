# Uptime monitoring readiness (93.md §5.2)

The endpoints are ready for UptimeRobot / Better Stack today; **creating the
monitor account, the monitors themselves, and alert routing (Slack/email) is
an EXTERNAL task** — it needs a provider account and cannot be done from this
repository (launch checklist: "Requires provider-account creation").

## Recommended monitors

| # | Monitor | URL | Method | Expect | Interval |
|---|---|---|---|---|---|
| 1 | Marketing / landing | `https://pecanrev.com/` | HTTP GET | `200`, HTML body | 5 min |
| 2 | Application frontend | `https://pecanrev.com/app` | HTTP GET | `200`, HTML body (SPA shell serves for any route) | 5 min |
| 3 | API liveness | `https://pecanrev.com/api/health` | HTTP GET, keyword | `200`, body contains `"status":"ok"` | 1–2 min |
| 4 | API readiness (DB) | `https://pecanrev.com/api/health/ready` | HTTP GET, keyword | `200`, body contains `"status":"ok"` — degraded = `503` with `"status":"unavailable"` | 1–2 min |
| 5 | TLS certificate expiry | `https://pecanrev.com` | provider's cert check | > 14 days remaining | daily |
| 6 | Staging (optional, non-paging) | `https://staging.pecanrev.com/api/health` | HTTP GET | `200` | 15 min |

Exact response bodies (from `server/index.js`):

```json
GET /api/health        → 200 {"status":"ok","timestamp":"…","version":"3.99.0"}
GET /api/health/ready  → 200 {"status":"ok","checks":{"database":"ok"},"version":"…","timestamp":"…"}
GET /api/health/ready  → 503 {"status":"unavailable","checks":{"database":"timeout"|"error"},…}   // DB down/hung
```

Notes for monitor configuration:

- **Liveness vs readiness**: `/api/health` proves the Node process answers;
  `/api/health/ready` additionally pings the DB with a strict timeout
  (`READY_DB_TIMEOUT_MS`, default 3 s) so a hung DB flips readiness fast
  instead of hanging the probe. Alert on both, but page on #3 and #4.
- Both endpoints are **public, unauthenticated, cheap, and exempt from the
  maintenance-mode gate** — safe at 1-minute intervals. They expose no
  secrets, addresses, or stack traces.
- Keyword-match on `"status":"ok"` rather than status-code-only: a proxy
  serving a cached error page as 200 would otherwise look healthy.
- During maintenance mode, #1–#4 stay green by design (health is exempt);
  user-facing routes 503 — that is intentional, not an outage.
- **Transactional-email health**: no dedicated public probe (would leak
  config); watch Brevo's own status page + the Ops console email metrics
  (sent/failed counters), and alert manually on failure spikes. Practical
  proxy: a weekly scripted password-reset to a team address.

## Alert routing (EXTERNAL — document of intent, not done)

- Page (immediate): monitors #3/#4 failing ≥ 2 consecutive checks → Slack
  channel + email to the on-call owner. Both UptimeRobot and Better Stack do
  Slack webhooks + email natively once the account exists.
- Notify (non-paging): #1/#2/#5/#6 → Slack only.
- Escalation and on-call rotation are a one-person show during beta — the
  routing above is still worth configuring so the phone buzzes.

## Public status page (EXTERNAL, optional for beta)

UptimeRobot/Better Stack can publish a hosted status page fed by monitors
#1–#4. Creating it is a provider-account task; when it exists, surface the
link in the app footer/support page (93.md §6.4 — the support-link surface is
config-driven).

## Related

- Post-deploy smoke test already hits health/ready/version on every deploy
  (`scripts/smoke-deploy.mjs`, wired into `.github/workflows/deploy.yml`).
- Deeper runtime metrics for humans (event-loop delay, memory, job-queue
  depths): `GET /api/admin/metrics/runtime` (admin session required) — not for
  uptime monitors.
- Disk-space monitoring on the VPS: `vps-hardening.md` §8.
