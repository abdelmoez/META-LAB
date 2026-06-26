# 56.md — Unified PecanRev project workspace (implementation report)

A major, production-grade refinement of the admin-only **Stitch** project experience:
navigation, workflow visibility, project presence, theme cohesion. Built **audit-first**
(Phase-1 parallel audit → shared architecture → implementation → adversarial review →
fix), populating the existing centralized machinery (`navConfig`, the shell's submenu
slot, the screening-state model) rather than inventing parallel systems. The **legacy
theme, routes, permissions, project data, engine separation and autosave are untouched.**

## Summary of changes

| § | Area | What landed |
|---|------|-------------|
| §2 | Coordinated purple+white nav shell | Rail + white submenu are ONE region driven by a single CSS var `--prail-w`; the submenu tracks the rail (`left:var(--prail-w)`) and can never be covered/clipped; hover/focus expands as an overlay (no content reflow), pinned reflows once. |
| §3 | Main vertical project stepper | The purple rail renders the 6-stage Research Workflow as a numbered vertical stepper with connectors + non-color status (check/number/alert + label). |
| §4 | Screening vertical stepper | The Screen submenu is a detailed vertical stepper from the SAME `buildScreeningSteps()` model as the horizontal one — live counts ("312 unresolved", "1,796 remaining"), attention states, prerequisites. |
| §5 | Presence consistency | `totalMembersOf()` — one shared member-count source across every project page (was `members.length` vs `memberCount`). |
| §6 | Pin the sidebar open | New `useSidebarPin` (optimistic + persisted + cross-tab) backed by a new nullable `User.projectSidebarPinned`. Default collapsed. |
| §7 | Grouping + separators | Rail grouped into Project Management / Research Workflow / Project Resources with separators between. |
| §8 | Back to Projects | Labelled control above Overview, links directly to `/app` (never `history.back()`), works collapsed + expanded. |
| §1 | Overview redesign | Calmer command center: compact header → ONE context-aware Continue → quiet two-column body (Workflow summary, Attention required, My work, metrics, protocol-at-a-glance, team), empty sections omitted, progressive disclosure. |
| §10 | Stitch theme audit | RoB judgment pills + NMA banners/buttons now theme-aware (fixes Stitch-dark AND legacy-night); documented remaining cosmetic follow-ons. |

## Final navigation architecture

Purple rail (single source of truth = `nav/navConfig.js`):

```
[ PR ]  · pin ⊙
← Back to Projects
──────────────
PROJECT MANAGEMENT
  ◻ Overview
  ◻ Project Control
──────────────
RESEARCH WORKFLOW            (vertical stepper, status from stepStatus())
  ① Plan & Protocol  ✓
  ② Search           ◷
  ③ Screen           !        ← attention when conflicts/dups unresolved
  ④ Extract
  ⑤ Analyze
  ⑥ Report
──────────────
PROJECT RESOURCES
  ◻ Reference
──────────────
[ avatar ] name · v3.x
```

- **Single source of truth** (`navConfig.js`): `PROJECT_CATEGORIES`, `PROJECT_NAV_GROUPS`,
  `buildRailGroups` (numbers the 6 workflow steps), `submenuForCategory`, `categoryForStage`,
  `activeSubmenuKey`, `projectsHref`, `railWorkflowStepCount`. The rail, submenu, main
  stepper, screening stepper and active-route detection all derive from it.
- **One status language** (`nav/navStatus.js`): `statusMeta` (glyph + label, never color
  alone) + `rollUpStatus`. Shared by the rail glyphs, the main stepper and the submenu.
- Every child maps to an EXISTING `?tab=`/`?screen=` route — **no new routes**.

## Purple ↔ white interaction model (§2)

`stitchTokens.js` `.stitch-wsnav*` CSS + `StitchAppShell` (`coordinatedNav`):

| State | `--prail-w` | Reserved in-flow width | Submenu | Content |
|-------|-------------|------------------------|---------|---------|
| Collapsed (default) | 72px | 72 (+280 submenu) | attached at 72 | full |
| Hover / focus-within (unpinned) | 248px | unchanged | slides to left:248 **as overlay** | not reflowed |
| Pinned | 248px | 248 (+280 submenu) | attached at 248 | reflows once |

The rail (`z 46`) and submenu (`z 45`) are absolutely positioned inside the
`.stitch-wsnav` group; on hover they paint OVER the main content (which is a flex
sibling) and are never clipped (the group is `overflow:visible`; only the rail clips its
own labels). They share one transition timing so they animate together. Respects
`prefers-reduced-motion`.

## Pinning & persistence (§6)

`useSidebarPin` → server-canonical `user.projectSidebarPinned` (cross-device), localStorage
mirror (survives refresh before `getMe`, syncs across tabs), optimistic toggle via
`api.profile.update({projectSidebarPinned})` with revert on failure. Backend: nullable
`Boolean? projectSidebarPinned` in **both** prisma schemas (sqlite + postgres — additive,
`prisma db push`-safe), selected in `getMe` + profile `PROFILE_SELECT`, validated
(boolean|null) + persisted in `updateProfile`. Default (null) = collapsed.

## Workflow data sources (no fabricated state)

- Main stepper per-category status = `rollUpStatus(categoryStageStatuses(cat, stepStatus(project)))`
  — the SAME `stepStatus()` truth the legacy sidebar and Overview use.
- Screen "needs attention" + the screening vertical stepper = `buildScreeningSteps(summary)`
  where `summary = screeningApi.getOverview(spId).dataSummary` via `useScreeningSummary`
  (ONE fetch + realtime `decision.saved`/`handoff.updated` refresh — **no polling loop**).
- Overview "Attention required"/"My work" = pure `overviewModel.js` over
  `auditProject`/`readinessCheck`/`stepStatus` + screening conflicts, gated by permissions.

## Presence architecture (§5)

Unchanged backend hook `useProjectPresence` (30s heartbeat, realtime refresh, 75s server
prune, current user counted). `PresenceIndicator` already harmonizes under Stitch (its
`C.grn` is `var(--t-grn)` → remapped). The only real inconsistency — total-members source
— is closed by `totalMembersOf(project, members)` (prefer cached `memberCount`, fall back
to roster length), used identically on Overview and the deep-tool workspace. Presence
renders once, in the top bar, on every linked project page.

## Theme-compliance audit (§10)

Phase-1 fanned out per engine. Result: the screening engine, extraction, PICO/protocol,
search builder, the funnel plot etc. already harmonize because they style via
`C`/`var(--t-*)` tokens which `legacyRemap` re-tunes under `html[data-ui-design="stitch"]`.
**Fixed** (genuine hardcoded hex that broke dark mode / looked off-brand in BOTH themes):

- `rob/judgmentStyle.js` — on-screen pill `bg/fg` now token-based (`hex` kept absolute for the SVG/PNG export rasteriser).
- `workspace/tabs/nmaTab.jsx` — button text, banners, readiness/status colors → tokens / `color-mix`.
- `workspace/charts/charts.jsx` (**recs round**) — the LIVE forest plot now follows the app
  theme TOKENS (like the funnel plot already did) instead of a fixed indigo DARK/LIGHT
  palette, so it harmonizes with the Stitch light/dark themes (and a custom admin brand)
  and the legacy themes. The publication/"Dark (screen)" EXPORT render (`live=false`) keeps
  its absolute hex unchanged.

**Verified non-issues:** the modal/drawer dark scrim (dark scrims are standard in both
light + dark), the notification badge (`C.accText` on `C.red` resolves to readable
fg/bg in both themes), and the white toggle-thumb/avatar text (white-on-colored is the
standard, theme-independent pattern). Left as-is.

## Files changed

New: `stitch/shell/{useSidebarPin,useScreeningSummary,presence}.js`,
`stitch/pages/overviewModel.js`, `tests/unit/{stitch56Nav.test.js,stitch56Components.test.jsx}`,
this report. Modified: `stitch/nav/navConfig.js`, `stitch/theme/stitchTokens.js`,
`stitch/shell/{StitchAppShell,StitchProjectRail,StitchProjectSubnav}.jsx`,
`stitch/pages/{StitchProjectWorkspace,StitchProjectOverview}.jsx`,
`server/prisma/{schema,postgres/schema}.prisma`,
`server/controllers/{profileController,authController}.js`,
`rob/judgmentStyle.js`, `workspace/tabs/nmaTab.jsx`.

## Tests / build / commands

- `npm run build` ✓ · `npx vitest run tests/unit tests/screening/unit` → **2436 pass** (+23 new, 0 regressions; baseline 2413).
- New unit tests: nav grouping + Back-to-Projects + step numbering; `totalMembersOf` edge cases; `buildMyWork`/`buildAttention` role-aware gating; SSR smoke of the rail (groups, stepper, active step, pin `aria-pressed`, separators) and the screening vertical stepper (live counts, active step, disabled-when-unlinked).

## DB migration

Additive only: `projectSidebarPinned Boolean?` (nullable) on `User` in both schemas →
operator runs `prisma db push` (no data migration, backward-compatible; old clients
ignore the field, new clients treat null as collapsed).

## Preservation

Legacy theme, all routes, permissions, role gating, screening/extraction/analysis/report/
reference data, presence, project switching, admin-only design switching, deep links,
autosave — all preserved. No data reset/reseed.

## Required-review fixes (post-implementation, all confirmed)

A fresh 4-lens (UX / architecture / a11y / correctness) adversarial review with per-finding
verification reported **zero confirmed high-severity issues**. Fixed: white focus ring on the
purple rail (WCAG 2.4.7 — the brand ring was purple-on-purple, invisible); disabled screening
rows now expose the "available once screening is set up" reason in `aria-label` (a disabled
button can't receive the hover tooltip). Also self-caught + fixed: the unpinned reserved rail
width was tied to `--prail-w` (would reflow content on hover) → fixed to a constant; the mobile
drawer rail labels were hidden (not inside `.stitch-wsnav`) → `stitch-prail-static` reveal rule.

## Remaining limitations (honest)

- Mobile is a single stacked drawer (rail + submenu, full-label) — functional, with pinning
  correctly disabled on small screens; a layered category→submenu drill-down is a follow-on.
- Visual-regression (Playwright) coverage of every nav state is scaffolded (`playwright.config.ts`)
  but the spec suite is a remaining QA pass (needs a running app + auth, out of scope here).
