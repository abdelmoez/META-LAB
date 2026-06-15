# META·SIFT — QA Report (collaboration upgrade)

> **Update 2026-06-12 (prompt9 notifications/invites/exports/delete/ops):** ✅ **272/272 screening tests pass**
> (+23 `integration/prompt9.test.js`). Full repo: **906 pass / 6 pre-existing quarantined / 7 skips**.
> prompt9 section below; prompt8…prompt1 follow unchanged.

> **Update 2026-06-11 (prompt8 landing/ops/overflow/chat-placement):** ✅ **249/249 screening tests pass —
> unchanged.** prompt8 touched no screening API: chat launchers moved into the top-right utility cluster
> (UI only; `prompt7-chat.test.js` 6/6 green), SIFT pages got global overflow fixes (`minWidth:0`/ellipsis/
> `title=` tooltips — verified visually with a 190-char title and long owner emails), and the ops SIFT
> overview gained funnel/donut visuals from existing `/api/admin/screening/metrics` data. Full-repo result
> and the new admin timeseries endpoint are reported in `tests/report.md` (prompt8 section).

> **Update 2026-06-10 (prompt7 design/security/chat upgrade):** ✅ **249/249 screening tests pass**
> (+4 `integration/prompt7.test.js`, +6 `integration/prompt7-chat.test.js`). prompt7 section below; prompt6…prompt1 follow unchanged.

---

## prompt9 — Notifications dismiss-on-click, invite tokens, leave, soft delete, RIS, ops controls (2026-06-12)

**Result:** ✅ **272/272 screening tests pass** (`npx vitest run tests/screening --no-file-parallelism`, server up).
Adds **+23** integration tests: `integration/prompt9.test.js`. Full repo suite: **906 pass / 6 pre-existing
`serverStorage.test.js` fake-timer failures (quarantined, identical set, unchanged from baseline) / 7 skips
(919 total, 39 files)**. Baseline delta: 883→906 = exactly the 23 new tests; **0 new failures**.

**Flipped assertions: NONE.** Every pre-prompt9 test passes unchanged — deletes went soft underneath their
existing wire contracts (`{deleted:true}` / 204), `markRead`/`dismiss` semantics are untouched (the new
`opened` endpoint is additive), and all the 403/404 permission matrices from prompts 2–7 are green as-is.

**New in this file vs the legacy pattern:** T1 hard-fails when the server is down instead of self-skipping,
so a server-down full run can no longer report vacuous green for prompt9 contracts. Every global setting the
ops tests flip (`registrationOpen`, `maintenanceMode`, `animationSpeed`, `inviteExpiryDays`) is restored in a
`finally` block.

### prompt9.test.js inventory (23 tests)

| Area | What is pinned |
|---|---|
| T1 reachability | live API on 127.0.0.1:3001 + seeded-admin login (anti-vacuous-green guard) |
| T2 opened (2) | `POST /api/notifications/:id/opened` sets readAt+dismissedAt+clickedAt in one call; idempotent (stamps stable on repeat); removed from active list; present under `?all=1`; unread-count 0; **persists across re-login**; foreign id → 404 |
| T3 invites (6) | invalid email → 400 with nothing persisted; existing user → immediate active member, **no invite field**; unknown email → `pending:true` + `invite{link,emailConfigured,emailSent,expiresAt}` with a 64-hex token link; public `GET /api/invites/:token` (no cookie) returns projectName/inviter/role/**masked** email; bogus token 404; register-with-`inviteToken` auto-joins (claim is fire-and-forget — polled); token single-use after claim; **mismatched-email accept** binds the row to the accepting account; revoke via removeMember kills the token |
| T4 leave (2) | member `POST .../leave` → `{left:true}` then 404 on the project; owner leave → 400; non-member → 404 |
| T5 ML soft delete (2) | typed-name mismatch → 400 `Project name does not match`; correct + `cascadeLinked` → `{deleted:true, cascaded:[workspaceId]}`; 404 + absent from list after; **autosave to deleted → 200 `{skipped:true}`, no resurrection**; legacy `DELETE` keeps `{deleted:true}` |
| T6 one-way (1) | SIFT `DELETE` → 204; ML project survives (deliberate asymmetry per opinion doc §3) |
| T7 overview link (1) | `linkedMetaLab {id,title,missing:false,canOpen:true}` for owner; `missing:true, canOpen:false` after ML delete; `null` when unlinked |
| T8 RIS (1) | `?format=ris` → 200, `application/x-research-info-systems`, `TY  - JOUR`/`TI`/`ER  -` present; csv+json regression-green |
| T9 ops (6) | `animationSpeed` round-trips landing-content → public settings; `registrationOpen:false` → register 403; `maintenanceMode` → plain user 503 `{maintenance:true}`, admin passes, public settings exempt; all six new metrics groups + screening invite counters present and numeric; plain user 403 on admin metrics; `inviteExpiryDays` round-trip + `UPDATE_SIFT_SETTINGS` in the audit log; admin SIFT restore returns the project to its owner |
| T10 regression (1) | outsider → 404 (never 403) on a screening project |

Not duplicated here (already pinned elsewhere in the suite, all green): `/read`+`/dismiss` single-column
semantics and claim-on-register (prompt6 T1), export 403/404 permission matrix (prompt6 T17-adjacent),
viewer autosave contract (prompt6 T5), mod RBAC matrix (prompt6 T14/prompt7). Invite **expiry** (410) is
covered by the server-side smoke (`smoke-b2` ran 55/55 pre-QA) — flipping `inviteExpiresAt` requires direct
DB access that the API-only test convention avoids.

---

## prompt7 — Mod target-role enforcement, shared workspace chat, theme/icons/redesign (2026-06-10)

**Result:** ✅ **249/249 screening tests pass** (`npx vitest run tests/screening/ --no-file-parallelism`, server up).
Adds **+10** integration tests over the prompt6 total of 239: `integration/prompt7.test.js` (4, mod RBAC on user
targets) and `integration/prompt7-chat.test.js` (6, META·LAB chat door). `npm run build` exit 0 (sole advisories:
pre-existing monolith esbuild JSX warning + >500 kB chunk note). Full repo suite: **876 pass / 6 pre-existing
`serverStorage.test.js` fake-timer failures (quarantined, unchanged from baseline) / 7 skips**.

**Flipped assertions: NONE.** The whole pre-prompt7 suite is green unchanged — the new 403s (mod → admin/mod user
mutations) were previously-untested paths; the prompt6 T14 mod matrix passes as-is.

### prompt7.test.js inventory (4 tests — Task 1)

| Test | What is pinned |
|---|---|
| mod PATCH /users/:id | **403 on admin and mod targets** (pinned body `Moderators cannot modify administrator or moderator accounts`), incl. self-via-admin-route and email-takeover attempts; 200 on ordinary user with verify-by-read; admin target unchanged |
| mod reset-password | 403 on admin/mod targets with **no `tempPassword` leak** in the body; victim admin's original password still logs in; 200 + working temp password for an ordinary user |
| mod status | 403 suspending another mod (victim's console still 200); 200 suspend+unsuspend ordinary user |
| regression | mod role-assign stays 403; **admin PATCH mod profile stays 200** (admins manage mods); `MOD_TARGET_DENIED` SecurityEvent visible via `GET /admin/security-events` |

### prompt7-chat.test.js inventory (6 tests — Task 11)

| Test | What is pinned |
|---|---|
| shared thread | post via `/projects/:pid/chat` ↔ read via `/metalab/:mlpid/chat` in BOTH directions; same response shape; `?since` cursor on the metalab door |
| unread/read | unread-count via metalab door; `POST /metalab/:mlpid/chat/read` clears; read state shared across both doors (one `ScreenChatRead`); own messages never count |
| existence-hiding | non-member → **404** on all six metalab chat routes; standalone (unlinked) META·LAB project → 404 even for its owner; nonexistent id → 404 |
| chatRestricted | `readonly_both` member (canChat:false) post via metalab door → 403 (read stays 200); owner posts 200 |
| delete | DELETE own message via metalab door → 204; gone from BOTH doors (soft delete); non-sender member → 403 |
| SSE | `chat.message` poke carries `projectId` AND `metaLabProjectId` for a linked workspace; payload stays poke-only |

Schema: additive migration `20260610185705_add_theme_preference` (User.themePreference for the night/day toggle).

**Limitations:** UI-level theme/icon/redesign changes are verified by build + Playwright screenshots (night/day,
1366/1920/2560/3440) rather than DOM assertions; the `serverStorage.test.js` fake-timer failures remain quarantined
as in every prior prompt.

---

## prompt6 — Shared workspace: notifications, linked pair, read-only, SSE, fingerprint, ops (2026-06-10)

**Result:** ✅ **239/239 screening tests pass** (`npx vitest run tests/screening/ --no-file-parallelism`, server up).
Adds **+23** integration tests (`integration/prompt6.test.js`) over the prompt5 total of 216. `npm run build` exit 0
(sole advisories: the pre-existing `meta-lab-3-patched.jsx` ~L4047 esbuild JSX warning and the >500 kB chunk note —
both pre-date prompt6). Full repo suite: **866 pass / 6 pre-existing `serverStorage.test.js` fake-timer failures
(quarantined, unchanged from baseline) / 7 skips**.

**Flipped assertions: NONE.** Every prior suite was audited against the implementers' enumerated status-code flips
(B2: import/export/duplicates/labels/listDecisions/createProject-validation; B3: META·LAB member PUT/export/import;
B4: the new `'Provide stage, disabled/archived, or progressStatus'` 400 message). No existing test asserted the old
behavior — the flipped paths were all previously-untested *member* paths (owner stays 200, outsider stays 404, incl.
the 4 prompt5 `SEC*` adversarial tests, which pass unchanged). The entire pre-prompt6 suite is green without a single
assertion edit. One cosmetic fix: `tests/unit/effect-sizes.test.js:20` section comment "SMD (Hedges' g / Cohen's d)"
→ "SMD (Cohen's d — pooled-SD standardiser, no Hedges' g small-sample correction)" (truth-alignment with R1's
Cohen's-d documentation fix; zero assertion changes).

### prompt6.test.js inventory (23 tests)

| Area | Tests | What is pinned |
|---|---|---|
| T1 Notifications | 3 | invite → `PROJECT_INVITE` row (app/relatedScreenProjectId/relatedWorkspaceId alias/relatedMetaLabProjectId/role/actor); cross-user mark-read → **404** + counts isolated; unread-count; read → not unread; dismiss (hidden unless `?all=1`); mark-all-read; **persistence acceptance: fresh login → read state survived**; linked-workspace invite carries both ids + `app:'workspace'`; pending invite (userId null, no notification) → claim-on-register activates membership + creates the invite notification |
| T2 Linked creation | 4 | `POST /api/projects {createLinkedSift:true}` → `{project, linkedScreenProject}` same owner/title + `_linkedMetaSift`/`_permissions`; legacy POST stays bare (and creates no SIFT project); SIFT-side default creates no ML project, `alsoCreateMetaLab:true` does (verified live + linked); explicit-link create snapshots PICO (non-empty when ML has PICO); foreign/dead `linkedMetaLabProjectId` → **400** |
| T3/T8 Linked display | 1 | member (not just owner) gets `linked:true` + `screeningProjectId` from `GET /metalab/:mlpid/summary`; `GET /screening/projects/:pid` carries `linkedMetaLabProjectTitle`; member's `/api/projects` list shows `_linkedMetaSift` with **no relink action** |
| T5 Viewer read-only | 1 | viewer PUT → 403, export → 403, import references → 403, verify-by-read; **THE PINNED CONTRACT: viewer autosave → 200 + `skipped:true`, NEVER 4xx** (batch-save protection — do not "fix" read-only by 403-ing autosave); canEdit member PUT/export/import → 200; owner unaffected; outsider 404 everywhere |
| T6 Roles/modules | 2 | `modules:'metalab'/'metasift'/'both'` → canView* mapping (`metasift` also clears `canEditMetaLab`); invalid modules → 400; visibility consequence on the SIFT list; leader cannot assign leader preset (403), owner can; leader cannot touch the owner row |
| T7 SSE | 3 | no cookie → 401; 200 + `text/event-stream`; `:connected` immediately; member receives `notification.created`/`members.changed`/`chat.message` pokes with projectId; **scope-leak: outsider stream receives ZERO data frames**; thin-payload (no message/title/actor/email/decision keys on any frame); `:hb` heartbeat within ~30s (only test with a >25s budget); AbortController abort in `finally` always |
| T17 Import 403-vs-404 | 1 | outsider → 404; nonexistent pid → 404; viewer / plain reviewer (no `canImportRecords`) → 403; leader/owner/member-with-flag → 200; **viewer upgraded to leader imports successfully IMMEDIATELY** (no server-side permission cache) |
| T19 Import fingerprint | 1 | first import → `{imported, skippedDuplicates, total, batchId}` (total = parsed count); identical content → **409** `{error:'duplicate_import', batch:{filename, importedAt, importedByName, recordCount}}`; `force:true` → 200 with `imported:0` + `skippedDuplicates:2` (record-dedupe always on); same file in a different project → no 409 (per-project scope); CRLF vs LF → still 409 (normalization) |
| T9/T12 Ops metrics | 3 | `logins:{day,week,month,quarter,year}` all numbers + monotonic; 3 logins by one user → day +**1** exactly (distinctness); lastActive within last minute after a user action (recency window, never equality); doneToday counts done→in_progress→done as **1** (distinct project); admin PATCH `progressStatus:'bogus'` → 400 `invalid progressStatus`; empty PATCH → 400 `'Provide stage, disabled/archived, or progressStatus'`; same-value PATCH writes no event |
| T11 Ops linked + progress | 1 | `GET /api/admin/projects` rows carry `linkedMetaSift {id,title}` + `workspaceId` + `owner` + `status`; SIFT admin detail carries the 10-field `progress` block (total/screened/unscreened/included/excluded/maybe/conflicts/duplicates/secondReview/sentToExtraction) + `memberProgress` with real per-member counts |
| T14 Mod RBAC | 1 | mod allowed: console (`sections:['users','messages']`), users list, contact messages + replies + unread-count; mod denied (403): metrics/settings/feature-flags/audit-log/security-events/projects + ALL `/admin/screening/*` + role PATCH + message DELETE; plain user → 403 on every probed `/api/admin/*` route (lean matrix, ~35 requests, limiter is 1000/15min in non-production) |
| T18 Rename | 2 | ML rename → linked SIFT title follows when titles were equal (sync-if-in-sync); SIFT rename syncs back to ML; pre-diverged titles never sync (either direction); viewer rename → 403 on both sides |

### Manual-only remainder (cannot be automated in this harness — browser QA required)

- **Two-browser realtime**: A renames/edits PICO/screens/chats, B sees it without refresh; B's permissions revalidate
  after A changes B's role; the dirty-edit conflict banner ("Updated by a collaborator") instead of a clobbering refetch.
- **Bell UX on all 4 surfaces** (`/app`, SIFT dashboard, SIFT project, `/ops`): badge, 99+ cap, mark-read on click,
  panel list, mark-all-read, unread persisting across logout/login in the UI.
- **Deep link from a real click**: SIFT LinkBadge / bell → `/app?project=<id>` selects the exact project (never
  `projects[0]`); bogus/forbidden id shows the explicit "no access / link broken" panel; param stripped after consume.
- **Viewer UX polish**: controls hidden/disabled, "Read-only access" pill, autosave indicator never shows "failed"
  from skipped read-only PUTs (mixed own+shared batch).
- **Mod console navigation**: mod visits `/ops` (no 404), lands on Users, sees only Users+Messages nav, "Mod Console"
  chip, AccessDenied on direct nav to admin sections, role-derived fallback when the console fetch fails.
- **Methods & Equations tab rendering**: all entries render vs the engine whitelist, 4 amber "needs verification"
  badges, Not-implemented closer, SMD shown as Cohen's d (structural contract is unit-tested; pixels are not).
- **EventSource reconnect**: kill/restart the API server → stream reconnects (retry hint + capped backoff) without
  a page refresh; polling fallback carries chat/bell meanwhile.
- **Poll pause on hidden tab**: bell/chat polling pauses on `document.hidden` and resumes on focus.

Run: `npm run server`, then `npx vitest run tests/screening/ --no-file-parallelism`.

---

## prompt5 — Owner/Leader, linked project access, versioning, ops fixes (2026-06-09)

**Result:** ✅ **216/216 screening tests pass** (+9 `integration/prompt5.test.js`: 5 feature + 4 `SEC*` security
regressions). `vite build` clean. Full integration+unit suite: only the **6 pre-existing** `serverStorage.test.js`
fake-timer failures remain (that frontend bridge file is **untouched** — `git status` clean). `api-health` updated
(version no longer hardcoded). `prompt3 BUG4` updated (owner's role is now `owner`, not `leader`).

**Adversarial review + fixes:** a multi-agent review of the diff confirmed 9 issues (then re-verified the fixes
complete). Fixed before delivery, each with a regression test: privilege escalation via raw permission flags / missing
self-guard / global-flag grants (`SEC1`), cross-owner link-repoint data leak (`SEC2`), admin-archived projects still
reachable + `canManageSettings` UI/backend mismatch (`SEC3`), and per-staff isolation of the admin Overview unread
metric (`SEC4`).

| Task | Delivered | Verified |
|------|-----------|----------|
| T1 Separate Owner from Leader | owner role is `owner` (not `leader`) everywhere; API returns `owner`+`leaders[]` as separate fields; UI chips/colors distinct; `creator`→`owner` complete | `prompt5 T1/T2`, `T3` |
| T2 Lock owner/leader rows + server guards | owner row locked for all; leader rows owner-only; only owner grants/promotes/removes leaders; member w/ `canManageMembers` manages reviewers/viewers only; audit on every change | `prompt5 T1/T2` (leader→owner 403, leader→leader 403, demote-owner 400, reviewer-manage 403) |
| T3 Created/updated date | `listProjects` returns `createdAt`/`updatedAt`; cards + monolith header render Created/Modified | `prompt5 T3` |
| T4 Linked member access | `metalabAccess.js`; `/api/projects` returns owned+shared; membership-aware get/autosave; read-only no-op (batch-safe); cross-module visibility gating; repair script | `prompt5 T4/T6` (extractor edits persist; read-only no-op ignored; readonly_metasift hidden from META·LAB; readonly_metalab hidden from META·SIFT) |
| T5 Project Control tab | new `ProjectControlTab` (status/blind/chat + link/unlink + embedded Members); `?tab=members` alias | build |
| T6 Member sync | shared `ScreenProjectMember` is the source of truth; add/remove/permission apply to both modules immediately | `prompt5 T4/T6` |
| T7 Version per commit | `version.js` env→generated→git→fallback; `commit`+`commitDate`+`buildDate`+`full`; `scripts/generate-version.js`; `npm run version:gen`; health endpoints report real version | `prompt5 T7`, live `/api/version` |
| T8 Account dropdown everywhere | shared `UserMenu` added to ops console top bar (already in META·LAB + META·SIFT) | build |
| T9 Ops message read clears | per-staff `ContactMessageRead`; `unread-count` + `mark-read` endpoints; `box=` per-staff filter; badge uses per-staff count (works for mods); fixed undefined-`setUnread` bug | `prompt5 T9` + live curl (create→unread→mark-read→baseline; second staffer unaffected) |

Schema: additive migration `20260609230000_add_contact_message_read` (`ContactMessageRead`). Repair:
`node server/scripts/repair-linked-access.js` (healed 13 projects / 3 linked workspaces on the dev DB).
Full report: `docs/manager/meta-sift-roles-and-linked-access-report.md`.

**Limitations:** no ownership-transfer flow yet; META·LAB read-only enforcement is by backend no-op save + a read-only
banner (no deep per-field editor gating inside the monolith — deferred to avoid breaking META·LAB); no headless-browser
click-through (logic covered by live-API integration + clean build; manual browser pass recommended).

---

## prompt4 — Server-ready upgrade (2026-06-09)

**Result:** ✅ **207/207 screening tests pass** (+4 `integration/prompt4.test.js`). `vite build` clean. Email-reply fallback verified live (200 + draft when SMTP unconfigured).

| Task | Delivered | Verified |
|------|-----------|----------|
| T1 User dropdown in META·SIFT | Shared `components/UserMenu.jsx` (used by META·LAB + META·SIFT; profile, cross-app link, Ops/Mod console for admin+mod, version, sign-out) | build |
| T2 Admin user editing | adminController: updateUser (name/email), status, reset-password (temp pw once), updateUserRole (last-admin guard) | `prompt4 T2/T3` live |
| T3 Mod role | `requireRole`/`requireAdminOrMod`; routes split mod-allowed vs admin-only; `/api/admin/console` role descriptor; server-enforced | `prompt4 T2/T3` (mod sees users, blocked from metrics; user 403) |
| T4 Email replies | `emailService.js` (nodemailer dynamic import, env SMTP); `/contact-messages/:id/reply` + `/replies`; META·LAB template; draft fallback when unconfigured | live curl (200, draft) |
| T5 Deployment readiness | env-driven CORS, `.env.example` (root+server), `docs/manager/deployment-readiness.md`, `server/docs/email-setup.md` | — |
| T6 Versioning | `server/version.js` + public `GET /api/version` `{name,version,commit,buildDate}`; shown in UserMenu + console | `prompt4 T6` live |
| T7 Chat typing + notifications | in-memory project-scoped typing (TTL 6s) via chat poll `typing[]` + `/chat/typing`; ChatLauncher "X is typing…"; per-user unread badge (prompt3) | `prompt4 T7` |
| T8 creator→owner + model | `ScreenProjectMember.role 'owner'`; access.js full perms for owner/leader; leader cannot edit/demote owner; self-healing migration of legacy owner rows | `prompt4 T8/T9` + collab |
| T9 Review Workspace | module-permission flags on member (META·LAB/META·SIFT/global) + shared `permissionPresets.js` + preset add UI; create+link META·SIFT from META·LAB (monolith); accepted-study pull-merge (prompt3) | `prompt4 T8/T9` |

Schema: additive migration `..._workspace_perms_and_contact_replies` (member permission flags + ContactReply + ContactMessage.replied).
**Limitations:** META·LAB-side read-only *enforcement* is surfaced via permissions but the single-owner `Project` model isn't deeply membership-gated yet (documented); no headless browser click-through; typing is per-instance in-memory (multi-instance needs Redis/WS — documented in deployment-readiness.md).

---

## prompt3 — Targeted bug fixes (2026-06-09)

**Result:** ✅ **203/203 screening tests pass** (122 unit + 42 keyword-filter unit + 39 integration). `vite build` clean.

| Bug | Root cause | Fix | Verified by |
|-----|-----------|-----|-------------|
| 1 · Include keywords not showing | Legacy projects created before keyword-seeding had empty include lists (only exclude appeared, via fallback); browser tab was also stale | Backfilled all projects to 28 include / 52 exclude (`server/scripts/backfill-keywords.js`); leader "Reset to defaults" button; server + frontend fallback; **render-proven** the panel shows both lists | `prompt3 › BUG 1` (keyword-stats returns defaults + article counts) |
| 2 · Chat badge always after login | Unread was derived from all loaded messages on mount (every history msg counted) | New `ScreenChatRead` (lastReadAt per user/project) + `unread-count` / `mark-read` endpoints; ChatLauncher fetches server count, marks read on open | `prompt3 › BUG 2` (per-user count, persists across re-login, re-arms on new msg) |
| 3 · PDF "connection was reset" | `downloadPdf` streamed with no Content-Length and ignored Range; Chrome's PDF viewer Range request got a full chunked 200 → reset | Range-aware streaming: `Accept-Ranges`, `Content-Length`, `206 Partial Content` + bounded `createReadStream` | `prompt3 › BUG 3` (200 advertises ranges; `bytes=0-99` → 206 + Content-Range) |
| 4 · Project cards lack context | List endpoint didn't return linked title / leader / role | `listProjects` adds `linkedMetaLabProjectTitle`, `leaderName/Email`, `currentUserRole`, `totalArticles`, `status`; card shows linked project, "You are leader", leader, members, status | `prompt3 › BUG 4` |
| 5 · Accepted studies not in Data Extraction | Server push could be clobbered by a stale-state autosave / no reload | `metalab/:id/summary` now returns `acceptedStudies` (with `screeningRecordId` provenance); META·LAB `MetaSiftPrismaSync` pull-merges them into `project.studies` idempotently (DOI/PMID/title/recordId) | `prompt3 › BUG 5` + `prompt2 › Task 4/5` (study lands in `studies[]`) |
| 6 · Member progress leakage | `getOverview` returned all members + whole-project progress to everyone | Server gates by role: non-leaders get only their own member row + `projectProgress: null`; OverviewTab shows "My Progress" only | `prompt3 › BUG 6` (member sees 1 row, null projectProgress; leader sees all) |

New suites: `integration/prompt3.test.js` (6). Schema: additive migration `20260609164836_add_chat_read_state` (ScreenChatRead). **Limitation:** still no headless-browser click-through (no browser tooling) — verified via live-API integration + a `renderToStaticMarkup` proof that the keyword panel renders both lists; manual browser pass recommended.

---

## prompt2 — Integration upgrade (2026-06-09)

**Scope:** PDF preview, resolved-conflict → second review, admin control panel,
META·LAB association ("Review Workspace"), Data-Extraction handoff status, chat
drawer, new/viewed/dispute indicators, default keyword filtering/highlighting.

**Result:** ✅ **197/197 screening tests pass** (122 unit + 42 keyword-filter unit + 33 integration).

Run: `npm run server`, then `npx vitest run tests/screening/ --no-file-parallelism`.

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Keyword filter / counts / safe highlight (new) | `unit/keywordFilter.test.js` | 42 | ✅ |
| prompt2 integration (new) | `integration/prompt2.test.js` | 6 | ✅ |
| Collaboration integration (prompt1) | `integration/collaboration.test.js` | 7 | ✅ |
| Screening API baseline (prompt1) | `integration/screening-api.test.js` | 20 | ✅ |
| Unit (dedup/keywords/highlight/stats/conflicts) | `unit/*.test.js` | 122 | ✅ |

### prompt2 task → test coverage

| prompt2 task | Verified by | Status |
|---|---|---|
| 1 · PDF preview (inline, members-only, no public URL) | `prompt2 › Task 1` (inline `application/pdf`, 401 unauth) + `collaboration › PDF upload` | ✅ |
| 2 · Resolved-Include conflict → Second Review | `prompt2 › Task 2` (include promotes `promotedVia=conflict_resolution`; exclude/maybe do not; reviewer blocked from conflicts) | ✅ |
| 3 · Admin control panel toggles | `prompt2 › Task 3` (allowPdfUpload/allowChat/allowSecondReview enforced) + live admin endpoint smoke | ✅ |
| 4 · META·LAB association (link/unlink, rollup) | `prompt2 › Task 4/5` (linkable list, link, handoff rollup counts) | ✅ |
| 5 · Second Review → Data Extraction handoff | `prompt2 › Task 4/5` (sent + study lands in `studies[]`) & `Task 5` (pending→link→retry→sent; retry→already_exists) | ✅ |
| 8 · Default keywords + counts + filtering | `prompt2 › Task 8` (seeded defaults) + `keywordFilter` unit (counts ARTICLES, OR/AND filter, safe segments) | ✅ |

### Frontend (Tasks 1, 6, 7, 8 UI)

- `vite build` clean (73 modules). New components: `PdfViewer` (inline iframe
  preview, used by Screening + Second Review), `ChatLauncher` (project-level
  right-side drawer, unread badge, focus-retained composer, outside-click close),
  keyword filter panel (checkboxes + per-keyword article counts + Select-all +
  Show more/less + shown/total + green/red highlight toggles + clear filters),
  left-column **NEW**/viewed marker + ⚠ dispute icon + 2nd-review/Sent badges.
- **Limitation:** no automated browser click-through this session (no headless
  browser tooling available). Flow logic is covered by the live-API integration
  tests above; rendering is covered by a clean production build. Manual browser QA
  of the new panels is the recommended next step.

---

## prompt1 — Collaboration upgrade (2026-06-08)

**Date:** 2026-06-08
**Scope:** META·SIFT collaborative screening upgrade (prompt1.md, Parts 1–16)
**Result:** ✅ **149/149 screening tests pass** · backend verified end-to-end against the live API

---

## 1. Automated test summary

Run: server up (`npm run server`), then `npx vitest run tests/screening/ --no-file-parallelism`.

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Deduplication + similarity | `unit/deduplication.test.js` | 50 | ✅ |
| PICO keyword extraction | `unit/keywords.test.js` | 18 | ✅ |
| Inclusion/exclusion highlighting | `unit/highlight.test.js` | 21 | ✅ |
| Decision stats | `unit/stats.test.js` | 16 | ✅ |
| Conflict detection | `unit/conflicts.test.js` | 17 | ✅ |
| Screening API (baseline) | `integration/screening-api.test.js` | 20 | ✅ |
| **Collaboration (new)** | `integration/collaboration.test.js` | 7 | ✅ |
| **Total** | | **149** | ✅ |

Integration tests self-skip when the server is down (`beforeAll` health probe), matching the project convention.

---

## 2. Part 16 "Required tests" coverage

| Required test | Where verified | Status |
|---------------|----------------|--------|
| admin seed works / `ops@metalab.local` works | `collaboration.test.js` (admin login) + startup `seedAdmins()` | ✅ |
| project leader creation (creator → leader) | `collaboration.test.js` | ✅ |
| member add / remove | `collaboration.test.js` (+ smoke-membership) | ✅ |
| role / status changes | `collaboration.test.js` | ✅ |
| one decision per reviewer per record **per stage** | `collaboration.test.js` | ✅ |
| quorum include rule (2 distinct includes → promote) | `collaboration.test.js` | ✅ |
| second review handoff | `collaboration.test.js` | ✅ |
| data-extraction handoff (→ META·LAB `studies[]`, dedupe) | `collaboration.test.js` | ✅ |
| PRISMA auto-update (metalab summary) | `collaboration.test.js` | ✅ |
| PICO keyword extraction | `unit/keywords.test.js` | ✅ |
| inclusion/exclusion highlighting | `unit/highlight.test.js` | ✅ |
| duplicate similarity % (explainable) | `unit/deduplication.test.js` + `collaboration.test.js` | ✅ |
| vertical duplicate view renders | DuplicatesTab (build-verified; see §4) | ⚠ UI |
| per-member opened state | `collaboration.test.js` | ✅ |
| project chat access control | `collaboration.test.js` (members-only + sanitize) | ✅ |
| PDF upload validation | `collaboration.test.js` (mime + magic-byte + replace + delete) | ✅ |
| user ownership / membership security | `collaboration.test.js` (non-member 404, viewer/inactive 403) | ✅ |
| META·SIFT disable does NOT break META·LAB | `collaboration.test.js` | ✅ |

---

## 3. End-to-end flow (API-level, automated)

The 54-step manual QA flow from Part 16 is covered at the API/data layer by the integration tests, which drive a real project through the full lifecycle:

create project → creator is leader → add 2nd reviewer (by email) → import/create records → run duplicate detection (similarity % surfaced) → reviewer 1 + reviewer 2 decisions → one-decision-per-reviewer-per-stage enforced → quorum (2 includes) auto-promotes to Second Review → reviewer cannot finalize / leader accepts → study appended to linked META·LAB `studies[]` (dedupe, `siftOrigin`, `needsReview`) → `metalab/:id/summary` reports PRISMA numbers → reject keeps record with reason → chat (members-only, sanitized, polling) → per-member open-state → PDF upload (valid accepted, fake/non-PDF rejected) → blind mode / viewer / inactive / non-member access controls → admin disable → META·SIFT 503 while META·LAB stays 200 → re-enable.

All of the above is green.

---

## 4. Known limitations / honesty notes

- **Browser UI click-through not performed.** This session has no browser/headless tool, so the React UI was verified by a clean production build (`vite build` ✅, 72 modules) and by exercising every endpoint the UI calls — but a human-style click-through of the 3-column workbench, vertical duplicates, chat panel, etc. was not run. **Recommended next step:** `npm run dev` and walk the 54 steps in a browser (or re-run in a session with a browser tool).
- **Pre-existing unrelated failures:** `tests/unit/serverStorage.test.js` has **6 failing assertions** (autosave "saving/saved" status pub-sub timing). These files are **unmodified by this work** (`git status` clean) and the failures **reproduce in isolation on the original code** — they are pre-existing and unrelated to META·SIFT, which does not import `serverStorage`. Reported here per the "do not hide failures" rule; not fixed because touching the META·LAB autosave core is out of scope and risk-bearing.
- **PRISMA mapping:** while screening is in progress, `excludedTitleAbstract` is computed as `screened − fullTextAssessed`, which lumps still-undecided records with excluded ones until screening completes (documented in `docs/manager/`).

---

## 5. How to reproduce

```bash
# 1. start the API (loads server/.env, seeds admins)
npm run server
# 2. in another shell, run the screening suite
npx vitest run tests/screening/ --no-file-parallelism
# unit-only (no server needed):
npx vitest run tests/screening/unit/
```

The smoke scripts under `scripts/smoke-*.mjs` and `server/scripts/smoke-secondreview.mjs` are standalone equivalents kept for manual debugging.

---

## prompt18 — Unified Review Workspace (Screening as one stage)

**What was tested:** the new resolver/repair endpoint `GET /api/screening/metalab/:mlpid/workspace`
and the unified-project flow, plus a no-regression pass on the screening + integration suites.

New suite: `tests/screening/integration/prompt18.test.js` (live API on 127.0.0.1:3001):

| # | Case | Result |
|---|------|--------|
| T1 | Create project with `createLinkedSift` → screening module created; workspace resolves it (`created:false`) | ✅ |
| T2 | "Old" project (no module) → module auto-created on first resolve (`created:true`); idempotent on repeat (`created:false`) | ✅ |
| T3 | Workspace member resolves the SAME module (`created:false`); a stranger gets 404 | ✅ |
| T4 | Unknown META·LAB project id → 404 | ✅ |
| T5 | Admin `GET /screening/workspace-health` returns the engine roll-up; non-admin → 403 | ✅ |
| T6 | Admin repair backfills missing modules; `missing_after === failed`; legacy project then resolves `created:false` | ✅ |

**Run results (this session):**
- Unit: **653 passed / 6 pre-existing fails** (`serverStorage.test.js` timing — untouched by this work). No new regressions.
- Integration (live server): screening + integration suites green, including prompt18 (5) and prompt2 link/handoff/conflict/second-review/PDF/admin (6).
- Fixed a stale assertion in `prompt6.test.js` T2 (`_linkedMetaSift` gained prompt11 landing-card keys; switched `toEqual` → `toMatchObject` for the identity subset).

**Coverage of prompt18 acceptance items:** create→module ✅(T1); ensure idempotent ✅(T2); old project gets module on demand ✅(T2 repair); screening uses correct module ✅(T1/T3 same id); extraction handoff + PRISMA sync ✅(prompt2); permissions/no-leak ✅(T3/T4); no duplicate module ✅(T2).

**Reproduce:**
```bash
npm run server
npx vitest run tests/screening/integration/prompt18.test.js --pool=forks --poolOptions.forks.singleFork=true
node server/scripts/backfill-workspaces.js   # one-time data repair for pre-existing projects
```

---

## prompt19 — Screening rebuild, required reviewers, forest fix, dashboard, ops country map

**Result (this session):** build green; integration **31 files / 325 passed / 0 failed / 7 skipped**; unit **653 passed / 6 pre-existing** (serverStorage timing). No new regressions.

New suites (live server):
- `tests/screening/integration/prompt19-reviewers.test.js` — **7 passed**: getProject exposes `requiredScreeningReviewers` (default 2); one include doesn't advance, second does; include+exclude = conflict; owner raises to 3 (two no longer enough, third advances); non-leader 403 on change; backend rejects insufficient-distinct-decision advance (no forge bypass); validation (non-integer→400, out-of-range clamped).
- `tests/integration/prompt19-countries.test.js` — **12 passed**: `GET /api/admin/users/countries` shape for admin; non-admin → 403; registration still 201 with/without a country header (geolocation never blocks); country-level only, no raw IP leak.

Regression anchors re-run green: `prompt2.test.js` (6 — promotion/handoff still correct with default required=2), full `tests/screening/integration` + `tests/integration`.

Task coverage: broken tabs (root cause = 960px clamp, fixed via full-bleed focus workspace) · required reviewers (FE+BE+enforcement) · forest plot live theme/responsive (export preserved) · dashboard linked/unlinked filters removed · ops users-by-country (capture + endpoint + map). META·SIFT is internal-only; the user sees Screening.
