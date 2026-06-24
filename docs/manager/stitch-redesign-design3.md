# Stitch core project pages — implementation report (design3.md)

Native Stitch versions of the five deep project tools — **Project Control, PICO, Plan &
Protocol, Search Builder, Search Discovery** — now render inside ONE shared Stitch project
shell with real online-member presence, reached natively (no `?ui=legacy` design flip),
reusing the legacy backend/state/autosave/validation/permissions with **zero data
duplication**. Builds on the design2 navigation layer. CI: **2276 tests green**; `vite build`
green. Parity audit: `.claude/implementation-plans/stitch-core-project-pages-parity.md` +
`.claude/Engine/design3-audit/{A..E}.md`.

## 1. Files created
- `src/frontend/stitch/pages/StitchProjectWorkspace.jsx` — the `?tab=`-routed native project
  workspace: loads the project + presence once, renders the overview or a deep-tool page in
  the shared shell (rail + page header + presence + next-step), lazy-loading each editor body.
- `src/frontend/stitch/shell/useStitchProjectDoc.js` — standalone project loader + blob
  `upd/updNested` bridge (debounced `api.projects.autosave` — the same endpoint the monolith
  uses; read-only-gated; flush-on-unmount). The native equivalent of the monolith's plumbing.
- `src/frontend/stitch/shell/StitchProjectPresence.jsx` — reusable online-members strip.
- `tests/unit/stitchProjectWorkspace.test.jsx` — SSR smoke.
- `.claude/implementation-plans/stitch-core-project-pages-parity.md` — the parity doc.

## 2. Files modified
- `src/frontend/stitch/nav/navConfig.js` — `STAGE_KIND` marks control/pico/prospero/search/
  discovery as `'stitch'`; `projectStageHref` emits `/app/project/:id?tab=<id>` (no `?ui=legacy`).
- `src/App.jsx` — project route `stitch=` now `StitchProjectWorkspace` (was StitchProjectOverview).
- `tests/unit/stitchNavRedesign.test.jsx` — updated deep-tool href assertions + design3 cases.

## 3. Shared components introduced
`StitchProjectWorkspace` (shell + page header + presence + next-step), `useStitchProjectDoc`
(load/blob-autosave bridge), `StitchProjectPresence`. The collapsible workflow rail
(`StitchProjectRail`) + `StitchAppShell` from design2 are reused as the shell chrome.

## 4. Legacy features identified / 5. represented in Stitch
Each tool's full feature inventory is in the audit files. Every capability is preserved
because each native page mounts the proven, self-contained editor inside Stitch chrome:
- **Project Control** → `ControlTab` (project info/status/blind/chat/required-reviewers/
  create-&-link/archive/delete-with-name-confirm) + its embedded `ProjectMembersPanel`
  (members/roles/invites incl. RoB + extraction permissions/leave/transfer). All `screeningApi`/
  `api.projects.*` calls + the full role matrix preserved server-side.
- **PICO** → `PICODispatcher` (flag-aware: server `protocol` module when `serverBackedWorkflowState`
  ON; blob `project.pico` via the bridge when OFF) — P/I/C/O, question, study design, timeframe,
  PROSPERO id, keywords, `"• item\n"` criteria, required-field readiness, autosave, conflict,
  field locks (`lockCtx`).
- **Plan & Protocol** → `PlanProtocolDispatcher` — 20 PROSPERO fields + deterministic draft
  generator (copy/download), flag-aware persistence.
- **Search Builder** → `SearchDispatcher` → `SearchBuilderTab` (own `/api/search-builder` engine:
  terms/MeSH/boolean/live PubMed counts/strategies/copy/save/history; legacy `SearchTab` when flag OFF).
- **Search Discovery** → `DiscoveryDispatcher` → `PecanSearchTab` (own `/api/pecan-search` engine:
  run/preview/dedup/import/report/cancel; native inert note when flag OFF).

## 6. Legacy issues corrected
None required; the bridge reuses the exact autosave endpoint + read-only semantics.

## 7. Permission behavior verified
Read-only derived from `project._readOnly || _permissions.readOnly`; the bridge no-ops read-only
writes (server also no-ops). All member/role/settings authorization stays in `screeningApi` +
the server (no client-only enforcement). Discovery receives `readOnly`. The admin design switch
and `DesignRoute` gating are untouched.

## 8. Presence behavior implemented
`useProjectPresence(linkedSiftId(project), stageLabel, {heartbeat:true})` + `PresenceIndicator`
on every deep-tool page — real, project-scoped (the linked ScreenProject), SSE-refreshed, 75s
server-side staleness prune, reconnect-safe via `useRealtime`, avatars/initials + accessible
names + overflow popover. Exactly one heartbeating component per tab (the page that IS the
location); the screening engine on its own route keeps its own heartbeat.

## 9-11. Tests / results / build
+1 SSR smoke (workspace); updated nav assertions. `npm run test:ci` → **2276 passed** (151
files). `vite build` → success (deep-tool bodies code-split: protocolTabs/overviewTabs/
PresenceIndicator are their own chunks; the workspace module stays light via `React.lazy`).

## 12. Remaining limitations / 13. backend deps / 14. future work
- **Editor bodies reuse the proven legacy/feature editors** (harmonized to Stitch via the design2
  `--t-*` token remap) rather than bespoke native-Stitch-styled forms. This guarantees full
  functional parity + zero data-duplication risk; fully native-styled PICO/Protocol/Control card
  layouts (on the standalone `useProtocolState`/`usePlanProtocolState` hooks the audit identified)
  are the recommended next visual step.
- The **project overview** page (`StitchProjectOverview`) does not yet show the presence strip
  (the 5 explicitly-required deep tools do) — a small addition (it already loads members).
- Search Builder/Discovery render only when their flags (`searchEngine`/`pecanSearch`) are ON;
  OFF behavior matches the legacy dispatchers (legacy SearchTab / inert note) — no fake controls.

## 15. Page-by-page parity summary
| Page | Native route | Functional parity | Presence | Source of truth |
|---|---|---|---|---|
| Project Control | `?tab=control` | full (ControlTab + members panel) | yes | ScreenProject + project blob |
| PICO | `?tab=pico` | full (flag-aware module/blob) | yes | `protocol` module / `project.pico` |
| Plan & Protocol | `?tab=prospero` | full | yes | `planProtocol` module / `project.prospero` |
| Search Builder | `?tab=search` | full (engine) | yes | `/api/search-builder` |
| Search Discovery | `?tab=discovery` | full (engine) | yes | `/api/pecan-search` |

All reuse the same backend, APIs, authorization, autosave and workflow state as the legacy UI;
switching designs loses no data and the legacy workspace remains fully operational.
