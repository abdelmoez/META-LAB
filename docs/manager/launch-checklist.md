# External launch checklist (93.md Documentation §23)

The honest ledger of what ships in this repository versus what a human must do
outside it. 93.md's rule applies: **never claim an external action was
performed unless it can be verified.** Every unchecked box below is genuinely
not done. Categories are 93.md's required 8-way separation.

## 1. Completed in code (verifiable in this repo)

- [x] Health (`/api/health`) + readiness (`/api/health/ready`, strict DB
      timeout) endpoints — `server/index.js`.
- [x] PM2 process definition (fork/1 by design, graceful-shutdown-aligned
      `kill_timeout`) — `ecosystem.config.cjs`; ops: `pm2-operations.md`.
- [x] Graceful shutdown (SIGTERM/SIGINT drain, bounded by
      `SHUTDOWN_GRACE_MS`) — `server/index.js`.
- [x] Release-based deploy with readiness gate + auto-rollback —
      `deploy/metalab-deploy.sh`; manual fast path `deploy/rollback.sh`.
- [x] Production nginx example (TLS redirect, SSE semantics, timeouts,
      staging block) — `deploy/nginx/pecanrev.conf.example`.
- [x] DSN-gated Sentry server+client with scrubbing contract —
      `sentry-setup.md`.
- [x] Request-id middleware + structured JSON logs (`LOG_FORMAT=json`).
- [x] Origin-check CSRF middleware; immutable `/assets` caching; admin
      runtime-metrics endpoint (`/api/admin/metrics/runtime`).
- [x] PostgreSQL capability: provider-selectable client, schema sync, data
      migration + verification tooling — `postgres-migration.md`.
- [x] Staging pattern: `server/.env.staging.example`, staging email
      redirect (`EMAIL_REDIRECT_ALL_TO`/`EMAIL_ALLOWLIST`), `APP_ENV=staging`
      identity — `staging-deployment.md`.
- [x] Waitlist → cohort invitation mechanics (single-use hashed tokens,
      expiry, resend cooldown, cohort field) — 80.md/93.md Phase 9 work.
- [x] Runbooks: pm2 / rollback / backup-restore / vps-hardening /
      secret-rotation / incident-response / uptime-monitoring /
      email-domain-auth / sentry-setup / staging-deployment /
      google-oauth-setup / cloudflare-setup (this directory). The last two
      document EXTERNAL dashboard steps (§2/§3) — the docs ship; the dashboard
      actions do not.

## 2. Requires credentials (accounts exist; someone must log in)

- [ ] **MFA on GitHub** (org + every maintainer account).
- [ ] **MFA on IONOS** (VPS hosting account).
- [ ] **MFA on the domain registrar** account.
- [ ] **MFA on the email provider** (Brevo) account.
- [ ] **MFA on the database provider** account (once one exists — see §5).
- [ ] Brevo: generate/rotate the production SMTP key into
      `shared/server.env` (`secret-rotation.md` §2).
- [ ] GitHub Actions secrets review: `VPS_SSH_KEY` rotated to a dedicated
      ed25519 deploy key (`secret-rotation.md` §4).
- [ ] Sentry: create server + client projects, put DSNs into the prod/staging
      env files (`sentry-setup.md`).
- [ ] Uptime provider (UptimeRobot / Better Stack): create monitors #1–#5 and
      alert routing per `uptime-monitoring.md`.
- [ ] **Google OAuth** (Google Cloud Console): create the project, configure the
      OAuth consent screen (External; `openid email profile` only — no
      verification needed), create the Web-application client, add the local/
      staging/production redirect URIs, add test users, publish, and put
      `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` into each
      env file — full runbook in `google-oauth-setup.md`. None of the dashboard
      steps are done.
- [ ] **Cloudflare Turnstile** (if adopting Cloudflare): create separate dev/
      staging/production widgets and map `TURNSTILE_SITE_KEY` (public) +
      `TURNSTILE_SECRET_KEY` (secret) per environment — `cloudflare-setup.md`
      Phase 9.

## 3. Requires DNS access

- [ ] `staging.pecanrev.com` A/AAAA record → the VPS.
- [ ] Sending-domain records for Brevo: SPF include, DKIM, brevo-code
      verification TXT on `mail.pecanrev.com` (`email-domain-auth.md` §4).
- [ ] DMARC record, monitor-first (`p=none` + `rua=`), tighten later
      (`email-domain-auth.md` §5).
- [ ] (If adopting Cloudflare) move DNS to Cloudflare, recreate mail/SPF/DKIM/
      DMARC as **DNS-only**, and proxy the web records — full gated runbook in
      `cloudflare-setup.md` (Phases 1–2). Extends `deploy/nginx/README.md` §3.

## 4. Requires VPS administrator access

- [ ] Install the new deploy scripts:
      `deploy/metalab-deploy.sh` + `deploy/rollback.sh` → `/usr/local/bin/`,
      bootstrap `/opt/pecanrev/{repo,shared}` (script header has the layout).
- [ ] Install `deploy/nginx/pecanrev.conf.example` (real domain) + TLS certs
      via certbot (`deploy/nginx/README.md`).
- [ ] Apply the hardening runbook end-to-end: deploy user, ed25519 keys,
      SSH password/root-login off, ufw default-deny (22/80/443 only — 3001
      never public), fail2ban, unattended-upgrades, logrotate, disk alerts
      (`vps-hardening.md`, with its lockout warnings).
- [ ] Nightly backup cron + offsite copy (`backup-restore.md` §1) and the
      **first recorded scratch-restore test** (§4 template).
- [ ] `pm2 startup` + `pm2 save` so the app survives a VPS reboot.
- [ ] Stand up the staging instance (`staging-deployment.md`).

## 5. Requires provider-account creation (paid/free signups — do not pretend)

- [ ] **PostgreSQL provider** (Neon or Supabase): provision `pecanrev` +
      `pecanrev_waitlist` (+ staging equivalents), then run the cutover
      runbook (`postgres-migration.md`). This is the release-blocking one.
- [ ] **Sentry** organization (free tier is fine for beta).
- [ ] **PostHog** (or chosen analytics) project — production + staging
      separation per 93.md §5.3.
- [ ] **UptimeRobot / Better Stack** account.
- [ ] Public **status page** (hosted by the uptime provider is fine) and its
      link surfaced in the app (93.md §6.4).
- [ ] (Optional) Plausible or equivalent for cookieless marketing analytics.

## 6. Requires a business decision

- [ ] **Email provider**: keep Brevo SMTP vs move to Postmark/Resend
      (93.md §6.1 prefers a dedicated transactional provider; the app's
      provider abstraction makes the switch config-level; DNS records change
      with the provider — `email-domain-auth.md` §8).
- [ ] PostgreSQL provider choice (Neon vs Supabase vs other) + plan/tier.
- [ ] Beta cohort sizes, invitation pacing, and tier assignment policy.
- [ ] Support address + alert-routing destination (which inbox/Slack pages a
      human).
- [ ] Cloudflare in front of the VPS: yes/no. If yes, the whole adoption is
      gated in `cloudflare-setup.md` (edge-only; frontend stays on the origin,
      no Workers/Pages migration — decision recorded there).
- [ ] Design-partner recruitment, institutional contracts, testimonials
      program (93.md explicitly non-code).

## 7. Requires legal or accounting review

- [ ] Breach-notification obligations by user jurisdiction (feeds
      `incident-response.md` §4 step 4).
- [ ] Terms of service / privacy policy review for beta (research data
      handling, analytics disclosure, email opt-out wording).
- [ ] Tax/VAT/billing questions — explicitly deferred by 93.md; no billing is
      active.

## 8. Deferred until after beta (93.md's own deferral list)

- [ ] Activating paid billing / Stripe live mode.
- [ ] Tax/VAT automation, institutional invoicing, procurement workflows.
- [ ] Public roadmap surface.
- [ ] Social-media account creation.
- [ ] Demo-video production.
- [ ] Long-term testimonial campaigns.
- [ ] PM2 cluster mode (blocked on the four single-process subsystems —
      `pm2-operations.md`) and horizontal scaling generally.
- [ ] Full-disk encryption (safe only on a server rebuild —
      `vps-hardening.md` §9).
- [ ] Sentry source-map upload automation (`sentry-setup.md` § Source maps).
