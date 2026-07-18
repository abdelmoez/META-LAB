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
