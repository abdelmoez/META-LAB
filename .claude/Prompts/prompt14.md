CLAUDE MAX / FABLE 5.0 — COMPLETE EMAIL SYSTEM IMPLEMENTATION FOR META·LAB + META·SIFT

Claude, now everything important in the app is implemented, and I want you to implement the email system properly.

I am giving you full autonomy here.

I want you to read the current codebase first, read the existing email documentation/specification, understand what is already implemented, and then build the email system in the easiest, safest, most efficient, and most production-ready way possible.

Important:
Do not blindly create duplicate email systems.
First inspect what already exists.
If email service already exists partially, improve it.
If routes already exist partially, complete them.
If database models already exist partially, migrate safely.
If docs already exist, update them.
If tests already exist, expand them.

Read:
- server/docs/email-setup.md if it exists
- docs/manager/email-related docs if they exist
- services/emailService.js if it exists
- admin/contact message routes
- invite/member routes
- password reset routes if any
- ops metrics/audit log system
- .env.example
- package.json dependencies
- deployment docs

The uploaded/email spec says:
- Email is optional.
- SMTP is used.
- Email only sends when SMTP_HOST and EMAIL_FROM are configured.
- If SMTP is not configured, console replies are saved as draft and nothing crashes.
- sendEmail() should never throw.
- Admin/mod can reply to contact messages by email.
- Invite emails should use META·LAB-styled templates.
- Invite links should use secure tokens, hash-only storage, single-use, and expiration.
- Password reset should preferably use token-based reset rather than admins manually relaying temporary passwords.

I want you to implement the best version of this.

Use the Fable / Opus / Sonnet workflow:

Fable:
- You are the architect and advanced reasoning lead.
- Decide the best email architecture.
- Decide what to implement now and what to postpone.
- Own final integration, tests, version bump, commit, and push.

Opus:
- Reason through security, token flows, password reset safety, invite expiry, abuse cases, and production deployment.
- Validate that the email behavior is safe and does not leak secrets.

Sonnet:
- Implement straightforward backend routes, services, UI, docs, tests, and .env.example updates.

Use the team:
1. Main Claude / Fable — Overall Manager, Architect, Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Collaboration & Realtime Agent
5. QA Developer
6. Security & Diagnostics Agent
7. Ops/Admin Console Agent if useful

Do not ask me small questions.
Make the best technical and UX decisions.
Implement, test, document, version, commit, and push if safe.

Do not commit secrets.
Do not hardcode credentials.
Do not use real API keys.
Do not break login, invites, ops console, messages, or project membership.

====================================================
PHASE 0 — INSPECT CURRENT EMAIL STATE FIRST
====================================================

Before coding, create:

docs/manager/email-current-state-audit.md

Audit:

1. Is nodemailer installed?
2. Is any email service already implemented?
3. Does services/emailService.js exist?
4. Does renderInviteEmail exist?
5. Does renderContactReplyEmail exist?
6. Does sendEmail exist?
7. Does isEmailConfigured exist?
8. Do admin contact-message reply routes exist?
9. Do contact replies save to database?
10. Do invite models/routes exist?
11. Are invite emails sent already?
12. Are invite tokens hash-only at rest?
13. Are invite tokens single-use?
14. Is invite expiry implemented?
15. Is password reset token flow implemented?
16. Does admin/mod password reset currently generate temporary passwords?
17. Does .env.example include email variables?
18. Does ops console show email settings/status?
19. Does ops console show failed/sent email metrics?
20. Are UsageEvents or audit logs connected to email?
21. Are tests already present?

For each item, mark:
- implemented and working
- partially implemented
- broken
- missing
- risky
- should be postponed

Do not duplicate working systems.

====================================================
PHASE 1 — EMAIL ARCHITECTURE PLAN
====================================================

Create:

docs/manager/email-implementation-plan.md

Include:

1. Recommended architecture.
2. Which provider abstraction to use.
3. Whether to use nodemailer SMTP.
4. Which files will be changed.
5. Database models needed.
6. Routes needed.
7. UI changes needed.
8. Security risks.
9. Fallback behavior.
10. Testing plan.
11. Production setup plan.
12. What will be implemented now.
13. What will be postponed.

Preferred architecture:
- One shared email service.
- SMTP transport via nodemailer.
- Email templates rendered safely.
- No secret in code.
- Graceful fallback when unconfigured.
- All email attempts logged appropriately.
- Admin/mod console can see email status.
- Invite and reset links use APP_BASE_URL.

====================================================
TASK 1 — IMPLEMENT SHARED EMAIL SERVICE
====================================================

Implement or improve a shared email service.

Preferred file:
server/services/emailService.js

or the existing equivalent if the project structure differs.

Required exports:
1. isEmailConfigured()
2. sendEmail()
3. renderContactReplyEmail()
4. renderInviteEmail()
5. renderPasswordResetEmail()
6. maybe renderBaseEmailLayout()

Environment variables:
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- EMAIL_FROM
- EMAIL_PROVIDER
- APP_BASE_URL

Rules:
1. Email sends only when SMTP_HOST and EMAIL_FROM exist.
2. SMTP_PORT defaults to 587.
3. Port 465 should use secure implicit TLS.
4. Port 587 should use STARTTLS where appropriate.
5. SMTP_USER/SMTP_PASS are optional for unauthenticated relays.
6. EMAIL_PROVIDER is informational only unless you decide otherwise.
7. APP_BASE_URL is used for footer links and invite/reset links.
8. sendEmail() must never throw to route handlers.
9. sendEmail() should return:
   - { sent: true, provider, messageId? }
   - or { sent: false, reason }
10. If nodemailer is unavailable, return sent:false with reason.
11. If SMTP is not configured, return sent:false with reason not_configured.
12. If sending fails, catch error and return sent:false with safe reason.
13. Do not expose SMTP password or sensitive details in UI/API responses.
14. Log detailed error server-side only if safe.
15. Sanitize/escape all interpolated values in HTML templates.
16. Provide plain-text fallback for every HTML email if feasible.

Email design:
Use a META·LAB-styled template:
- professional
- clean
- academic
- not flashy
- works in email clients
- simple inline CSS
- app name/logo text
- CTA button where appropriate
- clear footer
- APP_BASE_URL link if configured

Templates needed:
1. Contact message reply.
2. Project invite.
3. Password reset.
4. Optional generic system email.

====================================================
TASK 2 — CONTACT MESSAGE EMAIL REPLIES FROM OPS CONSOLE
====================================================

Admin and Mod should be able to reply to contact/support messages by email.

Required endpoints:
- POST /api/admin/contact-messages/:id/reply
- GET /api/admin/contact-messages/:id/replies

Use existing route names if already implemented. Do not create conflicting routes.

Permissions:
- Admin can reply.
- Mod can reply.
- User cannot reply.
- Mod still cannot access dangerous admin-only settings.

Reply body:
{
  subject?: string,
  body: string
}

Behavior:
1. Validate body is not empty.
2. Subject defaults to Re: <original subject>.
3. Save ContactReply in database before or after send, but do not lose it if send fails.
4. If email is configured and send succeeds:
   - status = sent
   - sentAt set
   - response returns sent:true
5. If email is not configured:
   - status = draft
   - response returns 200
   - sent:false
   - emailConfigured:false
   - UI shows amber notice:
     “Email is not configured — reply saved as draft.”
6. If email send fails:
   - status = failed
   - response returns 200 or safe non-500 if reply saved
   - sent:false
   - include safe reason
7. Nothing should 500 just because SMTP is missing.
8. Store reply history/thread.
9. Mark original contact message as replied if sent.
10. If draft only, mark as draft/reply drafted rather than fully replied if that distinction exists.
11. Add audit log or UsageEvent:
    - CONTACT_REPLY_DRAFTED
    - CONTACT_REPLY_SENT
    - CONTACT_REPLY_FAILED

Ops UI:
1. In contact message detail, add reply composer.
2. Subject field.
3. Body field.
4. Preview if easy.
5. Send button.
6. Show status:
   - sent
   - draft
   - failed
7. Show reply history.
8. If email not configured, show amber setup notice and link/reference to server/docs/email-setup.md.
9. Admin and Mod can use it.
10. Normal users cannot access it.

====================================================
TASK 3 — PROJECT INVITE EMAIL FLOW
====================================================

When adding a member by email:
1. Validate email.
2. Check if user exists.
3. If user exists:
   - add them to the Review Workspace/project immediately
   - assign selected role/permissions
   - create in-app notification
   - optionally send email notification/invite
4. If user does not exist:
   - create pending invite
   - generate secure token
   - store only hash of token
   - send invite email if configured
   - return copyable invite link in dev/unconfigured fallback
   - when user registers through invite link, automatically join them to the correct workspace/project with the selected permissions

Invite requirements:
1. Token must be random and high entropy.
2. Store SHA-256 hash at rest, not raw token.
3. Single-use token.
4. Time-limited token.
5. Expiry should use setting:
   - metaSiftSettings.inviteExpiryDays
   - or app setting inviteExpiryDays
   - default sensible value like 7 or 14 days
6. Invite status:
   - pending
   - accepted
   - expired
   - revoked
7. Invite tied to:
   - email
   - invitedBy
   - workspaceId
   - metaLabProjectId if applicable
   - metaSiftProjectId if applicable
   - role
   - permissions
   - tokenHash
   - expiresAt
   - acceptedAt
   - revokedAt
8. If SMTP unconfigured:
   - request should still succeed
   - return invite.link to inviter
   - UI shows copyable link
9. If SMTP send fails:
   - invite still exists
   - show warning
   - return copyable link if safe
10. Do not let non-owner/non-authorized leader invite.
11. Do not let invite create permissions the inviter cannot grant.
12. If invited email already has account, do not require re-registering.
13. If invited user logs in with same email, they can accept invite.
14. If user registers with invite link, they should automatically land in project or see project in their landing page.

Email template:
renderInviteEmail should include:
- META·LAB branding
- project/workspace name
- inviter name/email
- role summary
- permissions summary if useful
- CTA button
- expiration note
- safe fallback link text
- footer

Suggested endpoints:
- POST /api/workspaces/:workspaceId/invites
- GET /api/invites/:token
- POST /api/invites/:token/accept
- POST /api/invites/:inviteId/revoke
- POST /api/invites/:token/register or integrate with existing register flow

If existing endpoints differ, use existing architecture.

====================================================
TASK 4 — TOKEN-BASED PASSWORD RESET FLOW
====================================================

The email setup doc says the current admin reset generates a temporary password and returns plaintext once. That is convenient but weak.

I want the production-preferred token-based reset implemented if feasible.

Claude, inspect the current password reset system first.

Best behavior:
1. Admin/Mod initiates password reset.
2. System generates a single-use reset token.
3. Store only hash of token.
4. Token expires.
5. Email user reset link:
   ${APP_BASE_URL}/reset?token=...
6. User opens link.
7. User sets new password.
8. Token is consumed.
9. User can then login.
10. Admin/Mod never handles plaintext password.

Permissions:
- Admin can initiate reset for normal users and Mods if policy allows.
- Mod can initiate reset for normal users only.
- Mod cannot reset Admin.
- Mod cannot reset other Mods.
- Normal users can request password reset for themselves if public forgot-password flow exists or is implemented.

Routes:
Use existing if present, otherwise add:
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/admin/users/:id/send-password-reset

Frontend:
1. Public reset password page:
   - /reset?token=...
2. Form:
   - new password
   - confirm password
3. Validate password.
4. Show success/failure.
5. Expired/invalid token message.

Ops:
1. Admin/mod user detail page should have:
   - Send password reset email
2. If email not configured:
   - create reset token
   - show copyable reset link only to authorized operator
   - warn clearly this is dev fallback
3. Do not show raw temporary password unless keeping legacy fallback intentionally.

Security:
1. Hash token.
2. Single-use.
3. Expiry.
4. Rate limit forgot-password if feasible.
5. Do not reveal whether email exists in public forgot-password response.
6. Audit reset requests.
7. Do not log raw token.

If this is too risky or too large:
- implement admin-initiated token reset first
- document public forgot-password as next step

But I prefer the full safe version if feasible.

====================================================
TASK 5 — OPS EMAIL SETTINGS AND METRICS
====================================================

Ops console should show email status and useful metrics.

Add or improve Ops Email section.

Show:
1. Email configured:
   - yes/no
2. Provider label:
   - SMTP / Resend / SendGrid / Gmail / custom
3. SMTP host presence:
   - configured/not configured
   - do not show password
4. EMAIL_FROM configured:
   - yes/no
5. APP_BASE_URL configured:
   - yes/no
6. Last successful email send.
7. Last failed email send.
8. Contact replies sent.
9. Contact reply drafts.
10. Invite emails sent.
11. Invite email failures.
12. Password reset emails sent.
13. Password reset email failures.
14. Total email failures over time if easy.

Controls:
1. Enable/disable email invites if setting exists.
2. Invite expiry days.
3. Maybe email sending enabled/disabled if app setting exists.
4. Do not allow editing SMTP secrets from UI unless a secure secret management system exists.

Use UsageEvents or audit logs if already available.

Add event types if needed:
- EMAIL_SENT
- EMAIL_FAILED
- EMAIL_NOT_CONFIGURED
- INVITE_EMAIL_SENT
- INVITE_EMAIL_FAILED
- PASSWORD_RESET_EMAIL_SENT
- PASSWORD_RESET_EMAIL_FAILED
- CONTACT_REPLY_SENT
- CONTACT_REPLY_DRAFTED
- CONTACT_REPLY_FAILED

====================================================
TASK 6 — ENVIRONMENT AND DEPLOYMENT SETUP
====================================================

Update:
- .env.example
- server/docs/email-setup.md
- docs/manager/deployment-readiness.md if relevant

Required .env.example variables:
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
EMAIL_PROVIDER=smtp
APP_BASE_URL=

Add comments explaining:
1. SMTP_HOST + EMAIL_FROM are required for sending.
2. SMTP_PORT 587 uses STARTTLS.
3. SMTP_PORT 465 uses implicit TLS.
4. SMTP_USER/PASS may be omitted for unauthenticated relay.
5. Gmail app password is dev/low-volume only.
6. Production should use a transactional email provider.
7. Secrets must be configured in deployment environment, not committed.

Deployment readiness:
1. Do not hardcode localhost.
2. Use APP_BASE_URL for links.
3. If APP_BASE_URL missing, fallback to request origin if safe.
4. Ensure reverse proxy/HTTPS reset links work.
5. Ensure CORS/cookies/session settings work with deployed domain.
6. Do not leak secrets in client bundle.

====================================================
TASK 7 — EMAIL SAFETY, VALIDATION, AND SECURITY
====================================================

Security & Diagnostics Agent must review:

1. HTML escaping in templates.
2. Contact reply body handling.
3. Invite token hashing.
4. Password reset token hashing.
5. Token expiry.
6. Single-use tokens.
7. Permissions:
   - Admin
   - Mod
   - Owner
   - Leader
   - User
8. Email enumeration risk.
9. SMTP error leakage.
10. Secrets exposure.
11. Audit logging.
12. Rate limiting if feasible.
13. Abuse prevention:
   - repeated invite spam
   - repeated password reset
   - reply spam

Create:

docs/manager/email-security-review.md

Include:
- checked items
- risks found
- fixes implemented
- remaining limitations
- production recommendations

====================================================
TASK 8 — FRONTEND UX REQUIREMENTS
====================================================

Frontend should be simple and helpful.

Contact message reply:
- clear reply composer
- shows email status
- shows draft/sent/failed
- shows reply history
- does not crash if SMTP missing

Invite flow:
- validate email before submit
- if invalid email, show error
- if existing user, show added success
- if invite sent, show sent success
- if email unconfigured, show copyable invite link
- if send failed, show copyable link and warning
- show pending invites list if feasible
- allow revoke invite if authorized

Password reset:
- admin/mod user detail: send reset link
- show success
- if email unconfigured, show copyable reset link only to authorized operator
- public reset page works

Ops email section:
- show configured/not configured
- show safe metrics
- show setup guidance

====================================================
TASK 9 — TESTING REQUIREMENTS
====================================================

QA must test before completion.

Unit tests:
1. isEmailConfigured false when SMTP_HOST missing.
2. isEmailConfigured false when EMAIL_FROM missing.
3. isEmailConfigured true when both exist.
4. sendEmail returns sent:false when unconfigured.
5. sendEmail never throws on transport failure.
6. renderInviteEmail escapes values.
7. renderContactReplyEmail escapes values.
8. token generation creates hash-only storage.
9. expired token rejected.
10. used token rejected.

Integration tests:
1. Admin replies to contact message with email configured mock.
2. Admin replies with email unconfigured → draft saved, 200 returned.
3. Mod replies to contact message.
4. Normal user cannot reply.
5. Add existing user by email → member added.
6. Add non-existing email → invite created.
7. Invite link acceptance adds user to workspace/project.
8. Invite cannot be used twice.
9. Expired invite fails.
10. Password reset email flow.
11. Reset token cannot be reused.
12. Mod cannot reset Admin.
13. Mod cannot reset Mod.
14. Admin can reset allowed user.
15. Ops email metrics update.

Manual QA:
1. Start app without SMTP env.
2. Reply to contact message.
3. Confirm draft saved, no 500.
4. Add non-existing member.
5. Confirm copyable invite link appears.
6. Register through invite link.
7. Confirm user joins project automatically.
8. Configure SMTP test provider if available.
9. Send test contact reply.
10. Send invite email.
11. Send password reset email.
12. Use reset link.
13. Confirm password changed.
14. Confirm ops email status/metrics.

Do not mark complete if:
- missing SMTP causes 500
- invite link is stored raw in database
- token can be reused
- Mod can reset Admin/Mod
- email templates allow HTML injection
- secrets leak to frontend
- tests/build fail

====================================================
TASK 10 — VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.

Rules:
- Patch:
  third number
  for small fixes
- Minor:
  second number
  for meaningful feature/system addition
- Major:
  first number
  for major overhaul

This is a meaningful production feature, likely minor unless it causes a larger auth/workspace overhaul.
Use your judgment.

2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit.

Suggested commit message:
feat: implement production-ready email service and invite flows

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason

Do not commit:
- secrets
- .env with credentials
- local database files
- junk files

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Current email state found before implementation.
2. What you implemented.
3. What already existed and was improved.
4. Email service architecture.
5. Contact reply behavior.
6. Invite email behavior.
7. Password reset behavior.
8. SMTP fallback behavior.
9. Ops email metrics/settings.
10. Security decisions.
11. Database migrations.
12. Backend files changed.
13. Frontend files changed.
14. Docs updated.
15. Manual QA results.
16. Automated test results.
17. Version bump and new version.
18. Commit hash.
19. Push status.
20. Remaining limitations.
21. Production setup steps.

Claude, I want this done in the cleanest, safest, most efficient way possible.
Do not overcomplicate it, but do not leave it half-working.
The app should behave professionally whether email is configured or not.