# 55.md — Project navigation IA redesign (implementation report)

Audit-first (see `55-nav-audit.md`). The redesign **populates existing machinery**
(the centralized `navConfig`, the shell's `contextRail` slot, the screening
sub-stepper) rather than building new layout systems, and preserves every route,
permission, engine and piece of data. Landed in two commits; build + unit suite
green throughout (2875 unit pass; the only failures are pre-existing live-`:3001`
integration reachability guards).

## Final navigation hierarchy (purple rail = 9 categories)

```
Overview · Project Control · Plan & Protocol · Search · Screen · Extract · Analyze · Report · Reference
```

- **Overview / Project Control / Reference** are single destinations — NO white
  submenu (they reclaim the full width).
- **Plan & Protocol** → PICO & Question, Protocol
- **Search** → Search Builder, Search & Discovery
- **Screen** → Overview, Import, Duplicates, Title & Abstract, Conflicts, Final
  Review, Settings, Export (the screening sub-workflow, as a numbered sub-stepper) + **PRISMA Flow**
- **Extract** → Data Extraction, Risk of Bias *(RoB kept under Extract — current architecture)*
- **Analyze** → Meta-Analysis, Forest Plot, Sensitivity & Bias, Subgroup, Network Meta-Analysis
- **Report** → GRADE Certainty, PRISMA Checklist, Manuscript Draft

Every child maps to an existing `?tab=`/`?screen=` route — **no new routes**.

## Shared components / contract

- `nav/navConfig.js` (extended, back-compatible): `PROJECT_CATEGORIES`,
  `categoryForStage`, `submenuForCategory`, `categoryShowsSubmenu`, `activeSubmenuKey`,
  `categoryEntryHref`, `categoryStageStatuses`, `readScreenParam`, `buildCategoryNav`.
  The single source of truth for the rail, submenu, active-state and steppers.
- `nav/navStatus.js` (new): ONE status language — `statusMeta` (glyph + label, never
  color-only) + `rollUpStatus`. Shared by the rail glyphs and the submenu badges.
- `shell/StitchProjectSubnav.jsx` (new): the persistent white secondary sidebar
  rendered into the existing `StitchContextRail`. Route-derived active item
  (`aria-current`), permission-safe (disabled, not hidden, when unavailable),
  Screen renders a numbered sub-stepper.
- `shell/StitchProjectRail.jsx` (rewritten): 9 category buttons; per-category
  completion rolled up from `stepStatus()` with non-color glyphs; active category
  from the route; collapse/expand + keyboard preserved.

## Status language (one, non-color)

`stepStatus()` truth → `statusMeta`: Complete (check), In progress (clock), Not
started (hollow ring), Needs attention (alert). Glyph SHAPE + accessible label,
never color alone (WCAG 1.4.1) — satisfies #11/#12.

## Per-criterion status (30)

MET: #1 (9 categories), #2 (Overview no submenu — the screening pipeline column was
removed from Overview), #3 (Control no submenu), #4/#5 (persistent, non-hover white
submenu), #6 (route→category+submenu restoration), #7 (every engine in a category),
#8 (full screening sub-workflow in the Screen submenu), #11/#12 (non-color status),
#13 (engines backend-separate, frontend-integrated), #14 ("Active now" → top bar,
on Overview + deep-tool pages; in-content copies removed), #15 (presence still
project-scoped), #18 (permissions unchanged + backend-authoritative), #19/#20
(legacy + Stitch both functional), #21 (legacy design switch relocated inline into
the project header; floating pill hidden on project routes — no overlap), #25
(light/dark via tokens), #28 (no data touched).

PARTIAL / follow-on (documented, not faked):
- **#9 / #10** — the Screen submenu shows an ordered, route-aware sub-stepper, and
  the rail shows per-category roll-up status; a *richer* main workflow stepper with
  live screening counts/lock states in the submenu is a follow-on (the live counts
  already render in the screening engine body).
- **#16 / #17** — Overview leads with the next-action and now reclaims full width
  (submenu removed, presence moved out of content); a deeper progressive-disclosure
  pass on the lower cards is a follow-on.
- **#23 mobile** — the drawer shows the 9-category rail; a layered category→submenu
  drawer is a follow-on (desktop/tablet ≥1024px fully covered).
- **#26/#27/#29** — unit suite green + the nav contract is unit-tested
  (`stitch55Categories.test.js`); Playwright visual-regression across every submenu
  / compact-expanded rail / light-dark / breakpoints is the remaining QA pass.

## Tests / build

- `tests/unit/stitch55Categories.test.js` (new, +14): category contract, route→
  category, submenu visibility + children (incl. Screen = sub-workflow + PRISMA),
  active-submenu-key.
- `tests/unit/designModeUi.test.jsx`: updated to render the switch inside a Router
  (it now reads the route for #21).
- `npm run build` ✓ · 2875 unit pass.

## Preservation

Backend engine separation, routes, permissions, screening/extraction/analysis/
report/reference data, presence, project switching, legacy + Stitch designs,
admin-only design switching, deep links, autosave — all preserved. No schema or
data change.

## Remaining limitations (honest)

Richer main workflow stepper with live submenu counts (#9/#10 deep), Overview
progressive-disclosure polish (#17), layered mobile category→submenu drawer (#23),
permission-aware *hiding* of submenu children (today they render and the page/back
end gates — safer), and Playwright visual-regression coverage (#27). These are
scoped follow-ons; none block the IA, and nothing is faked.
