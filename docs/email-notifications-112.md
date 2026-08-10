# 112 — Email & Notification Management (v4.17.0)

Round report for `.claude/Prompts/112.md`. Builds on the Ops control plane (109),
the settings catalogue, and the export-worker job patterns.

## What shipped

### 1. Template registry + render layer (`server/services/emailTemplates.js`)
- **9 registry entries**: `contact.reply`, `waitlist.confirmation`, `password.reset`
  (operator variant via `@if:` paragraph), `email.verification`,
  `invite.projectMember`, `invite.waitlist`, `welcome`, `password.changed`,
  `chat.digest`. Each: `{ key, category, description, requiredVariables,
  optionalVariables, defaultFields, disableable }`.
- Templates are **structured plain-text fields** (subject, heading,
  bodyParagraphs[], ctaLabel/ctaHref, footerNote) with `[token]` substitution —
  **no admin-authored HTML exists anywhere**, so template XSS is impossible by
  construction. Tokens are escaped in the HTML part, raw in the text part;
  unknown tokens render literally; missing *required* tokens fail the render
  (`missingRequired`) and the outbox row, never a half-rendered send.
- `renderTemplate(key, variables, { overrides })` is the single renderer; the 8
  legacy `render*Email` functions in `emailService.js` are now thin adapters
  with unchanged signatures, and `renderInviteEmail`'s duplicated inline
  document was folded onto the shared base layout.
- **DB stores overrides only** (`EmailTemplate` table, diff-per-field): restore
  default = delete the row. Transactional templates cannot be disabled — only
  `welcome` and `chat.digest` (category `optional`) have an off switch.

### 2. Outbox + worker (`EmailOutbox`, `emailOutboxService.js`, `emailOutboxWorker.js`)
- User actions **enqueue**; the worker claims, renders and hands to the existing
  `sendEmail` transport (still the ONLY egress; dev stays no-send —
  unconfigured SMTP records `skipped_unconfigured`, never fake success).
- Idempotency is **code-enforced** (`templateKey|recipient|entityId|discriminator`,
  plain `@@index` + findFirst-then-insert in one transaction — no `@@unique` on
  live tables). Statuses: `pending/sending/sent/failed/skipped_unconfigured/
  skipped_disabled/cancelled`. Claim loop, heartbeat, stuck-recovery and
  attempts cap mirror `screeningExportWorker`. Bodies are never stored — only
  the rendered subject.
- Both invitation call sites (project member + waitlist) now enqueue
  (`entityId` = invite id, `discriminator` = expiry timestamp, so genuine
  re-invites send while double-clicks dedupe). `invitationsPaused` is respected
  at enqueue. `WaitlistInvitation.emailStatus` now reads `queued` at creation.

### 3. Chat digests (opt-in, batched — never one email per message)
- **Profile preference** `emailNotifications.projectChat` (JSON blob on User,
  same contract as `dashboardPreferences`; `PUT /api/profile` validates
  object-or-JSON-string, 500-char cap, null clears). Profile page gained an
  "Email Notifications" card with the single toggle. **Default OFF** — a new
  email class must be opt-in for existing users.
- On each chat message (both chat doors share `postMessageCore`) a
  fire-and-forget hook upserts `ChatDigestPending` per opted-in recipient
  (active members + owner — the realtime audience — never the sender); sender
  names dedupe and cap at 5.
- The worker sweeps pending rows: send when quiet ≥ `EMAIL_CHAT_DIGEST_QUIET_MS`
  (5 min) or age ≥ `EMAIL_CHAT_DIGEST_MAX_MS` (30 min); at send it **re-checks**
  the preference, membership, and `ScreenChatRead.lastReadAt` (already read ⇒
  row deleted, no send) and a per-user daily cap
  (`EMAIL_CHAT_DIGEST_DAILY_CAP`, 10). The eligibility decision is a pure
  exported function (`chatDigestPolicy.js`).

### 4. Unsubscribe + compliance (`emailUnsubscribe.js`, `routes/emailPublic.js`)
- HMAC-subkey tokens (`email-unsub-v1` off `JWT_SECRET`, timing-safe compare,
  30-day TTL). `GET /api/email/unsubscribe` flips the preference for
  **optional categories only** (transactional → 400) and renders an inline
  confirmation page. Optional-category sends carry `List-Unsubscribe` headers.
  The digest policy also honours the endpoint's `chat.digest:false` flag, so
  the header is never advertising an opt-out we'd ignore.

### 5. Ops › Email (`src/frontend/pages/admin/email/`, `emailAdminController.js`)
- Template list (registry merged with overrides), structured-field editor with
  variable helper + required-token survival validation, deterministic preview
  (iframe srcDoc), test-send to the calling admin (5/hour via outbox rows,
  audited), enable toggles (400 unless disableable), restore-default, and a
  paginated delivery history (subjects only — `variablesJson`/`idempotencyKey`
  never leave the server). Capability seam: mods get `view_email_delivery`;
  `manage_email_templates` is admin-only. All writes audited with
  before/after + reason.

## Schema (additive only)
`EmailOutbox`, `EmailTemplate`, `ChatDigestPending` + `User.emailNotifications
String?` — four-place checklist done (canonical schema, generated Postgres
schema, hand-written migrations `20260810120000_email_notification_system` +
`20260810130000_user_email_notifications`, client regenerated); drift gate green.

## Env knobs
`EMAIL_OUTBOX_WORKER_ENABLED`, `EMAIL_CHAT_DIGEST_QUIET_MS`,
`EMAIL_CHAT_DIGEST_MAX_MS`, `EMAIL_CHAT_DIGEST_DAILY_CAP`.

## Known limitations
- Chat digest previews are generic ("New messages") — `ChatDigestPending`
  stores no message text by design (no chat content at rest outside the chat
  table); a preview would need a read-time fetch of the last message.
- `chatUrl` deep-links to the project workspace (`/sift-beta/projects/<id>`),
  not the chat drawer itself (the drawer has no route).
- Presence-based suppression (skip the digest when the user is actively online)
  is documented-not-implemented: presence is app-wide and transient, so
  read-state is the honest suppressor.
- The digest sweep is single-instance (in-process timer), like every other
  worker in the repo; multi-instance deploys would double-sweep (the outbox
  idempotency key makes that harmless — one duplicate row loses the race).
