# Security & Diagnostics Report — Prompt 7 (Task 7)

**Scope:** defensive security review of the META·LAB / META·SIFT application — own code, own data, no offensive testing.
**Method:** full-codebase security mapping (`.claude/tmp/prompt7/map-security.md`), live API probing against the dev stack, npm audit, git-tracking audit.
**Date:** 2026-06-10 · v2.5.0 → prompt7 working tree.

---

## 1. What was checked

| Area | How |
|---|---|
| Auth (register/login/logout/me), sessions, JWT, cookies | code review `server/auth/*`, `authController.js`, live probes |
| Admin/mod access & role middleware | code review + **live privilege-escalation probe** (`probe-mod.mjs`) |
| User ownership & workspace membership (META·LAB + META·SIFT) | `store.js`, `metalabAccess.js`, `access.js`, integration tests |
| META·LAB / META·SIFT permission flags (17 per-member flags) | `permissionPresets.js`, member controller, live flow walkthrough |
| Project linking & viewer read-only enforcement | autosave probe (viewer write attempt), summary endpoints |
| Owner/leader protections | member-controller rules + live probe (reviewer→leader grant denied) |
| Ops console access | AdminRoute 404-cloak, `requireAdminOrMod`, mod section descriptor |
| Message replies & email config safety | `emailService.js` (never throws, draft fallback), reply flow probe |
| File upload safety | `screeningPdfController.js` review |
| API route protection | route-by-route middleware audit (`routes/*.js`) |
| CORS, helmet, rate limits, body limits | `server/index.js` |
| Environment variables & secrets | `.env` handling, `jwt.js`, seed scripts, repo grep for hardcoded secrets |
| Database safety, destructive commands, migrations | Prisma usage audit ($queryRaw, hard deletes), migration history |
| Input validation | body-handling audit across all controllers |
| XSS (abstracts/chat/messages/imported references) | `dangerouslySetInnerHTML`/innerHTML grep + render-path review |
| Chat permissions & realtime event authorization | chat controller gates, SSE subscribe/emit model, new metalab chat door |
| Notifications | notification service + routes review |

## 2. What passed

- **JWT/cookie design:** `JWT_SECRET` throws at boot if unset (no insecure default); session cookie is `httpOnly + sameSite=strict + secure(prod)`, 7-day expiry; bcrypt cost 12; password hashes never returned.
- **Role verification:** privileged routes re-verify the caller's role from the DB on every request (`requireRole`) — stale JWT roles cannot escalate. Role assignment was already admin-only.
- **Viewer read-only:** enforced server-side at the autosave boundary (member without edit → silent `{skipped:true}`, owner data untouched — verified live).
- **Existence-hiding:** unauthorized project access consistently returns 404 (no resource enumeration), including the new META·LAB chat door (verified by integration tests).
- **SSE authorization:** subscription is by authenticated user id only — no client-supplied channel; recipients are resolved from DB membership at emit time; events are poke-only (no content). A user cannot subscribe to another project's events.
- **PDF upload:** mime + extension + 25 MB limits, `%PDF-` magic-byte check, server-generated UUID filenames (no path traversal), members-only authenticated download.
- **SQL injection:** no string-interpolated raw SQL (`$queryRaw` used only as literal `SELECT 1` health checks); all data access via Prisma parameterized queries.
- **Secrets:** no hardcoded passwords/API keys in `src/` or `server/`; admin seeding is env-driven and skips weak/unset passwords; the legacy in-browser AI client sends no API key and is disabled behind `AI_FEATURES_ENABLED=false`.
- **Email safety:** SMTP unconfigured → replies persist as drafts, `{sent:false}` returned honestly; no crash paths.
- **Mass assignment:** the two body-spread sites (project update/autosave) serialize into a JSON `data` blob rather than raw DB columns, and `_`-prefixed annotations are stripped on persist — blunted by design.
- **Chat permission gates (including the new shared chat):** admin kill-switch (`allowChat`), inactive-member block, `chatRestricted` + per-member `canChat`, sender-or-leader-only delete — all enforced in the shared handler cores used by BOTH route doors (6 integration tests).
- **npm audit (production server deps): 0 vulnerabilities.**

## 3. What failed

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | **Mod → admin password takeover.** `POST /api/admin/users/:id/reset-password` had no target-role check: a moderator could reset an **admin's** password and receive the plaintext temp password (verified live: HTTP 200). | **Critical** | **FIXED** |
| F2 | **Mod → admin/mod profile edit.** `PATCH /api/admin/users/:id` let mods change admin/mod name **and email** (email = identity/recovery takeover vector). Verified live: 200. | **Critical** | **FIXED** |
| F3 | **Mod → mod suspension.** `PATCH /api/admin/users/:id/status` blocked suspending admins but let a mod suspend another mod. Verified live: 200. | High | **FIXED** |
| F4 | **Live SQLite DB tracked in git.** `server/prisma/dev.db` (+ a `.bak`) — containing user emails, bcrypt hashes, contact messages — was committed to version control; `.gitignore` had no `*.db` pattern. | High | **FIXED** (untracked + ignored; see §5 for history caveat) |
| F5 | **CSP disabled** (`helmet({ contentSecurityPolicy: false })`) while the monolith renders a built SVG via `dangerouslySetInnerHTML` (escaper present, but no second layer). | Medium | **FIXED** (two-layer CSP, see §4) |
| F6 | Public `POST /api/contact` had **no rate limit** (spam/flooding vector). | Medium | **FIXED** |
| F7 | Frontend offered mods Edit/Reset/Suspend buttons on admin/mod rows (discoverable escalation UI for F1–F3). | Medium | **FIXED** (controls hidden + lock note; server is authoritative regardless) |

## 4. What was fixed (implementation detail)

1. **Target-role enforcement (F1–F3):** new `requireTargetEditable` middleware (`server/middleware/requireRole.js`) mounted after `requireAdminOrMod` on the three mutating user routes — admin passes through; a mod acting on any non-`user` target gets `403 {"error":"Moderators cannot modify administrator or moderator accounts"}` plus a `MOD_TARGET_DENIED` SecurityEvent (target id/role in details). The same check is repeated inside `updateUser`/`updateUserStatus`/`resetUserPassword` as defense-in-depth. Existing actor-agnostic "cannot suspend admin" rule retained. **Covered by 4 integration tests (mod→admin, mod→mod, mod→user matrix, admin→mod regression) — all passing.**
2. **Git data exposure (F4):** `git rm --cached` on both DB files plus stray server logs/stackdump; `.gitignore` now covers `server/prisma/*.db`, `*.db-journal`, `*.db.bak*`, `*.sqlite*`, `server-stderr.log`, `bash.exe.stackdump`.
3. **CSP (F5):** two layers — (a) API server: strict helmet CSP (`default-src 'none'`, `frame-ancestors 'none'`) since it serves JSON only; (b) SPA: `<meta http-equiv="Content-Security-Policy">` in `index.html` locking script/connect/font/img origins to self + Google Fonts + CrossRef + PubMed E-utilities, `object-src 'none'`, `frame-src 'self'` (same-origin PDF viewer). `'unsafe-inline'` remains for styles/scripts because the app's styling is inline-first and Vite injects a dev preamble — see §9 for the nonce upgrade path.
4. **Contact rate limit (F6):** 8 requests / 15 min / IP in production (relaxed in dev/test), mounted on `/api/contact`.
5. **Ops UI locks (F7):** when the signed-in staff member is a mod, admin/mod target rows render a lock note ("Managed by administrators") instead of Edit/Reset/Suspend controls.

## 5. What still needs work

- **Git history still contains the DB.** `git rm --cached` stops future commits; the previously committed `dev.db` remains in history. Purging requires a history rewrite (`git filter-repo`) and a coordinated force-push — recommended before the repo is ever shared, **not** executed unilaterally in this round. Also rotate the seeded admin passwords if the repo was ever public.
- **CSP uses `'unsafe-inline'`** for styles/scripts (architectural constraint of inline styling + Vite). Moving to nonces requires server-rendered HTML or a build step.
- **`frame-ancestors` for the SPA** cannot be set via `<meta>` — add `X-Frame-Options`/CSP at the reverse proxy in production.
- **No token-based password reset for end users** (admin/mod relay temp passwords for ordinary users; admins use ops console). Email-token reset is documented in `server/docs/email-setup.md` but not implemented.
- **Dev-tooling npm advisories** (root package: `concurrently`→`shell-quote` critical chain, `esbuild`/`vite`/`vitest` moderate) — dev-only, not reachable in production; upgrade in a maintenance window.
- **Single-process SSE** — fine today; a multi-instance deployment needs a broker (documented in realtime-architecture.md).

## 6. High-priority risks (residual)

1. Git history exposure of `dev.db` until history is rewritten (see §5).
2. Plaintext temp-password relay flow for ordinary users — operationally weak; replace with token-based email reset before public launch.

## 7. Medium-priority risks

1. `'unsafe-inline'` CSP (partial XSS mitigation only).
2. No global rate limiter (auth/admin/contact are limited; other endpoints rely on auth).
3. Project autosave accepts arbitrarily shaped JSON into the data blob (schema validation would harden imports/exports).

## 8. Low-priority risks

1. Duplicate `COOKIE_NAME` constants in three files (drift risk).
2. `requirePermission`/`MOD_PERMISSIONS` middleware exists but is unused (dead authz code can mislead reviewers).
3. Legacy unrouted pages (`SiftWorkbench` etc.) still compiled into the bundle.
4. Dev tooling advisories (above).

## 9. Recommended next security improvements

1. Rewrite git history to purge `dev.db`; rotate seeded admin credentials.
2. Token-based password reset (email link, 30-min expiry) for all roles; remove plaintext temp-password relay.
3. Nonce-based CSP via server-rendered `index.html` (or meta-CSP per build with hashed bootstrap script).
4. Schema validation (zod) on autosave/import payload shapes.
5. Global fallback rate limiter + per-user (not per-IP) limits on authenticated mutation routes.
6. Session revocation list (logout-all, suspend-kills-session) — currently suspension blocks at next role-verified request only for staff routes; ordinary cookie sessions live out their 7 days unless checked.
7. Audit-log viewer filters in ops for `MOD_TARGET_DENIED` events (data already captured).

---

*Flow-level diagnostics (42/42 passing) are reported separately in `docs/manager/full-diagnostics-report.md` (Task 8).*
