# Stitch core project pages — functional parity audit & plan (design3.md)

Scope: native Stitch versions of **Project Control, PICO, Plan & Protocol, Search Builder,
Search Discovery**, plus a shared in-project Stitch shell and real online-member presence.
Hard rule: reuse the legacy backend/state/autosave/validation/permissions with ZERO data
duplication; never break the legacy UI or the admin design switch.

Full evidence: `.claude/Engine/design3-audit/{A..E}.md`.

## Architecture decisions (from the 5-lead audit)

| Page | Verdict | How |
|---|---|---|
| Project Control | **Native cards + embed members** | Native Stitch cards call the same `screeningApi.updateProject`/`api.projects.*`; embed `ProjectMembersPanel` verbatim (purpose-built to embed; re-porting its seq-guarded concurrency code is high-risk for cosmetic gain). |
| PICO | **Native Stitch UI** | Flag-aware: `useProtocolState(projectId,{project,enabled})` when `serverBackedWorkflowState` ON; a blob-autosave bridge (`api.projects.autosave`) writing `project.pico` when OFF. Reuse `CriteriaList` bullet `"• item\n"` serialization, `STUDY_DESIGNS`, `TIMEFRAME_OPTIONS`, `timeframeComplete`. |
| Plan & Protocol | **Native Stitch UI** | Flag-aware `usePlanProtocolState`/blob; render the 20 `PROSP_FIELDS` grouped by section + the deterministic `buildProtocolDraft` generator (copy/download). |
| Search Builder | **Embed in native shell** | `SearchBuilderTab({projectId,pico,api,loadSearch,saveSearch})` — self-contained engine (own `/api/search-builder` tables), flag `searchEngine`. Native chrome (header/next-step/presence) + a normal scroll region. |
| Search Discovery | **Embed in native shell** | `PecanSearchTab({projectId,pico,readOnly})` — self-contained engine (own `/api/pecan-search`), flag `pecanSearch`. Native chrome; OFF → native "not enabled" note. |

## Routing (preserves deep links / permissions / design switch)
- New `StitchProjectWorkspace` at the existing `/app/project/:projectId` stitch route; reads
  `?tab=` via `activeProjectStage(useLocation().search)` (NOT `useSearchParams` — SSR test mock)
  and renders overview or the native tool page; unknown stages fall through to the overview.
- `navConfig.STAGE_KIND` gains `pico/prospero/search/discovery/control: 'stitch'`; the `'stitch'`
  branch of `projectStageHref` emits `/app/project/:id?tab=<id>` (NO `?ui=legacy`). The project
  rail + overview `goStage` then route natively with no further changes.

## Presence (real, project-scoped, reused)
- `useProjectPresence(spId, location, {enabled, heartbeat})` + `PresenceIndicator` — both standalone.
  `spId = linkedSiftId(project)`; `location` = the stage label; `heartbeat:true` on the page that
  IS the location; `myUserId = useAuth().user.id`; `totalMembers = members.length`. Server prunes
  >75s (no stale), SSE-refreshed, reconnect-safe via `useRealtime`. `StitchProjectPresence` wraps it.

## Shared shell
- `StitchProjectShell` — project rail (built in design2) + `StitchProjectPageHeader` (breadcrumb,
  title, status, autosave indicator, presence strip, next-step) + loading/error/permission states +
  scroll region. `useStitchProjectDoc(projectId)` loads `api.projects.get`, exposes perms/linkedId
  and a debounced blob `upd/updNested` (`api.projects.autosave`) for the flag-OFF paths.

## Parity matrix (condensed — full per-feature tables in the audit files)

| Page | Legacy feature | Status | Action | Validation |
|---|---|---|---|---|
| Control | project info (read-only) | reuse | render rows from `api.projects.get` | SSR + manual |
| Control | status / blind / restrict-chat / required-reviewers | reuse | native switches → `screeningApi.updateProject` | unit (gating) + manual |
| Control | create & link screening | reuse | `screeningApi.createProject` | manual |
| Control | members / roles / invites / RoB+extraction perms / leave / transfer | embed | `ProjectMembersPanel` | existing tests |
| Control | archive / unarchive / delete (name-confirm + cascade) | reuse | `api.projects.{archive,unarchive,confirmDelete}` | unit (match) + manual |
| PICO | P/I/C/O, question, study design, timeframe, PROSPERO id, keywords | native | `useProtocolState`/blob bridge | unit + manual |
| PICO | inclusion/exclusion criteria (`"• item\n"`) | native | reuse serialization | unit |
| PICO | required-field readiness | native | `['P','I','C','O']` filled | unit |
| PICO | autosave + save status + conflict | reuse | module hook / blob status | manual |
| Protocol | 20 PROSPERO fields + char limits | native | `usePlanProtocolState`/blob | manual |
| Protocol | draft generate / copy / download | reuse | `buildProtocolDraft` | manual |
| Search Builder | terms/MeSH/boolean/hit-counts/strategies/copy/save | embed | `SearchBuilderTab` | engine tests |
| Search Discovery | run/dedup/import/report/cancel | embed | `PecanSearchTab` | engine tests |

## Out of scope (documented, not native): screening/prisma/extraction/rob/analysis/report/methods
tabs (already reachable in their engines / legacy). Transfer-ownership UI optionally added to Control.

## Validation
Unit (nav config stage hrefs, presence formatting, deletion match, completion logic), SSR smoke
(each native page renders), full `npm run test:ci`, `vite build`, adversarial review.
