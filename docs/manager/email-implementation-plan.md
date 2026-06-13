# Email — Implementation Plan (prompt14, Phase 1)

Companion to `email-current-state-audit.md`. The transport/contact/invite layers
are mature; this plan **completes** the partial pieces and **adds** the one
missing system (token-based password reset) with the smallest safe change set.

## 1. Recommended architecture

Keep the existing **single shared service** (`server/services/emailService.js`) as
the only place that talks to SMTP. Everything (contact reply, invite, password
reset) renders a template and calls `sendEmail()`, which never throws and records
metrics. No new transport, no new provider SDK, no secrets in code.

```
caller → render*Email() → sendEmail({to,subject,html,text,context})
                              ├─ not configured → {sent:false, reason:'not_configured'}   (draft/link fallback)
                              ├─ send ok        → {sent:true, id}   + EMAIL_SENT usage
                              └─ send error     → {sent:false, reason:'send_failed'} + EMAIL_FAILED usage
```

## 2. Provider abstraction

`nodemailer` SMTP, env-driven, already installed. `EMAIL_PROVIDER` stays an
**informational label** surfaced in ops (smtp/resend/sendgrid/gmail/custom). No
per-provider branching — every supported provider is "SMTP with different creds".

## 3. nodemailer SMTP — yes (unchanged)

Port 465 ⇒ implicit TLS; else STARTTLS. Auth optional. Already correct.

## 4. Files to change

**Backend**
- `server/prisma/schema.prisma` — **add** `PasswordResetToken` model + `User.passwordResetTokens` relation (additive/nullable; new table → safe under `prisma db push`).
- `server/services/emailService.js` — add `renderPasswordResetEmail`, `renderBaseEmailLayout` (extract shared card), `renderContactReplyEmail` alias, `emailStatus()` (secret-free config snapshot).
- `server/utils/usage.js` — add `PASSWORD_RESET_EMAIL_SENT`, `PASSWORD_RESET_EMAIL_FAILED`.
- `server/services/passwordResetService.js` — **new**: `createResetToken(userId, {requestedByUserId, ip})`, `consumeResetToken(token, newPassword)`, hashing/expiry/single-use; never logs raw token.
- `server/controllers/authController.js` — add `forgotPassword` (no-enumeration), `resetPassword`.
- `server/routes/auth.js` — add `POST /forgot-password`, `POST /reset-password` (inherit `authLimiter`).
- `server/controllers/adminController.js` — add `sendPasswordReset` (admin/mod, token-based, copyable link fallback); enrich `getMetrics.emailStats`; add `email` block to `getConsole`.
- `server/routes/admin.js` — add `POST /users/:id/send-password-reset` (`requireAdminOrMod` + `requireTargetEditable`).

**Frontend**
- `src/frontend/pages/ResetPassword.jsx` — **new** public page: `/reset` (request mode) and `/reset?token=…` (set-password mode).
- `src/App.jsx` — add public `/reset` route (unwrapped, like `/invite/:token`); pass `onForgot` to `LoginRoute`.
- `src/frontend/pages/Login.jsx` — add "Forgot password?" link (new `onForgot` prop).
- `src/frontend/api-client/apiClient.js` — `auth.forgotPassword`, `auth.resetPassword`.
- `src/frontend/pages/admin/adminApiClient.js` — `users.sendPasswordReset`; (metrics already wired).
- `src/frontend/pages/admin/AdminConsole.jsx` — "Send password reset email" in user detail (token-based, copyable-link fallback); Email System status card in Overview.

**Docs / env**
- `.env.example` (root), `server/.env.example`, `server/docs/email-setup.md`, `docs/manager/deployment-readiness.md`, **new** `docs/manager/email-security-review.md`.

**Tests**
- `tests/unit/emailService.test.js` (new), `tests/integration/api-password-reset.test.js` (new).

## 5. Database models

```prisma
model PasswordResetToken {
  id                String    @id @default(uuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash         String    // SHA-256 hex; raw token never stored
  expiresAt         DateTime
  usedAt            DateTime?
  requestedByUserId String?   // admin/mod who initiated; null = self-service
  ip                String    @default("")
  createdAt         DateTime  @default(now())
  @@index([tokenHash])
  @@index([userId, createdAt])
}
```
No `@unique` on `tokenHash` (mirrors invite precedent → `db push` needs no
`--accept-data-loss`); 256-bit tokens + single-use `usedAt` guarantee uniqueness.

## 6. Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/forgot-password` | public (authLimiter) | self-service request; **always 200** (no enumeration) |
| POST | `/api/auth/reset-password` | public (authLimiter) | `{token,password}` → consume + set password |
| POST | `/api/admin/users/:id/send-password-reset` | admin+mod, `requireTargetEditable` | operator-initiated; emails link or returns copyable link |
| POST | `/api/admin/users/:id/reset-password` | (existing) | legacy temp password — kept as fallback |

## 7. UI changes

- Public `/reset` page (two modes) matching Login/Invite design tokens.
- "Forgot password?" link on Login.
- Ops user detail: "Send password reset email" (primary) + existing temp-password (secondary fallback). When email unconfigured → copyable reset link shown **only to the operator**, clearly marked dev fallback.
- Ops Overview: Email System card (configured/provider/host/from/base-URL + last sent/failed + per-context counts).

## 8. Security risks & mitigations

| Risk | Mitigation |
|------|------------|
| Token theft at rest | SHA-256 hash only; raw token never stored/logged |
| Token replay | single-use `usedAt`; consumed atomically |
| Stale tokens | short TTL (`PASSWORD_RESET_TTL_MINUTES`, default 60) + all of a user's tokens invalidated on successful reset |
| Email enumeration | `forgot-password` always 200 with generic copy; no "no such user" |
| Operator takeover | `requireTargetEditable` → mod cannot reset admin/mod; defense-in-depth role check in handler |
| Secret leakage | `emailStatus()` returns booleans/labels only — never host/user/pass values |
| Abuse / spam | `authLimiter` (20/15min prod) on forgot/reset; admin path rate-limited by `adminLimiter` |
| HTML injection | every interpolated value escaped in templates |

## 9. Fallback behaviour (email optional — the core contract)

- SMTP unconfigured: `sendEmail` → `{sent:false, reason:'not_configured'}`; **nothing 500s**.
  - contact reply → saved as draft (existing).
  - invite → copyable `invite.link` (existing).
  - password reset → operator gets copyable reset link; self-service still returns generic 200 (link only logged server-side at debug, never to the user).
- Send failure: caught, `{sent:false, reason:'send_failed'}`, EMAIL_FAILED recorded, token/draft still persisted.

## 10. Testing plan

- **Unit** (`emailService.test.js`): `isEmailConfigured` matrix; `sendEmail` not_configured / never-throws; `renderInviteEmail`/`renderReplyEmail`/`renderPasswordResetEmail` escape injected `<script>`/quotes; `emailStatus` hides secrets.
- **Integration** (`api-password-reset.test.js`, live server): forgot-password always 200 (known + unknown email); admin send-reset returns link when unconfigured; reset consumes token + login works with new password; token cannot be reused; expired/invalid token 400; mod cannot reset admin/mod (403); admin can reset ordinary user.
- Re-run existing unit + screening/integration suites to prove no regressions.

## 11. Production setup plan

Set `SMTP_HOST`, `EMAIL_FROM` (required), `APP_BASE_URL` (HTTPS origin for links),
optional `SMTP_PORT/USER/PASS`, `EMAIL_PROVIDER`, `PASSWORD_RESET_TTL_MINUTES`.
Secrets only in the deploy environment, never committed. Links use `APP_BASE_URL`
(fallback to request origin if unset). Documented in `email-setup.md` +
`deployment-readiness.md`.

## 12. Implement now

Everything in §4 — full token-based reset (self-service + admin-initiated),
service polish, ops status/metrics, env/docs, security review, tests.

## 13. Postpone

- Per-provider API SDKs (Resend/SendGrid HTTP APIs) — SMTP covers them all.
- Editing SMTP secrets from the ops UI — needs a secret manager; out of scope (status is read-only).
- Email open/click tracking, templated digests — not requested.
