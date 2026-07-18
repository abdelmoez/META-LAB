# Email domain authentication — SPF, DKIM, DMARC (93.md §6.2)

Deliverability groundwork for PecanRev's transactional email (currently sent
through the **Brevo SMTP relay** — see `server/services/emailService.js` and
`docs/manager/email-security-review.md`). **Every DNS record below is an
EXTERNAL task** — it requires access to the domain's DNS zone (registrar /
IONOS / Cloudflare) and cannot be performed from this repository. The
repository side (env configuration, sender addresses) is documented here and
is complete.

## 1. Environment configuration (repository side — done, operator fills values)

| Var | Value pattern | Notes |
|---|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` | Brevo SMTP relay |
| `SMTP_PORT` | `587` | STARTTLS |
| `SMTP_USER` / `SMTP_PASS` | Brevo SMTP key | secrets — `shared/server.env` only |
| `EMAIL_FROM` | `no-reply@mail.pecanrev.com` | the authenticated sending identity (see §3) |
| `WAITLIST_SUPPORT_EMAIL` | `support@pecanrev.com` | shown in confirmation emails |
| `EMAIL_PROVIDER` | `smtp` | informational label in Ops |
| Staging: `EMAIL_REDIRECT_ALL_TO` | `team@pecanrev.com` | staging never emails real users (`server/.env.staging.example`) |

Sender addresses are configurable — use role addresses (`support@…`,
`hello@…`, `no-reply@…`), never a personal mailbox. Do not hardcode a domain
anywhere; `EMAIL_FROM`/`APP_BASE_URL` drive everything.

## 2. Provider setup checklist (Brevo dashboard — EXTERNAL)

- [ ] Brevo → Senders, Domains & Dedicated IPs → **Domains** → add the sending
      domain (recommended: `mail.pecanrev.com`, see §3).
- [ ] Brevo displays the exact DNS records for *your* account (a `brevo-code`
      verification TXT, DKIM record(s), and its SPF include). **Copy the
      dashboard values verbatim — they are account-specific; the examples in
      §4 are illustrative shapes only.**
- [ ] Add each record in DNS (§4), then click **Verify/Authenticate** in Brevo
      until all records show green.
- [ ] Add the `EMAIL_FROM` address as a verified sender if Brevo asks for it.

## 3. Sending-subdomain pattern (recommended)

Send from `mail.pecanrev.com` (e.g. `no-reply@mail.pecanrev.com`) rather than
the bare domain:

- Isolates transactional-email reputation from the root domain (and from any
  future marketing sending, which should get its own subdomain — 93.md §6.2's
  transactional/marketing separation).
- Lets SPF/DKIM/DMARC for the subdomain be managed independently.
- The root domain keeps its own (restrictive) SPF for human mailboxes.

## 4. DNS-record checklist (EXTERNAL — shapes, replace with dashboard values)

| Type | Host | Value (illustrative) | Purpose |
|---|---|---|---|
| TXT | `mail.pecanrev.com` | `v=spf1 include:spf.brevo.com -all` | SPF — authorizes Brevo to send for the subdomain (Brevo's include is shown in the dashboard; older accounts may show `spf.sendinblue.com`) |
| TXT/CNAME | `mail._domainkey.mail.pecanrev.com` (name per dashboard) | Brevo-provided DKIM key/target | DKIM — cryptographic signature |
| TXT | `mail.pecanrev.com` | `brevo-code:xxxxxxxx` | Brevo domain-ownership verification |
| TXT | `_dmarc.mail.pecanrev.com` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@pecanrev.com; fo=1` | DMARC — **monitor-first** (§5) |

One SPF TXT per host, ever — if a record already exists, merge the `include:`
into it instead of adding a second `v=spf1` record (two SPF records = SPF
permanently fails).

## 5. DMARC rollout — monitor first, then tighten

1. **Weeks 1–4: `p=none`** (as in §4). Nothing is blocked; aggregate reports
   arrive at the `rua=` mailbox showing who is sending as the domain and
   whether SPF/DKIM align.
2. **Review reports** (any free DMARC-report viewer works). Proceed only when
   ~100% of legitimate mail passes alignment.
3. **Tighten to `p=quarantine`** (optionally staged with `pct=25` → `pct=100`).
4. `p=reject` is the eventual end state — only after quarantine has run clean
   for weeks. Never start at reject.

## 6. Verification steps (after DNS propagates, ~minutes to 24 h)

```bash
dig +short TXT mail.pecanrev.com                       # SPF + brevo-code visible
dig +short TXT mail._domainkey.mail.pecanrev.com       # DKIM (or CNAME per dashboard)
dig +short TXT _dmarc.mail.pecanrev.com                # DMARC policy
```

Brevo dashboard → domain shows **Authenticated** on all rows.

## 7. Deliverability test procedure

1. Trigger a real flow (password reset to a team Gmail/Outlook address) — or
   staging with `EMAIL_REDIRECT_ALL_TO` pointed at the test inbox.
2. In the received message: **Show original / View source** → confirm
   `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`, and that the message is not in
   spam.
3. Send one test to a mail-tester service (e.g. mail-tester.com) and chase
   anything below ~9/10.
4. Re-test after ANY change to sender address, domain records, or provider.
5. Ops console → email metrics: confirm `sent` increments and no `failed`
   spike.

## 8. Related

- Provider abstraction, retry/idempotency, and the staging redirect are
  application-side (93.md §6.1) — see the email service and
  `server/.env.staging.example`.
- Keeping Brevo vs moving to Postmark/Resend is a **business decision** on the
  launch checklist; this document's DNS shapes change with the provider (each
  provider issues its own SPF include + DKIM keys) but the process is
  identical.
