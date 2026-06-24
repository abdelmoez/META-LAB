# TOPIC E — Functional Parity Matrix: Legacy project Overview vs Stitch ProjectOverview

Read-only audit. Evidence cited as `file:Lnn`. No app code changed.

## Files in scope
- **Legacy Overview tab component**: `src/frontend/workspace/tabs/overviewTabs.jsx` → `OverviewTab` (L253–495)
- **Legacy detailed project header** (Overview only): `src/frontend/workspace/Workspace.jsx` L1488–1529
- **Legacy universal header bar** (every tab): `src/frontend/workspace/tabs/overviewTabs.jsx` → `ProjectHeaderBar` (L139–200)
- **Legacy Audit drawer**: `overviewTabs.jsx` → `AuditPanel` (L29–81); driven by `auditProject()` in `projectHelpers.js` L304–365
- **Legacy Project Control tab** (sibling, "Project Control access"): `overviewTabs.jsx` → `ControlTab` (L507–818)
- **Legacy sidebar workflow stepper** (per-step status dots): `Workspace.jsx` L1213–1330 (uses `stepStatus`)
- **Pure engine**: `src/frontend/workspace/projectHelpers.js` (stepStatus L261–301, readinessCheck L244–258, auditProject L304–365, projectPerms L370–378, linkedSiftId L380–382, TABS L199–229, PHASES L230, CTRL_STATUS_OPTIONS L385–389)
- **Landing helpers**: `src/frontend/pages/projectLanding.helpers.js` (statusOf L21–27, STATUS_META L29–34, relTime L58–73, ROLE_LABEL L13, progressOf L80–86)
- **Stitch overview**: `src/frontend/stitch/pages/StitchProjectOverview.jsx` (L87–517)

## Data sources / API signatures (quoted)
- `api.projects.get(projectId)` → full project blob (canonical). apiClient `projects` L63; returns `{ id,name,createdAt,updatedAt,_archived,_archivedAt,_studyCount,_recordCount,_permissions,_linkedMetaSift }` (apiClient L70).
- `api.exportProject(id)` = `req(`${BASE}/export/project/${id}`)` — apiClient.js **L345**.
- `api.projects.archive(id)` = `req(`${BASE}/projects/${id}/archive`, {method:"POST"})` — apiClient **L135-136**; `unarchive` **L144-145**; `confirmDelete(id, body)` **L123**.
- `screeningApi.getOverview(pid)` = `req('GET', `/projects/${pid}/overview`)` — screeningApi.js **L104**. Server `screeningOverviewController.js`: returns `{ dataSummary:{ totalArticles, confirmedDuplicates, unresolvedDuplicateGroups, resolvedDuplicateGroups, disputedDecisions, unresolvedConflicts, eligibleSecondReview, acceptedToExtraction, rejectedSecond, ... } (L135-141), projectProgress (leader-only, L146), eligibleSecondReview, acceptedToExtraction, conflicts (L116-119) }`.
- `screeningApi.listMembers(pid)` = `req('GET', `/projects/${pid}/members`)` — screeningApi.js **L108**. Returns `{ members, isOwner, isLeader, canManageMembers, myRole }`.
- **Legacy-only screening source**: `GET /api/screening/metalab/:id/summary` (raw `fetch`, overviewTabs.jsx **L276**). Server `screeningController.js` L1822-1832 returns a **PRISMA-shaped** payload Stitch does NOT use: `{ linked, screeningProjectId, title, prisma:{ identified, duplicatesRemoved, screened, excludedTitleAbstract, fullTextAssessed, fullTextExcluded, included }, screeningStarted, screeningComplete, screeningPending:{ titleAbstractPending, unresolvedConflicts, unresolvedDuplicateGroups, secondReviewPending }, acceptedStudies }`. **This is the single biggest data gap** — Stitch reads `getOverview` (a different shape) and never the PRISMA roll-up the legacy card shows.

---

## PARITY MATRIX

Legend for "In Stitch?": **yes** = present + equivalent; **partial** = present but reduced/different; **no** = absent.

| # | Feature | Legacy source (file:Lnn) | Data source/API | In Stitch? | Gap / what to add |
|---|---------|--------------------------|-----------------|------------|-------------------|
| **PROJECT IDENTITY / METADATA** |
| 1 | Project title (display) | overviewTabs `ProjectTitle` L91-128; header L1493; OverviewTab kv("Title") L338 | project.name | **yes** | StitchPageHeader title L278. |
| 2 | **Inline rename** (pencil → real `PUT /api/projects/:id`, syncs linked SIFT title) | `ProjectTitle` L91-128, `renameProject` wired L1493; gated `projectPerms().canEdit` | api.projects rename | **no** | Stitch has no rename. Add an editable title (owner/canEdit) calling the same rename path. |
| 3 | Owner name | OverviewTab kv("Owner") L338-346 (`project._owner.name||email`, fallback "You") | project._owner | **no** | Stitch shows "Your role" but never the OWNER's name/email. Add an Owner row in Project details. |
| 4 | Your role (+ read-only suffix) | OverviewTab L340-344 (`perms.role`, `read-only` suffix) | projectPerms() | **partial** | Stitch shows role badge (L291) + Project-details "Your role" (L417) but **drops the "· read-only" distinction**. Add read-only state to the role display. |
| 5 | Created date | OverviewTab kv("Created") L346 (`fmtDate`); header L1495 | project.created/createdAt | **yes** | Stitch DetailRow "Created" L416 (uses relTime, not absolute date — see #45). |
| 6 | Last modified date | OverviewTab kv("Last modified") L347; header L1495 | project.modified/updatedAt | **yes** | Stitch DetailRow "Last updated" L415 + subtitle L279 (relTime). |
| 7 | Studies-in-extraction count | OverviewTab stat L321 `studies.length`; header L1495 | project.studies / _studyCount | **yes** | Stitch metric L299 + DetailRow L418. |
| 8 | Lifecycle status badge (Active/In progress/Done/Archived) | NOT in legacy Overview tab; legacy derives via `statusOf` only on dashboard cards | projectLanding.helpers statusOf L21 | **yes (Stitch adds)** | Stitch badge L290 — actually an *improvement*; keep. |
| 9 | Archived badge | Legacy: header read-only/shared banners L1531; Danger-zone archive in Control | project._archived | **partial** | Stitch shows "Archived" badge L293 — fine. Legacy archive *action* is in Control (see #41). |
| **WORKFLOW PROGRESS** |
| 10 | Per-step status (done/partial/empty) for all 15 workflow tabs | sidebar stepper L1227-1330 (`stepStatus`); OverviewTab `status=stepStatus(...)` L299 | stepStatus() projectHelpers L261-301 | **yes** | Stitch rolls 15 steps into 6 phase cards (PHASE_STEPS L48-55) + per-step chips L474-479. Equivalent coverage. |
| 11 | "Workflow steps complete" count + ProgressBar (X / N) | OverviewTab L420-423 (`doneCount`/`wfTabs.length`) | stepStatus | **partial** | Stitch shows per-phase % + an overall % (overallPct L149) but **no explicit "X of 15 steps done" figure**. Add a steps-complete count. |
| 12 | Overall completion % | derived informally in legacy stepper headers | — | **yes (Stitch adds)** | Stitch overallPct subtitle L279, rail footer L214. Improvement. |
| 13 | Per-phase progress bars (6 phases) | sidebar phase headers L1257-1258 (phaseDone/steps) | stepStatus | **yes** | Stitch "Workflow progress" card L308-321. |
| 14 | "Next suggested step" card (first incomplete tab + partial-vs-empty copy + jump button) | OverviewTab L450-462 (`nextStep`, "Go to X →") | stepStatus walk L302 | **no** | **Important gap.** Stitch has phase cards but no single "do this next" call-to-action that names the exact next tab and deep-links to it. Add a Next-step card. |
| 15 | Extraction progress bar ("studies with an effect size", withES/total) | OverviewTab L424-427 (`withES`) | studies filter L294 | **partial** | Stitch shows "Studies extracted" count but **not the withES/total ratio or a bar**. Add effect-size completeness. |
| **SCREENING STATUS** |
| 16 | Live PRISMA roll-up: Imported · Duplicates · Screened · Full text · Included (5 numbers) | OverviewTab Screening Progress card L350-383, `scr.data.prisma` from `/metalab/:id/summary` | summary endpoint (screeningController L1826) | **partial** | Stitch shows isolated metrics (records L300, included L301, conflicts L302) from `getOverview.dataSummary`, **not the 5-stage PRISMA funnel**. Add the full identified→included funnel (source: summary endpoint or dataSummary). |
| 17 | Screening "Next action" hint ("Import references" / "Screen titles…" / "Review full text" / "Send to extraction") | OverviewTab L363 (computed from prisma counts) | summary prisma | **no** | Add a screening-specific next-action string. |
| 18 | Start/Continue Screening button (label flips on whether records exist) | OverviewTab L379-382 | — | **partial** | Stitch deep-links to `/sift-beta/projects/:linkedId` (L300, phase card L482) but the Screen phase card label is generic; no "Continue vs Start" based on record presence. Minor. |
| 19 | Live refetch on realtime screening events (handoff/decision/status) | OverviewTab `useRealtime` L287-291 | useRealtime hook | **no** | Stitch loads once (reload L98-125); no realtime subscription → numbers go stale after a Final-Review change elsewhere. Add useRealtime poke-refetch. |
| 20 | Screening complete signal feeding stepStatus("done") | summary `screeningComplete` L1813-1816; OverviewTab L299 | summary endpoint | **partial** | Stitch approximates via `_linkedMetaSift.progressStatus==='done'` (L135) instead of the authoritative `screeningComplete` flag — coarser/less accurate. Wire the summary endpoint's `screeningComplete`. |
| 21 | Workspace-members count stat | OverviewTab stat L324 (`mem.members.length`) | listMembers | **yes** | Stitch team card L373-410 + count via roster. |
| **PRISMA / REPORT STATUS** |
| 22 | PRISMA included count stat | OverviewTab stat L323 (`prisma.included`) | project.prisma | **partial** | Stitch "Included (to extraction)" L301 uses `dataSummary.acceptedToExtraction`, not `project.prisma.included`. Different source; verify intent. |
| 23 | PRISMA one-line summary (identified · dup removed · excl T/A · full-text excl · included + pooled k/I²) | OverviewTab L429-432 | project.prisma + runMeta | **no** | **Gap.** No PRISMA line and no pooled k/I² in Stitch. Add a compact PRISMA + meta-analysis summary line. |
| 24 | Pooled meta result (k, I²) inline | OverviewTab L431 (`runMeta(studies)`); header badge L1503 | runMeta | **no** | Add k/I² readout (the legacy header chip `k=… · I²=…%`). |
| **MEMBERSHIP / TEAM** |
| 25 | Members count | OverviewTab Team card L394; stat L324 | listMembers | **yes** | Stitch Team card lists members L394-407. |
| 26 | Leaders list (names) | OverviewTab L395 (`leaders.map`) | listMembers filter L307 | **partial** | Stitch shows per-member role badges but **no dedicated "Leaders" line**. Add leader call-out. |
| 27 | Per-member avatar + name + email + role badge | Not in legacy Overview (only counts) — full roster lives in Control/MembersTab | listMembers | **yes (Stitch adds)** | Stitch full roster L394-407 is an improvement over legacy Overview's counts. |
| 28 | "Manage members →" shortcut | OverviewTab L397 (→ control tab) | — | **partial** | Stitch "Manage" → `/sift-beta/projects/:id` (L377), not the Project Control members panel. Different destination. |
| 29 | Unlinked/empty-team state | OverviewTab L390 ("Open Screening once to set up…") | linkedSiftId | **yes** | Stitch empty states L379-392. |
| **READINESS / AUDIT / WARNINGS** |
| 30 | Readiness check (PICO P/I/C/O + timeframe + ≥3 DBs + saved search) with missing list | OverviewTab "Meta-analysis readiness" L435-448; header pill L1504-1513 | readinessCheck L244-258 | **yes** | Stitch "Readiness check" card L324-349 (same engine). |
| 31 | **Project Audit drawer** (high/med/low severity items, grouped, click-to-jump-to-phase) | `AuditPanel` L29-81; trigger header L1517-1525 + L171/176; `auditProject` L304-365 | auditProject | **no** | **Major gap.** Stitch has NO audit. The legacy audit surfaces ~30 methodological checks (missing eligibility criteria, no PROSPERO ID, RoB gaps, validation errors, duplicates, heterogeneity, GRADE/PRISMA-checklist completeness, etc.) with severity + deep-jump. Add an audit panel/summary. |
| 32 | "Missing (N)" / "✓ Audit" header button (count of high-severity audit items) | Workspace.jsx L1517-1525; ProjectHeaderBar badges L169-178 (`reqMissing`, `missingItems`) | auditProject high-sev count L466 | **no** | Add a missing-items count badge that opens the audit. |
| 33 | "Requirements missing (N)" pill → opens audit | header L1504-1513; ProjectHeaderBar L169-173 | readinessCheck.missing | **partial** | Stitch shows readiness missing list inline (L337-347) but as a static list, not a count pill; acceptable. |
| 34 | Shared/read-only project banner | Workspace.jsx L1531-1541 | project._shared/_readOnly | **partial** | Stitch shows role + read-only is dropped (#4). Add the shared-by-X / read-only banner. |
| **PROTOCOL / PICO** |
| 35 | PICO summary card (question + P/I/C/O lines, empty-state link) | OverviewTab PICO card L402-413 | project.pico | **no** | **Gap.** Stitch shows no PICO content at all. Add a PICO summary (question + P/I/C/O) with a "start PICO" empty state. |
| 36 | PROSPERO registration ID chip | header L1501 (`pico.prosperoId`) | project.pico.prosperoId | **no** | Add PROSPERO ID badge when present. |
| 37 | Study-design chip (e.g. RCT) | header L1502 (`pico.studyDesign`) | project.pico.studyDesign | **no** | Add study-design chip. |
| **EXPORT / IMPORT / VALIDATION** |
| 38 | Export project (JSON) | OverviewTab/header L1515; `openProjectExport` | api.exportProject L345 | **yes** | Stitch Export button L282-284 + `onExport` L187-204 (real download), gated on `perms.canExport`. |
| 39 | Import project (JSON file picker) | header L1516 (`importRef.click`) | client import | **partial** | Stitch "Import" L281 → opens classic workspace (`openClassicTab('overview')`), it does NOT import in-place. Acceptable hand-off but not functional parity. |
| 40 | Full Report export (PDF/HTML) | header L1514 (`openReportExport`) | report engine | **no** | **Gap.** No "Report" export in Stitch. Add report export action. |
| 41 | Journal submission ZIP (PRISMA + forests + methods + study table) | OverviewTab "Export & validation" L468-477; `onJournalZip` | openJournalSubmissionExport | **no** | **Gap.** Add the one-click journal ZIP. |
| 42 | R (metafor) validation script download (gated poolable≥2) | OverviewTab L479-491; `onRValidate` (`downloadRValidationScript`) | rValidation engine | **no** | **Gap.** Add the .R validation download (disabled until ≥2 poolable studies). |
| **PROJECT CONTROL ACCESS / LIFECYCLE** |
| 43 | Link to Project Control (status, members, settings, danger zone) | OverviewTab "Manage members →" L397 → control; sidebar Control tab L1213 | ControlTab L507 | **partial** | Stitch links to `/sift-beta/...` (screening) and `?ui=legacy&tab=control` only via the team "Link in workspace" empty-state button (L383). No first-class Project Control entry. Add an explicit "Project Control / Settings" link. |
| 44 | Project status select (not_started/in_progress/done) | ControlTab L672-681; CTRL_STATUS_OPTIONS L385-389 | screeningApi.updateProject | **no** | Stitch shows derived lifecycle badge (read-only) but cannot SET status. Add status control (owner/leader). |
| 45 | Screening & collaboration settings (blind mode, restrict chat, required reviewers) | ControlTab L702-742 | screeningApi.updateProject | **no** | Settings shortcuts absent in Stitch. Add (or link to) these toggles. |
| 46 | Danger zone — Archive / Unarchive | ControlTab L772-785; api.projects.archive L135 | api.projects | **no** | Add archive/unarchive (owner-only). |
| 47 | Danger zone — Delete (name-confirm, cascade linked) | ControlTab L786-816; api.projects.confirmDelete L123 | confirmDelete | **no** | Add owner-only delete with name confirmation. |
| 48 | "Create & link Screening" (owner, when unlinked) | ControlTab `createLink` L611-619 | screeningApi.createProject | **partial** | Stitch empty-state "Link in workspace" L383 only deep-links to legacy control; no in-Stitch create-link. |
| **HEADER / UTILITY CLUSTER** |
| 49 | Presence indicator (live collaborators) | ProjectHeaderBar L193 (`PresenceIndicator`) | realtime presence | **no** | No live presence in Stitch overview. Add presence chip. |
| 50 | Project chat launcher | ProjectHeaderBar L194 (`MetaLabChatLauncher`) | chat | **no** | No chat entry. Add chat launcher. |
| 51 | Notifications bell | ProjectHeaderBar L195 | notifications | **partial** | Provided by StitchAppShell globally (verify), not the overview itself. |
| 52 | Account/user menu | ProjectHeaderBar L196 | — | **partial** | Provided by StitchAppShell shell. |
| 53 | Workflow-menu collapse toggle + breadcrumb | ProjectHeaderBar L156-167 | — | **yes** | Stitch context rail + breadcrumb L207-242, L273. |
| **NAV / DEEP-LINKS** |
| 54 | Back to all projects | ProjectHeaderBar L189 | — | **yes** | Stitch "Back to dashboard" L211. |
| 55 | Open each workflow phase / tab | sidebar L1284; OverviewTab buttons | setTab | **yes** | Stitch phase cards deep-link (`?ui=legacy&tab=` L172-185); Screen→sift-beta; RoB→`/rob/:id` (L364). |
| 56 | Risk-of-Bias dedicated entry + permission gate | sidebar rob tab L1227; RoB perms | projectPerms.canAssessRiskOfBias | **yes** | Stitch RoB button L485-489 gated `perms.isOwner||canAssessRiskOfBias`. Improvement (explicit). |

---

## PRIORITIZED GAPS for a redesigned Stitch "research command center"

**MUST add (information/actions the legacy Overview surfaces that Stitch entirely lacks):**
1. **Project Audit** (#31/#32) — ~30 severity-graded methodological checks via `auditProject()` with deep-jump. Highest-value missing feature.
2. **PICO summary** (#35) + PROSPERO ID (#36) + study-design chip (#37) — protocol identity is invisible in Stitch.
3. **Full PRISMA funnel** (#16) + PRISMA/meta summary line with pooled k·I² (#23/#24) — Stitch shows scattered metrics, not the funnel.
4. **"Next suggested step" CTA** (#14) — the single most actionable element of the legacy Overview.
5. **Owner name** (#3) and **read-only/shared banner** (#4/#34).
6. **Export/validation actions**: Report export (#40), Journal ZIP (#41), R validation script (#42).
7. **Project Control surface**: status select (#44), screening/collab settings (#45), archive/delete danger zone (#46/#47), create-&-link (#48).
8. **Inline rename** (#2).

**SHOULD add:**
9. Realtime refetch of screening numbers (#19) + authoritative `screeningComplete` (#20).
10. Extraction effect-size completeness bar (#15) + explicit "X/15 steps done" (#11).
11. Leaders call-out (#26); presence (#49) + chat (#50) launchers.

**Stitch ALREADY improves on legacy (keep):** lifecycle status badge (#8), overall % (#12), full member roster with avatars (#27), explicit RoB permission gate (#56).

**Data-source caveat for implementers:**
- Legacy screening numbers come from `GET /api/screening/metalab/:id/summary` (PRISMA-shaped, `screeningController.js` L1822-1832). Stitch currently uses `screeningApi.getOverview` (`/projects/:id/overview`) which returns `dataSummary`/`projectProgress` — a DIFFERENT shape with no 5-stage funnel and no `screeningComplete`. To reach full parity, the Stitch overview should ALSO call the `metalab/:id/summary` endpoint (it already has `linkedSiftId`/`project.id`).
- `relTime` (Stitch) gives "x ago"; legacy `fmtDate` gives absolute dates. Consider showing both (tooltip) so Created/Modified are unambiguous (#45/#5/#6).
