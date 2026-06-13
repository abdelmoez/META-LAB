# Email — Current-State Audit (prompt14, Phase 0)

> Inspection performed **before** any code was written. Status legend:
> ✅ implemented & working · 🟡 partial · 🔴 broken · ⬜ missing · ⚠️ risky · ⏸ postpone.
>
> Headline: the email **transport, contact-reply, and invite** systems are already
> mature and production-shaped (prompts 4 & 9). The one genuine gap is the
> **token-based password reset** flow (only a legacy admin temp-password reset
> exists). Ops email **status/metrics** are partial. Nothing here is duplicated —
> every change below either completes a partial system or adds the one missing one.

## Audit matrix

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | nodemailer installed | ✅ | `server/package.json` → `"nodemailer": "^8.0.10"` |
| 2 | Email service implemented | ✅ | `server/services/emailService.js` |
| 3 | `services/emailService.js` exists | ✅ | `server/services/emailService.js` (262 lines) |
| 4 | `renderInviteEmail` exists | ✅ | `emailService.js:173` — META·LAB card, escaped, plain-text fallback |
| 5 | `renderContactReplyEmail` exists | 🟡 | Exists as **`renderReplyEmail`** (`emailService.js:108`), not that exact name. Used by `adminController.replyToMessage`. Will keep name + add a `renderContactReplyEmail` **alias** so the prompt's contract name resolves. |
| 6 | `sendEmail` exists | ✅ | `emailService.js:46` — never throws, returns `{sent, reason?, id?}`, records `EMAIL_SENT`/`EMAIL_FAILED` |
| 7 | `isEmailConfigured` exists | ✅ | `emailService.js:32` — true iff `SMTP_HOST` **and** `EMAIL_FROM` |
| 8 | Admin contact-reply routes exist | ✅ | `routes/admin.js:101-102` — `GET/POST /contact-messages/:id/replies\|reply`, `requireAdminOrMod` |
| 9 | Contact replies save to DB | ✅ | `ContactReply` model (`schema.prisma:76`), status `sent\|failed\|draft` |
| 10 | Invite models/routes exist | ✅ | Invite = pending `ScreenProjectMember` row + token fields (`schema.prisma:373-386`); `routes/invites.js`, `screeningMemberController.addMember` |
| 11 | Invite emails sent already | ✅ | `addMember` best-effort send, gated by `appSettings.emailInvitesEnabled !== false` + `isEmailConfigured()` |
| 12 | Invite tokens hash-only at rest | ✅ | `crypto.randomBytes(32)` → SHA-256 → `inviteTokenHash`; plaintext only in the `invite.link` response |
| 13 | Invite tokens single-use | ✅ | `acceptInvite` nulls `inviteTokenHash` + stamps `inviteAcceptedAt` |
| 14 | Invite expiry implemented | ✅ | `inviteExpiresAt`, default `metaSiftSettings.inviteExpiryDays` (=14) |
| 15 | **Password-reset token flow** | ⬜ | **No token model, no public reset route, no reset page.** This is the main work. |
| 16 | Admin/mod reset generates temp passwords | ✅ | `adminController.resetUserPassword` (`:587`) → `generateTempPassword`, returns plaintext once. Weak (operator handles secret). Kept as fallback. |
| 17 | `.env.example` has email vars | 🟡 | `server/.env.example` has `SMTP_*`, `EMAIL_FROM`, `EMAIL_PROVIDER`; `APP_BASE_URL` lives in the CORS block (not the email block). Placeholder values look like real config. Needs clarifying comments + reset TTL var. |
| 18 | Ops console shows email status | 🟡 | `getConsole` returns `emailConfigured` (bool); `MessagesSection` shows the amber not-configured notice. No provider/host/from/base-URL status surface. |
| 19 | Ops console shows sent/failed email metrics | 🟡 | `getMetrics` → `emailStats:{sent,failed}`; Overview shows "Emails Sent/Failed". No per-context (invite/reset/contact) split, no last-sent/last-failed, no reset metrics. |
| 20 | UsageEvents / audit connected to email | ✅ | `sendEmail` records `EMAIL_SENT`/`EMAIL_FAILED` (with `meta.context`); `logAdminAction('REPLY_MESSAGE')`; `writeAudit('INVITE_*')`. Missing: `PASSWORD_RESET_*` events. |
| 21 | Tests present | 🟡 | Invite token tests in `tests/screening/integration/prompt9.test.js` (T3); contact-reply in prompt4/5 suites. **No emailService unit tests, no password-reset tests.** |

## Architecture as-found

- **Transport** (`emailService.js`): env-driven, lazy `import('nodemailer')`, `secure` on port 465 else STARTTLS, optional auth, **never throws**, returns `{sent,reason}`, records usage. Templates use inline-hex tables (correct for email clients), escape every interpolated value, ship HTML + plain-text. This is already the "preferred architecture" the prompt asks for.
- **Contact reply** (`adminController.replyToMessage` `:1111`): render → `sendEmail` → persist `ContactReply` (status `sent` if sent else `draft`) → mark message replied → per-staff read receipt → `logAdminAction`. Returns `{reply, emailConfigured, sent}`, **never 500s** on missing SMTP. Frontend `ReplyComposer`/`MessageDetail`/`ReplyThread` (AdminConsole) complete, incl. amber notice. **Complete.**
- **Invites** (`addMember` → `invitesController`): existing-user → immediate active member + notification; new email → pending member row + token ceremony + best-effort email + copyable `invite.link` fallback (`emailConfigured`/`emailSent` flags). Accept = `POST /api/invites/:token/accept` (single-use). Register auto-claims pending invites by email (`authController.claimPendingScreenInvites`). Revoke = removing the pending row (`removeMember`, `INVITE_REVOKED`). `InvitePage.jsx` handles signed-in & signed-out. **Complete** — only minor metric/event-naming polish possible.
- **Password reset**: legacy only. `POST /api/admin/users/:id/reset-password` (`requireAdminOrMod` + `requireTargetEditable`, so **mod cannot target admin/mod**) → temp password returned once + `CopyableBox` in user detail. No self-service, no token, no email link.

## Roles / permissions baseline (reused, not rebuilt)

- `requireAuth` (cookie `metalab_session`, JWT) → `requireRole(['admin','mod'])` = `requireAdminOrMod`; `requireAdmin` = admin-only. Roles: `user | mod | admin` (schema comment is stale; `mod` is live since prompt12).
- `requireTargetEditable`: admins pass; **mods may only mutate `role==='user'` targets** (403 + `MOD_TARGET_DENIED` SecurityEvent otherwise). This already encodes "mod cannot reset admin/mod" and will gate the new `send-password-reset` route verbatim.

## What must change (no duplication)

1. **Add** token-based password reset: `PasswordResetToken` model (hash-only, single-use, expiry — mirrors the invite-token precedent: plain `@@index`, **no `@unique`** so `prisma db push` stays clean), `forgotPassword`/`resetPassword` handlers + routes, admin-initiated `send-password-reset`, public `/reset` page, ops "Send reset link" button. `renderPasswordResetEmail` template.
2. **Complete** ops email status/metrics: cheap env-only `email` block on `getConsole`; enrich `getMetrics.emailStats`; ops Email System status card.
3. **Polish** the service: `renderPasswordResetEmail`, `renderBaseEmailLayout` (extract shared card to kill duplication), `renderContactReplyEmail` alias, `emailStatus()` helper, `PASSWORD_RESET_EMAIL_*` usage types.
4. **Docs/env**: clarify `.env.example` (both), update `email-setup.md`, `deployment-readiness.md`; new `email-security-review.md`.
5. **Tests**: new emailService unit tests; new password-reset integration tests (token single-use/expiry, mod-cannot-reset-admin, no email enumeration).

Nothing in the existing transport/contact/invite systems is rewritten — they are reused as-is and extended.
