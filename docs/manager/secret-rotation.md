# Secret rotation runbook (93.md §4.1/§4.2)

Every credential the deployment uses, what rotating it breaks, and the exact
rotation procedure. Rotate immediately on any suspicion of exposure; rotate
routinely (≈ every 6–12 months) for the high-blast-radius ones. All server
secrets live in ONE place on the VPS: `/opt/pecanrev/shared/server.env`
(chmod 600) — nothing secret is in git, PM2 config, or nginx config.

## Rotation matrix

| Secret | Where | Impact of rotation | Routine cadence |
|---|---|---|---|
| `JWT_SECRET` | `shared/server.env` | **Mass session invalidation** — see below | On compromise; yearly |
| SMTP / Brevo credentials (`SMTP_USER`/`SMTP_PASS`) | `shared/server.env` + Brevo dashboard | Outbound email fails until updated (app degrades gracefully: drafts/operator links, nothing 500s) | On compromise; on staff departure |
| `ADMIN_SEED_PASSWORD` | `shared/server.env` | Re-seeding resets the two admin accounts' passwords | After first login (always); on compromise |
| GitHub Actions secrets (`VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `SMOKE_BASE`) | repo → Settings → Secrets | Deploys fail until updated | On compromise; on staff departure |
| SSH keys (operator + Actions) | VPS `authorized_keys` + GitHub secret | Locked-out key can no longer deploy/login | On staff departure; yearly for the Actions key |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | `shared/server.env` / root `.env` at build | Error reporting stops until updated (app unaffected — DSN-gated no-op) | On compromise (DSNs are low-sensitivity but rotatable in Sentry) |
| `POSTGRES_DATABASE_URL` / `POSTGRES_WAITLIST_DATABASE_URL` (after cutover) | `shared/server.env` + provider dashboard | DB access fails until updated → readiness 503 | On compromise; on staff departure |
| `AI_EMBEDDING_API_KEY` (optional hosted embeddings) | `shared/server.env` | Semantic layer falls back to lexical (by design) | On compromise |

## 1. JWT_SECRET — the big one

Sessions are stateless JWTs signed with this single secret. There is **no
dual-secret overlap window** in the current implementation, so rotation =
every session cookie instantly invalid = **every user (and admin) is logged
out** and must sign in again. That is also exactly why it is the
incident-response mass-revocation lever (`incident-response.md`).

Procedure:

1. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
2. Pick a low-traffic window (unless this is an incident — then now).
3. Edit `/opt/pecanrev/shared/server.env` → `JWT_SECRET="<new>"` (file stays 600).
4. `pm2 reload pecanrev-api` (zero-downtime; new secret applies as workers cycle).
5. Verify: your own session is now rejected (app redirects to login); log in
   fresh; `curl -s http://127.0.0.1:3001/api/health/ready` still 200.
6. If staging shares nothing (it must not — `.env.staging.example`), staging is
   unaffected; rotate its own secret separately if needed.

Note: passive session invalidation for a *single* user never needs this — the
per-user `sessionEpoch` bump (suspend / role change / password reset) already
revokes that user's tokens.

## 2. SMTP / Brevo credentials

1. Brevo dashboard → SMTP & API → generate a new SMTP key. *(External:
   requires the Brevo account login.)*
2. Update `SMTP_USER`/`SMTP_PASS` in `shared/server.env`; `pm2 reload pecanrev-api`.
3. Delete the old key in Brevo **after** step 4.
4. Verify: trigger a password-reset email to a team address; check Ops →
   email metrics show `sent` (not `failed`); check the message actually arrives
   (deliverability test steps: `email-domain-auth.md`).

## 3. Admin seed password

1. New strong value in `ADMIN_SEED_PASSWORD` (≥12 chars).
2. Re-run seeding from `server/`: `node scripts/seed-admins.js`
   (resets both `ADMIN_EMAIL_*` accounts to the new password and unsuspends).
3. Log in and change each admin password via the UI (the seed value is
   transitional by design — `server/docs/admin-seeding.md`).
4. Note: the seed script does not bump `sessionEpoch`; if rotating because of
   compromise, ALSO suspend/unsuspend the account (epoch bump) or rotate
   `JWT_SECRET` to kill existing admin sessions.

## 4. GitHub Actions secrets

1. Repo → Settings → Secrets and variables → Actions. *(External: requires
   GitHub admin; MFA on the GitHub account is on the launch checklist.)*
2. For `VPS_SSH_KEY`: generate a fresh ed25519 keypair
   (`ssh-keygen -t ed25519 -a 100 -f actions_ed25519`), append the new public
   key to the VPS deploy user's `authorized_keys`, update the secret with the
   new private key, run a manual `workflow_dispatch` deploy to verify, THEN
   remove the old public key from `authorized_keys`.
3. `VPS_HOST`/`VPS_USER`/`SMOKE_BASE` are low-sensitivity but update them the
   same way if the topology changes.

## 5. SSH keys (operator)

1. New key per operator (`vps-hardening.md` §2), add to `authorized_keys`,
   verify login with the new key from a fresh terminal.
2. Remove the departing/compromised key line from
   `/home/deploy/.ssh/authorized_keys` (and root's, which should be unused).
3. Verify the removed key is refused; keep the lifeline-session rule.

## Order of operations in a suspected full compromise

Rotate in blast-radius order, verifying between steps: **(1)** SSH keys +
GitHub `VPS_SSH_KEY` (regain exclusive control of the box and the deploy
path) → **(2)** `JWT_SECRET` (kill all sessions) → **(3)** DB URLs/passwords →
**(4)** SMTP/Brevo → **(5)** Sentry DSNs → **(6)** admin passwords. Then follow
`incident-response.md` for evidence preservation and user notification —
rotation is containment, not the whole response.
