# Email Setup (Console Replies)

The ops console can reply to contact messages by email (prompt4 Task 4). Email is
**optional**: when SMTP is not configured the reply is saved as a *draft* and the UI
shows an amber notice. Nothing 500s and the console stays fully usable.

## Environment variables

| Variable         | Required | Description                                                                 |
|------------------|----------|-----------------------------------------------------------------------------|
| `SMTP_HOST`      | **yes**  | SMTP server host. Email only sends when this **and** `EMAIL_FROM` are set.  |
| `EMAIL_FROM`     | **yes**  | From header, e.g. `META·LAB <no-reply@yourdomain.com>`.                     |
| `SMTP_PORT`      | no       | SMTP port. Default `587` (STARTTLS). Use `465` for implicit TLS.            |
| `SMTP_USER`      | no       | SMTP auth username. Omit for unauthenticated relays.                       |
| `SMTP_PASS`      | no       | SMTP auth password / API key.                                              |
| `EMAIL_PROVIDER` | no       | Informational label only (e.g. `smtp`, `resend`, `sendgrid`).              |
| `APP_BASE_URL`   | no       | Public base URL, used in the footer link **and** to build invite + reset links (`${APP_BASE_URL}/reset?token=…`). Falls back to the request origin if unset. |
| `PASSWORD_RESET_TTL_MINUTES` | no | Lifetime of a password-reset token link (default `60`).            |

`isEmailConfigured()` returns true only when **both** `SMTP_HOST` and `EMAIL_FROM`
are present. `emailStatus()` exposes a **secret-free** snapshot (booleans + the
provider label only) to the ops console — host/user/password values are never
returned by any API.

## Example configs (.env)

### Resend (SMTP)
```
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_your_api_key
EMAIL_FROM=META·LAB <no-reply@yourdomain.com>
APP_BASE_URL=https://app.metalab.example
```

### SendGrid (SMTP)
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your_api_key
EMAIL_FROM=META·LAB <no-reply@yourdomain.com>
```

### Gmail (app password — dev/low volume only)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=youraddress@gmail.com
SMTP_PASS=your_16_char_app_password
EMAIL_FROM=Your Name <youraddress@gmail.com>
```
Create an app password at https://myaccount.google.com/apppasswords (2FA required).

## Not-configured fallback

If `SMTP_HOST`/`EMAIL_FROM` are missing, or `nodemailer` cannot be imported, or the
send fails:

- `sendEmail()` returns `{ sent: false, reason }` and **never throws**.
- `POST /api/admin/contact-messages/:id/reply` still returns **200** with the saved
  `ContactReply` (status `draft` if not configured, `failed` if a send attempt errored),
  plus `emailConfigured: false` and `sent: false`.
- The console shows: *"Email is not configured — reply saved as draft. See
  server/docs/email-setup.md."*

## Endpoints

| Method | Path                                          | Who           |
|--------|-----------------------------------------------|---------------|
| POST   | `/api/admin/contact-messages/:id/reply`       | admin + mod   |
| GET    | `/api/admin/contact-messages/:id/replies`     | admin + mod   |

Reply body: `{ subject?, body }`. If `subject` is omitted it defaults to
`Re: <original subject>`. Response: `{ reply, emailConfigured, sent }`.

## Token-based password reset (prompt14 — implemented)

The production-preferred **token-based reset** is now wired end to end. Tokens are
32-byte CSPRNG; only the **SHA-256 hash** is stored (`PasswordResetToken.tokenHash`),
they are **single-use** (`usedAt`) and **time-limited** (`PASSWORD_RESET_TTL_MINUTES`,
default 60). Issuing a new token invalidates the user's prior unused ones; a
successful reset invalidates all remaining ones. The raw token appears only in the
emailed link / authorized-operator response and is **never logged**.

### Flows

| Entry point | Route | Notes |
|-------------|-------|-------|
| Self-service | `POST /api/auth/forgot-password` `{email}` | Always returns the same generic 200 — **no account enumeration**. Emails a link if the account exists & is active. |
| Set password | `POST /api/auth/reset-password` `{token,password}` | Consumes the token, sets the new password (min 8 chars). 400 on invalid/expired/used. |
| Operator-initiated | `POST /api/admin/users/:id/send-password-reset` | admin + mod (`requireTargetEditable` → **mod cannot target admin/mod**). Emails the link; when email is unconfigured/fails, returns a copyable `link` for the operator to relay. |
| Public page | `GET /reset` (request) · `GET /reset?token=…` (set) | `src/frontend/pages/ResetPassword.jsx`. A "Forgot password?" link on Login routes here. |

Both `/api/auth/forgot-password` and `/api/auth/reset-password` inherit the
`/api/auth` rate limiter (20 req / 15 min in production).

### Legacy fallback

`POST /api/admin/users/:id/reset-password` (generate a temporary password,
returned once) is **kept** as a secondary fallback in the ops user detail. Prefer
the token-based reset — it never makes a human handle the credential.

## Ops email status & metrics (prompt14 Task 5)

- `GET /api/admin/console` and `GET /api/admin/metrics` both return `email`
  (secret-free config snapshot: `configured`, `provider`, `smtpHostConfigured`,
  `emailFromConfigured`, `smtpAuthConfigured`, `appBaseUrlConfigured`).
- `GET /api/admin/metrics` → `emailStats`: `sent`, `failed`, `lastSentAt`,
  `lastFailedAt`, and `invites` / `passwordResets` / `contactReplies` splits.
- The ops Overview renders an **Email System** card from these.

---

## Invite emails (prompt 9)

`renderInviteEmail` in `services/emailService.js` builds the META·LAB-styled invitation (project name,
inviter, role summary, CTA link, expiration note; every interpolated value escaped). It is sent
**best-effort** from `addMember` when SMTP is configured and `appSettings.emailInvitesEnabled` is not
false — a send failure never fails the request. When email is unconfigured, the inviter gets a copyable
invite link in the 201 response instead (`invite.link`, with `emailConfigured:false`), following the
contact-reply fallback precedent. Token links follow the hash-only storage rule above (single-use,
time-limited via `metaSiftSettings.inviteExpiryDays`, SHA-256 hash at rest). `sendEmail` records
`EMAIL_SENT` / `EMAIL_FAILED` UsageEvents for the ops email metrics (not_configured/no_recipient
early-outs are not counted as failures).
