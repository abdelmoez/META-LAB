# nginx + TLS runbook (93.md §3.2)

How to install the reverse proxy from `pecanrev.conf.example` and obtain/renew
TLS certificates. Everything here **requires VPS access** — nothing in this
directory does anything until an operator applies it on the server.

## 1. Install the site config

```bash
sudo cp deploy/nginx/pecanrev.conf.example /etc/nginx/sites-available/pecanrev.conf
sudo sed -i 's/example\.com/pecanrev.com/g' /etc/nginx/sites-available/pecanrev.conf   # real domain
sudo ln -sf /etc/nginx/sites-available/pecanrev.conf /etc/nginx/sites-enabled/pecanrev.conf
sudo rm -f /etc/nginx/sites-enabled/default        # avoid the stock catch-all
sudo nginx -t && sudo systemctl reload nginx
```

Notes:

- The config proxies **everything** (SPA + `/assets` + `/api`) to the single
  Express process on `127.0.0.1:3001` (staging block → `3002`). nginx does not
  serve `dist/` from disk.
- **Never replace the `location /` proxy with `try_files $uri $uri/ /index.html`.**
  That is the change that de-indexed the whole site in August 2026 — see the box at
  the top of `pecanrev.conf.example` and §5 below. If you genuinely cannot put Node
  in front of page requests, use **recipe B** (commented block at the bottom of the
  example file), which is prerender-aware, not the bare SPA fallback.
- The example includes a `www.example.com` → apex **301** server block. It only
  works once the certificate carries `www` as a SAN (§2) — TLS is negotiated before
  nginx sees the path, so without the SAN the visitor gets a certificate error and
  the redirect never runs.
- Security headers come from the app (helmet) — do not add duplicates in nginx.
- If `gzip` is already configured in `/etc/nginx/nginx.conf`'s `http{}` block,
  delete the gzip lines from the site file (define it in one place only).
- `TRUST_PROXY` in `server/.env` stays at its default for this topology (nginx
  on loopback); see `docs/manager/deployment-config.md` § Trust proxy.

## 2. Certbot / Let's Encrypt (recommended default)

Install (snap is the certbot-recommended channel on Ubuntu):

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

Issue certificates (nginx plugin edits the `ssl_certificate` lines in place):

```bash
sudo certbot --nginx -d pecanrev.com -d www.pecanrev.com -d staging.pecanrev.com
```

Requires: DNS A/AAAA records for all three hostnames already pointing at the
VPS, and ports 80+443 open (the HTTP-01 challenge arrives on port 80 — the
redirect server block keeps `/.well-known/acme-challenge/` reachable).

**`www` must be in the certificate.** As of 2026-08-10 the live certificate covered
only the apex (plus an IP-based nip.io name), so `https://www.pecanrev.com` returned
a hard TLS error — the `www` → apex 301 in the example config could never run,
because TLS is negotiated before nginx reads the request path. Confirm the SANs
after issuing:

```bash
openssl s_client -connect www.pecanrev.com:443 -servername www.pecanrev.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 'Subject Alternative Name'
curl -sI https://www.pecanrev.com/features | head -2   # → 301 → https://pecanrev.com/features
```

### Auto-renewal

The snap package installs a systemd timer that renews automatically when <30
days remain. Verify it — do not assume:

```bash
systemctl list-timers | grep -i certbot   # timer present and scheduled
sudo certbot renew --dry-run              # full renewal rehearsal, no cert change
```

Renewal reloads nginx via certbot's deploy hook. If the dry run fails, fix it
**now** — a broken renewal is only discovered 90 days later as an outage.

## 3. Cloudflare-managed TLS (alternative)

If DNS moves to Cloudflare with the proxy (orange cloud) enabled:

- Set SSL/TLS mode to **Full (strict)** and install a **Cloudflare Origin
  Certificate** on the VPS in place of the Let's Encrypt files (or keep
  certbot — both work; Full (strict) just requires a cert nginx can present).
  Never use "Flexible" — it downgrades origin traffic to plain HTTP, which
  breaks Secure cookies.
- Client IPs then arrive in `CF-Connecting-IP`; either add nginx `real_ip`
  configuration for Cloudflare's ranges, or leave nginx as-is (it appends to
  `X-Forwarded-For`) and set `TRUST_PROXY` accordingly so `req.ip` is the real
  client, not the Cloudflare edge (rate limits and geo depend on it).
- Cloudflare MAY cache `/assets/*` (content-hashed, immutable) but must never
  cache `index.html` or `/api/*` — add a cache rule excluding those explicitly.
  Emergency purge: Cloudflare dashboard → Caching → Purge (see 93.md §3.7).
- Cloudflare's default 100s proxy timeout is **below** the app's 120s request
  timeout; long exports may need a page rule/timeout bump or should already run
  as durable background jobs (they do — see the job workers).

## 4. Smoke checks after any nginx change

```bash
sudo nginx -t                                              # config parses
curl -sI https://pecanrev.com | head -5                    # 200, HTTPS
curl -s  https://pecanrev.com/api/health                   # {"status":"ok",...}
curl -sI http://pecanrev.com | grep -i location            # 301 → https
# SSE not buffered (with a valid session cookie): frames arrive immediately
curl -N --max-time 30 -H "Cookie: metalab_session=<token>" https://pecanrev.com/api/events
```

## 5. SEO serving check — run this after EVERY nginx change

This is the one class of breakage that is invisible to a human: the site looks
perfect in a browser (the SPA boots and renders everything) while every crawler
receives an empty shell. Full runbook and background:
`docs/manager/deployment-readiness.md` § "SEO serving".

```bash
# 1. A feature page must serve ITS OWN title, not the homepage's.
curl -s https://pecanrev.com/features/screening | grep -o '<title>[^<]*'
#    → <title>Title, Abstract &amp; Full-Text Screening Software | PecanRev
#    ✗ if it prints "PecanRev — Systematic Review & Meta-Analysis Platform"

# 2. …and exactly one <h1>, with real text in it.
curl -s https://pecanrev.com/features/screening | grep -c '<h1'          # → 1

# 3. …and a page-specific description + canonical.
curl -s https://pecanrev.com/features/screening \
  | grep -oE '<(meta name="description"|link rel="canonical")[^>]*'

# 4. Unknown URLs are REAL 404s, not 200 shells (soft-404 regression alarm).
curl -sI https://pecanrev.com/this-does-not-exist | head -1              # → 404
curl -sI https://pecanrev.com/features/does-not-exist | head -1          # → 404

# 5. The prerender staging directory is not a public URL space.
curl -sI https://pecanrev.com/__prerender/terms/index.html | head -1     # → 404

# 6. Crawler files are served and compressed.
curl -sI -H 'Accept-Encoding: gzip' https://pecanrev.com/sitemap.xml | grep -iE 'content-(type|encoding)'
curl -s https://pecanrev.com/robots.txt | tail -1                        # → Sitemap: …
```

Check 1 is the whole thing in one line. If it prints the homepage title, the
prerendered documents are not being served, no amount of on-site SEO work matters,
and the fix is in this directory — not in the application.
