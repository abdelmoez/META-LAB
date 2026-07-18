# Security incident response runbook (93.md Documentation §15)

What to do, in order, when something security-relevant happens. Healthcare and
research-adjacent data is treated as sensitive even where it is not formally
PHI (93.md primary directive #10) — when in doubt, escalate severity.

## 1. Severity triage (first 10 minutes)

| Severity | Definition | Examples | Response clock |
|---|---|---|---|
| **SEV-1 Critical** | Confirmed breach, data loss, or total outage | Secret leaked publicly; attacker session confirmed; DB corrupted/exfiltrated; site down | Act immediately, all hands |
| **SEV-2 High** | Probable compromise or a core workflow unavailable | Suspicious admin logins; auth bypass reported; screening/import broken for all users | Same day |
| **SEV-3 Medium** | Contained vulnerability, no evidence of exploitation | Dependency CVE in a used path; permission gap found internally | Within days, tracked |
| **SEV-4 Low** | Hardening gap / cosmetic | Missing header on a non-sensitive route | Backlog |

Write down (timestamped, in a private incident doc): what was observed, when,
by whom, current best severity guess. Keep updating it — this becomes the
post-incident timeline.

## 2. Containment levers (fastest first)

- **Suspend a specific user/attacker account**: Ops console → user → suspend.
  Suspension bumps the user's `sessionEpoch`, so every existing token dies on
  its next request, and force-closes their SSE streams.
- **Mass session revocation (everyone logged out)**: rotate `JWT_SECRET` —
  procedure and impact in `secret-rotation.md` §1. Equivalent DB-side lever
  (keeps the secret): `UPDATE User SET sessionEpoch = sessionEpoch + 1;` —
  every issued token fails its epoch check on next request. Prefer the secret
  rotation when the secret itself may be exposed.
- **Maintenance mode**: Ops console toggle (`appSettings.maintenanceMode`) —
  503s all non-staff API traffic while staff can still work. Use when the app
  must stay down while you investigate.
- **Take the site offline entirely**: `pm2 stop pecanrev-api` (nginx then
  serves 502) — last resort, loses even the maintenance-mode messaging.
- **Credential rotation**: full matrix + ordering in `secret-rotation.md`
  ("Order of operations in a suspected full compromise").
- **Kill a risky feature**: Ops → Feature Flags (automated search, duplicate
  detection, AI screening, public sharing, waitlist landing… are all
  flag-gated server-side).

## 3. Evidence preservation — BEFORE cleanup

Do not "fix and forget"; you cannot un-delete evidence.

- **Copy the DBs**: `sqlite3 /var/lib/metalab/prod.db ".backup '/root/incident-<date>/prod.db'"`
  (plus the waitlist DB) — or a PG dump post-cutover. Store off-VPS, encrypted.
- **Application audit stores** (queryable via Prisma/SQL; do not truncate):
  - `AdminAuditLog` — every admin action (who, what, target, when).
  - `SecurityEvent` — auth-relevant events (password-reset request/complete,
    `MOD_TARGET_DENIED`, …).
  - `LoginEvent` — login history with context.
  - `UsageEvent` — email sends/failures and feature usage trails.
  - `ProjectEvent` — the append-only research-provenance ledger (88.md); shows
    any tampering with project content.
- **Process logs**: copy `~/.pm2/logs/` (structured JSON lines with
  `X-Request-Id` correlation — a request id from an error report links the
  full request trail) and `/var/log/nginx/access.log*` before rotation eats
  them.
- **Sentry**: the issue stream is already off-box; note relevant event IDs.
- Record SHA-256 sums of collected files in the incident doc.

## 4. User notification decision path

Decide with this tree, and record the decision + rationale in the incident doc:

1. **Was user data plausibly accessed, altered, or exfiltrated?**
   No → no user notification; write the internal post-mortem only.
2. **Yes → which users?** Scope from the evidence (audit stores above).
   Notify *affected* users specifically; notify all users only when scoping is
   impossible.
3. **What do we tell them?** Honestly: what happened, what data, when, what we
   did, what they should do (e.g. "your session was revoked; reset your
   password"). Never speculate beyond evidence; never minimize.
4. **Are there legal/contractual notification duties?** Research data may fall
   under institutional agreements or GDPR-style rules depending on the user's
   jurisdiction. **This is a legal review question — external**; flag it to
   the owner immediately rather than deciding ad hoc (launch checklist:
   "Requires legal review").
5. **Channel**: transactional email via the normal provider (from the
   configured support address), plus an in-app/status note for anything
   availability-related.

## 5. Recovery

- Restore data only per `backup-restore.md` (scratch-verify first) and
  `rollback-runbook.md` (never blindly reverse data migrations).
- Re-deploy from a known-good ref via `deploy/metalab-deploy.sh` (pin
  `DEPLOY_REF` to a tag/sha if `main` itself is suspect).
- Re-run the hardening verification sweep (`vps-hardening.md` §10).
- Exit containment deliberately: unsuspend, disable maintenance mode, restore
  flags — each recorded in the incident doc.

## 6. Post-incident review template

Complete within a week of resolution; store with the incident doc.

```markdown
## Post-incident review — <short title> — YYYY-MM-DD
- **Severity / duration:** SEV-n, detected <ts>, resolved <ts>
- **Timeline:** (timestamped facts, from the incident doc)
- **Root cause:** (technical + process; "5 whys" depth, no blame)
- **Blast radius:** (systems, data, users affected — with evidence)
- **What went well / what went badly:** (detection, containment, comms)
- **User notification:** (sent? to whom? copy attached / decision rationale)
- **Action items:** (each: owner, deadline, tracked where)
- **Runbook gaps found:** (update incident-response.md / secret-rotation.md / …)
```
