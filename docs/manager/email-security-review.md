# Email — Security Review (prompt14, Task 7)

Scope: the email transport, contact-reply, invite, and the new token-based
password-reset flows. Reviewed against the prompt's Security & Diagnostics
checklist. Verdict per item: ✅ safe · 🟡 acceptable with note · ⬜ out of scope.

## Checklist

| # | Item | Verdict | Evidence / decision |
|---|------|---------|---------------------|
| 1 | HTML escaping in templates | ✅ | `escapeHtml()` applied to **every** interpolated value in `renderReplyEmail`, `renderInviteEmail`, `renderPasswordResetEmail`. The base layout (`renderBaseEmailLayout`) escapes `appName` + the footer `APP_BASE_URL`. Unit test injects `<script>`/quotes and asserts they're encoded. |
| 2 | Contact reply body handling | ✅ | Body is escaped then `\n`→`<br>`; never interpolated raw. Plain-text variant carries the raw body (text email, not HTML — no injection surface). |
| 3 | Invite token hashing | ✅ | `crypto.randomBytes(32)` → SHA-256 → `inviteTokenHash`; plaintext only in the `invite.link` response, never stored/logged. |
| 4 | Password-reset token hashing | ✅ | Same ceremony in `passwordResetService.js`: 32-byte token, SHA-256 `tokenHash`, raw token only in the link/operator response, never logged. |
| 5 | Token expiry | ✅ | Invite: `inviteExpiresAt` (default 14 d). Reset: `expiresAt = now + PASSWORD_RESET_TTL_MINUTES` (default 60 min). Both checked on resolve → 410/400. |
| 6 | Single-use tokens | ✅ | Invite: accept nulls `inviteTokenHash`. Reset: `consumeResetToken` burns via `updateMany {where:{id,usedAt:null}}` (race-safe — a concurrent double-consume sees count 0 and bails before any password write). |
| 7 | Permissions (admin/mod/owner/leader/user) | ✅ | Reset routes: self-service is public; admin `send-password-reset` is `requireAdminOrMod` + `requireTargetEditable` (mod blocked from admin/mod targets, +`MOD_TARGET_DENIED` event) with a defense-in-depth in-handler check. Invite authorization is the existing `getProjectAccess`/`canManageMembers` gate (unchanged). |
| 8 | Email enumeration risk | ✅ | `forgot-password` returns an **identical** generic body for valid, unknown, and suspended emails; only a malformed-format input gets a 400 (format error, not an existence oracle). Suspended accounts get no link. |
| 9 | SMTP error leakage | 🟡 | `sendEmail` returns a coarse `reason` (`not_configured`/`send_failed`) to callers; the detailed `err.message` is logged **server-side only**. The `error` is stored on `ContactReply.error` for operators but never on reset/invite responses. Acceptable — operators are staff. |
| 10 | Secrets exposure | ✅ | `emailStatus()` returns booleans + provider label only — never `SMTP_HOST/USER/PASS/EMAIL_FROM` values. No SMTP secret is stored in the DB or sent to any client. Verified by unit test (asserts no host/user/pass keys). |
| 11 | Audit logging | ✅ | `SEND_PASSWORD_RESET` (admin), `PASSWORD_RESET_REQUESTED` / `PASSWORD_RESET_COMPLETED` SecurityEvents (no raw token), `EMAIL_SENT`/`EMAIL_FAILED` + `PASSWORD_RESET_EMAIL_*` usage events. |
| 12 | Rate limiting | ✅ | `forgot-password` + `reset-password` inherit the `/api/auth` limiter (20/15 min prod). Admin path under `adminLimiter` (300/15 min prod). |
| 13 | Abuse prevention (invite/reset/reply spam) | 🟡 | Rate limiters above + one-live-token-per-user (issuing a new reset token invalidates prior ones, capping inbox spam). No per-email cooldown beyond the shared limiter — acceptable for the threat model; noted as a future hardening. |

## Risks found & fixed during implementation

- **Double-consume race** on reset tokens → fixed with the `usedAt:null` guarded `updateMany` (burn-before-write).
- **Enumeration via 500** → `forgot-password` swallows internal errors and still returns the generic body.
- **Metric flooding** → reset-specific `PASSWORD_RESET_EMAIL_FAILED` is recorded only on a real send failure, not on the expected not-configured fallback (mirrors `sendEmail`'s philosophy).
- **`@unique` on token hash** would force `prisma db push --accept-data-loss` on the VPS → avoided; uses a plain `@@index` like the invite precedent.

## Remaining limitations

- No per-email reset cooldown (only the shared auth limiter). Low risk; document as future work.
- `ContactReply` has no dedicated `sentAt` column — `status='sent'` + `createdAt` is the de-facto send time (no schema churn).
- SMTP secrets are env-only and **not** editable from the ops UI by design (would need a secret manager).

## Production recommendations

1. Set `SMTP_HOST` + `EMAIL_FROM` (required) and `APP_BASE_URL` (HTTPS) so reset/invite links resolve.
2. Use a transactional provider (Resend/SendGrid/Postmark/SES); Gmail app passwords are dev-only.
3. Keep `PASSWORD_RESET_TTL_MINUTES` short (≤ 60). Serve over HTTPS so tokens aren't exposed in transit.
4. Secrets live only in the deploy environment — never committed.
