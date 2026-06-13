# Claude Opinion — Notifications, Invites, Exports, Project Delete, Chat Fix, Ops Expansion (Prompt 9)

Date: 2026-06-11 · Author: Main Claude (Manager/Integrator) · Status: APPROVED PLAN — implementation follows this document.

This document was written after a full 9-subsystem mapping pass (maps in `.claude/tmp/prompt9/map-*.md`). Every claim below is grounded in current code with file/line references in those maps.

---

## 1. Opinion on the current notification/invite flow

**Notifications are 90% built and 10% wired.** The schema already has `readAt` AND `dismissedAt` (soft-dismiss columns exist since prompt 6), the server already hides dismissed rows from the default list, supports `?all=1` history, and exposes `POST /:id/dismiss` — which has **zero frontend callers**. The bell's click handler only marks read and navigates, which is exactly the reported bug: clicked notifications never leave the list. The right fix is small and surgical, not a rebuild.

One real server gap: there is no single endpoint that marks read+dismissed atomically, and `dismiss` today does not stamp `readAt`. Two round-trips on click would race with the full-page reload that `/app?project=` navigation forces (`window.location.assign`). So we add **one combined endpoint** and await it before navigating.

**The invite flow is honest but minimal.** "Pending invite" today is a `ScreenProjectMember` row with `userId:null`, claimed silently when someone registers with a matching email. That design is good — role/permissions already live on the row and transfer on claim, and the prompt-6 tests pin it. What's missing is the entire *ceremony*: no email validation (any string is accepted), no token, no email sent, no invite landing page, no revoke semantics beyond row deletion, no expiry. The inviter also gets a `pending:!user` flag, a deliberate account-existence disclosure to project managers — acceptable (they typed the email), but new public endpoints must not widen it.

## 2. Recommended invite architecture

**Keep the pending member row as the single source of truth; add the token ceremony on top of it.** No second invite table — a separate table would have to be kept in sync with the member row that claim-on-register already mutates, and drift between them would be a standing bug factory.

Additive columns on `ScreenProjectMember`:
- `invitedByUserId String?` — fixes the known "A project manager added you" UX gap
- `inviteTokenHash String? @unique` — SHA-256 of a 32-byte random token; **plaintext never stored** (this follows the pre-written spec in `server/docs/email-setup.md` §future-work)
- `inviteExpiresAt DateTime?` — default now + `inviteExpiryDays` (ops-configurable, default 14)
- `inviteAcceptedAt DateTime?` — for accepted-invite metrics

Flow:
1. `addMember` validates email format (shared `server/utils/validators.js`, also used by the frontends). Invalid → 400, never persisted.
2. Existing user → immediate active member + in-app notification (unchanged).
3. No user → pending row + token + **best-effort** styled invite email (`renderInviteEmail` in emailService — project name, inviter, role summary, link, expiry note). The 201 response to the *inviter* includes `invite: { link, emailConfigured, emailSent, expiresAt }` — the copyable-link dev fallback, following the established `{emailConfigured, sent}` contact-reply precedent. Email failure never fails the request.
4. Invite link → `/invite/<token>` (new public SPA route, NOT wrapped in PublicRoute so signed-in users aren't bounced to /app and stranded). It calls `GET /api/invites/:token` (new public router, rate-limited, mounted in `server/index.js` — it cannot live under the requireAuth+flag-gated screening router) returning sanitized info: project name, inviter display name, role, invited email (masked), state (valid/expired/revoked). No token-validity oracle beyond what the link holder already knows.
5. Accept: `POST /api/invites/:token/accept` — logged-in user accepts directly (binds `userId` to the pending row; the row keeps the invited email, uniqueness preserved). Logged-out users register via `/invite/:token` → register passes `inviteToken` → server claims by token after user creation. **Claim-on-register by email match stays untouched** (pinned by tests) — the token path is additive for mismatched-email registration and the pre-registration landing experience.
6. Revoke = existing `removeMember` on the pending row (+ `INVITE_REVOKED` audit). Expiry enforced at read/accept time (410); no cron needed.

Security: token hash-only storage; public endpoints rate-limited (authLimiter pattern); 404 existence-hiding preserved on all project-scoped routes; accept is idempotent; expired/revoked invites return the same sanitized "no longer valid" shape.

## 3. Opinion on project deletion vs archive/soft-delete

**Soft delete, unambiguously.** Three current facts make hard delete actively dangerous here:
1. SIFT hard delete **cascades away its own audit trail** (`ScreenAuditLog` has FK cascade) — "audit the deletion" is impossible with hard delete.
2. The META·LAB monolith fires `DELETE` from a debounced autosave array-diff sweep with failures swallowed — a hard delete triggered by a stale tab is unrecoverable.
3. Real user data lives in the dev DB; the linked pair (`linkedMetaLabProjectId` is a soft FK) means one hard delete strands the partner project.

Design:
- `Project` already has `deletedAt` but it is **owned by the admin archive feature**; reusing it would let admin "restore" resurrect owner-deleted projects. So: add `deletedSource ('owner'|'admin')` discriminator (additive; legacy rows = admin). Add `deletedAt + deletedSource` to `ScreenProject` (which today only has the decorative admin `archived` boolean).
- Owner delete = soft delete with `deletedSource='owner'`: hidden from all lists (including the owner's), 404 on direct access (existence-hiding consistent), recoverable by admin from the ops console.
- **Linked cascade (user preference honored):** deleting a META·LAB project with a linked SIFT workspace archives both, atomically, with consequences listed up front. Deleting from SIFT archives **only the SIFT module project** and leaves META·LAB intact — the ML project is the owner's primary artifact and SIFT is the linked module; destroying the parent from the child is the surprising direction. Documented here as the decided behavior.
- **Typed-name confirmation** server-side on the new explicit endpoint `POST /api/projects/:id/delete { confirmName, cascadeLinked }` — the modal lists exactly what is affected (records, decisions, chats, PDFs, members). The legacy `DELETE /api/projects/:id` (autosave sweep path) and `DELETE /api/screening/projects/:pid` (test cleanup path, 204) keep their wire contracts but become soft underneath. Guard added so autosave can never resurrect a soft-deleted project (today `store.save()` upserts with no deletedAt check — a live resurrection bug).
- **Leave project:** `POST /api/screening/projects/:pid/leave` — self-service for any non-owner member (today reviewers/viewers literally cannot exit). Owner gets 400 with transfer-ownership messaging. Ownership transfer itself is **out of scope** (it's referenced in error copy today but implemented nowhere; doing it properly touches ensureLeaderMember self-healing and the ML ownership invariant — recommended next step, not a rush job). Audit `MEMBER_LEFT`, realtime `members.changed` + targeted `permissions.changed` pokes so open UIs revalidate.
- Hard delete: not exposed in UI. Ops console shows deletion behavior as policy ("Soft delete / archive — hard delete disabled").

## 4. Recommended export/download UX

**Shared `ExportDialog` component + a per-item adapter registry. Not a monolithic export service.** ~14 download triggers exist across two apps with three generation styles (server endpoints, client Blob builders, SVG-string builders). A central service would have to know every item's quirks; adapters keep knowledge local and the dialog generic:

```js
adapter = { id, label, formats: [{id:'png'|'svg'|'csv'|'json'|'ris'|'xls', label}],
            sizing: true|false, defaults, run(format, options) -> downloads }
```

- The two publication figures (`buildPrismaSVG`, `buildPubForestSVG`) already return `{svg, W, H}` — ideal adapter inputs. PNG rasterization goes through one shared `rasterizeSvg(svg, W, H, {scale, transparent, background})` util (canvas; the existing per-button hardcoded 3×/4× scales become user-chosen presets).
- **Size presets** (figures): Journal single column (90 mm @ 300 DPI ≈ 1063 px), Journal double column (190 mm ≈ 2244 px), Poster (2×), Presentation slide (1920 px wide), Custom (validated 320–6000 px). DPI is encoded in the rendered pixel size and the filename suffix (`@300dpi`); transparent background as a checkbox (PNG only); light/dark variant choice where both exist (forest plot).
- **FunnelPlot gets an export for the first time** (it has none today) — publication variant with resolved literal colors, since exported artifacts must never carry `--t-*` CSS variables.
- Formats stay honest per item: figures PNG/SVG; screening export CSV/JSON/**RIS (new, server-side)**; extraction CSV; analysis CSV/XLS(HTML); project JSON; report PDF(print)/HTML. No fake DOCX/XLSX.
- All existing buttons route through the dialog; the `exportTools` feature flag — admin-toggleable but enforced *nowhere* today — becomes real: client hides export triggers, server export endpoints honor it (default remains ON, so pinned tests stay green; SIFT `allowExport` 403 untouched).
- Export events are recorded (best-effort) to power the "exports by format" ops metric.

## 5. How much should the ops console control?

**Control plane, not pilot's cockpit.** My recommendation, applied below: ops should control *policies and defaults* (toggles, limits, durations, default behaviors) and *observe everything*; it should not perform bulk destructive actions or impersonate flows. Concretely:

- **No new sections.** The existing 10 sections absorb the new controls — adding 8 more nav sections (the prompt sketches 18) would manufacture the clutter the prompt warns against. Placement: Animation → Content section (new sub-tab); notifications/invites/exports/deletion/maintenance/default-theme → Settings section (grouped cards); SIFT-specific invite expiry → SIFT settings tab; all new metrics → existing Overview + SIFT overview.
- **Make stored knobs real before adding new ones:** `registrationOpen` and `maintenanceMode` are stored and editable today but enforced *nowhere* — prompt 9 wires them (register gate; maintenance 503 with configurable message for non-staff API access, login/admin exempt so admins can turn it off).
- New controls: `notificationsEnabled` (gates creation chokepoint), `inviteExpiryDays`, `emailInvitesEnabled`, `exportFormats` allowlist, `projectDeletion` policy (read-mostly), `defaultTheme`, `maintenanceMessage`, landing `animationSpeed`.
- New metrics (one additive `UsageEvent` table powers most): invites pending/accepted/expired, notifications sent/clicked/dismissed, projects deleted/left, exports by format, emails sent/failed, linked vs unlinked workspace counts, chat messages (total exists; add to context).
- **Mods gain nothing.** Mod stays `users`+`messages`. Every new control is admin-only; the `getConsole` capability descriptor remains the single source of truth.
- **Audit the auditors:** `updateScreeningSettings` is unaudited today (real gap) — it and all new settings writes get `logAdminAction` with changed-key diffs.

## 6. Security concerns

1. **Invite tokens**: hash-only storage (SHA-256), 32-byte CSPRNG, single-use (accept stamps `inviteAcceptedAt` and nulls the hash), expiring, rate-limited public endpoints, no account-existence oracle in `GET /api/invites/:token` responses, revoked/expired indistinguishable ("no longer valid").
2. **Existence-hiding (pinned)**: all new project-scoped endpoints return 404 for non-members; soft-deleted projects return 404 identically to nonexistent ones — deletion must not create a distinguishable state.
3. **Autosave resurrection**: `store.save()` upserting without a deletedAt guard is a genuine pre-existing hazard the soft-delete work must close (stale tab PUT must yield `200 {skipped:true}`, never a resurrect).
4. **Cascade scope honesty**: the delete modal lists the linked SIFT workspace, records, decisions, chats, PDFs explicitly — consent must match consequence.
5. **Maintenance mode**: must never lock admins out (exempt /api/auth/login, /api/admin, /api/settings/public) and must return a clean 503 shape, mirroring the SIFT `checkEnabled` precedent.
6. **Email content**: invite emails contain no permissions detail beyond role label; reply-to inviter not set (header injection surface); HTML built from escaped values only (reuse `escapeHtml`).
7. **Mod surface unchanged**: requireTargetEditable and section gating untouched; new settings endpoints admin-only.
8. **Pinned contracts re-verified by QA**: 404-hiding, viewer autosave `200 {skipped:true}`, mod target-role 403, SIFT delete 204, `{deleted:true}` shape, claim-on-register, notification 404-on-foreign-id.

## 7. Final implementation plan

Team roles → waves (file ownership is disjoint per agent; monolith edits owned by exactly one agent per wave):

**Wave B — Backend, Auth & Database Developer** (sequential, B1 → B2):
- B1 *(invites + notifications)*: one additive migration `prompt9_invites_lifecycle_usage` (Notification.clickedAt; ScreenProjectMember invite columns; Project.deletedSource; ScreenProject.deletedAt/deletedSource; UsageEvent model). `POST /api/notifications/:id/opened` (readAt+dismissedAt+clickedAt, idempotent). Email validator util. addMember validation + token + invite email + link-in-response. Public `/api/invites` router (GET :token, POST :token/accept). Register `inviteToken` claim path. `renderInviteEmail`. `notificationsEnabled` gate at the creation chokepoint.
- B2 *(lifecycle + ops)*: soft delete both apps + `deletedSource` discrimination + list/get filters + autosave guards. `POST /api/projects/:id/delete` (typed-name + cascadeLinked). `POST /api/screening/projects/:pid/leave`. RIS export format. UsageEvent recording (exports, deletes, leaves, emails). Metrics additions (getMetrics/getScreeningMetrics/admin invite+notification counters). Settings: new appSettings keys + enforcement (registrationOpen, maintenanceMode/message), `inviteExpiryDays` in metaSiftSettings (+coerceSettings), landing animationSpeed passthrough (none needed server-side — landingContent is schemaless). Audit for updateScreeningSettings + new lifecycle actions. getOverview additive `linkedMetaLab {id,title,missing,canOpen}`.

**Wave F — Frontend App Developer + Collaboration/Realtime + Website Manager** (F-shared first, then F-monolith ∥ F-sift ∥ F-ops):
- F-shared: `ExportDialog.jsx` + `exportCore.js` (rasterizeSvg, presets, validation, download helpers) to the adapter spec above; ChatDrawer portal fix (first `createPortal` in the codebase — overlay subtree portals to document.body, drawer stays mounted for poll/SSE); NotificationsBell opened-flow (await before location.assign, optimistic removal, history toggle via `?all=1`); `/invite/:token` page + App route + Register inviteToken handoff.
- F-monolith: all `meta-lab-3-patched.jsx` edits — export adapters wired for PRISMA/pub-forest/dark-forest/funnel/extraction-CSV/analysis/project-JSON/report; typed-name delete modal calling the new endpoint with cascade consequences; CtrlAddMember email validation + invite-link copy UI.
- F-sift: ExportTab through dialog (+RIS); MembersTab AddMemberModal validation + invite-link copy + revoke affordance on pending rows; own-row **Leave project**; OverviewTab "Open linked META·LAB project" button (canOpen-aware, AccessDenied state, link-management pointer when absent); SiftDashboard typed-name delete modal.
- F-ops: AdminConsole — Content→Animation sub-tab (Off/Slow/Normal/Fast segmented control — discrete beats numeric: each option is a QA-able state and "Off" is a first-class accessibility choice); Settings section grouped cards for the new keys; Overview + SIFT metrics tiles; Landing.jsx animation wiring (`--lp-speed` custom property + HeroCanvas speed prop + count-up scaling; `prefers-reduced-motion` retains absolute priority; off ≙ reduced path).

**Wave QA — QA Developer**: `tests/screening/integration/prompt9.test.js` (invite token lifecycle incl. expiry/revoke/mismatched-email accept; leave; soft delete + cascade + 404 states + no-resurrection; notification opened persistence across re-login; overview linkedMetaLab payload; RIS export; animationSpeed passthrough; new metrics keys; settings audit rows) + full suite `npx vitest run --no-file-parallelism` against 127.0.0.1:**3001** (baseline 883 pass / 6 quarantined / 7 skip; screening 249/249; flipped assertions: NONE), plus report updates.

**Wave D — Manager**: docs (api-contract additions, this doc's QA results, final-implementation-report), `graphify update .`, temp-file cleanup, version bump 2.7.0, commit.

Known deliberate scope cuts (documented, recommended next steps): ownership transfer; owner-side restore UI (admin restore covers recovery); DOCX/XLSX true formats; per-user notification preferences; invite email for existing users (they get in-app + email is redundant noise — revisit on feedback).

---

## 8. QA results (post-implementation, 2026-06-12)

- **Manual/E2E smoke:** invite flow verified end-to-end by hand pre-QA (invalid email 400 → pending invite
  with copyable link → masked public landing → register-with-token auto-join → claim notification →
  `opened` clears badge + survives in history → token single-use). B2 server smoke `smoke-b2`: **55/55**
  (incl. invite expiry 410, maintenance toggle, admin restores, RIS content, exportTools default-on).
- **Automated:** `tests/screening/integration/prompt9.test.js` **23/23** · screening suite **272/272** ·
  full repo **906 pass / 6 pre-existing quarantined serverStorage fake-timer failures (identical set) /
  7 skips** · `npm run build` exit 0 at v2.7.0 · **flipped assertions: NONE**.
- **One integration bug found and fixed during verification:** B1 originally mounted `/api/invites` after
  the bare-`/api` importExport router, whose router-level `requireAuth` 401'd the public landing endpoint.
  Mount moved above it with a comment pinning the invariant; now covered by the public-GET test.
