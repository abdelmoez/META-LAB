# META·SIFT Collaboration Upgrade — Final Report

**Date:** 2026-06-08 · **Driver:** `.claude/Prompts/prompt1.md` (Parts 1–16)
**Outcome:** Collaborative, multi-reviewer screening system integrated with META·LAB, kept fully removable. Backend verified end-to-end (149/149 screening tests); frontend builds clean.

---

## 1. What was built
A real collaborative screening product on top of the existing META·SIFT Beta:
- **Members & roles** (leader / reviewer / viewer), leader powers, add-by-email + pending invites.
- **Two-reviewer decisions** with one active decision **per reviewer per record per stage**, and a **quorum rule** (≥2 distinct includes) that auto-promotes records.
- **Second Review** (full-text) stage with leader accept/reject and **handoff into META·LAB Data Extraction**.
- **PICO highlighting** (green inclusion / red exclusion) + auto keyword extraction.
- **Duplicate management** with an explainable **0–100 similarity %** and a vertical comparison view.
- **Per-member open-state**, **project chat** (polling), **PDF upload per article**, **blind mode from overview**, **audit log**, **project status**, an **Overview dashboard**, a **3-column screening workbench**, an improved **project list**, and **admin controls** with enforced feature flags.
- **META·LAB integration:** manual title/abstract screening hidden, **PRISMA diagram auto-fills** from linked META·SIFT data, extraction shows a **META·SIFT** provenance badge.

## 2. Files changed (high level)
**Backend (`server/`):** `prisma/schema.prisma` (+5 models, +fields); new `screening/access.js`, `screening/settings.js`, `load-env.js`, `auth/seedAdmins.js`; new controllers `screeningMemberController.js`, `screeningReviewController.js`, `screeningChatController.js`, `screeningOverviewController.js`, `screeningPdfController.js`; extended `screeningController.js`, `screeningAdminController.js`, `routes/screening.js`, `index.js`; deps `dotenv`, `multer`.
**Research engine (`src/research-engine/screening/`):** new `keywords.js`, `highlight.js`; extended `deduplication.js` (scoring).
**Frontend (`src/frontend/screening/`):** new `ui/` (theme/components/highlightRender), `tabs/` (Overview, Screening, SecondReview, Duplicates, Conflicts, Members, Export), `components/ChatPanel.jsx`, `pages/SiftProject.jsx`; extended `api-client/screeningApi.js`, `pages/SiftDashboard.jsx`, `pages/admin/AdminConsole.jsx`; `src/App.jsx` routing.
**Monolith:** `meta-lab-3-patched.jsx` (PRISMA auto-sync + extraction badge; manual screening hidden).
**Tests:** new `tests/screening/unit/{keywords,highlight}.test.js`, extended `deduplication.test.js`, new `tests/screening/integration/collaboration.test.js`.

## 3. Database migration
One additive migration: `20260608213133_metasift_collab_upgrade`. New tables: `ScreenProjectMember`, `ScreenChatMessage`, `ScreenPdfAttachment`, `ScreenRecordOpenState`, `ScreenAuditLog`. New columns on `ScreenProject` (progressStatus, archived, disabled, inclusion/exclusionKeywords, studyTypeFilter, picoSnapshot, chatRestricted), `ScreenRecord` (currentStage, finalStatus, promotedAt, acceptedAt, rejectedReason), `ScreenDecision` (reviewerName, stage; unique widened to `[recordId, reviewerId, stage]`). **Additive only — existing data preserved** (verified: 377 users / 5 projects / records / decisions intact via SQLite `INSERT…SELECT` table-redefine).

## 4. Project isolation
One app DB, every `Screen*` row scoped by `projectId`, access via `getProjectAccess` (owner or active member → else 404), role/permission gated. Full detail in **`project-data-isolation.md`**.

## 5. Reviewer quorum
`ScreenDecision` is unique per `[recordId, reviewerId, stage]` (one active decision per reviewer per stage). On each `include` at `title_abstract`, the server counts distinct includes; at `QUORUM = 2` (`server/screening/access.js`) it sets `record.currentStage='full_text'` + `promotedAt`. The UI grays "advance" until quorum and shows `N/2`.

## 6. Second review
Promoted (`full_text`) records appear in the Second Review tab. Reviewers cast full-text decisions (`saveDecision` with `stage:'full_text'`); the leader finalizes accept/reject (`finalizeRecord`). Reject sets `finalStatus='rejected'` + reason; accept sets `finalStatus='accepted'` + `acceptedAt` and triggers handoff. All audited.

## 7. Data Extraction handoff
On accept, `handoffToMetaLab` loads the linked META·LAB project (must be owned by the screening owner), parses `Project.data` JSON, and appends a `mkStudy()`-shaped study (title/authors/year/journal/doi/pmid/abstract + `siftOrigin:true` + `needsReview:true` + provenance). **Dedupe** by DOI/PMID/normalised title prevents repeats. No link → returns `{handed:false, reason:'no_link'}` and the UI prompts to link.

## 8. PRISMA auto-update
`GET /api/screening/metalab/:mlpid/summary` finds the linked screening project and derives PRISMA numbers (identified, duplicatesRemoved, screened, excludedTitleAbstract, fullTextAssessed, fullTextExcluded, included). In the monolith, `MetaSiftPrismaSync` fetches this on the PRISMA tab and writes into `project.prisma.*` (idempotent; skips redundant writes), with link/empty/error states that never crash.

## 9. PDF upload
`multer` memory storage → magic-byte (`%PDF-`) + mime + extension validation, 25MB cap → written to `server/storage/screening-pdfs/<projectId>/<uuid>.pdf` with metadata in `ScreenPdfAttachment`. Members-only; streamed through an authenticated route (never a public URL); upload replaces the prior file; uploader/leader can delete. **Future-ready:** swap the two fs helpers for S3/Supabase.

## 10. Project chat
Members-only; `GET /chat?since=<ISO>` polling cursor; `POST /chat` sanitises (strips HTML tags + control chars; React escapes on render — no unsafe HTML). Leader can restrict posting (`chatRestricted`) so only `canChat` members send. Stored in `ScreenChatMessage` (sender, time, body, status, soft-delete).

## 11. Blind mode
Leader-toggled from Overview (`updateProject({blindMode})`, audited). When on, non-leaders get anonymised reviewer identities (`Reviewer 1/2…`), hidden author/journal in lists, and no per-reviewer attribution — enforced server-side in `listRecords`, `listSecondReview`, members/overview shaping.

## 12. Duplicate similarity
`scorePair(a,b)` in `deduplication.js`: exact DOI/PMID → 100; else weighted blend of title similarity (0.7, normalised Levenshtein), author-surname Jaccard (0.15), year match (0.15), scaled to 0–100 with a human reason ("92% title similarity; authors overlap; same year"). `listDuplicates` surfaces the max-pairwise score + reason per group; the Duplicates tab renders records **vertically** with a color-coded badge.

## 13. Admin `ops@metalab.local` fix
Root cause: there was **no `dotenv`** and `index.js` never loaded `server/.env`, so `JWT_SECRET` was unset and `jwt.js` threw — breaking **all** logins at runtime (the DB credentials were valid). Fix: `server/load-env.js` (first import) loads `server/.env` regardless of CWD; added idempotent startup `seedAdmins()` (creates missing admins, never resets a changed password). Verified: `ops@metalab.local` logs in with role `admin`.

## 14. Manual QA project (E2E)
The full Part-16 lifecycle is covered at the API layer by `collaboration.test.js` (create → leader → add reviewer → records → duplicates+similarity → dual decisions → per-stage uniqueness → quorum → second review → leader accept → handoff → PRISMA summary → reject-with-reason → chat → open-state → PDF validation → blind/viewer/inactive/non-member access → admin disable keeps META·LAB up). **All green.** Browser click-through was not performed (no browser tool this session) — see Limitations.

## 15. Automated test results
`npx vitest run tests/screening/ --no-file-parallelism` → **149/149 pass** (122 unit + 7 collaboration + 20 baseline). Full project suite: **632 pass / 7 skip / 6 pre-existing failures** in `tests/unit/serverStorage.test.js` (autosave timing, unmodified by this work — disclosed, not introduced). Backend additionally proven by smoke suites (15/15, 9/9, 14/14, 11/11). `vite build` ✅.

## 16. Known limitations
- No browser/headless UI click-through this session — UI is build-verified + endpoint-verified only.
- 6 pre-existing `serverStorage` autosave test failures (not ours).
- In-progress `excludedTitleAbstract` lumps undecided with excluded until screening completes.
- Chat is polling (WebSockets deferred by design). PDF storage is local-disk (S3/Supabase-ready but not wired).
- Pending invites are records only (no email delivery in local MVP).

## 17. Recommended next steps
1. Browser E2E walk-through of the 54 steps (`npm run dev`), then convert key flows to Playwright.
2. Email delivery for pending invites.
3. WebSocket upgrade for chat + reviewer presence.
4. Wire S3/Supabase for PDFs in production.
5. Investigate/repair the pre-existing `serverStorage` autosave tests (separate from this work).

---

## Tools / skills used (and why)
- **Subagents (Agent tool):** 4 parallel recon mappers (read-only) to map the codebase fast; 1 background research-engine dev (keywords/highlight/similarity + tests); 6 parallel frontend devs (one per tab) on a shared design-system contract — the "team" model from the prompt, used for breadth + parallelism.
- **Prisma migrate** (additive migration), **Vitest** (unit + integration), **Vite build** (compile gate), **dotenv/multer** (env + uploads). Live-server smoke scripts for fast backend verification before committing tests.
- Workflow/multi-agent orchestration tool was **not** used (the per-tab subagent fan-out + manual integration was sufficient and kept me in the loop for verification).
