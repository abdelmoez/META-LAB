# Cloudflare setup — adoption runbook (94.md Parts 3 + 6)

Ordered, gated procedure for putting Cloudflare in front of the existing PecanRev
origin. **Every step here is an EXTERNAL action in the Cloudflare dashboard or on
the VPS; NONE has been performed** — "Cloudflare in front of the VPS: yes/no" is
still an open decision on `launch-checklist.md` §6. Each phase ends with a
**verify-before-proceeding** gate; do not advance until its check passes. When a
step can break access, its warning says so — read it first.

## Architecture decision (what Cloudflare is, and is not, here)

- **The Node/Express backend stays on the origin VPS.** It depends on Node APIs,
  Prisma, PostgreSQL (post-cutover) / SQLite, PDF processing, durable background
  jobs, and CPU-heavy screening — none of which belong on Cloudflare Workers
  (94.md §3.1). No Workers migration.
- **The frontend stays on the origin too.** Express already serves the SPA, its
  content-hashed immutable `/assets/*`, no-cache `index.html`, and no-store
  `/api/*` on one origin (see `deployment-config.md`). That single-origin model
  keeps auth cookies, OAuth callbacks, CSP nonces, client-side routing, and
  staging separation trivially correct. Moving the SPA to **Cloudflare Pages**
  would split origins and complicate all of the above for no real gain while the
  origin is not a bottleneck — so **Pages is NOT adopted** (94.md §3.2). Revisit
  only if static-asset serving ever becomes a measured problem; the CDN in front
  already caches `/assets/*` at the edge without Pages.
- **Cloudflare's role is the edge layer only:** DNS, reverse proxy, TLS, CDN/
  cache, DDoS/WAF/bot protection, edge rate limiting, and Turnstile. It
  **complements** — never replaces — the app's own auth, authorization,
  express-rate-limit, CSRF, and helmet CSP (94.md §3.9). Internal traffic and
  the direct-origin path can bypass Cloudflare, so app-level security stays
  authoritative.

Extends, does not repeat: `deploy/nginx/README.md` §3 (Cloudflare-managed TLS),
`deploy/nginx/cloudflare-real-ip.conf.example`, and
`deploy/cloudflare/update-cf-ip-ranges.sh`.

---

## Phase 0 — Prerequisites (verify BEFORE touching DNS)

Cloudflare in front of a broken origin just hides the breakage behind a second
layer. Confirm the origin is healthy on its real IP first.

- [ ] Production nginx + TLS already working directly (certbot per
      `deploy/nginx/README.md`), app healthy:
      ```bash
      curl -sI https://pecanrev.com | head -3            # 200 over HTTPS, direct
      curl -s  https://pecanrev.com/api/health           # {"status":"ok",...}
      ```
- [ ] You have: Cloudflare account (with MFA — `launch-checklist.md` §2),
      registrar login (to change nameservers), and VPS root/deploy access.
- [ ] Record the origin's real IPv4/IPv6 — you will need them for the DNS records
      and, later, to lock the firewall to Cloudflare (Phase 6).

**Gate:** origin serves HTTPS correctly on its own before Cloudflare is added.

---

## Phase 1 — Add the site and change nameservers

- [ ] Cloudflare dashboard → **Add a site** → `pecanrev.com` → choose a plan
      (Free is sufficient for the edge features used here; note upload/timeout
      caps in the Appendix).
- [ ] Cloudflare scans existing DNS. **Review the imported records carefully** —
      it may miss records; you will reconcile them in Phase 2 before cutover.
- [ ] Cloudflare shows **two assigned nameservers**. At the **registrar**,
      replace the domain's nameservers with those two. (This is the cutover
      moment for DNS authority — do Phase 2 records first in the Cloudflare UI so
      they are ready the instant nameservers propagate.)

> ⚠️ Changing nameservers moves ALL DNS for the domain to Cloudflare, including
> **email (MX/SPF/DKIM/DMARC)**. If those records are not recreated in Cloudflare
> (Phase 2), mail delivery breaks at propagation. Stage every record in
> Cloudflare BEFORE switching nameservers.

**Verify:** `dig NS pecanrev.com +short` returns the Cloudflare nameservers
(propagation is minutes to a few hours). Do not proceed until it does.

---

## Phase 2 — DNS records (proxied vs DNS-only)

Create these in Cloudflare **before** relying on the nameserver switch. The
orange cloud = proxied (through Cloudflare); grey cloud = DNS-only (Cloudflare
answers DNS but traffic goes straight to the target). **Mail and verification
records MUST be grey-clouded** — proxying an MX or a TXT is meaningless or
harmful.

| Type | Name | Content | Proxy | Purpose |
|---|---|---|---|---|
| A | `pecanrev.com` | origin IPv4 | 🟠 Proxied | Apex web traffic |
| AAAA | `pecanrev.com` | origin IPv6 (if used) | 🟠 Proxied | Apex web traffic (v6) |
| CNAME | `www` | `pecanrev.com` | 🟠 Proxied | www → apex |
| A | `staging` | origin IPv4 | 🟠 Proxied | Staging web (Phase = staged rollout) |
| MX | `mail` / apex (per mail provider) | mail host | ⚪ DNS-only | Inbound mail — never proxy |
| TXT | `mail.pecanrev.com` | `v=spf1 include:spf.brevo.com -all` | ⚪ DNS-only | SPF (`email-domain-auth.md` §4) |
| TXT/CNAME | `mail._domainkey.mail.pecanrev.com` (name per Brevo dashboard) | Brevo DKIM value | ⚪ DNS-only | DKIM |
| TXT | `mail.pecanrev.com` | `brevo-code:xxxxxxxx` | ⚪ DNS-only | Brevo domain verification |
| TXT | `_dmarc.mail.pecanrev.com` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@pecanrev.com; fo=1` | ⚪ DNS-only | DMARC (monitor-first) |

Notes:
- The **exact** mail record names/values are account-specific — copy them
  verbatim from the Brevo dashboard (`email-domain-auth.md` §2/§4). The shapes
  above are illustrative; do not invent DKIM keys.
- Any provider ownership-verification TXT (e.g. a future analytics or CA
  validation record) is likewise **DNS-only**.
- Keep the sending subdomain pattern (`mail.pecanrev.com`) from
  `email-domain-auth.md` §3 — it is unaffected by proxying the web records.

**Verify (still grey-clouded / before enabling proxy features):**
```bash
dig +short pecanrev.com                       # resolves (Cloudflare edge IPs once proxied)
dig +short TXT mail.pecanrev.com              # SPF + brevo-code still present
dig +short TXT _dmarc.mail.pecanrev.com       # DMARC still present
```
Then send one test email through a staging flow and confirm SPF/DKIM/DMARC still
PASS (`email-domain-auth.md` §7). **Gate:** mail auth unchanged after the move.

---

## Phase 3 — SSL/TLS: Full (strict) + Origin Certificate

> ⚠️ **Never use "Flexible."** Flexible makes Cloudflare→origin traffic plain
> HTTP, so the app sees `http` and drops `Secure` cookies (breaking every
> session). Full (strict) is mandatory (94.md §3.4).

- [ ] SSL/TLS → Overview → set encryption mode to **Full (strict)**. This
      requires the origin to present a certificate Cloudflare trusts.
- [ ] Provide that origin certificate one of two ways (extends
      `deploy/nginx/README.md` §3):
  - **Cloudflare Origin Certificate (recommended when locking the firewall to CF
    in Phase 6).** SSL/TLS → **Origin Server** → **Create Certificate** → install
    the cert + key on the VPS and point nginx's `ssl_certificate` /
    `ssl_certificate_key` at them. An Origin Certificate is trusted **only by
    Cloudflare**, is valid for years, and needs **no HTTP-01 challenge** — so it
    keeps working even after Phase 6 firewalls port 80 to Cloudflare (which would
    break certbot renewal).
  - **Keep Let's Encrypt / certbot.** Full (strict) is happy with a valid public
    cert too. But see the renewal warning below.
- [ ] Enable **Authenticated Origin Pulls** (optional, Phase 6) so the origin can
      require Cloudflare's client certificate — a second lock on the origin.

> ⚠️ **certbot HTTP-01 vs origin lockdown.** certbot's default HTTP-01 challenge
> arrives on **port 80 from Let's Encrypt**, not from Cloudflare. If Phase 6
> firewalls 80/443 to Cloudflare ranges, HTTP-01 renewal silently fails ~60 days
> later and the cert expires. If you keep certbot behind a locked firewall,
> either (a) switch to a **Cloudflare Origin Certificate** (no ACME, preferred),
> or (b) move certbot to a **DNS-01** challenge (which needs no inbound port).
> Do not lock the firewall while relying on HTTP-01.

**Verify:**
```bash
curl -sI https://pecanrev.com | grep -i server        # cloudflare present once proxied
curl -sI https://pecanrev.com | head -3               # 200, valid chain, no cert warning
# origin still answers Cloudflare with a cert it trusts (no 526 "invalid cert" from CF)
```
**Gate:** the site loads over HTTPS through Cloudflare with no certificate errors
on apex, www, and (once live) staging. A Cloudflare **526** means the origin cert
is not valid/trusted — fix before proceeding.

---

## Phase 4 — HTTP→HTTPS redirect and HSTS (ONLY after Phase 3 verifies)

- [ ] SSL/TLS → Edge Certificates → **Always Use HTTPS: On** (edge-level
      redirect). The origin nginx already 301s HTTP→HTTPS
      (`deploy/nginx/pecanrev.conf.example`); with Cloudflare in front, enabling
      it at the edge avoids an extra origin hop. Keep the origin redirect too — it
      protects the direct-origin path.
- [ ] Confirm nginx does **not** enter a redirect loop behind Cloudflare. The app
      trusts `X-Forwarded-Proto` from the loopback nginx hop, and nginx sets it
      to `$scheme` (already `https` at the TLS terminator), so the app never
      thinks an already-HTTPS request is plain HTTP. (Full (strict) guarantees
      Cloudflare→origin is HTTPS, so `$scheme` is `https` — a Flexible setup is
      exactly what would cause the loop, another reason it is banned.)
- [ ] **HSTS — enable LAST, and only after** apex + www + staging all serve HTTPS
      cleanly for a while. SSL/TLS → Edge Certificates → **HTTP Strict Transport
      Security** → enable with a **short max-age first** (e.g. 6 months), add
      `includeSubDomains` only once every subdomain is confirmed HTTPS, and treat
      `preload` as a one-way door (hard to undo). helmet may already set HSTS at
      the app; pick ONE authority (edge or app) to avoid a confusingly doubled
      header — prefer the app's helmet value and leave Cloudflare HSTS off, or
      disable helmet HSTS and manage it at the edge. Document which you chose.

**Verify:**
```bash
curl -sI http://pecanrev.com | grep -i location        # 301 → https
curl -sI https://pecanrev.com | grep -i strict          # HSTS present (once enabled), single header
```
**Gate:** HTTP redirects to HTTPS on every hostname; exactly one HSTS header; no
redirect loop (a loop shows as `curl` erroring with too many redirects).

---

## Phase 5 — Real client IP at the origin

With Cloudflare proxying, the origin's `$remote_addr` becomes a Cloudflare edge
IP. Restore the true client IP for rate limits, audit/`LoginEvent`, and
suspicious-login detection — **at nginx, not by widening the app's trust-proxy**.

- [ ] Install `deploy/nginx/cloudflare-real-ip.conf.example` on the VPS (its
      header has the how-to). Simplest: drop it at
      `/etc/nginx/conf.d/cloudflare-real-ip.conf` (auto-included by nginx.conf's
      `http{}`), then `sudo nginx -t && sudo systemctl reload nginx`.
- [ ] Install and schedule `deploy/cloudflare/update-cf-ip-ranges.sh` to keep the
      `set_real_ip_from` list current (cron example in the script header;
      monthly is plenty). It validates the fetched ranges, rewrites the managed
      block atomically, and reloads nginx **only if `nginx -t` passes**.
- [ ] Leave **`TRUST_PROXY` at its loopback default** — do NOT set
      `TRUST_PROXY=true`. nginx now presents the real client IP to Express over
      the single trusted loopback hop; `req.ip` is correct. Setting it to `true`
      would make Express trust a spoofable `X-Forwarded-For` on the app's public
      bypass port (3001) — the exact origin header-spoofing hole 94.md §3.5 warns
      against. (Rationale in `cloudflare-real-ip.conf.example` and
      `deployment-config.md` § Trust proxy.)

**Verify:** from an external network, load the app, then on the VPS:
```bash
tail -n 5 /var/log/nginx/access.log     # your PUBLIC IP, not a 104.x / 172.6x Cloudflare edge IP
```
Confirm a fresh `LoginEvent`/audit row records the real client IP, and that
express-rate-limit buckets by it (two requests from the same client share a
bucket). **Gate:** logs and rate limits key on the real client IP.

---

## Phase 6 — Protect the origin (ranked options)

Prevent visitors from bypassing Cloudflare straight to the origin. Options,
best-first — **do at least the first**:

1. **Firewall 80/443 to Cloudflare ranges + Origin Certificate (primary).**
   Allow inbound web ports only from Cloudflare's published ranges; keep the
   Origin Certificate from Phase 3 so TLS still works. Procedure and the ufw
   variant live in `vps-hardening.md` § Origin lockdown (which reuses the same
   range list as the real-IP script).
   > ⚠️ **Never touch the SSH (22) rule** — keep the `vps-hardening.md` §0 dual-
   > session lifeline open while changing the firewall. And per Phase 3: a locked
   > firewall breaks certbot HTTP-01 — use the Origin Certificate (no ACME) or
   > DNS-01.
2. **Authenticated Origin Pulls.** Origin nginx requires Cloudflare's client
   certificate (`ssl_verify_client`), so even a direct connection that reaches
   the port is refused without CF's cert. Layer on top of #1.
3. **Cloudflare Tunnel (`cloudflared`) as an alternative to #1.** The origin makes
   an outbound tunnel to Cloudflare and you can then firewall inbound 80/443
   entirely. Compatible with this app (it is a normal HTTP origin), but adds a
   daemon to run/monitor.
   > ⚠️ A tunnel changes the inbound model — verify SSH access does not depend on
   > anything you close, and keep the out-of-band console (`vps-hardening.md` §9)
   > as the recovery path.

The origin must **never** trust `CF-Connecting-IP` / forwarded headers from
arbitrary direct connections — Phase 5's `set_real_ip_from` already scopes that
trust to Cloudflare ranges, so this holds even before the firewall is locked.

**Verify:** from a host outside Cloudflare, a direct hit to the origin IP is
refused/timed out while the Cloudflare hostname still works:
```bash
curl -sS --max-time 5 https://<origin-ip>/ -H 'Host: pecanrev.com' || echo "direct origin correctly blocked"
curl -sI https://pecanrev.com | head -1                # still 200 via Cloudflare
```
**Gate:** origin unreachable directly; site reachable via Cloudflare; SSH still
works from a fresh session.

---

## Phase 7 — WAF, DDoS, bot protection, edge rate limiting

Cloudflare rules **complement** the app's express-rate-limit, which stays
authoritative (user/project/tier limits need app context; internal traffic
bypasses the edge — 94.md §3.9).

- [ ] Security → WAF → **Managed rules: ON** (Cloudflare Managed Ruleset; OWASP
      core ruleset available on higher plans). Start in log/deploy mode, watch
      for false positives on legitimate flows (large imports, PDF uploads), then
      enforce.
- [ ] **DDoS protection** is on by default (L3/4 + L7 managed) — no action beyond
      leaving it enabled.
- [ ] **Bot Fight Mode** (Free) / Bot Management (paid) — enable, but ensure it
      does **not** challenge the SSE endpoint or API clients that legitimately
      poll.
- [ ] **Custom rate-limiting rules** (Security → WAF → Rate limiting rules) that
      COMPLEMENT the app limiter — set them looser than a real user but tight
      enough to blunt bursts:

      | Rule scope (path) | Suggested edge limit | Why |
      |---|---|---|
      | `/api/auth/*` (login, register, forgot-password) | tight, e.g. 20 req / 10 min / IP | credential stuffing, reset abuse |
      | `/api/auth/google/*` | modest, e.g. 30 req / 10 min / IP | redirect/callback abuse without blocking real retries |
      | `/api/waitlist*` | modest, e.g. 10 req / 10 min / IP | signup spam |
      | `/api/contact` | modest, e.g. 5 req / 10 min / IP | contact-form spam |
      | expensive processing routes (import/screening kickoff) | modest per IP | abuse of costly endpoints |

      These are edge burst-guards; the app's per-user/per-project/per-tier limits
      remain the real enforcement. Keep them **looser** than the app limiter so
      Cloudflare never blocks a user the app would have allowed (avoids the two
      layers conflicting — 94.md §3.9).
- [ ] Do **not** put a Cloudflare challenge on `/api/events` (SSE) or on
      authenticated API calls a signed-in user makes constantly.

**Verify:** trip a rule from a throwaway IP (rapid repeated `/api/auth/*` hits)
and confirm Cloudflare 429s at the edge while a normal browser session is
unaffected; Security → Events shows the block. **Gate:** rules block abuse
without blocking real users or SSE.

---

## Phase 8 — Caching (respect origin headers)

The origin already emits the correct caching contract: immutable
`Cache-Control: public, max-age=31536000, immutable` on content-hashed
`/assets/*`, no-cache on `index.html`, no-store on `/api/*`
(`deployment-config.md`, `deploy/nginx/pecanrev.conf.example`). So Cloudflare's
**default "respect origin cache headers" is correct** — Cloudflare will edge-cache
`/assets/*` and never cache HTML or `/api/*` on its own.

- [ ] Leave Cache → Configuration at the default (honor origin headers). Do not
      set a blanket Browser Cache TTL that overrides `no-store`.
- [ ] **Do NOT enable "Cache Everything" on HTML.** `index.html` carries a
      **per-response CSP nonce** (helmet) — caching one user's HTML and serving it
      to another reuses a stale nonce and breaks CSP (and could serve
      personalized HTML across users). HTML must stay uncached at the edge.
- [ ] **SSE `/api/events` must never be cached or buffered** at the edge — it is
      under `/api/*` (no-store) already; do not add any cache/transform rule that
      touches it. (Cloudflare does not buffer streaming responses by default; just
      do not override it.)
- [ ] Optional cache rule to be explicit/defensive: a rule matching `/assets/*`
      → Cache eligible / Edge TTL "respect origin," and a rule for everything else
      → Bypass cache. This restates the origin's own headers at the edge but
      documents intent; it is not required because the origin headers already
      drive it.

**Verify:**
```bash
curl -sI https://pecanrev.com/assets/<hashed>.js | grep -i -e cf-cache-status -e cache-control
#   → Cache-Control: public, max-age=31536000, immutable ; CF-Cache-Status: HIT (after a warm-up hit)
curl -sI https://pecanrev.com/ | grep -i -e cf-cache-status -e cache-control
#   → HTML: no-cache/appropriate ; CF-Cache-Status: DYNAMIC or BYPASS (never HIT)
curl -sI https://pecanrev.com/api/health | grep -i -e cf-cache-status -e cache-control
#   → Cache-Control: no-store ; CF-Cache-Status: DYNAMIC/BYPASS
```
**Gate:** hashed assets HIT at the edge; HTML and `/api/*` are never edge-cached.

---

## Phase 9 — Turnstile widgets (per environment)

The backend verifies Turnstile server-side on `register`, `forgot-password`,
`waitlist-signup`, and `contact` (deliberately **not** login — 94.md §3.10).
Create **separate keys per environment** so a staging key can never satisfy
production.

- [ ] Cloudflare dashboard → **Turnstile** → **Add widget** for each environment:
      - **Development:** hostnames `localhost`, `127.0.0.1`. Mode: **Managed**.
      - **Staging:** hostname `staging.pecanrev.com`. Mode: **Managed**.
      - **Production:** hostnames `pecanrev.com`, `www.pecanrev.com`. Mode:
        **Managed**.
- [ ] Each widget yields a **Site Key** (public, safe in the frontend bundle) and
      a **Secret Key** (server-side only). Map them:
      - Frontend build var → `TURNSTILE_SITE_KEY` (public; baked into the SPA).
      - Server env → `TURNSTILE_SECRET_KEY` (secret — `shared/server.env`, chmod
        600, never committed, never in the bundle).
      - `TURNSTILE_FAIL_OPEN` controls behaviour when Cloudflare's verify API is
        unreachable: `false` (fail closed, most secure) vs `true` (fail open, most
        available). Choose deliberately per environment; the app never permanently
        locks users out when Cloudflare is down if fail-open is set — document the
        choice.
- [ ] Never expose the secret key to the frontend; never trust the frontend token
      without the server-side verify (the backend already enforces this).

**Verify:** submit a protected form (e.g. waitlist signup) in each environment —
the widget renders, a real submission succeeds, and a request with a
missing/forged token is rejected server-side (`403`/validation error), not just
hidden in the UI. **Gate:** each environment uses its own key pair and rejects
bad tokens on the server.

---

## Phase 10 — Cache-purge API token (optional, recommend NOT now)

Because assets are content-hashed, a new deploy ships new filenames and old ones
simply age out — **manual purging is not needed** (94.md §3.8). Add a token only
if you later want to force-purge HTML or a specific URL.

- [ ] If adopted: My Profile → API Tokens → **Create Token** with **Zone →
      Cache Purge** permission scoped to the `pecanrev.com` zone **only**. Not the
      Global API Key. Store it as a **CI/deploy secret** (never in the repo).
- [ ] The deploy must treat a purge failure as **non-fatal but reported** — a
      transient purge error must not fail the whole deployment silently (content
      hashing means users still get the right asset). Log it and continue.
- [ ] **Recommendation: do not add this now.** Content-hashed assets make it
      unnecessary; adding a scoped token later is a 2-minute task if a real need
      appears.

**Verify (only if adopted):** a scoped purge of one test URL succeeds; the token
cannot edit DNS or other zone settings (least privilege). **Gate:** token is
Cache-Purge-only and zone-scoped, or intentionally absent.

---

## Phase 11 — Analytics: Cloudflare vs Sentry/app logs (division of labor)

Use Cloudflare analytics as **infrastructure telemetry only** — it does not
replace Sentry, app/audit logs, product analytics, or DB monitoring (94.md
§3.14).

- Use **Cloudflare** for: traffic volume, cache-hit ratio, blocked threats/bot
  traffic, geographic summaries, edge/origin error-code patterns, origin
  response time, bandwidth.
- Use **Sentry / app logs / audit log / product analytics / DB monitoring** for:
  application errors, request traces, security/audit events, feature usage, query
  performance. (`sentry-setup.md`, `deployment-config.md`.)

> ⚠️ **No private data in URLs.** Cloudflare (and any edge/proxy log) sees full
> request URLs. The app must keep identifiers, tokens, `state`/`nonce`, and
> signed values out of query strings and in POST bodies / headers / cookies so
> they never land in edge analytics or logs (94.md §3.14, §7). This is an
> app-side invariant — verify no OAuth/reset/signed-URL secret rides in a query
> string.

**Gate:** dashboards reviewed; confirmed no sensitive value appears in a sampled
set of request URLs.

---

## Appendix — Limits & compatibility (Cloudflare in front of this app)

- **Request duration.** Cloudflare's proxy has a ~**100s** edge timeout, which is
  **below** the origin's `REQUEST_TIMEOUT_MS=120000` (and nginx's 130s). A slow
  request could be cut by Cloudflare at 100s before the origin's own timeout
  fires. **Recommendation (documented, not changed here):** once behind
  Cloudflare, set `REQUEST_TIMEOUT_MS=95000` so the origin owns the timeout and
  returns a real error + request id instead of an opaque Cloudflare 524. Heavy
  work already runs as **durable background jobs** (immediate job id + SSE/poll
  progress) — nothing user-facing should approach 100s (94.md §3.11).
- **Upload size.** Cloudflare's plan body-size cap (Free/Pro ~**100 MB** per
  request) sits in front of nginx's `client_max_body_size 70m`. The bulk
  full-text upload path can attempt up to **500 × 100 MB**; any single part over
  the plan cap returns a **413 at the edge** before reaching the origin.
  Mitigations: keep per-file uploads under the cap; for genuinely large files,
  the documented future option is **direct-to-object-storage via signed URLs
  (Cloudflare R2 or equivalent)** that bypass the proxy body limit — do **not**
  migrate existing storage to R2 without a real need and a migration plan (94.md
  §3.11). Private R2 objects must stay non-public behind short-lived signed
  access.
- **SSE / long-polling.** `/api/events` works through Cloudflare: the app sends a
  `:hb` heartbeat every 25s and `X-Accel-Buffering: no`, well within edge idle
  limits, and Cloudflare does not buffer streaming responses (Phase 8). WebSockets
  are supported by Cloudflare if ever adopted.
- **Real IP.** Covered in Phase 5 — required for rate limits/audit to be correct
  behind the proxy.

---

## Staged rollout plan (staging first, then production)

Do not flip production DNS to Cloudflare cold. Prove it on staging.

1. **Staging behind Cloudflare first.** Proxy `staging.pecanrev.com` (Phase 2 row)
   and run Phases 3–9 against staging only. Validation checklist:
   - [ ] HTTPS via Cloudflare on staging, Full (strict), no cert error.
   - [ ] **OAuth callback works through the proxy** — full Google round-trip on
     `staging.pecanrev.com` lands signed in (uses the staging redirect URI +
     staging Turnstile key — `google-oauth-setup.md`, `staging-deployment.md`).
   - [ ] **Real IP** appears in staging `LoginEvent`/logs (Phase 5), not an edge
     IP.
   - [ ] **Cookies** (`metalab_session`, `metalab_gauth_txn`) set and clear
     correctly behind the proxy; sessions survive navigation.
   - [ ] **SSE** streams (screening/dedup progress arrives live).
   - [ ] **PDF upload and download** work through the proxy within the size cap.
   - [ ] Assets edge-cache (HIT); HTML/`/api/*` never cache (Phase 8).
   - [ ] Turnstile-protected forms pass/fail correctly (Phase 9).
2. **Then production.** Repeat Phases 3–9 for apex + www. Cut over by confirming
   the proxied apex/www records and Always Use HTTPS. Run the production smoke
   test (`scripts/smoke-deploy.mjs`) and a manual pass over login (password +
   Google), an SSE flow, and a PDF up/download.
3. **Rollback.** If anything misbehaves behind Cloudflare, **grey-cloud the
   affected record** (turn off the orange cloud) — traffic then goes straight to
   the origin (which still serves TLS directly via certbot/Origin Cert) while you
   diagnose. This is the instant, low-risk backout; no origin change needed.
   (Do not grey-cloud AND lock the firewall to CF at the same time — unlock the
   firewall first, or you black-hole the record.)

---

## External-actions checklist (all NOT DONE)

| Action | Dashboard / location | Status |
|---|---|---|
| Add site `pecanrev.com` to Cloudflare | Cloudflare | NOT DONE |
| Change nameservers at registrar | Registrar | NOT DONE |
| Create proxied A/AAAA/CNAME (apex, www, staging) | Cloudflare DNS | NOT DONE |
| Recreate mail/SPF/DKIM/DMARC as DNS-only | Cloudflare DNS | NOT DONE |
| Set SSL/TLS to Full (strict) | Cloudflare | NOT DONE |
| Install Cloudflare Origin Certificate on nginx (or keep certbot) | VPS | NOT DONE |
| Always Use HTTPS on; HSTS after cross-subdomain verify | Cloudflare | NOT DONE |
| Install `cloudflare-real-ip.conf` + range-refresh cron | VPS | NOT DONE |
| Origin lockdown (ufw to CF ranges / authenticated origin pulls / tunnel) | VPS + Cloudflare | NOT DONE |
| WAF managed rules + custom rate-limit rules | Cloudflare | NOT DONE |
| Caching left at "respect origin headers"; no Cache-Everything on HTML | Cloudflare | NOT DONE |
| Create Turnstile widgets (dev/staging/prod) + map keys | Cloudflare + env | NOT DONE |
| (Optional) scoped Cache-Purge API token in CI | Cloudflare + CI | NOT DONE |
| Review analytics; confirm no private data in URLs | Cloudflare | NOT DONE |
| Staged rollout: staging behind CF → validate → production | Cloudflare | NOT DONE |

## Related

- TLS + nginx install: `deploy/nginx/README.md` (§3 Cloudflare-managed TLS).
- Real-IP config + refresh script: `deploy/nginx/cloudflare-real-ip.conf.example`,
  `deploy/cloudflare/update-cf-ip-ranges.sh`.
- Origin firewall lockdown: `vps-hardening.md` § Origin lockdown.
- Google OAuth (callback URLs through the proxy): `google-oauth-setup.md`.
- Cookies/session/SSE behind the proxy: `deployment-config.md`.
- Staging isolation (own Turnstile keys + callback): `staging-deployment.md`.
- External ledger: `launch-checklist.md`.
