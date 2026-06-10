# META·SIFT — QA Report (collaboration upgrade)

> **Update 2026-06-09 (prompt5 roles / linked access / version / ops-read):** ✅ **216/216 screening tests pass**.
> prompt5 section below; prompt4/prompt3/prompt2/prompt1 sections follow unchanged.

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
