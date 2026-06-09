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
| `APP_BASE_URL`   | no       | Public base URL, used in the email footer link.                            |

`isEmailConfigured()` returns true only when **both** `SMTP_HOST` and `EMAIL_FROM`
are present.

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

## Production-preferred: token-based password reset

`POST /api/admin/users/:id/reset-password` generates a strong temporary password,
hashes it, and returns the plaintext **once** for the admin/mod to relay securely.
This is convenient but operationally weak (the operator handles the secret).

The production-preferred flow is a **token-based reset**:

1. Generate a single-use, time-limited reset token (store only its hash).
2. Email the user a link (`${APP_BASE_URL}/reset?token=...`) using this email service.
3. The user sets their own password; the token is consumed and invalidated.

This avoids any human relaying the credential and gives the user control. Wiring it
requires a token model + a public reset route (outside this prompt's file ownership),
but the email transport here is ready to carry the link once those exist.
