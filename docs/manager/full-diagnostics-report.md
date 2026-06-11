# Full Flow Diagnostics Report — Prompt 7 (Task 8)

**Method:** scripted end-to-end walkthrough of every flow in the prompt's Task 8 list against the live dev stack
(`.claude/tmp/prompt7/flow-diagnostics.mjs`, output `.claude/tmp/prompt7/flow-results.txt`), plus the full automated
test suites and Playwright visual QA in both themes at 1366/1920/2560/3440.
**Date:** 2026-06-10 · post-prompt7 working tree (v2.6.0).

---

## 1. Tested flows — 42 scripted checks

### META·LAB (17 checks)
register · login · create project · project overview fetch · create linked META·SIFT project · add member (reviewer)
· add member (read-only preset) · change member permissions · linked member can view shared project · **viewer
read-only enforced** (autosave returns `{skipped:true}`, data verified unchanged) · data extraction persists
(autosave studies) · PRISMA fields persist · linked META·SIFT summary (PRISMA sync source) · project rename ·
realtime SSE poke delivery (chat.message with `metaLabProjectId`) · admin/mod logins · mod limited access.

### META·SIFT (14 checks)
create/open linked project · import records (RIS) · **duplicate management** (import-time exact+fuzzy dedupe skips
planted near-duplicate; manual detect endpoint runs clean) · two-reviewer decisions (quorum) · conflict raised on
disagreement · conflict resolution (`finalDecision`) · second-review list · second-review accept (finalize) ·
**accepted article reaches the META·LAB Data Extraction feed** (`acceptedStudies` via the metalab summary) · project
overview rollup · project control status change · member-add notification created · owner/leader protection
(reviewer cannot promote to leader) · chat both doors (covered in depth by the 6 prompt7-chat integration tests).

### Ops / Admin / Mod (11 checks)
admin login · mod login · mod limited sections (`['users','messages']`) · mod blocked from metrics (403) · **mod
blocked from editing admin (403 — Task 1)** · admin edits user · public contact form accepted (now rate-limited) ·
message visible in inbox · mark-read clears unread count · reply with email fallback (draft persisted when SMTP
unconfigured, `sent:false` honest) · metrics include unique logins {day/week/month/quarter/year} · lastActive
tracked · sift project list shows linked META·LAB id+title · sift project detail shows progress counts.

## 2. Passed flows

**42 / 42 scripted flows pass.** Automated suites: screening **249/249**; full repo **876 pass / 7 skip / 6
quarantined pre-existing `serverStorage.test.js` failures** (untouched file, disclosed since prompt1).
`npm run build` exit 0.

UI-level flows verified by build + Playwright screenshots (night and day): landing render with animated evidence
panel · login/register restyle · META·LAB workspace with monochrome icon rail, 13-step workflow (Rayyan gone),
Overview alignment at 1366/1920/2560/3440 (4-up stat row, aligned 2-up rows, centered 960px container on ultrawide,
1100px single-column collapse) · header Chat launcher (enabled on linked project) · META·SIFT dashboard · ops
console overview in both themes. Keyword highlighting is covered by the existing 21-test unit suite
(`tests/screening/unit/highlight.test.js`) plus visual inspection.

## 3. Broken flows found during diagnostics

Three of my initial probe failures were **probe bugs, not app bugs** (wrong endpoint shapes: conflict resolution
uses `finalDecision`, finalize lives at `/records/:rid/finalize`, and the planted exact duplicate was correctly
removed at import time) — fixed in the probe, after which the app passed. Real defects found this round and fixed
**before** the flow run:

1. **Mod → admin/mod account mutation (critical)** — see security report F1–F3; now 403 + audited.
2. **prompt7-chat test self-collision** — the outsider test email collided with the owner's generated email
   (test bug); fixed in the test file.

No broken application flows remain in the Task 8 list.

## 4. Fixes implemented this round

- Server-side mod target-role enforcement + ops UI lock notes (Task 1).
- Shared workspace chat backend + frontend drawer in both apps (Task 11).
- Overview container alignment + responsive collapse (Task 2).
- Theme token system, night/day persistence, monochrome icons (Tasks 5/10).
- Rayyan & Screening removal with door consolidation (Task 6).
- Landing/Login/Register/Profile redesign; META·LAB/META·SIFT/ops token adoption + polish (Tasks 3/4).
- Security hardening: CSP, contact rate limit, dev.db untracked (Task 7).

## 5. Remaining recommended fixes

1. **"Total records: 0" in ops Platform Overview** while studies count is non-zero — the records counter reads the
   legacy META·LAB blob field, not META·SIFT `ScreenRecord` rows; cosmetic metric mislabel, fix by counting
   `screenRecord` or relabeling (pre-existing, out of this round's scope).
2. Legacy unrouted pages (`SiftWorkbench`, `SiftConflicts`, `SiftDuplicates`, `SiftExport`, `src/frontend/styles/`
   design system, monolith dead `ScreeningModule`/`MeSHTab`) still carry old palettes — harmless (never rendered),
   delete in a cleanup sprint.
3. The 6 quarantined `serverStorage.test.js` fake-timer tests should be rewritten against real timers or the
   subscription API redesigned for testability.
4. `git filter-repo` history purge for the previously committed `dev.db` (coordinated action, see security report).
5. Consider code-splitting the 900 kB bundle (landing visitors currently download the research engine).

## 6. Suggestions for the next major upgrade

See `docs/manager/claude-product-suggestions.md` (Task 9) — headline items: decompose the monolith tab-per-file,
promote studies/records out of the JSON blob into real tables, journal-submission export bundle, `metafor`/CSV
statistician interop, token-based password reset, demo-project onboarding, and the institutional trust kit
(audit-report export, self-hosting guide, permissions matrix documentation).
